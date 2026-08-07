//! SQLite: la verdad.
//!
//! Redis lleva la cola y el estado caliente, pero lo que tiene que sobrevivir a
//! un corte de luz a mitad de una indexación de días está aquí. Si Redis se
//! vacía, la cola se reconstruye leyendo qué imágenes siguen sin vector.

use std::path::Path;
use std::sync::Mutex;

use anyhow::Result;
use lumi_index::manifest::{FilaImagen, Tipo, TrabajoDe};
use rusqlite::{params, Connection};

const ESQUEMA: &str = "
CREATE TABLE IF NOT EXISTS indices (
    id         INTEGER PRIMARY KEY,
    nombre     TEXT NOT NULL,
    slug       TEXT NOT NULL UNIQUE,
    estado     TEXT NOT NULL CHECK (estado IN ('abierto','sellado')),
    ruta       TEXT,
    creado_en  INTEGER NOT NULL,
    sellado_en INTEGER
);

-- Una fila por cada vez que entra material. Cada imagen apunta a su lote, y
-- eso ES la cadena de custodia: no hace falta un campo «cómo llegó esto aquí»,
-- es la fila padre.
CREATE TABLE IF NOT EXISTS lotes (
    id         INTEGER PRIMARY KEY,
    indice_id  INTEGER NOT NULL,
    clase      TEXT NOT NULL CHECK (clase IN ('legacy','carpeta','herencia','red')),
    origen     TEXT NOT NULL,
    tipo       TEXT CHECK (tipo IN ('calle','cenital','suelta')),
    -- 'desconocida' es un valor como cualquier otro y sale en los porcentajes.
    fuente     TEXT NOT NULL,
    licencia   TEXT,
    atribucion TEXT,
    -- Si la procedencia la dijo el material o la declaró el operador. Un
    -- paquete legacy no la trae, así que la diferencia importa.
    declarada_por_operador INTEGER NOT NULL DEFAULT 0,
    estado     TEXT NOT NULL CHECK (estado IN ('pendiente','en_curso','hecho','error')),
    error      TEXT,
    reintentos INTEGER NOT NULL DEFAULT 0,
    version_indexer TEXT NOT NULL,
    creado_en  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS imagenes (
    id         INTEGER PRIMARY KEY,
    indice_id  INTEGER NOT NULL,
    lote_id    INTEGER NOT NULL,
    ruta       TEXT NOT NULL,
    sha256     TEXT NOT NULL,
    lat        REAL NOT NULL,
    lng        REAL NOT NULL,
    quadkey    TEXT NOT NULL,
    capturada_en TEXT,
    ancho      INTEGER,
    alto       INTEGER,
    -- Motivo por el que se saltó. Es un RESULTADO, no una avería: se anota y
    -- no se reintenta.
    saltada_motivo TEXT,
    creada_en  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS vectores (
    imagen_id INTEGER NOT NULL,
    modelo    TEXT NOT NULL,
    estado    TEXT NOT NULL CHECK (estado IN ('pendiente','hecho','fallo')),
    PRIMARY KEY (imagen_id, modelo)
);

-- Procedencia DEL TRABAJO: quién pagó la descarga y la GPU de cada tesela.
-- Suma 100 % porque una tesela la indexó exactamente uno.
CREATE TABLE IF NOT EXISTS teselas (
    indice_id INTEGER NOT NULL,
    quadkey   TEXT NOT NULL,
    trabajo   TEXT NOT NULL CHECK (trabajo IN ('aqui','local','catalogo')),
    fuente_indice TEXT,
    sha256    TEXT,
    PRIMARY KEY (indice_id, quadkey)
);

CREATE TABLE IF NOT EXISTS ajustes (
    clave  TEXT PRIMARY KEY,
    valor  TEXT,
    sellado BLOB
);

-- La caché de sondeos. Solo la necesitan los orígenes que se sondean por
-- muestreo: los de teselas vectoriales los pinta el navegador y no pasan
-- por aquí.
CREATE TABLE IF NOT EXISTS sondeos (
    fuente      TEXT NOT NULL,
    quadkey     TEXT NOT NULL,
    nivel       TEXT NOT NULL CHECK (nivel IN ('mucho','poco','nada')),
    estimadas   INTEGER NOT NULL,
    sondeado_en INTEGER NOT NULL,
    PRIMARY KEY (fuente, quadkey)
);

-- El libro de gasto. Una fila por día y origen, y NADA SE BORRA: es el
-- registro de lo que se pagó, no un contador que se pueda poner a cero.
CREATE TABLE IF NOT EXISTS gasto (
    dia      TEXT NOT NULL,
    fuente   TEXT NOT NULL,
    unidades INTEGER NOT NULL,
    coste    REAL NOT NULL,
    PRIMARY KEY (dia, fuente)
);

-- La unidad de trabajo de una descarga. Que esto sea una tabla es lo que
-- hace que cortar una descarga a la mitad no cueste dinero al retomarla.
CREATE TABLE IF NOT EXISTS descargas (
    indice_id  INTEGER NOT NULL,
    fuente     TEXT NOT NULL,
    quadkey    TEXT NOT NULL,
    estado     TEXT NOT NULL CHECK (estado IN ('en_curso','hecho','error')),
    imagenes   INTEGER NOT NULL DEFAULT 0,
    unidades   INTEGER NOT NULL DEFAULT 0,
    reintentos INTEGER NOT NULL DEFAULT 0,
    motivo     TEXT,
    PRIMARY KEY (indice_id, fuente, quadkey)
);

CREATE INDEX IF NOT EXISTS imagenes_por_indice ON imagenes(indice_id);
CREATE INDEX IF NOT EXISTS imagenes_por_quadkey ON imagenes(indice_id, quadkey);
CREATE INDEX IF NOT EXISTS lotes_por_indice ON lotes(indice_id);
CREATE INDEX IF NOT EXISTS vectores_pendientes ON vectores(modelo) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS gasto_por_mes ON gasto(dia);
";

pub struct Almacen(Mutex<Connection>);

impl Almacen {
    pub fn abrir(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        let c = Connection::open(dir.join("indexer.db"))?;
        // WAL: lectores concurrentes junto a un escritor. El volumen de
        // escritura aquí es estado de lote, no una carga transaccional.
        c.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA busy_timeout = 5000;
             PRAGMA synchronous = NORMAL;",
        )?;
        c.execute_batch(ESQUEMA)?;
        // Migración idempotente: `CREATE TABLE IF NOT EXISTS` no toca una tabla
        // que ya existe, así que las columnas nuevas se añaden aparte y se
        // ignora el error de «ya existe». Es la forma más barata de que una
        // base del 7a siga abriendo.
        for alter in [
            // Estado de revisión: NULL en todo lo que no la necesita (calle,
            // cenital), 'pendiente' | 'aceptada' | 'rechazada' en las sueltas.
            "ALTER TABLE imagenes ADD COLUMN revision TEXT",
            // Lo que el proveedor dijo de la propia foto, que es lo que decide
            // si viaja en el paquete cuando la licencia va por imagen.
            "ALTER TABLE imagenes ADD COLUMN licencia TEXT",
            "ALTER TABLE imagenes ADD COLUMN atribucion TEXT",
            "ALTER TABLE imagenes ADD COLUMN id_origen TEXT",
            "ALTER TABLE imagenes ADD COLUMN rumbo REAL",
        ] {
            let _ = c.execute(alter, []);
        }

        // `clase` gana 'red'. En SQLite un CHECK no se altera, así que en una
        // base del 7a se recrea la tabla con el CHECK nuevo. Es barato:
        // `lotes` tiene una fila por tanda de material, no por imagen.
        let hay_red: bool = c
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='lotes'",
                [],
                |r| r.get::<_, String>(0),
            )
            .map(|sql| sql.contains("'red'"))
            .unwrap_or(true);
        if !hay_red {
            c.execute_batch("ALTER TABLE lotes RENAME TO lotes_viejos")?;
            c.execute_batch(ESQUEMA)?; // recrea `lotes` con el CHECK nuevo
            c.execute_batch(
                "INSERT INTO lotes SELECT * FROM lotes_viejos; DROP TABLE lotes_viejos;",
            )?;
        }
        Ok(Self(Mutex::new(c)))
    }

    fn ahora() -> i64 {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0)
    }

    pub fn crear_indice(&self, nombre: &str, slug: &str) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO indices (nombre, slug, estado, creado_en) VALUES (?1, ?2, 'abierto', ?3)",
            params![nombre, slug, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
    }

    pub fn crear_lote(
        &self,
        indice_id: i64,
        clase: &str,
        origen: &str,
        tipo: Option<&str>,
        fuente: &str,
        licencia: Option<&str>,
        atribucion: Option<&str>,
        declarada_por_operador: bool,
    ) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO lotes
               (indice_id, clase, origen, tipo, fuente, licencia, atribucion,
                declarada_por_operador, estado, version_indexer, creado_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pendiente', ?9, ?10)",
            params![
                indice_id,
                clase,
                origen,
                tipo,
                fuente,
                licencia,
                atribucion,
                declarada_por_operador as i32,
                env!("CARGO_PKG_VERSION"),
                Self::ahora()
            ],
        )?;
        Ok(c.last_insert_rowid())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn insertar_imagen(
        &self,
        indice_id: i64,
        lote_id: i64,
        ruta: &str,
        sha256: &str,
        lat: f64,
        lng: f64,
        quadkey: &str,
        modelos_pendientes: &[String],
    ) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO imagenes (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, creada_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![indice_id, lote_id, ruta, sha256, lat, lng, quadkey, Self::ahora()],
        )?;
        let id = c.last_insert_rowid();
        for m in modelos_pendientes {
            c.execute(
                "INSERT OR IGNORE INTO vectores (imagen_id, modelo, estado)
                 VALUES (?1, ?2, 'pendiente')",
                params![id, m],
            )?;
        }
        Ok(id)
    }

    /// Inserta una captura de red. A diferencia de `insertar_imagen`, esta
    /// exige la atribución porque `Captura` la lleva dentro y no es opcional:
    /// no hay forma de llamar a esto y quedarse sin ella.
    ///
    /// Las sueltas entran como `revision = 'pendiente'`; las capturas
    /// sistemáticas no pasan por revisión y entran ya aceptadas.
    pub fn insertar_imagen_de_red(
        &self,
        indice_id: i64,
        lote_id: i64,
        c: &lumi_index::network::Captura,
        quadkey: &str,
        modelos: &[String],
    ) -> Result<i64> {
        let revision = if c.fuente == "commons" || c.fuente == "flickr" { "pendiente" } else { "aceptada" };
        let atrib = serde_json::to_string(&c.atribucion)?;
        let cn = self.0.lock().unwrap();
        cn.execute(
            "INSERT INTO imagenes
               (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, capturada_en,
                revision, licencia, atribucion, id_origen, rumbo, creada_en)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                indice_id,
                lote_id,
                c.ruta.display().to_string(),
                // El sha se calcula al sellar; aquí basta el identificador del
                // proveedor, que ya es único y no obliga a releer el fichero.
                format!("origen:{}:{}", c.fuente, c.id_origen),
                c.lat,
                c.lng,
                quadkey,
                c.capturada_en,
                revision,
                c.atribucion.licencia,
                atrib,
                c.id_origen,
                c.rumbo,
                Self::ahora()
            ],
        )?;
        let id = cn.last_insert_rowid();
        for m in modelos {
            cn.execute(
                "INSERT OR IGNORE INTO vectores (imagen_id, modelo, estado) VALUES (?1, ?2, 'pendiente')",
                params![id, m],
            )?;
        }
        Ok(id)
    }

    pub fn marcar_saltada(&self, imagen_id: i64, motivo: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE imagenes SET saltada_motivo = ?2 WHERE id = ?1",
            params![imagen_id, motivo],
        )?;
        Ok(())
    }

    /// Lo que la procedencia de imágenes necesita, y nada más. Las saltadas no
    /// cuentan: no forman parte del índice.
    pub fn filas_procedencia(&self, indice_id: i64) -> Result<Vec<FilaImagen>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT l.tipo, l.fuente, i.quadkey
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                let tipo: Option<String> = r.get(0)?;
                Ok(FilaImagen {
                    tipo: match tipo.as_deref() {
                        Some("cenital") => Tipo::Cenital,
                        Some("suelta") => Tipo::Suelta,
                        _ => Tipo::Calle,
                    },
                    fuente: r.get(1)?,
                    quadkey: r.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn teselas_trabajo(&self, indice_id: i64) -> Result<Vec<(String, TrabajoDe)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT quadkey, trabajo, fuente_indice FROM teselas WHERE indice_id = ?1",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                let qk: String = r.get(0)?;
                let trabajo: String = r.get(1)?;
                let fuente: Option<String> = r.get(2)?;
                let t = match (trabajo.as_str(), fuente) {
                    ("local", Some(f)) => TrabajoDe::Local(f),
                    ("catalogo", Some(f)) => TrabajoDe::Catalogo(f),
                    _ => TrabajoDe::Aqui,
                };
                Ok((qk, t))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn anotar_tesela(
        &self,
        indice_id: i64,
        quadkey: &str,
        trabajo: &str,
        fuente_indice: Option<&str>,
        sha256: Option<&str>,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT OR REPLACE INTO teselas (indice_id, quadkey, trabajo, fuente_indice, sha256)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![indice_id, quadkey, trabajo, fuente_indice, sha256],
        )?;
        Ok(())
    }

    /// Cuántas imágenes de este índice siguen sin vector de este modelo. Es lo
    /// que reconstruye la cola cuando Redis se ha vaciado, y lo que impide
    /// sellar un paquete a medias.
    pub fn sin_vector(&self, indice_id: i64, modelo: &str) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Imágenes de este índice que siguen sin vector de este modelo. Es lo que
    /// reconstruye la cola cuando Redis se ha vaciado: la verdad está aquí, no
    /// en la lista de Redis.
    pub fn pendientes_de(
        &self,
        indice_id: i64,
        modelo: &str,
        limite: u32,
    ) -> Result<Vec<(i64, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, i.ruta FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL
              ORDER BY i.id LIMIT ?3",
        )?;
        let filas = q
            .query_map(params![indice_id, modelo, limite], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn marcar_vector(&self, imagen_id: i64, modelo: &str, estado: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE vectores SET estado = ?3 WHERE imagen_id = ?1 AND modelo = ?2",
            params![imagen_id, modelo, estado],
        )?;
        Ok(())
    }

    pub fn estado_lote(&self, lote_id: i64, estado: &str, error: Option<&str>) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE lotes SET estado = ?2, error = ?3 WHERE id = ?1",
            params![lote_id, estado, error],
        )?;
        Ok(())
    }

    /// Devuelve el número de reintentos DESPUÉS de sumar uno. Es el contador
    /// que impide el bucle infinito cuando el proceso se muere una y otra vez.
    pub fn sumar_reintento(&self, lote_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        c.execute("UPDATE lotes SET reintentos = reintentos + 1 WHERE id = ?1", params![lote_id])?;
        let n: u32 =
            c.query_row("SELECT reintentos FROM lotes WHERE id = ?1", params![lote_id], |r| r.get(0))?;
        Ok(n)
    }

    pub fn lotes_sin_terminar(&self) -> Result<Vec<(i64, i64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT id, indice_id FROM lotes WHERE estado IN ('pendiente','en_curso') ORDER BY id",
        )?;
        let filas = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// `(id, clase, origen, estado)` de los lotes de un índice, más nuevo
    /// primero. Es lo que enseña el detalle junto a las dos tablas de
    /// procedencia: de dónde vino cada tanda de material.
    pub fn listar_lotes(&self, indice_id: i64) -> Result<Vec<(i64, String, String, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT id, clase, origen, estado FROM lotes WHERE indice_id = ?1 ORDER BY creado_en DESC",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// `(id, nombre, slug, estado)` de todos los índices, más nuevo primero. Es
    /// lo que alimenta la lista del catálogo.
    pub fn listar_indices(&self) -> Result<Vec<(i64, String, String, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare("SELECT id, nombre, slug, estado FROM indices ORDER BY creado_en DESC")?;
        let filas = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Guarda un secreto ya cifrado por `Maestra` bajo una clave de ajuste,
    /// como la de Mapbox. Nunca se guarda en claro.
    pub fn guardar_ajuste_sellado(&self, clave: &str, sellado: &[u8]) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT OR REPLACE INTO ajustes (clave, sellado) VALUES (?1, ?2)",
            params![clave, sellado],
        )?;
        Ok(())
    }

    pub fn leer_ajuste_sellado(&self, clave: &str) -> Result<Option<Vec<u8>>> {
        let c = self.0.lock().unwrap();
        Ok(c
            .query_row("SELECT sellado FROM ajustes WHERE clave = ?1", params![clave], |r| r.get(0))
            .ok())
    }

    pub fn quadkey_de_imagen(&self, imagen_id: i64) -> Result<String> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT quadkey FROM imagenes WHERE id = ?1", params![imagen_id], |r| {
            r.get(0)
        })?)
    }

    /// `(id, ruta, quadkey)` de las imágenes de un índice, EN EL ORDEN de
    /// `indice.db` (por id). Ese orden es el contrato del fragmento: la fila N
    /// de un `.b1`/`.i8` tiene que ser la imagen N de esta misma lista.
    pub fn imagenes_de_indice(&self, indice_id: i64) -> Result<Vec<(i64, String, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT id, ruta, quadkey FROM imagenes
              WHERE indice_id = ?1 AND saltada_motivo IS NULL
              ORDER BY id",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Cuántas imágenes (sin contar las saltadas) tiene el índice en total. Es
    /// el "filas esperadas" contra el que se cuadra cada modelo al sellar.
    pub fn total_imagenes(&self, indice_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1 AND saltada_motivo IS NULL",
            params![indice_id],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Cuántos vectores 'hecho' tiene el índice para un modelo. Es el
    /// "vectores encontrados" del informe de sellado.
    pub fn vectores_hechos(&self, indice_id: i64, modelo: &str) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'hecho'
                AND i.saltada_motivo IS NULL",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Las `fuente` distintas de las imágenes NO saltadas de una tesela. Es lo
    /// que `cobertura.json` declara como cubierto por el fragmento, y por tanto
    /// lo que otro operador puede dar por heredado al instalarlo.
    pub fn fuentes_de_tesela(&self, indice_id: i64, quadkey: &str) -> Result<Vec<String>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT DISTINCT l.fuente
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.quadkey = ?2 AND i.saltada_motivo IS NULL
              ORDER BY l.fuente",
        )?;
        let filas = q
            .query_map(params![indice_id, quadkey], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(filas)
    }

    /// Sellar es irreversible: pasa el índice a `sellado`, con su ruta y
    /// cuándo. No hay camino de vuelta a `abierto`.
    pub fn sellar_indice(&self, indice_id: i64, ruta: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE indices SET estado = 'sellado', ruta = ?2, sellado_en = ?3 WHERE id = ?1",
            params![indice_id, ruta, Self::ahora()],
        )?;
        Ok(())
    }

    // ── Sondeos ──────────────────────────────────────────────────────────

    pub fn sondeo_guardar(&self, fuente: &str, quadkey: &str, nivel: &str, estimadas: u32) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT OR REPLACE INTO sondeos (fuente, quadkey, nivel, estimadas, sondeado_en)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![fuente, quadkey, nivel, estimadas, Self::ahora()],
        )?;
        Ok(())
    }

    /// `None` si no está o si ya caducó. La caducidad se pasa como parámetro y
    /// no como constante para que el test pueda pedir cero días.
    pub fn sondeo_leer(&self, fuente: &str, quadkey: &str, dias: i64) -> Result<Option<(String, u32)>> {
        let c = self.0.lock().unwrap();
        let corte = Self::ahora() - dias * 86_400;
        Ok(c.query_row(
            "SELECT nivel, estimadas FROM sondeos
              WHERE fuente = ?1 AND quadkey = ?2 AND sondeado_en > ?3",
            params![fuente, quadkey, corte],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .ok())
    }

    // ── Gasto ────────────────────────────────────────────────────────────

    /// Suma sobre la fila del día. `dia` en `YYYY-MM-DD`.
    pub fn gasto_apuntar(&self, dia: &str, fuente: &str, unidades: u32, coste: f64) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO gasto (dia, fuente, unidades, coste) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(dia, fuente) DO UPDATE SET
               unidades = unidades + excluded.unidades,
               coste    = coste    + excluded.coste",
            params![dia, fuente, unidades, coste],
        )?;
        Ok(())
    }

    /// `mes` en `YYYY-MM`. El prefijo basta porque `dia` es ISO y ordena solo.
    pub fn gasto_del_mes(&self, mes: &str) -> Result<f64> {
        let c = self.0.lock().unwrap();
        let s: Option<f64> = c.query_row(
            "SELECT SUM(coste) FROM gasto WHERE dia LIKE ?1 || '-%'",
            params![mes],
            |r| r.get(0),
        )?;
        Ok(s.unwrap_or(0.0))
    }

    /// `(fuente, unidades, coste)` del mes, para el desglose de ajustes.
    pub fn gasto_del_mes_por_origen(&self, mes: &str) -> Result<Vec<(String, u32, f64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT fuente, SUM(unidades), SUM(coste) FROM gasto
              WHERE dia LIKE ?1 || '-%' GROUP BY fuente ORDER BY SUM(coste) DESC",
        )?;
        let filas = q
            .query_map(params![mes], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    // ── Descargas ────────────────────────────────────────────────────────

    pub fn descarga_estado(&self, indice_id: i64, fuente: &str, quadkey: &str) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row(
            "SELECT estado FROM descargas WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
            |r| r.get(0),
        )
        .ok())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn descarga_marcar(
        &self,
        indice_id: i64,
        fuente: &str,
        quadkey: &str,
        estado: &str,
        imagenes: u32,
        unidades: u32,
        motivo: Option<&str>,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO descargas (indice_id, fuente, quadkey, estado, imagenes, unidades, motivo)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(indice_id, fuente, quadkey) DO UPDATE SET
               estado = excluded.estado, imagenes = excluded.imagenes,
               unidades = excluded.unidades, motivo = excluded.motivo",
            params![indice_id, fuente, quadkey, estado, imagenes, unidades, motivo],
        )?;
        Ok(())
    }

    /// De las teselas pedidas, las que faltan por bajar de este origen.
    /// **Solo `hecho` excluye.** Un `error` vuelve, porque es una avería; una
    /// tesela `en_curso` de una ejecución anterior también, porque el proceso
    /// murió sin terminarla.
    pub fn descargas_pendientes(
        &self,
        indice_id: i64,
        fuente: &str,
        pedidas: &[String],
    ) -> Result<Vec<String>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT quadkey FROM descargas
              WHERE indice_id = ?1 AND fuente = ?2 AND estado = 'hecho'",
        )?;
        let hechas: std::collections::HashSet<String> = q
            .query_map(params![indice_id, fuente], |r| r.get(0))?
            .collect::<Result<_, _>>()?;
        Ok(pedidas.iter().filter(|q| !hechas.contains(*q)).cloned().collect())
    }

    pub fn descarga_sumar_reintento(&self, indice_id: i64, fuente: &str, quadkey: &str) -> Result<u32> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE descargas SET reintentos = reintentos + 1
              WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
        )?;
        let n: u32 = c.query_row(
            "SELECT reintentos FROM descargas WHERE indice_id = ?1 AND fuente = ?2 AND quadkey = ?3",
            params![indice_id, fuente, quadkey],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Ajustes que NO son secretos, como el tope mensual. Van en la columna
    /// `valor` y no en `sellado`: cifrar un número que la propia pantalla
    /// enseña sería teatro.
    pub fn guardar_ajuste(&self, clave: &str, valor: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO ajustes (clave, valor) VALUES (?1, ?2)
             ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor",
            params![clave, valor],
        )?;
        Ok(())
    }

    pub fn leer_ajuste(&self, clave: &str) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT valor FROM ajustes WHERE clave = ?1", params![clave], |r| r.get(0))
            .ok()
            .flatten())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporal() -> (tempfile::TempDir, Almacen) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        (d, a)
    }

    #[test]
    fn el_sondeo_se_guarda_y_caduca_a_los_treinta_dias() {
        let (_d, a) = temporal();
        a.sondeo_guardar("google", "03113322013021", "poco", 30).unwrap();

        let fresco = a.sondeo_leer("google", "03113322013021", 30).unwrap();
        assert_eq!(fresco, Some(("poco".to_string(), 30)));

        // Con una ventana de cero días, lo de hace un instante ya está viejo.
        assert_eq!(a.sondeo_leer("google", "03113322013021", 0).unwrap(), None);
        // Y otro origen no se contamina con este.
        assert_eq!(a.sondeo_leer("flickr", "03113322013021", 30).unwrap(), None);
    }

    #[test]
    fn el_gasto_suma_por_dia_y_origen_y_el_mes_los_agrega() {
        let (_d, a) = temporal();
        a.gasto_apuntar("2026-08-07", "google", 1_000, 6.51).unwrap();
        a.gasto_apuntar("2026-08-07", "google", 500, 3.26).unwrap();
        a.gasto_apuntar("2026-08-07", "mapbox-satelite", 2_000, 1.40).unwrap();
        a.gasto_apuntar("2026-07-31", "google", 9_000, 58.59).unwrap();

        let agosto = a.gasto_del_mes("2026-08").unwrap();
        assert!((agosto - 11.17).abs() < 1e-9, "{agosto}");
        // Julio no se mezcla, aunque sea el día de antes.
        let julio = a.gasto_del_mes("2026-07").unwrap();
        assert!((julio - 58.59).abs() < 1e-9, "{julio}");
    }

    #[test]
    fn una_tesela_ya_hecha_no_se_vuelve_a_descargar_ni_a_cobrar() {
        // Esta es LA prueba del 7b: es lo que impide pagar dos veces por lo
        // mismo cuando una descarga se corta a la mitad.
        let (_d, a) = temporal();
        let i = a.crear_indice("lugo-norte", "lugo-norte").unwrap();

        assert_eq!(a.descarga_estado(i, "google", "AAA").unwrap(), None);
        a.descarga_marcar(i, "google", "AAA", "hecho", 148, 148, None).unwrap();
        assert_eq!(a.descarga_estado(i, "google", "AAA").unwrap(), Some("hecho".into()));

        let pendientes = a.descargas_pendientes(i, "google", &["AAA".into(), "BBB".into()]).unwrap();
        assert_eq!(pendientes, vec!["BBB".to_string()], "AAA ya está y no vuelve");

        // Un error SÍ vuelve: es una avería, no un resultado.
        a.descarga_marcar(i, "google", "BBB", "error", 0, 0, Some("se cayó la red")).unwrap();
        let pendientes = a.descargas_pendientes(i, "google", &["AAA".into(), "BBB".into()]).unwrap();
        assert_eq!(pendientes, vec!["BBB".to_string()]);

        // Y el contador de reintentos es lo que impide el bucle infinito.
        assert_eq!(a.descarga_sumar_reintento(i, "google", "BBB").unwrap(), 1);
        assert_eq!(a.descarga_sumar_reintento(i, "google", "BBB").unwrap(), 2);
    }
}
