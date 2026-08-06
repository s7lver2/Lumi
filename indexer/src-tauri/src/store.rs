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
    clase      TEXT NOT NULL CHECK (clase IN ('legacy','carpeta','herencia')),
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

CREATE INDEX IF NOT EXISTS imagenes_por_indice ON imagenes(indice_id);
CREATE INDEX IF NOT EXISTS imagenes_por_quadkey ON imagenes(indice_id, quadkey);
CREATE INDEX IF NOT EXISTS lotes_por_indice ON lotes(indice_id);
CREATE INDEX IF NOT EXISTS vectores_pendientes ON vectores(modelo) WHERE estado = 'pendiente';
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
}
