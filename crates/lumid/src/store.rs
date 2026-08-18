//! SQLite del plano de control. Una sola conexión bajo mutex: el volumen es
//! de decenas de operaciones por minuto, no de miles por segundo.
//! ponytail: si el plano de control llega a ser el cuello de botella, se pasa
//! a un pool; hoy sería complejidad sin causa.

use anyhow::Result;
use lumi_proto::api::DaemonState;
use rusqlite::Connection;
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

const SCHEMA: &str = "
CREATE TABLE IF NOT EXISTS pair_key (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    secret_phc TEXT NOT NULL,
    expires_at INTEGER,
    consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_phc TEXT NOT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    running INTEGER NOT NULL,
    exit_code INTEGER,
    started_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS access_requests (
    id             INTEGER PRIMARY KEY,
    display_name   TEXT NOT NULL,
    message        TEXT NOT NULL,
    ticket_phc     TEXT NOT NULL,
    source_ip      TEXT NOT NULL,
    status         TEXT NOT NULL,
    reason         TEXT,
    granted_models TEXT,
    created_at     INTEGER NOT NULL,
    expires_at     INTEGER NOT NULL,
    resolved_at    INTEGER,
    resolved_by    INTEGER
);
CREATE TABLE IF NOT EXISTS credit_requests (
    id              INTEGER PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id),
    tipo            TEXT NOT NULL,
    valor_actual    INTEGER NOT NULL,
    valor_propuesto INTEGER NOT NULL,
    mensaje         TEXT,
    status          TEXT NOT NULL,
    reason          TEXT,
    created_at      INTEGER NOT NULL,
    resolved_at     INTEGER,
    resolved_by     INTEGER
);
CREATE TABLE IF NOT EXISTS devices (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    client_id  TEXT NOT NULL,
    name       TEXT NOT NULL,
    os         TEXT,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    UNIQUE(user_id, client_id)
);
CREATE TABLE IF NOT EXISTS limits (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER,
    key     TEXT NOT NULL,
    value   TEXT NOT NULL,
    UNIQUE(user_id, key)
);
CREATE TABLE IF NOT EXISTS projects (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS project_members (
    project_id INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    role       TEXT NOT NULL CHECK (role IN ('owner','member')),
    added_at   INTEGER NOT NULL,
    PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS cases (
    id         INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
    id          INTEGER PRIMARY KEY,
    case_id     INTEGER NOT NULL,
    uploader_id INTEGER NOT NULL,
    filename    TEXT NOT NULL,
    bytes       INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    width       INTEGER,
    height      INTEGER,
    mime        TEXT NOT NULL,
    exif_json   TEXT,
    exif_lat    REAL,
    exif_lng    REAL,
    created_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS analyses (
    id                INTEGER PRIMARY KEY,
    case_id           INTEGER NOT NULL,
    requested_by      INTEGER NOT NULL,
    model             TEXT NOT NULL,
    state             TEXT NOT NULL CHECK (state IN ('pendiente','en_curso','hecho','error')),
    error             TEXT,
    result_lat        REAL,
    result_lng        REAL,
    result_radius_m   REAL,
    result_confidence REAL,
    created_at        INTEGER NOT NULL,
    finished_at       INTEGER
);
CREATE TABLE IF NOT EXISTS analysis_images (
    analysis_id INTEGER NOT NULL,
    image_id    INTEGER NOT NULL,
    PRIMARY KEY (analysis_id, image_id)
);
-- Quién tiene un proyecto abierto ahora mismo. Solo una fila por proyecto: es
-- justo lo que impide que dos personas trabajen en el mismo a la vez.
-- `enter`/`leave` en routes/projects.rs son los únicos que la tocan.
CREATE TABLE IF NOT EXISTS project_locks (
    project_id INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    token      TEXT NOT NULL,
    since      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS cases_by_project ON cases(project_id);
CREATE INDEX IF NOT EXISTS images_by_case ON images(case_id);
CREATE INDEX IF NOT EXISTS analyses_by_case ON analyses(case_id);
CREATE UNIQUE INDEX IF NOT EXISTS limits_global ON limits(key) WHERE user_id IS NULL;
CREATE TABLE IF NOT EXISTS installed_indices (
    paquete      TEXT PRIMARY KEY,
    nombre       TEXT NOT NULL,
    autor        TEXT NOT NULL,
    url          TEXT NOT NULL,
    ficha_sha256 TEXT NOT NULL,
    modelo       TEXT NOT NULL,
    version      TEXT NOT NULL,
    teselas      INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    -- Qué assets se han volcado ya, uno por línea. Es lo que permite reanudar
    -- por asset: una instalación cortada no vuelve a descargar ni a descifrar
    -- lo que ya está en disco.
    hechos       TEXT NOT NULL DEFAULT '',
    completo     INTEGER NOT NULL DEFAULT 0,
    installed_at INTEGER NOT NULL
);
-- Un paquete puede traer varias capas de vectores, una por modelo. Las
-- columnas `modelo`/`version` de `installed_indices` se quedan por lo ya
-- instalado y pasan a significar la capa principal.
CREATE TABLE IF NOT EXISTS installed_index_layers (
    paquete TEXT NOT NULL,
    modelo  TEXT NOT NULL,
    version TEXT NOT NULL,
    dims    INTEGER NOT NULL,
    PRIMARY KEY (paquete, modelo, version)
);
CREATE TABLE IF NOT EXISTS reference_images (
    id      INTEGER PRIMARY KEY,
    paquete TEXT NOT NULL,
    ruta    TEXT NOT NULL,
    lat     REAL NOT NULL,
    lng     REAL NOT NULL,
    quadkey TEXT NOT NULL,
    fuente  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ref_paquete ON reference_images(paquete);
-- Las alternativas. La principal NO se duplica aquí: sigue en las columnas
-- result_* de `analyses`, que el cliente ya lee.
CREATE TABLE IF NOT EXISTS analysis_hypotheses (
    analysis_id INTEGER NOT NULL,
    orden       INTEGER NOT NULL,
    lat         REAL NOT NULL,
    lng         REAL NOT NULL,
    radio_m     REAL NOT NULL,
    peso        REAL NOT NULL,
    indice      TEXT NOT NULL,
    autor       TEXT NOT NULL,
    PRIMARY KEY (analysis_id, orden)
);
-- Lo que dijeron los agentes de un análisis. Es a la vez el panel del cliente
-- y el registro de auditoría: como Vision corre «todos los del registro», dos
-- servidores pueden componerse distinto, y esta tabla es lo que hace que el
-- informe diga exactamente de qué se compuso ESTE.
CREATE TABLE IF NOT EXISTS analysis_agents (
    analysis_id INTEGER NOT NULL,
    agente      TEXT NOT NULL,
    nombre      TEXT NOT NULL,
    etiqueta    TEXT NOT NULL,
    confianza   REAL NOT NULL,
    tipo        TEXT NOT NULL,
    detalle     TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (analysis_id, agente)
);
CREATE TABLE IF NOT EXISTS model_licenses (
    licencia     TEXT NOT NULL,
    para         TEXT NOT NULL,
    aceptada_por INTEGER NOT NULL,
    aceptada_en  INTEGER NOT NULL,
    PRIMARY KEY (licencia, para)
);
CREATE TABLE IF NOT EXISTS ip_allowlist (
    ip        TEXT PRIMARY KEY,
    added_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ip_denylist (
    ip        TEXT PRIMARY KEY,
    added_at  INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avisos (
    id           INTEGER PRIMARY KEY,
    -- Documento JSON del editor Tiptap, NUNCA HTML: quien lo lee en otra
    -- sesión nunca pasa por un render de markup arbitrario.
    contenido    TEXT NOT NULL,
    icono        TEXT NOT NULL,
    prioridad    TEXT NOT NULL,
    destino      TEXT NOT NULL,
    creado_por   TEXT NOT NULL,
    created_at   INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS avisos_usuarios (
    aviso_id  INTEGER NOT NULL,
    user_id   INTEGER NOT NULL,
    PRIMARY KEY (aviso_id, user_id)
);
CREATE TABLE IF NOT EXISTS hardware_profiles (
    gpu_index          INTEGER PRIMARY KEY,
    potencia_w         INTEGER NOT NULL,
    offset_nucleo_mhz  INTEGER NOT NULL,
    offset_memoria_mhz INTEGER NOT NULL,
    -- JSON de `Vec<PuntoCurva>` — una curva no necesita sus propias filas,
    -- se edita y se relee entera cada vez.
    curva_ventilador   TEXT NOT NULL,
    updated_at         INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS cpu_profile (
    id         INTEGER PRIMARY KEY CHECK (id = 1),
    pl1_w      REAL NOT NULL,
    pl2_w      REAL NOT NULL,
    updated_at INTEGER NOT NULL
);
";

pub struct Store(Mutex<Connection>);

impl Store {
    pub fn open(dir: &Path) -> Result<Self> {
        let ruta = dir.join("lumi.db");
        let c = Connection::open(&ruta)?;
        // Sin esto, el fichero nace con el umask por defecto del proceso —
        // en un host mal configurado (umask 022, cuenta compartida) podía
        // quedar legible por cualquiera. Ahora guarda hashes de contraseña y
        // de token, no secretos en claro, pero restringir el fichero al
        // dueño del daemon sigue siendo la defensa barata de más capas.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&ruta, std::fs::Permissions::from_mode(0o600));
        }
        // El instalador escribe la clave de vinculación en este mismo fichero
        // justo después de arrancar el servicio (`lumi install`), y por
        // defecto SQLite falla al instante con "database is locked" en vez de
        // esperar -- busy_timeout hace que la conexión que llega segundo
        // reintente unos segundos en vez de morir en esa carrera.
        c.busy_timeout(std::time::Duration::from_secs(5))?;
        // ponytail: la sesión de bootstrap usa user_id = 0 como centinela (no
        // hay usuario con ese id todavía). El build bundled de SQLite activa
        // foreign_keys por defecto y rompería ese diseño; se desactiva
        // explícitamente, que es el comportamiento estándar de SQLite.
        c.execute_batch("PRAGMA foreign_keys = OFF;")?;
        c.execute_batch(SCHEMA)?;
        migrate(&c);
        Ok(Self(Mutex::new(c)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().expect("mutex del store envenenado")
    }

    pub fn state(&self) -> DaemonState {
        let c = self.conn();
        let has_admin: i64 = c
            .query_row("SELECT COUNT(*) FROM users WHERE is_admin = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if has_admin == 0 {
            return DaemonState::Unclaimed;
        }
        let running: i64 = c
            .query_row("SELECT COUNT(*) FROM tasks WHERE running = 1", [], |r| r.get(0))
            .unwrap_or(0);
        if running > 0 {
            return DaemonState::Provisioning;
        }
        match c.query_row("SELECT v FROM meta WHERE k = 'provisioned'", [], |r| {
            r.get::<_, String>(0)
        }) {
            Ok(v) if v == "1" => DaemonState::Ready,
            _ => DaemonState::Claimed,
        }
    }

    pub fn set_meta(&self, k: &str, v: &str) -> Result<()> {
        self.conn()
            .execute("INSERT OR REPLACE INTO meta (k, v) VALUES (?1, ?2)", (k, v))?;
        Ok(())
    }

    pub fn get_meta(&self, k: &str) -> Option<String> {
        self.conn()
            .query_row("SELECT v FROM meta WHERE k = ?1", [k], |r| r.get(0))
            .ok()
    }

    /// Todo `en_curso` que exista al arrancar es un resto de una caída: ningún
    /// trabajador sobrevive al daemon, así que no puede haber nada corriendo de
    /// verdad. Sin esto, un corte de luz deja trabajos que nadie recogerá jamás.
    ///
    /// Devuelve cuántos ha rearmado, para poder decirlo en el log de arranque.
    pub fn rearmar_trabajos_huerfanos(&self) -> usize {
        self.conn()
            .execute("UPDATE analyses SET state = 'pendiente' WHERE state = 'en_curso'", [])
            .unwrap_or(0)
    }
}

/// Columnas añadidas después de la primera versión del esquema.
///
/// ponytail: no hay tabla de versiones ni motor de migraciones. `ALTER TABLE
/// ADD COLUMN` falla con "duplicate column name" si ya existe, y ese fallo es
/// exactamente la señal de "ya está aplicada". El techo es el día en que haga
/// falta transformar datos y no solo añadir columnas; ahí sí toca versionar.
fn migrate(c: &Connection) {
    for (table, col, decl) in [
        ("users", "display_name", "TEXT"),
        ("users", "blocked", "INTEGER NOT NULL DEFAULT 0"),
        ("users", "must_change_password", "INTEGER NOT NULL DEFAULT 0"),
        ("sessions", "device_id", "INTEGER"),
        ("sessions", "created_at", "INTEGER NOT NULL DEFAULT 0"),
        ("sessions", "last_seen", "INTEGER NOT NULL DEFAULT 0"),
        ("sessions", "public_id", "TEXT"),
        // Todo lo anterior a la invitación con aceptación ya estaba dentro:
        // migra a 'accepted' o el dueño (y cada invitado ya admitido) se
        // quedaría fuera de su propio proyecto en cuanto `access()` empiece
        // a exigir el estado.
        ("project_members", "status", "TEXT NOT NULL DEFAULT 'accepted'"),
        ("project_members", "invited_by", "INTEGER"),
        // Cuántas veces ha vuelto a la cola por muerte de su trabajador. Sin
        // tope, una imagen envenenada tumbaría a la misma GPU en bucle para
        // siempre.
        ("analyses", "requeues", "INTEGER NOT NULL DEFAULT 0"),
        // El nivel que realmente corrió tras la degradación del 5b. Nulo
        // significa «el pedido», que es lo normal.
        ("analyses", "nivel_efectivo", "TEXT"),
        // De qué verificador salió la coordenada afinada y con cuánto
        // respaldo. Es evidencia, no telemetría.
        ("analysis_hypotheses", "inliers", "INTEGER"),
        ("analysis_hypotheses", "verificador", "TEXT"),
        // Por qué un agente hundió esta hipótesis. Nulo significa que ninguno
        // la tocó, no que la aprobaran.
        ("analysis_hypotheses", "motivo_agente", "TEXT"),
        // Lo que declaró el cliente al pedir acceso. Anulable a propósito: las
        // solicitudes ya pendientes no lo tienen, y se enseñan con «no
        // consta» en vez de con un dato inventado.
        ("access_requests", "device", "TEXT"),
        ("users", "is_service", "INTEGER NOT NULL DEFAULT 0"),
        // Una clave de API es una fila más en `sessions`, no una tabla nueva:
        // mismo camino de autenticación que un login, solo cambia el `kind`.
        ("sessions", "kind", "TEXT NOT NULL DEFAULT 'login'"),
        ("sessions", "label", "TEXT"),
        // JSON: lista de IP/CIDR propias de esta clave, o clases de
        // dispositivo permitidas. Vacío (`[]`) o NULL significa "sin
        // restricción" — el mismo criterio que "sin Zero Trust".
        ("sessions", "ips", "TEXT"),
        ("sessions", "devices", "TEXT"),
        // `token` pasa a guardar un hash (ver `lumi_proto::crypto::hash_token`)
        // en vez del secreto en claro — leer `lumi.db` ya no basta para
        // hacerse pasar por una sesión. Pero una clave de API necesita seguir
        // mostrando un fragmento reconocible en la lista ("lumi_ak_9f83…c1e2")
        // y un hash no se puede des-hacer para eso, así que ese fragmento se
        // guarda aparte, en claro, calculado una vez al emitir la clave.
        ("sessions", "token_prefix", "TEXT"),
    ] {
        let _ = c.execute(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"), []);
    }
    // Las sesiones anteriores a esta versión tienen public_id NULL. SQLite
    // admite varios NULL en un índice único, así que conviven sin conflicto:
    // simplemente no se pueden listar ni revocar por id, y caducan solas.
    let _ = c.execute_batch(
        "CREATE UNIQUE INDEX IF NOT EXISTS sessions_public ON sessions(public_id);",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_indice_parcial_protege_los_globales_que_unique_no_protege() {
        let dir = std::env::temp_dir().join(format!("lumi-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        let c = s.conn();
        c.execute("INSERT INTO limits (user_id, key, value) VALUES (NULL, 'max_daily', '50')", [])
            .unwrap();
        // Sin el índice parcial esto pasaría: para UNIQUE, NULL != NULL.
        assert!(c
            .execute("INSERT INTO limits (user_id, key, value) VALUES (NULL, 'max_daily', '99')", [])
            .is_err());
        // Y la anulación del mismo límite para un usuario sí debe entrar.
        c.execute("INSERT INTO limits (user_id, key, value) VALUES (7, 'max_daily', '99')", [])
            .unwrap();
        drop(c);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn abrir_dos_veces_migra_sin_romper() {
        let dir = std::env::temp_dir().join(format!("lumi-mig-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        drop(Store::open(&dir).unwrap());
        // La segunda apertura vuelve a lanzar los ALTER TABLE: si no fueran
        // idempotentes, el daemon no arrancaría nunca una segunda vez.
        let s = Store::open(&dir).unwrap();
        s.conn()
            .query_row("SELECT blocked FROM users WHERE 0", [], |_| Ok(()))
            .ok();
        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn los_trabajos_en_curso_se_rearman_al_abrir() {
        let dir = std::env::temp_dir().join(format!("lumi-huerf-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        s.conn()
            .execute(
                "INSERT INTO analyses (id, case_id, requested_by, model, state, created_at)
                 VALUES (1, 1, 1, 'mini', 'en_curso', 0), (2, 1, 1, 'mini', 'pendiente', 0),
                        (3, 1, 1, 'mini', 'hecho', 0)",
                [],
            )
            .unwrap();

        assert_eq!(s.rearmar_trabajos_huerfanos(), 1, "solo el que estaba en curso");

        let estados: Vec<String> = {
            let c = s.conn();
            let mut q = c.prepare("SELECT state FROM analyses ORDER BY id").unwrap();
            let v = q.query_map([], |r| r.get(0)).unwrap().flatten().collect();
            v
        };
        assert_eq!(estados, vec!["pendiente", "pendiente", "hecho"], "lo hecho no se toca");

        // Y la columna del tope de reintentos existe y nace a cero.
        let r: i64 = s
            .conn()
            .query_row("SELECT requeues FROM analyses WHERE id = 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(r, 0);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
