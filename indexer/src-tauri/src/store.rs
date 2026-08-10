//! SQLite: la verdad.
//!
//! Redis lleva la cola y el estado caliente, pero lo que tiene que sobrevivir a
//! un corte de luz a mitad de una indexación de días está aquí. Si Redis se
//! vacía, la cola se reconstruye leyendo qué imágenes siguen sin vector.

use std::collections::HashMap;
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
-- Genealogía de versiones: la migración idempotente de más abajo añade
-- `viene_de` y `numero_version` a una base que ya existía antes del 8s.

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
    estado     TEXT NOT NULL CHECK (estado IN ('pendiente','en_curso','hecho','error','cancelado')),
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

-- Un asset por fila. Que esto sea una tabla es lo que hace que una subida
-- cortada a la mitad se pueda retomar sin volver a subir lo que ya está: un
-- trozo son cientos de megas, y resubirlos por un corte de red es una hora.
CREATE TABLE IF NOT EXISTS publicaciones (
  indice_id INTEGER NOT NULL,
  asset     TEXT    NOT NULL,
  sha256    TEXT    NOT NULL,
  bytes     INTEGER NOT NULL,
  subido    INTEGER NOT NULL DEFAULT 0,
  url       TEXT,
  PRIMARY KEY (indice_id, asset)
);

-- Una ficha remota por paquete. `json` es la ficha entera tal como llegó —
-- viaja en claro, así que guardarla íntegra no cuesta nada y evita tener que
-- reconstruirla campo a campo cada vez que hace falta un dato que hoy no se
-- usa. `vista` es cuándo se comprobó por última vez si sigue viva.
CREATE TABLE IF NOT EXISTS fichas_remotas (
  paquete TEXT PRIMARY KEY,
  autor   TEXT NOT NULL,
  url     TEXT NOT NULL,
  json    TEXT NOT NULL,
  vista   TEXT NOT NULL,
  viva    INTEGER NOT NULL DEFAULT 1
);
-- Caché derivada de `fichas_remotas`, reconstruida entera en cada refresco.
-- La verdad es la ficha; esto solo existe para que el reclamo de un polígono
-- no tenga que reparsear el JSON de todas las fichas conocidas cada vez.
CREATE TABLE IF NOT EXISTS cobertura_remota (
  quadkey TEXT NOT NULL,
  fuente  TEXT NOT NULL,
  paquete TEXT NOT NULL,
  PRIMARY KEY (quadkey, fuente, paquete)
);
-- La única vía de la web (subsistema 9) hacia el catálogo local, y solo puede
-- QUITAR reclamos: un paquete en esta lista deja de reclamar aunque su ficha
-- siga viva y vigente.
CREATE TABLE IF NOT EXISTS desreclamos (paquete TEXT PRIMARY KEY, motivo TEXT);

CREATE INDEX IF NOT EXISTS imagenes_por_indice ON imagenes(indice_id);
CREATE INDEX IF NOT EXISTS imagenes_por_quadkey ON imagenes(indice_id, quadkey);
CREATE INDEX IF NOT EXISTS lotes_por_indice ON lotes(indice_id);
CREATE INDEX IF NOT EXISTS vectores_pendientes ON vectores(modelo) WHERE estado = 'pendiente';
CREATE INDEX IF NOT EXISTS gasto_por_mes ON gasto(dia);
CREATE INDEX IF NOT EXISTS cobertura_remota_por_quadkey ON cobertura_remota(quadkey);
";

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct Cuentas {
    pub pendientes: u32,
    pub aceptadas: u32,
    pub rechazadas: u32,
}

/// Una fila del visor de mapa/galería: el punto, la miniatura y los metadatos
/// que ya se conocían al ingerir la imagen.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FilaMapa {
    pub id: i64,
    pub ruta: String,
    pub lat: f64,
    pub lng: f64,
    pub fuente: String,
    pub capturada_en: Option<String>,
    pub ancho: Option<u32>,
    pub alto: Option<u32>,
    pub licencia: Option<String>,
    pub rumbo: Option<f64>,
}

/// `(paquete, autor, url, json, viva)`.
pub type FilaFichaRemota = (String, String, String, String, bool);
/// `(quadkey, fuente, paquete, autor, url)`.
pub type FilaReclamo = (String, String, String, String, String);

/// `(id_viejo, id_nuevo, ruta_vieja, quadkey)` de cada imagen clonada, y
/// `(modelo, id_viejo, id_nuevo)` de los vectores que ya estaban `hecho` en el
/// padre. Es lo que necesita quien clona una versión para hardlinkear
/// ficheros y duplicar puntos en Qdrant — las dos cosas que viven fuera de
/// esta base de datos.
#[derive(Debug, Default)]
pub struct ClonVersion {
    pub imagenes: Vec<(i64, i64, String, String)>,
    pub vectores_hechos: Vec<(String, i64, i64)>,
}

/// Lo que queda de una tesela liberada: sus rutas de fichero (para borrarlas
/// en disco) y sus vectores `hecho` (para limpiarlos en Qdrant). Ambas cosas
/// viven fuera de esta base de datos.
#[derive(Debug, Default)]
pub struct TeselaLiberada {
    pub rutas: Vec<String>,
    pub vectores_hechos: Vec<(String, i64)>,
}

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
            // Genealogía de versiones (subsistema 8s): `viene_de` es `NULL`
            // para cualquier índice creado como siempre — una v1. Crear una
            // versión nueva inserta una fila NUEVA con esto relleno; la fila
            // sellada del padre nunca se toca.
            "ALTER TABLE indices ADD COLUMN viene_de INTEGER REFERENCES indices(id)",
            "ALTER TABLE indices ADD COLUMN numero_version INTEGER NOT NULL DEFAULT 1",
        ] {
            let _ = c.execute(alter, []);
        }

        // `clase` gana 'red'. En SQLite un CHECK no se altera, así que en una
        // base del 7a se recrea la tabla con el CHECK nuevo. Es barato:
        // `lotes` tiene una fila por tanda de material, no por imagen.
        let sql_lotes: Option<String> = c
            .query_row(
                "SELECT sql FROM sqlite_master WHERE type='table' AND name='lotes'",
                [],
                |r| r.get::<_, String>(0),
            )
            .ok();
        let necesita_recrear = match &sql_lotes {
            Some(sql) => !sql.contains("'red'") || !sql.contains("'cancelado'"),
            None => false,
        };
        if necesita_recrear {
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

    /// `true` si el índice está sellado (o si ya no existe — negarse a
    /// escribir es la respuesta segura en los dos casos). «Sellar es
    /// irreversible: un paquete sellado no se sigue llenando» (DESIGN.md) era
    /// hasta ahora solo la promesa de la interfaz; nada en el backend
    /// impedía de verdad que una ingesta, una herencia de territorio o una
    /// descarga siguieran escribiendo filas contra un índice ya sellado.
    pub fn indice_sellado(&self, indice_id: i64) -> Result<bool> {
        let c = self.0.lock().unwrap();
        let estado: Option<String> = c
            .query_row("SELECT estado FROM indices WHERE id = ?1", params![indice_id], |r| r.get(0))
            .ok();
        Ok(estado.as_deref() != Some("abierto"))
    }

    pub fn crear_indice(&self, nombre: &str, slug: &str) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO indices (nombre, slug, estado, creado_en) VALUES (?1, ?2, 'abierto', ?3)",
            params![nombre, slug, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
    }

    /// `(viene_de, numero_version)` de un índice. `viene_de` es `None` para
    /// cualquier índice creado como siempre — una v1.
    pub fn genealogia(&self, indice_id: i64) -> Result<(Option<i64>, u32)> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row(
            "SELECT viene_de, numero_version FROM indices WHERE id = ?1",
            params![indice_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    }

    /// Crea la fila de una versión nueva: nace `abierto`, con `viene_de`
    /// apuntando al padre y `numero_version` un paso por delante del suyo. La
    /// fila del padre nunca se toca — sellado es sellado para siempre, y una
    /// versión nueva es una fila nueva, no una reapertura.
    pub fn crear_version(&self, padre_id: i64, nombre: &str, slug: &str, numero_version: u32) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO indices (nombre, slug, estado, viene_de, numero_version, creado_en)
             VALUES (?1, ?2, 'abierto', ?3, ?4, ?5)",
            params![nombre, slug, padre_id, numero_version, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
    }

    /// `None` si el índice ya no existe — por ejemplo, un plan de descarga
    /// pendiente que apunta a un índice que se borró entretanto.
    pub fn nombre_de_indice(&self, indice_id: i64) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT nombre FROM indices WHERE id = ?1", params![indice_id], |r| r.get(0)).ok())
    }

    #[allow(clippy::too_many_arguments)]
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
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')",
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

    /// `(modelo, imagen_id)` de todo lo que este índice ya subió a Qdrant.
    /// Se lee ANTES de `borrar_indice`: una vez borradas las filas de SQLite
    /// no hay otra forma de saber qué puntos hay que limpiar también allí.
    pub fn vectores_hechos_de_indice(&self, indice_id: i64) -> Result<Vec<(String, i64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT v.modelo, v.imagen_id FROM vectores v JOIN imagenes i ON i.id = v.imagen_id
              WHERE i.indice_id = ?1 AND v.estado = 'hecho'",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Borra un índice entero: sus imágenes, sus vectores, sus lotes y la
    /// procedencia del trabajo por tesela. Los ficheros de imagen en disco y
    /// los puntos ya subidos a Qdrant se limpian aparte, porque viven fuera
    /// de esta base de datos.
    pub fn borrar_indice(&self, indice_id: i64) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "DELETE FROM vectores WHERE imagen_id IN (SELECT id FROM imagenes WHERE indice_id = ?1)",
            params![indice_id],
        )?;
        c.execute("DELETE FROM imagenes WHERE indice_id = ?1", params![indice_id])?;
        c.execute("DELETE FROM lotes WHERE indice_id = ?1", params![indice_id])?;
        c.execute("DELETE FROM teselas WHERE indice_id = ?1", params![indice_id])?;
        c.execute("DELETE FROM indices WHERE id = ?1", params![indice_id])?;
        Ok(())
    }

    /// Clona lotes, imágenes, vectores y teselas del padre a la fila
    /// `nueva_id`, en una sola transacción — «mismo contenido lógico, otra
    /// clave foránea» (spec §2). Un `imagen_id` nuevo no tiene punto propio en
    /// Qdrant todavía, así que el llamador tiene que duplicarlo con lo que
    /// devuelve `vectores_hechos`; los ficheros, con `imagenes`.
    pub fn clonar_version(&self, padre_id: i64, nueva_id: i64) -> Result<ClonVersion> {
        let mut c = self.0.lock().unwrap();
        let tx = c.transaction()?;

        // Lotes: hace falta el mapa viejo → nuevo para reapuntar `imagenes.lote_id`.
        #[allow(clippy::type_complexity)]
        let filas_lotes: Vec<(
            i64, String, String, Option<String>, String, Option<String>, Option<String>,
            i64, String, Option<String>, i64, String, i64,
        )> = {
            let mut q = tx.prepare(
                "SELECT id, clase, origen, tipo, fuente, licencia, atribucion, declarada_por_operador,
                        estado, error, reintentos, version_indexer, creado_en
                   FROM lotes WHERE indice_id = ?1 ORDER BY id",
            )?;
            let filas = q.query_map(params![padre_id], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
            filas
        };
        let mut mapa_lotes: HashMap<i64, i64> = HashMap::new();
        for f in &filas_lotes {
            tx.execute(
                "INSERT INTO lotes (indice_id, clase, origen, tipo, fuente, licencia, atribucion,
                    declarada_por_operador, estado, error, reintentos, version_indexer, creado_en)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
                params![nueva_id, f.1, f.2, f.3, f.4, f.5, f.6, f.7, f.8, f.9, f.10, f.11, f.12],
            )?;
            mapa_lotes.insert(f.0, tx.last_insert_rowid());
        }

        // Imágenes, y sus vectores fila a fila.
        #[allow(clippy::type_complexity)]
        let filas_imgs: Vec<(
            i64, i64, String, String, f64, f64, String, Option<String>, Option<i64>,
            Option<i64>, Option<String>, i64, Option<String>, Option<String>, Option<String>,
            Option<String>, Option<f64>,
        )> = {
            let mut q = tx.prepare(
                "SELECT id, lote_id, ruta, sha256, lat, lng, quadkey, capturada_en, ancho, alto,
                        saltada_motivo, creada_en, revision, licencia, atribucion, id_origen, rumbo
                   FROM imagenes WHERE indice_id = ?1 ORDER BY id",
            )?;
            let filas = q.query_map(params![padre_id], |r| {
                Ok((
                    r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?,
                    r.get(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?,
                    r.get(14)?, r.get(15)?, r.get(16)?,
                ))
            })?
            .collect::<rusqlite::Result<_>>()?;
            filas
        };

        let mut imagenes = Vec::with_capacity(filas_imgs.len());
        let mut vectores_hechos = Vec::new();
        for f in &filas_imgs {
            let nuevo_lote = *mapa_lotes.get(&f.1).unwrap_or(&f.1);
            tx.execute(
                "INSERT INTO imagenes (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, capturada_en,
                    ancho, alto, saltada_motivo, creada_en, revision, licencia, atribucion, id_origen, rumbo)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
                params![
                    nueva_id, nuevo_lote, f.2, f.3, f.4, f.5, f.6, f.7, f.8, f.9, f.10, f.11,
                    f.12, f.13, f.14, f.15, f.16,
                ],
            )?;
            let nueva_imagen_id = tx.last_insert_rowid();
            imagenes.push((f.0, nueva_imagen_id, f.2.clone(), f.6.clone()));

            let vs: Vec<(String, String)> = {
                let mut qv = tx.prepare("SELECT modelo, estado FROM vectores WHERE imagen_id = ?1")?;
                let filas = qv.query_map(params![f.0], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect::<rusqlite::Result<_>>()?;
                filas
            };
            for (modelo, estado) in vs {
                tx.execute(
                    "INSERT INTO vectores (imagen_id, modelo, estado) VALUES (?1, ?2, ?3)",
                    params![nueva_imagen_id, modelo, estado],
                )?;
                if estado == "hecho" {
                    vectores_hechos.push((modelo, f.0, nueva_imagen_id));
                }
            }
        }

        // Teselas: el techo de la versión nueva nace exactamente igual al del
        // padre. Ni `liberar_tesela` ni el guardián de la sección 4 vuelven a
        // tocar esta tabla — es la única razón de que el techo se pueda
        // comprobar sin guardarlo aparte.
        tx.execute(
            "INSERT INTO teselas (indice_id, quadkey, trabajo, fuente_indice, sha256)
             SELECT ?1, quadkey, trabajo, fuente_indice, sha256 FROM teselas WHERE indice_id = ?2",
            params![nueva_id, padre_id],
        )?;

        tx.commit()?;
        Ok(ClonVersion { imagenes, vectores_hechos })
    }

    /// Borra las filas de imagen y vector de una quadkey para ESTE índice, y
    /// resetea sus `descargas` a pendiente — borrarlas basta, porque
    /// `descargas_pendientes` solo excluye lo `hecho`. La fila de `teselas` NO
    /// se toca: no hay valor "pendiente" en su CHECK, y el techo de la
    /// sección 4 solo necesita que la fila siga existiendo, no un valor
    /// concreto de `trabajo`.
    pub fn liberar_tesela(&self, indice_id: i64, quadkey: &str) -> Result<TeselaLiberada> {
        let mut c = self.0.lock().unwrap();
        let tx = c.transaction()?;
        let imagenes: Vec<(i64, String)> = {
            let mut q = tx.prepare("SELECT id, ruta FROM imagenes WHERE indice_id = ?1 AND quadkey = ?2")?;
            let filas = q.query_map(params![indice_id, quadkey], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<rusqlite::Result<_>>()?;
            filas
        };
        let mut vectores_hechos = Vec::new();
        for (id, _) in &imagenes {
            let modelos: Vec<String> = {
                let mut qv = tx.prepare("SELECT modelo FROM vectores WHERE imagen_id = ?1 AND estado = 'hecho'")?;
                let filas = qv.query_map(params![id], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?;
                filas
            };
            for m in modelos {
                vectores_hechos.push((m, *id));
            }
            tx.execute("DELETE FROM vectores WHERE imagen_id = ?1", params![id])?;
            tx.execute("DELETE FROM imagenes WHERE id = ?1", params![id])?;
        }
        tx.execute("DELETE FROM descargas WHERE indice_id = ?1 AND quadkey = ?2", params![indice_id, quadkey])?;
        tx.commit()?;
        let rutas = imagenes.into_iter().map(|(_, r)| r).collect();
        Ok(TeselaLiberada { rutas, vectores_hechos })
    }

    /// Repunta el fichero de una imagen clonada tras hardlinkearla (o
    /// copiarla) al directorio de la versión nueva.
    pub fn actualizar_ruta_imagen(&self, imagen_id: i64, ruta: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute("UPDATE imagenes SET ruta = ?2 WHERE id = ?1", params![imagen_id, ruta])?;
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
                AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')",
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
            "SELECT i.id, i.ruta FROM imagenes i
               JOIN vectores v ON v.imagen_id = i.id
               JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
                AND l.estado <> 'cancelado'
              ORDER BY i.id LIMIT ?3",
        )?;
        let filas = q
            .query_map(params![indice_id, modelo, limite], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Índices con al menos una imagen sin vector de ESTE modelo. Es lo que
    /// arranca cada bucle de la cola: independiente de `lotes.estado`, que es
    /// una sola columna compartida entre todos los modelos y por eso nunca
    /// pudo decir "a lumi-preview le queda trabajo" sin mentir sobre lumi-2.
    pub fn indices_con_pendientes(&self, modelo: &str) -> Result<Vec<i64>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT DISTINCT i.indice_id FROM imagenes i
               JOIN vectores v ON v.imagen_id = i.id
               JOIN lotes l ON l.id = i.lote_id
              WHERE v.modelo = ?1 AND v.estado = 'pendiente'
                AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
                AND l.estado <> 'cancelado'
              ORDER BY i.indice_id",
        )?;
        let filas = q.query_map(params![modelo], |r| r.get(0))?.collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// `(hechas, total)` de ESTE índice para ESTE modelo — el índice entero,
    /// no el lote de 32 que la cola tiene entre manos ahora mismo. Es lo que
    /// hace que la barra diga "1023 de 3224" en vez de reiniciar a "32/32"
    /// cada vez que empieza un lote nuevo, que no cuenta nada sobre cuánto
    /// queda de verdad.
    pub fn progreso_indice(&self, indice_id: i64, modelo: &str) -> Result<(u32, u32)> {
        let c = self.0.lock().unwrap();
        let hechas: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes i JOIN vectores v ON v.imagen_id = i.id
              WHERE i.indice_id = ?1 AND v.modelo = ?2 AND v.estado = 'hecho'",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        let total: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes i
               JOIN vectores v ON v.imagen_id = i.id
               JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND v.modelo = ?2
                AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
                AND l.estado <> 'cancelado'",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        Ok((hechas, total))
    }

    /// Upsert, no `UPDATE`: la cola de embebido marca una fila que
    /// `insertar_imagen` ya creó como `pendiente`, pero la ingesta legacy
    /// llama a esto para un modelo que trae el vector DESDE FUERA y por eso
    /// nunca pasó por `pendientes_de` — no hay fila que actualizar. Con solo
    /// `UPDATE`, ese caso afectaba a cero filas en silencio: el vector que
    /// venía dentro del paquete se perdía sin ningún error que lo delatara.
    pub fn marcar_vector(&self, imagen_id: i64, modelo: &str, estado: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO vectores (imagen_id, modelo, estado) VALUES (?1, ?2, ?3)
             ON CONFLICT (imagen_id, modelo) DO UPDATE SET estado = excluded.estado",
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

    /// Solo cancela si sigue `pendiente`: un lote `en_curso` ya tiene un
    /// trabajador consumiéndolo, y pararlo a mitad dejaría el vector a medio
    /// escribir. El `WHERE` es la guarda contra la carrera entre que la
    /// interfaz pinta el botón y que la cola lo coge justo antes del click.
    pub fn cancelar_lote(&self, lote_id: i64) -> Result<bool> {
        let c = self.0.lock().unwrap();
        let n = c.execute(
            "UPDATE lotes SET estado = 'cancelado' WHERE id = ?1 AND estado = 'pendiente'",
            params![lote_id],
        )?;
        Ok(n > 0)
    }

    /// `(id, clase, origen, estado)` de los lotes de un índice, más nuevo
    /// primero. Es lo que enseña el detalle junto a las dos tablas de
    /// procedencia: de dónde vino cada tanda de material.
    ///
    /// El `estado` se calcula contra `vectores`, no se lee de `lotes.estado`:
    /// con varios modelos activos, "hecho" para lumi-2 no significa "hecho"
    /// para lumi-preview, y una sola columna compartida no puede decir las
    /// dos cosas a la vez. La única excepción es `cancelado`, que sí es una
    /// decisión del operador y no algo que los vectores puedan derivar.
    pub fn listar_lotes(&self, indice_id: i64) -> Result<Vec<(i64, String, String, String)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT l.id, l.clase, l.origen,
                CASE
                    WHEN l.estado = 'cancelado' THEN 'cancelado'
                    WHEN EXISTS (
                        SELECT 1 FROM imagenes im JOIN vectores v ON v.imagen_id = im.id
                        WHERE im.lote_id = l.id AND v.estado = 'error'
                    ) THEN 'error'
                    WHEN EXISTS (
                        SELECT 1 FROM imagenes im JOIN vectores v ON v.imagen_id = im.id
                        WHERE im.lote_id = l.id AND v.estado = 'pendiente'
                    ) THEN 'pendiente'
                    ELSE 'hecho'
                END
             FROM lotes l WHERE l.indice_id = ?1 ORDER BY l.creado_en DESC",
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

    /// Los índices con `ficha.json` ya subida: la única prueba fiable de que
    /// una publicación llegó al final, en vez de quedarse a medio subir.
    pub fn indices_publicados(&self) -> Result<std::collections::HashSet<i64>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT indice_id FROM publicaciones WHERE asset = 'ficha.json' AND subido = 1",
        )?;
        let filas: std::collections::HashSet<i64> =
            q.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
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
                AND (revision IS NULL OR revision <> 'rechazada')
              ORDER BY id",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Todo lo que el visor de mapa/galería necesita de cada imagen de un
    /// índice: coordenadas para el punto, ruta para la miniatura, y los
    /// metadatos que ya guardamos (fecha, tamaño, procedencia). Las saltadas y
    /// las rechazadas no salen: no forman parte del índice.
    pub fn imagenes_mapa(&self, indice_id: i64) -> Result<Vec<FilaMapa>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, i.ruta, i.lat, i.lng, l.fuente, i.capturada_en, i.ancho, i.alto,
                    i.licencia, i.rumbo
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
              ORDER BY i.id",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                Ok(FilaMapa {
                    id: r.get(0)?,
                    ruta: r.get(1)?,
                    lat: r.get(2)?,
                    lng: r.get(3)?,
                    fuente: r.get(4)?,
                    capturada_en: r.get(5)?,
                    ancho: r.get(6)?,
                    alto: r.get(7)?,
                    licencia: r.get(8)?,
                    rumbo: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Cuántas imágenes (sin contar las saltadas ni las rechazadas) tiene el
    /// índice en total. Es el "filas esperadas" contra el que se cuadra cada
    /// modelo al sellar.
    pub fn total_imagenes(&self, indice_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n: u32 = c.query_row(
            "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1 AND saltada_motivo IS NULL
                AND (revision IS NULL OR revision <> 'rechazada')",
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
                AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')",
            params![indice_id, modelo],
            |r| r.get(0),
        )?;
        Ok(n)
    }

    /// Las `fuente` distintas de las imágenes NO saltadas ni rechazadas de una
    /// tesela. Es lo que `cobertura.json` declara como cubierto por el
    /// fragmento, y por tanto lo que otro operador puede dar por heredado al
    /// instalarlo.
    pub fn fuentes_de_tesela(&self, indice_id: i64, quadkey: &str) -> Result<Vec<String>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT DISTINCT l.fuente
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.quadkey = ?2 AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
              ORDER BY l.fuente",
        )?;
        let filas = q
            .query_map(params![indice_id, quadkey], |r| r.get(0))?
            .collect::<Result<Vec<String>, _>>()?;
        Ok(filas)
    }

    /// Lo que el sellado necesita para decidir qué sale del paquete. Las
    /// saltadas y las rechazadas no están: no forman parte del índice.
    pub fn filas_publicables(&self, indice_id: i64) -> Result<Vec<crate::package::FilaPublicable>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, l.fuente, i.licencia, i.quadkey
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.saltada_motivo IS NULL
                AND (i.revision IS NULL OR i.revision <> 'rechazada')
              ORDER BY i.id",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                Ok(crate::package::FilaPublicable {
                    id: r.get(0)?,
                    fuente: r.get(1)?,
                    licencia: r.get(2)?,
                    quadkey: r.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    // ── Revisión ─────────────────────────────────────────────────────────

    /// `(id, ruta, fuente, licencia)` de las sueltas que esperan revisión.
    #[allow(clippy::type_complexity)]
    pub fn revision_pendientes(&self, indice_id: i64, limite: u32) -> Result<Vec<(i64, String, String, Option<String>)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT i.id, i.ruta, l.fuente, i.licencia
               FROM imagenes i JOIN lotes l ON l.id = i.lote_id
              WHERE i.indice_id = ?1 AND i.revision = 'pendiente'
              ORDER BY i.id LIMIT ?2",
        )?;
        let filas = q
            .query_map(params![indice_id, limite], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    pub fn revision_marcar(&self, ids: &[i64], estado: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        for id in ids {
            c.execute("UPDATE imagenes SET revision = ?2 WHERE id = ?1", params![id, estado])?;
        }
        Ok(())
    }

    /// Cierra la revisión aceptando todo lo que siga pendiente. NO resucita lo
    /// ya rechazado: el `WHERE` lo deja fuera a propósito.
    pub fn revision_aceptar_resto(&self, indice_id: i64) -> Result<u32> {
        let c = self.0.lock().unwrap();
        let n = c.execute(
            "UPDATE imagenes SET revision = 'aceptada'
              WHERE indice_id = ?1 AND revision = 'pendiente'",
            params![indice_id],
        )?;
        Ok(n as u32)
    }

    pub fn revision_cuentas(&self, indice_id: i64) -> Result<Cuentas> {
        let c = self.0.lock().unwrap();
        let de = |e: &str| -> Result<u32> {
            Ok(c.query_row(
                "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1 AND revision = ?2",
                params![indice_id, e],
                |r| r.get(0),
            )?)
        };
        Ok(Cuentas { pendientes: de("pendiente")?, aceptadas: de("aceptada")?, rechazadas: de("rechazada")? })
    }

    /// Todas las filas de imagen, incluidas las rechazadas y las saltadas. Es
    /// lo que demuestra que descartar MARCA y no borra.
    pub fn contar_filas_imagenes(&self, indice_id: i64) -> Result<i64> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row(
            "SELECT COUNT(*) FROM imagenes WHERE indice_id = ?1",
            params![indice_id],
            |r| r.get(0),
        )?)
    }

    /// Solo para los tests de revisión: una suelta pendiente y nada más.
    #[cfg(test)]
    pub fn insertar_imagen_pendiente_de_revision(&self, indice_id: i64, lote_id: i64, nombre: &str) -> Result<i64> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO imagenes (indice_id, lote_id, ruta, sha256, lat, lng, quadkey, revision, creada_en)
             VALUES (?1, ?2, ?3, ?4, 43.0, -8.0, 'AAA', 'pendiente', ?5)",
            params![indice_id, lote_id, nombre, nombre, Self::ahora()],
        )?;
        Ok(c.last_insert_rowid())
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

    // ── Catálogo remoto ──────────────────────────────────────────────────

    pub fn ficha_remota_guardar(
        &self,
        paquete: &str,
        autor: &str,
        url: &str,
        json: &str,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO fichas_remotas (paquete, autor, url, json, vista, viva)
             VALUES (?1, ?2, ?3, ?4, ?5, 1)
             ON CONFLICT(paquete) DO UPDATE SET
               autor = excluded.autor, url = excluded.url, json = excluded.json,
               vista = excluded.vista, viva = 1",
            params![paquete, autor, url, json, Self::ahora()],
        )?;
        Ok(())
    }

    /// `(paquete, autor, url, json, viva)`.
    pub fn fichas_remotas(&self) -> Result<Vec<FilaFichaRemota>> {
        let c = self.0.lock().unwrap();
        let mut q =
            c.prepare("SELECT paquete, autor, url, json, viva FROM fichas_remotas ORDER BY paquete")?;
        let filas = q
            .query_map([], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get::<_, i64>(4)? == 1))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Un 404 en cualquiera de sus assets. Deja de reclamar sin borrarse: se
    /// sigue sabiendo que existió, y qué zona dejó libre al caerse.
    pub fn ficha_remota_marcar_muerta(&self, paquete: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute("UPDATE fichas_remotas SET viva = 0 WHERE paquete = ?1", params![paquete])?;
        Ok(())
    }

    /// Se reconstruye entera: es caché derivada, no verdad.
    pub fn cobertura_remota_rehacer(&self, filas: &[(String, String, String)]) -> Result<()> {
        let mut c = self.0.lock().unwrap();
        let tx = c.transaction()?;
        tx.execute("DELETE FROM cobertura_remota", [])?;
        for (quadkey, fuente, paquete) in filas {
            tx.execute(
                "INSERT OR IGNORE INTO cobertura_remota (quadkey, fuente, paquete)
                 VALUES (?1, ?2, ?3)",
                params![quadkey, fuente, paquete],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Quién reclama cada una de estas quadkeys. Solo fichas vivas, y nunca
    /// las que la web ha desreclamado.
    /// `(quadkey, fuente, paquete, autor, url)`.
    pub fn reclamos_de(&self, quadkeys: &[String]) -> Result<Vec<FilaReclamo>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT r.quadkey, r.fuente, r.paquete, f.autor, f.url
               FROM cobertura_remota r JOIN fichas_remotas f ON f.paquete = r.paquete
              WHERE f.viva = 1
                AND r.paquete NOT IN (SELECT paquete FROM desreclamos)",
        )?;
        let pedidas: std::collections::HashSet<&str> = quadkeys.iter().map(|s| s.as_str()).collect();
        let filas = q
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas.into_iter().filter(|(q, ..)| pedidas.contains(q.as_str())).collect())
    }

    pub fn desreclamos_fijar(&self, lista: &[(String, String)]) -> Result<()> {
        let mut c = self.0.lock().unwrap();
        let tx = c.transaction()?;
        tx.execute("DELETE FROM desreclamos", [])?;
        for (paquete, motivo) in lista {
            tx.execute(
                "INSERT OR REPLACE INTO desreclamos (paquete, motivo) VALUES (?1, ?2)",
                params![paquete, motivo],
            )?;
        }
        tx.commit()?;
        Ok(())
    }

    // ── Publicación ──────────────────────────────────────────────────────

    /// Dónde quedó el `.lumidx` al sellar. `None` mientras el índice siga
    /// abierto: no hay nada que publicar de un índice que aún cambia.
    pub fn ruta_de_indice(&self, indice_id: i64) -> Result<Option<String>> {
        let c = self.0.lock().unwrap();
        Ok(c.query_row("SELECT ruta FROM indices WHERE id = ?1", params![indice_id], |r| r.get(0))
            .ok()
            .flatten())
    }

    /// Apunta un asset del plan de subida. Mismo `ON CONFLICT` que
    /// `descarga_marcar`: volver a previsualizar no pierde lo ya subido.
    pub fn publicacion_apuntar(
        &self,
        indice_id: i64,
        asset: &str,
        sha256: &str,
        bytes: u64,
    ) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "INSERT INTO publicaciones (indice_id, asset, sha256, bytes)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(indice_id, asset) DO UPDATE SET
               sha256 = excluded.sha256, bytes = excluded.bytes",
            params![indice_id, asset, sha256, bytes as i64],
        )?;
        Ok(())
    }

    pub fn publicacion_marcar_subido(&self, indice_id: i64, asset: &str, url: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute(
            "UPDATE publicaciones SET subido = 1, url = ?3
              WHERE indice_id = ?1 AND asset = ?2",
            params![indice_id, asset, url],
        )?;
        Ok(())
    }

    /// Los assets que faltan por subir. Igual que `descargas_pendientes`:
    /// solo `subido = 1` excluye.
    pub fn publicacion_pendientes(&self, indice_id: i64) -> Result<Vec<(String, String, u64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT asset, sha256, bytes FROM publicaciones
              WHERE indice_id = ?1 AND subido = 0 ORDER BY asset",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                Ok((r.get(0)?, r.get(1)?, r.get::<_, i64>(2)? as u64))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
    }

    /// Todo el plan, subido o no: es lo que dice si un paquete está
    /// `publicado`, `subiendo n/m` o `incompleto`.
    #[allow(clippy::type_complexity)]
    pub fn publicacion_plan(
        &self,
        indice_id: i64,
    ) -> Result<Vec<(String, bool, Option<String>, String, u64)>> {
        let c = self.0.lock().unwrap();
        let mut q = c.prepare(
            "SELECT asset, subido, url, sha256, bytes FROM publicaciones
              WHERE indice_id = ?1 ORDER BY asset",
        )?;
        let filas = q
            .query_map(params![indice_id], |r| {
                Ok((
                    r.get(0)?,
                    r.get::<_, i64>(1)? == 1,
                    r.get(2)?,
                    r.get(3)?,
                    r.get::<_, i64>(4)? as u64,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(filas)
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

    pub fn borrar_ajuste(&self, clave: &str) -> Result<()> {
        let c = self.0.lock().unwrap();
        c.execute("DELETE FROM ajustes WHERE clave = ?1", params![clave])?;
        Ok(())
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

    #[test]
    fn cancelar_un_lote_pendiente_lo_saca_de_la_cola() {
        let (_d, a) = temporal();
        let i = a.crear_indice("tokio", "tokio").unwrap();
        let lote = a.crear_lote(i, "red", "mapillary", Some("calle"), "mapillary", None, None, false).unwrap();
        a.insertar_imagen(i, lote, "a.jpg", "sha-a", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();

        assert!(a.indices_con_pendientes("lumi-2").unwrap().contains(&i));
        assert!(a.cancelar_lote(lote).unwrap(), "debe reportar que sí canceló algo");
        assert!(!a.indices_con_pendientes("lumi-2").unwrap().contains(&i), "ya no está en cola");
        assert!(a.pendientes_de(i, "lumi-2", 32).unwrap().is_empty(), "sus imágenes tampoco se ofrecen sueltas");

        let (_, _, _, estado) = a.listar_lotes(i).unwrap().into_iter().find(|(id, ..)| *id == lote).unwrap();
        assert_eq!(estado, "cancelado");
    }

    /// `progreso_indice` cuenta el ÍNDICE entero, no el lote de 32 que la
    /// cola tiene entre manos: es la diferencia entre "32/32" (que no dice
    /// nada de cuánto falta) y "1 de 3" (que sí).
    #[test]
    fn progreso_indice_cuenta_el_indice_entero_no_el_lote() {
        let (_d, a) = temporal();
        let i = a.crear_indice("tokio", "tokio").unwrap();
        let lote = a.crear_lote(i, "red", "mapillary", Some("calle"), "mapillary", None, None, false).unwrap();
        a.insertar_imagen(i, lote, "a.jpg", "sha-a", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();
        let b = a.insertar_imagen(i, lote, "b.jpg", "sha-b", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();
        a.insertar_imagen(i, lote, "c.jpg", "sha-c", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();

        assert_eq!(a.progreso_indice(i, "lumi-2").unwrap(), (0, 3));
        a.marcar_vector(b, "lumi-2", "hecho").unwrap();
        assert_eq!(a.progreso_indice(i, "lumi-2").unwrap(), (1, 3));
    }

    /// Un lote ya `en_curso` no se puede cancelar: pararlo a mitad dejaría el
    /// vector a medio escribir. El `WHERE` de `cancelar_lote` es la guarda.
    #[test]
    fn un_lote_en_curso_no_se_cancela() {
        let (_d, a) = temporal();
        let i = a.crear_indice("tokio", "tokio").unwrap();
        let lote = a.crear_lote(i, "red", "mapillary", Some("calle"), "mapillary", None, None, false).unwrap();
        a.estado_lote(lote, "en_curso", None).unwrap();

        assert!(!a.cancelar_lote(lote).unwrap(), "no debe reportar cancelación");
        // La guarda es lo que importa: sigue sin ser 'cancelado'. El resto del
        // estado ahora se deriva de los vectores, no de esta columna.
        let (_, _, _, estado) = a.listar_lotes(i).unwrap().into_iter().find(|(id, ..)| *id == lote).unwrap();
        assert_ne!(estado, "cancelado");
    }

    /// Una versión nueva nace `abierto`, con `viene_de` al padre y un
    /// `numero_version` un paso por delante — y la fila del padre no se toca.
    #[test]
    fn crear_version_no_toca_al_padre_y_encadena_el_numero() {
        let (_d, a) = temporal();
        let padre = a.crear_indice("lugo", "lugo").unwrap();
        a.sellar_indice(padre, "/tmp/lugo").unwrap();

        let v2 = a.crear_version(padre, "lugo", "lugo-v2", 2).unwrap();
        assert_eq!(a.genealogia(v2).unwrap(), (Some(padre), 2));
        assert_eq!(a.genealogia(padre).unwrap(), (None, 1), "el padre no cambia");
        assert!(!a.indice_sellado(v2).unwrap(), "la versión nueva nace abierta");
        assert!(a.indice_sellado(padre).unwrap(), "el padre sigue sellado");
    }

    /// El corazón de la sección 2 de la spec: clonar copia lotes, imágenes,
    /// vectores y teselas con el `indice_id` reapuntado, y devuelve lo que el
    /// llamador necesita para hardlinkear ficheros y duplicar puntos en
    /// Qdrant — los `hecho` de verdad, no los `pendiente`.
    #[test]
    fn clonar_version_copia_el_contenido_logico_del_padre() {
        let (_d, a) = temporal();
        let padre = a.crear_indice("lugo", "lugo").unwrap();
        let lote = a.crear_lote(padre, "red", "mapillary", Some("calle"), "mapillary", None, None, false).unwrap();
        let img_a = a.insertar_imagen(padre, lote, "a.jpg", "sha-a", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();
        a.marcar_vector(img_a, "lumi-2", "hecho").unwrap();
        let img_b = a.insertar_imagen(padre, lote, "b.jpg", "sha-b", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();
        a.anotar_tesela(padre, "0311", "aqui", None, None).unwrap();

        let nueva = a.crear_version(padre, "lugo", "lugo-v2", 2).unwrap();
        let clon = a.clonar_version(padre, nueva).unwrap();

        assert_eq!(clon.imagenes.len(), 2, "las dos imágenes del padre se clonan");
        assert_eq!(clon.vectores_hechos.len(), 1, "solo la que ya estaba `hecho`, no la pendiente");
        assert_eq!(clon.vectores_hechos[0].0, "lumi-2");
        assert_eq!(clon.vectores_hechos[0].1, img_a, "el id viejo es el del padre");
        assert_ne!(clon.vectores_hechos[0].2, img_a, "el id nuevo no reutiliza el del padre");

        // Las filas nuevas existen de verdad bajo el `indice_id` nuevo, y el
        // padre queda exactamente como estaba.
        assert_eq!(a.total_imagenes(nueva).unwrap(), 2);
        assert_eq!(a.total_imagenes(padre).unwrap(), 2, "clonar no le quita nada al padre");
        assert_eq!(a.teselas_trabajo(nueva).unwrap().len(), 1);
        assert_eq!(a.sin_vector(nueva, "lumi-2").unwrap(), 1, "b.jpg sigue pendiente en la versión nueva");
        let _ = img_b;
    }

    /// `liberar_tesela` borra imágenes y vectores de esa quadkey para ESTE
    /// índice, y deja `descargas` sin fila — que es lo que hace que la
    /// maquinaria de descarga que ya existe la trate como nunca bajada.
    #[test]
    fn liberar_tesela_borra_y_deja_la_descarga_pendiente_otra_vez() {
        let (_d, a) = temporal();
        let i = a.crear_indice("lugo", "lugo").unwrap();
        let lote = a.crear_lote(i, "red", "mapillary", Some("calle"), "mapillary", None, None, false).unwrap();
        let img = a.insertar_imagen(i, lote, "a.jpg", "sha-a", 43.36, -8.41, "0311", &["lumi-2".into()]).unwrap();
        a.marcar_vector(img, "lumi-2", "hecho").unwrap();
        a.descarga_marcar(i, "mapillary", "0311", "hecho", 1, 1, None).unwrap();
        a.anotar_tesela(i, "0311", "aqui", None, None).unwrap();

        let liberada = a.liberar_tesela(i, "0311").unwrap();
        assert_eq!(liberada.rutas, vec!["a.jpg".to_string()]);
        assert_eq!(liberada.vectores_hechos, vec![("lumi-2".to_string(), img)]);

        assert_eq!(a.total_imagenes(i).unwrap(), 0, "la imagen ya no está");
        assert_eq!(
            a.descarga_estado(i, "mapillary", "0311").unwrap(), None,
            "sin fila en `descargas`, `descargas_pendientes` la trata como pendiente"
        );
        // El techo no se mueve: la fila de `teselas` sigue estando.
        assert_eq!(a.teselas_trabajo(i).unwrap().len(), 1, "liberar no borra la fila de teselas");
    }
}
