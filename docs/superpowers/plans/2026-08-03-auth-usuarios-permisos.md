# Plan de implementación — Auth, usuarios y permisos

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea a tarea. Los pasos
> usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que entre gente que no es el owner: pedir acceso con una tarjeta pública,
ser aprobado, crear la cuenta, iniciar sesión con límites y banderas de cuenta, y que el
admin lo gobierne desde una superficie mínima y provisional.

**Arquitectura:** un segundo formato de clave (`lumi1s_`, sin secreto) permite conectar
verificado sin credenciales, que es lo que desbloquea todo el flujo. Sobre eso, un ticket
de solicitud —Argon2id en la base, con el id delante para no escanear la tabla— autoriza
exactamente dos acciones: consultar el estado y crear la cuenta. Los límites viven en una
tabla clave/valor con dos niveles (global y por usuario) y se exponen por una sola función,
`limits::effective`; **este subsistema no los aplica**.

**Stack:** Rust 2021 · axum 0.7 · rusqlite (bundled) · argon2 · bs58 · clap ·
Tauri v2 · React 19 · Vite · Tailwind 3 · zustand

**Spec:** [`2026-08-03-auth-usuarios-permisos-design.md`](../specs/2026-08-03-auth-usuarios-permisos-design.md)
**Diseño:** [`DESIGN.md`](../../../DESIGN.md) · mockup aprobado en `../specs/lumi-s2-mockups.html`

---

## Restricciones globales

- **Sin tests salvo los indicados.** `PROJECT-CONVENTIONS.md` los considera gasto
  innecesario. Las tareas con lógica no trivial llevan **una** comprobación ejecutable; las
  mecánicas, ninguna.
- **Un commit por tarea terminada.** Nada de commits intermedios.
- **`ponytail` manda.** Antes de escribir: ¿esto necesita existir? ¿lo cubre la stdlib? ¿una
  dependencia ya instalada? Las simplificaciones deliberadas se marcan con un comentario
  `// ponytail:` que nombra el techo y la salida.
- **Sin jerga criptográfica en la interfaz de usuario.** Nada de huellas en base58, ni
  `Argon2id`, ni explicaciones de prefijos. Se comunica la garantía ("nadie puede leer tu
  contraseña"), no el mecanismo. **Excepción:** las vistas de admin y el CLI sí pueden
  mostrar la huella, porque ahí es un dato operativo que hay que copiar.
- **Copy en español, minúscula en subtítulos.** Sin em dashes (`—`) en texto de interfaz.
- **Iconos:** `viewBox="0 0 24 24"` siempre, `stroke-width` 1.6–2.0 sin adelgazar al crecer,
  32px máximo, trazo en `fg` salvo cuando el color significa estado.
- **Movimiento:** solo `ease-out` exponencial, `cubic-bezier(.16,1,.3,1)`. Sin rebote.
- **Sin colores fuera de la paleta de `DESIGN.md`. No hay verde.**
- **Ningún secreto en una ruta.** Tickets y tokens viajan en cabecera `Authorization`.
  Las rutas acaban en logs de acceso y trazas de error.
- **Los administradores ignoran todos los límites.** `is_admin` corta cualquier
  comprobación antes de mirar la tabla.
- **Las vistas de admin son provisionales.** El subsistema 3 las rediseña desde cero. No
  invertir esfuerzo de diseño en ellas más allá de que funcionen y usen los tokens.

---

## Estructura de archivos

```
crates/lumi-proto/
  src/key.rs                  + ServerCard: lumi1s_<addr>_<huella>
  src/api.rs                  + Limits, DeviceInfo, tipos de solicitud y admin

crates/lumid/
  src/store.rs                + tablas nuevas y migración idempotente de columnas
  src/limits.rs               NUEVO · defectos, effective(), lectura y escritura
  src/routes/access.rs        NUEVO · solicitud, estado, creación de cuenta
  src/routes/admin.rs         NUEVO · solicitudes, usuarios, límites globales
  src/routes/auth.rs          + login con dispositivo y banderas, change-password,
                                sesiones propias, revocación, require_session
  src/main.rs                 + rutas nuevas y ConnectInfo para el límite por IP

crates/lumi-cli/
  src/main.rs                 + subcomandos card y admin
  src/admin.rs                NUEVO · escotilla: reset-password, unblock, card

client/src-tauri/
  src/main.rs                 + PATCH y DELETE, cabecera Ticket, pair_card

client/src/lib/
  api.ts                      + tipos y verbos nuevos
  session.ts                  + servidores recordados, ticket, identidad de equipo
  store.ts                    + usuario en sesión

client/src/entry/             NUEVO · todo el flujo de entrada
  EntryScreen.tsx             enruta entre login, solicitud, espera y resolución
  LoginForm.tsx               pantalla 1
  ServerSelect.tsx            desplegable + "configurar un servidor nuevo"
  AddServerForm.tsx           pantalla 2
  RequestForm.tsx             pantalla 3
  WaitingScreen.tsx           pantalla 4, radar de 30 s
  ResolvedScreen.tsx          pantallas 5 y 6
  ChangePasswordForm.tsx      cambio forzado

client/src/ui/
  Bell.tsx                    NUEVO · campana de notificaciones

client/src/admin/             NUEVO · provisional
  AdminPanel.tsx              conmuta entre las dos vistas
  RequestsView.tsx            pantalla 7
  UsersView.tsx               pantallas 8 y 9
```

---

## Orden y dependencias

```
1 tarjeta ──┬── 4 solicitud ── 5 cuenta ── 7 admin solicitudes
2 esquema ──┤
3 límites ──┴── 8 admin usuarios
            └── 6 login, sesiones, dispositivos
9 CLI

10 puente Tauri ── 11 entrada ── 12 solicitud y espera ── 13 resolución
                                 14 cambio de contraseña
                                 15 admin provisional
                                 16 enrutado y documentación
```

Las tareas 1–9 dejan un servidor completo y probable por `curl`. Las 10–16 le ponen cara.

---

## Tarea 1: Tarjeta de servidor pública

**Ficheros:**
- Modificar: `crates/lumi-proto/src/key.rs`

**Interfaces:**
- Produce: `ServerCard { addr: String, fingerprint: String }`, `ServerCard::new(addr, cert_der)`,
  `ServerCard::parse(&str) -> Result<ServerCard, KeyError>`, `impl Display`,
  `ServerCard::matches_cert(&self, cert_der: &[u8]) -> bool`.
- Consume: `fingerprint()`, `FP_BYTES` y `KeyError`, que ya existen en el fichero.

El prefijo `lumi1s_` no puede parsearse con el `strip_prefix("lumi1")` existente: `lumi1s_…`
también empieza por `lumi1`. Hay que comprobar el prefijo largo **antes**, y `PairKey::parse`
tiene que rechazar explícitamente una tarjeta en vez de tragársela como una clave rota.

- [ ] **Paso 1: escribir la comprobación ejecutable**

En `crates/lumi-proto/src/key.rs`, dentro del `mod tests` existente:

```rust
    #[test]
    fn tarjeta_publica_y_no_confusion_con_la_clave() {
        let cert = b"certificado de mentira";
        let c = ServerCard::new("192.168.1.40:7717", cert);
        let s = c.to_string();
        assert!(s.starts_with("lumi1s_"));
        assert_eq!(ServerCard::parse(&s).unwrap(), c);
        assert!(c.matches_cert(cert));
        // La tarjeta no lleva secreto: es información pública.
        assert_eq!(s.split('_').count(), 3);
        // Y los dos formatos no se confunden en ninguna dirección.
        let k = PairKey::generate("192.168.1.40:7717", cert);
        assert_eq!(PairKey::parse(&s).unwrap_err(), KeyError::BadPrefix);
        assert_eq!(ServerCard::parse(&k.to_string()).unwrap_err(), KeyError::BadPrefix);
    }
```

- [ ] **Paso 2: ejecutarla para verla fallar**

```bash
cargo test -p lumi-proto tarjeta_publica
```

Se espera: error de compilación, `cannot find type ServerCard in this scope`.

- [ ] **Paso 3: implementar**

En `crates/lumi-proto/src/key.rs`, junto a `const PREFIX`:

```rust
const CARD_PREFIX: &str = "lumi1s";
```

Y al final del fichero, antes de `mod tests`:

```rust
/// Tarjeta de servidor pública: `lumi1s_<host:puerto>_<huella>`.
///
/// No lleva secreto y no se consume. Es la huella de un certificado público:
/// compartirla no filtra nada, y con ella cualquiera del equipo puede conectar
/// VERIFICADO para pedir acceso. Sin esto, un usuario nuevo con solo una IP no
/// podría conectar sin abrir una grieta en el anclaje, y esa grieta la usaría
/// un MITM para responder "aprobado, crea tu cuenta aquí".
#[derive(Debug, Clone, PartialEq)]
pub struct ServerCard {
    pub addr: String,
    pub fingerprint: String,
}

impl ServerCard {
    pub fn new(addr: &str, cert_der: &[u8]) -> Self {
        Self { addr: addr.to_string(), fingerprint: fingerprint(cert_der) }
    }

    pub fn parse(s: &str) -> Result<Self, KeyError> {
        let rest = s
            .trim()
            .strip_prefix(CARD_PREFIX)
            .and_then(|r| r.strip_prefix('_'))
            .ok_or(KeyError::BadPrefix)?;
        // Desde la derecha: la dirección lleva puntos y dos puntos.
        let (addr, fp) = rest.rsplit_once('_').ok_or(KeyError::BadShape)?;
        if addr.is_empty() {
            return Err(KeyError::BadShape);
        }
        let raw = bs58::decode(fp).into_vec().map_err(|_| KeyError::BadEncoding)?;
        if raw.len() != FP_BYTES {
            return Err(KeyError::BadFingerprintLen);
        }
        Ok(Self { addr: addr.to_string(), fingerprint: fp.to_string() })
    }

    pub fn matches_cert(&self, cert_der: &[u8]) -> bool {
        fingerprint(cert_der) == self.fingerprint
    }
}

impl fmt::Display for ServerCard {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{CARD_PREFIX}_{}_{}", self.addr, self.fingerprint)
    }
}
```

Y en `PairKey::parse`, sustituir la primera línea:

```rust
        let s = s.trim();
        // `lumi1s_…` también empieza por `lumi1`: hay que descartarlo antes de
        // partir por campos, o una tarjeta se leería como una clave malformada
        // y el error mandaría al usuario a buscar un secreto que no existe.
        if s.starts_with(CARD_PREFIX) {
            return Err(KeyError::BadPrefix);
        }
        let rest = s.strip_prefix(PREFIX).ok_or(KeyError::BadPrefix)?;
```

- [ ] **Paso 4: ejecutar toda la suite del crate**

```bash
cargo test -p lumi-proto
```

Se espera: `test result: ok`, con los dos tests pasando. El test antiguo
`roundtrip_con_ipv4_y_rechazo_de_basura` **también** tiene que seguir en verde: es el que
protege el parseo de `PairKey` que acabas de tocar.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/key.rs
git commit -m "Tarjeta de servidor pública: conectar verificado sin credenciales"
```

---

## Tarea 2: Esquema de datos

**Ficheros:**
- Modificar: `crates/lumid/src/store.rs`

**Interfaces:**
- Produce: tablas `access_requests`, `devices`, `limits`; columnas nuevas en `users` y
  `sessions`; el índice parcial `limits_global`.
- Consume: `Store::open`, `Store::conn`, que ya existen.

La base ya está desplegada en máquinas de prueba, así que el esquema tiene que **migrar**,
no recrearse. `CREATE TABLE IF NOT EXISTS` ya es idempotente; los `ALTER TABLE` no lo son y
se envuelven en un ayudante que ignora el "duplicate column name".

- [ ] **Paso 1: escribir la comprobación ejecutable**

`limits` declara `UNIQUE(user_id, key)`, pero SQLite trata cada `NULL` como distinto: esa
restricción **no** protege los valores globales de duplicarse. El índice parcial sí. Es un
detalle que se rompe en una migración descuidada, y la spec lo señala como riesgo.

Al final de `crates/lumid/src/store.rs`:

```rust
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
}
```

- [ ] **Paso 2: ejecutarlas para verlas fallar**

```bash
cargo test -p lumid store::tests
```

Se espera: `no such table: limits` en el primero.

- [ ] **Paso 3: implementar**

En `crates/lumid/src/store.rs`, añadir al final de la constante `SCHEMA` (dentro de las
comillas, antes del cierre):

```sql
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
CREATE UNIQUE INDEX IF NOT EXISTS limits_global ON limits(key) WHERE user_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sessions_public ON sessions(public_id);
```

`sessions_public` va **después** del `ALTER` que crea la columna, así que no puede vivir en
`SCHEMA`. Sácalo de ahí y déjalo para el bloque de migración de abajo.

Sustituye el cuerpo de `Store::open` por:

```rust
    pub fn open(dir: &Path) -> Result<Self> {
        let c = Connection::open(dir.join("lumi.db"))?;
        // ponytail: la sesión de bootstrap usa user_id = 0 como centinela (no
        // hay usuario con ese id todavía). El build bundled de SQLite activa
        // foreign_keys por defecto y rompería ese diseño; se desactiva
        // explícitamente, que es el comportamiento estándar de SQLite.
        c.execute_batch("PRAGMA foreign_keys = OFF;")?;
        c.execute_batch(SCHEMA)?;
        migrate(&c);
        Ok(Self(Mutex::new(c)))
    }
```

Y añade, fuera del `impl`:

```rust
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
```

- [ ] **Paso 4: ejecutar**

```bash
cargo test -p lumid store::tests
```

Se espera: `test result: ok. 2 passed`.

- [ ] **Paso 5: commit**

```bash
git add crates/lumid/src/store.rs
git commit -m "Esquema: solicitudes de acceso, dispositivos, límites y sesiones con id público"
```

---

## Tarea 3: Límites efectivos

**Ficheros:**
- Crear: `crates/lumid/src/limits.rs`
- Modificar: `crates/lumi-proto/src/api.rs`, `crates/lumid/src/main.rs` (una línea de `mod`)

**Interfaces:**
- Produce: `lumi_proto::api::Limits` (con `Default`), `limits::effective(&Store, i64) -> Limits`,
  `limits::global(&Store) -> Limits`, `limits::overrides(&Store, i64) -> HashMap<String, Value>`,
  `limits::set(&Store, Option<i64>, &str, &Value) -> Result<()>`,
  `limits::clear(&Store, Option<i64>, &str) -> Result<()>`.
- Consume: `Store::conn` de la tarea 2.

Los valores se guardan como JSON en `TEXT` porque hay listas y booleanos además de enteros.
Ese es también el motivo de que la API los exponga como un mapa `key → Value`: un tipo
distinto por palanca sería seis veces el mismo código.

- [ ] **Paso 1: escribir la comprobación ejecutable**

Crear `crates/lumid/src/limits.rs` con solo el bloque de tests al final del fichero (el
resto se escribe en el paso 3):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_anulacion_gana_al_global_y_el_resto_se_hereda() {
        let dir = std::env::temp_dir().join(format!("lumi-lim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = crate::store::Store::open(&dir).unwrap();

        // Sin nada configurado, salen los defectos de la spec.
        let d = effective(&s, 1);
        assert_eq!(d.models, vec!["mini".to_string()]);
        assert_eq!(d.max_daily, 50);

        // El global cambia para todos.
        set(&s, None, "max_daily", &serde_json::json!(200)).unwrap();
        assert_eq!(effective(&s, 1).max_daily, 200);

        // La anulación cambia solo para uno, y no toca las demás palancas.
        set(&s, Some(1), "max_daily", &serde_json::json!(5)).unwrap();
        set(&s, Some(1), "models", &serde_json::json!(["mini", "vision"])).unwrap();
        assert_eq!(effective(&s, 1).max_daily, 5);
        assert_eq!(effective(&s, 2).max_daily, 200);
        assert_eq!(effective(&s, 1).models.len(), 2);
        assert_eq!(effective(&s, 1).max_concurrent, 2);

        // Y quitarla devuelve al global, no al defecto de fábrica.
        clear(&s, Some(1), "max_daily").unwrap();
        assert_eq!(effective(&s, 1).max_daily, 200);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Paso 2: ejecutarla para verla fallar**

```bash
cargo test -p lumid limits
```

Se espera: `file not found for module limits` o `cannot find function effective`.

- [ ] **Paso 3: implementar**

En `crates/lumi-proto/src/api.rs`, al final:

```rust
/// Las seis palancas de la spec. Se serializa entera hacia el cliente; se
/// almacena descompuesta en filas clave/valor para poder anular una sola.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Limits {
    pub models: Vec<String>,
    pub max_concurrent: i64,
    pub max_daily: i64,
    pub max_storage_gb: i64,
    pub queue_priority: i64,
    pub can_create_projects: bool,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            models: vec!["mini".into()],
            max_concurrent: 2,
            max_daily: 50,
            max_storage_gb: 20,
            queue_priority: 0,
            can_create_projects: true,
        }
    }
}

/// Identidad del equipo desde el que se inicia sesión. Registro PASIVO: audita
/// y permite revocar, NO autentica. Copiar el fichero del cliente copia la
/// identidad, y eso es a propósito.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceInfo {
    pub client_id: String,
    pub name: String,
    pub os: Option<String>,
}
```

Crear `crates/lumid/src/limits.rs` (encima del `mod tests` del paso 1):

```rust
//! Dos niveles: el valor global del servidor y la anulación por usuario.
//!
//! Este subsistema DEFINE, ALMACENA y EXPONE los límites. Quien los APLICA es
//! la cola (subsistema 4) y los proyectos (6). La frontera es `effective`.

use crate::store::Store;
use anyhow::Result;
use lumi_proto::api::Limits;
use serde_json::Value;
use std::collections::HashMap;

/// Las claves válidas. Cualquier otra se rechaza al escribir: una errata en un
/// PATCH crearía una fila que nadie lee nunca y un límite que nadie entiende.
pub const KEYS: [&str; 6] = [
    "models",
    "max_concurrent",
    "max_daily",
    "max_storage_gb",
    "queue_priority",
    "can_create_projects",
];

fn rows(s: &Store, user_id: Option<i64>) -> HashMap<String, Value> {
    let c = s.conn();
    let mut q = match user_id {
        Some(_) => c.prepare("SELECT key, value FROM limits WHERE user_id = ?1"),
        None => c.prepare("SELECT key, value FROM limits WHERE user_id IS NULL"),
    }
    .expect("sql de límites inválido");
    let map = |r: &rusqlite::Row| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?));
    let it = match user_id {
        Some(id) => q.query_map([id], map),
        None => q.query_map([], map),
    };
    it.into_iter()
        .flatten()
        .flatten()
        .filter_map(|(k, v)| Some((k, serde_json::from_str(&v).ok()?)))
        .collect()
}

fn apply(l: &mut Limits, k: &str, v: &Value) {
    match k {
        "models" => {
            if let Ok(m) = serde_json::from_value(v.clone()) {
                l.models = m;
            }
        }
        "max_concurrent" => l.max_concurrent = v.as_i64().unwrap_or(l.max_concurrent),
        "max_daily" => l.max_daily = v.as_i64().unwrap_or(l.max_daily),
        "max_storage_gb" => l.max_storage_gb = v.as_i64().unwrap_or(l.max_storage_gb),
        "queue_priority" => l.queue_priority = v.as_i64().unwrap_or(l.queue_priority).clamp(-5, 5),
        "can_create_projects" => {
            l.can_create_projects = v.as_bool().unwrap_or(l.can_create_projects)
        }
        _ => {}
    }
}

/// Los valores del servidor, sin anulaciones.
pub fn global(s: &Store) -> Limits {
    let mut l = Limits::default();
    for (k, v) in rows(s, None) {
        apply(&mut l, &k, &v);
    }
    l
}

/// Sus anulaciones, tal cual, para que la interfaz pueda decir de dónde viene
/// cada límite. Un límite sin origen visible es indepurable cuando alguien
/// pregunta por qué solo puede lanzar uno.
pub fn overrides(s: &Store, user_id: i64) -> HashMap<String, Value> {
    rows(s, Some(user_id))
}

/// El valor que rige para este usuario: su anulación si existe, si no el global.
///
/// Esta es la ÚNICA función que los subsistemas 4 y 6 deben llamar. No lean la
/// tabla por su cuenta: la precedencia de dos niveles vive aquí y en un solo
/// sitio, y así un tercer nivel (roles) se añade sin tocarlos.
pub fn effective(s: &Store, user_id: i64) -> Limits {
    let mut l = global(s);
    for (k, v) in overrides(s, user_id) {
        apply(&mut l, &k, &v);
    }
    l
}

pub fn set(s: &Store, user_id: Option<i64>, key: &str, value: &Value) -> Result<()> {
    anyhow::ensure!(KEYS.contains(&key), "límite desconocido: {key}");
    let json = serde_json::to_string(value)?;
    let c = s.conn();
    match user_id {
        Some(id) => c.execute(
            "INSERT INTO limits (user_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id, key) DO UPDATE SET value = ?3",
            rusqlite::params![id, key, json],
        ),
        // El ON CONFLICT por columnas no dispara con user_id NULL (cada NULL
        // es distinto): para los globales el conflicto lo detecta el índice
        // parcial, así que se apunta a él por nombre.
        None => c.execute(
            "INSERT INTO limits (user_id, key, value) VALUES (NULL, ?1, ?2)
             ON CONFLICT(key) WHERE user_id IS NULL DO UPDATE SET value = ?2",
            rusqlite::params![key, json],
        ),
    }?;
    Ok(())
}

/// Quita una anulación: el usuario vuelve a heredar del global.
pub fn clear(s: &Store, user_id: Option<i64>, key: &str) -> Result<()> {
    let c = s.conn();
    match user_id {
        Some(id) => c.execute(
            "DELETE FROM limits WHERE user_id = ?1 AND key = ?2",
            rusqlite::params![id, key],
        ),
        None => c.execute("DELETE FROM limits WHERE user_id IS NULL AND key = ?1", [key]),
    }?;
    Ok(())
}
```

En `crates/lumid/src/main.rs`, añadir junto a los otros `mod`:

```rust
mod limits;
```

- [ ] **Paso 4: ejecutar**

```bash
cargo test -p lumid limits
```

Se espera: `test result: ok. 1 passed`.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/limits.rs crates/lumid/src/main.rs
git commit -m "Límites en dos niveles con una sola frontera: limits::effective"
```

---

## Tarea 4: Solicitar acceso y consultar el estado

**Ficheros:**
- Crear: `crates/lumid/src/routes/access.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`,
  `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Produce: `POST /v1/access-requests`, `GET /v1/access-requests/status`;
  `access::ticket(&HeaderMap) -> String`, `access::authorize(&App, &str) -> Result<Row, (StatusCode, String)>`
  con `pub struct Row { pub id: i64, pub status: String, pub display_name: String,
  pub granted_models: Option<String>, pub expires_at: i64 }`;
  tipos `AccessReq`, `AccessRes`, `AccessStatus`.
- Consume: `Store`, `hash_password`/`verify_password` de `lumi-proto::crypto`,
  `routes::claim::new_token`.

Esta es **la primera ruta escribible sin credenciales de todo el proyecto**. Las defensas de
la spec §8 no son opcionales: 3 solicitudes por IP y hora, 10 al día, tope global de 100
pendientes, tamaños máximos y un interruptor global.

**Formato del ticket:** `lt_<id>_<secreto en base58>`. El id va delante a propósito: la
base guarda solo el hash Argon2id del secreto, y sin el id habría que verificar el hash
contra **todas** las filas para encontrar la buena. Con el id, es una fila y una
verificación.

- [ ] **Paso 1: escribir la comprobación ejecutable**

Al final de `crates/lumid/src/routes/access.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_ticket_se_verifica_por_id_y_no_por_barrido() {
        let (t, phc) = new_ticket(42);
        assert!(t.starts_with("lt_42_"));
        let (id, secret) = split_ticket(&t).unwrap();
        assert_eq!(id, 42);
        assert!(lumi_proto::crypto::verify_password(&secret, &phc));
        // Un ticket con el id correcto pero el secreto de otro no vale.
        let (otro, _) = new_ticket(42);
        let (_, secret_otro) = split_ticket(&otro).unwrap();
        assert!(!lumi_proto::crypto::verify_password(&secret_otro, &phc));
        // Y la basura no revienta el parseo.
        assert!(split_ticket("lt_no_es_un_numero").is_none());
        assert!(split_ticket("Bearer abc").is_none());
        assert!(split_ticket("").is_none());
    }
}
```

- [ ] **Paso 2: ejecutarla para verla fallar**

```bash
cargo test -p lumid access
```

Se espera: `cannot find function new_ticket`.

- [ ] **Paso 3: escribir los tipos del protocolo**

En `crates/lumi-proto/src/api.rs`, al final:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AccessReq {
    pub display_name: String,
    pub message: String,
}

/// El ticket se devuelve UNA sola vez. El servidor guarda su hash.
#[derive(Debug, Serialize, Deserialize)]
pub struct AccessRes {
    pub ticket: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccessStatus {
    /// pending | approved | rejected
    pub status: String,
    pub display_name: String,
    /// Motivo del rechazo, escrito por el admin. Se muestra tal cual.
    pub reason: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct AccountReq {
    pub username: String,
    pub password: String,
}
```

- [ ] **Paso 4: implementar la ruta**

Crear `crates/lumid/src/routes/access.rs`, encima del `mod tests` del paso 1:

```rust
//! Solicitud de acceso: la única superficie escribible sin credenciales.
//!
//! Todo lo que hay aquí que parece paranoia (límite por IP, tope global,
//! tamaños máximos, interruptor) es lo que impide que un bucle llene el disco
//! de un servidor que alguien dejó expuesto.

use crate::App;
use axum::extract::ConnectInfo;
use axum::{extract::State, http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AccessReq, AccessRes, AccessStatus, DaemonState};
use lumi_proto::crypto::{hash_password, verify_password};
use rand::RngCore;
use std::net::SocketAddr;

/// Sin responder, la solicitud muere sola.
const REQUEST_TTL_S: i64 = 7 * 24 * 3600;
/// Tras aprobar, ventana para crear la cuenta. Es una credencial sin cifrar en
/// el equipo del usuario: no alargar este plazo sin pensarlo.
pub const APPROVED_TTL_S: i64 = 48 * 3600;
const MAX_NAME: usize = 80;
const MAX_MESSAGE: usize = 500;
const PER_HOUR: i64 = 3;
const PER_DAY: i64 = 10;
const MAX_PENDING: i64 = 100;

pub fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64
}

/// Devuelve el ticket en claro (que solo se ve una vez) y su hash.
fn new_ticket(id: i64) -> (String, String) {
    let mut b = [0u8; 24];
    rand::thread_rng().fill_bytes(&mut b);
    let secret = bs58::encode(b).into_string();
    let phc = hash_password(&secret).expect("argon2 falló");
    (format!("lt_{id}_{secret}"), phc)
}

fn split_ticket(t: &str) -> Option<(i64, String)> {
    let rest = t.trim().strip_prefix("lt_")?;
    let (id, secret) = rest.split_once('_')?;
    if secret.is_empty() {
        return None;
    }
    Some((id.parse().ok()?, secret.to_string()))
}

/// `Authorization: Ticket <t>`. En cabecera, nunca en la ruta: es un secreto y
/// las rutas acaban en logs de acceso, historiales de proxy y trazas de error.
pub fn ticket(h: &HeaderMap) -> String {
    h.get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Ticket "))
        .unwrap_or_default()
        .to_string()
}

pub struct Row {
    pub id: i64,
    pub status: String,
    pub display_name: String,
    pub granted_models: Option<String>,
    pub expires_at: i64,
}

/// Valida el ticket y devuelve su solicitud. Es la puerta de las dos únicas
/// acciones que un ticket autoriza: consultar el estado y crear la cuenta.
pub fn authorize(app: &App, t: &str) -> Result<Row, (StatusCode, String)> {
    let bad = |c: StatusCode, m: &str| (c, m.to_string());
    let (id, secret) = split_ticket(t).ok_or_else(|| bad(StatusCode::UNAUTHORIZED, "ticket inválido"))?;
    let r: (String, String, String, Option<String>, i64) = app
        .store
        .conn()
        .query_row(
            "SELECT ticket_phc, status, display_name, granted_models, expires_at
             FROM access_requests WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
        )
        .map_err(|_| bad(StatusCode::UNAUTHORIZED, "ticket inválido"))?;
    if !verify_password(&secret, &r.0) {
        return Err(bad(StatusCode::UNAUTHORIZED, "ticket inválido"));
    }
    if r.1 == "consumed" {
        return Err(bad(StatusCode::CONFLICT, "esta solicitud ya creó su cuenta; inicia sesión"));
    }
    if now() > r.4 {
        return Err(bad(StatusCode::GONE, "la solicitud caducó; vuelve a solicitar acceso"));
    }
    Ok(Row { id, status: r.1, display_name: r.2, granted_models: r.3, expires_at: r.4 })
}

pub async fn create(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Json(req): Json<AccessReq>,
) -> Result<Json<AccessRes>, (StatusCode, String)> {
    let err = |c: StatusCode, m: &str| (c, m.to_string());
    let name = req.display_name.trim();
    let message = req.message.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME || message.chars().count() > MAX_MESSAGE {
        return Err(err(StatusCode::BAD_REQUEST, "nombre vacío o texto demasiado largo"));
    }
    if app.store.state() == DaemonState::Unclaimed {
        return Err(err(
            StatusCode::CONFLICT,
            "este servidor todavía no tiene administrador; hace falta la clave de vinculación",
        ));
    }
    if app.store.get_meta("accept_requests").as_deref() == Some("0") {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "el servidor no acepta solicitudes ahora mismo"));
    }

    let ip = peer.ip().to_string();
    let t = now();
    let c = app.store.conn();
    let count = |since: i64| -> i64 {
        c.query_row(
            "SELECT COUNT(*) FROM access_requests WHERE source_ip = ?1 AND created_at > ?2",
            rusqlite::params![ip, since],
            |r| r.get(0),
        )
        .unwrap_or(0)
    };
    if count(t - 3600) >= PER_HOUR {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera una hora"));
    }
    if count(t - 86400) >= PER_DAY {
        return Err(err(StatusCode::TOO_MANY_REQUESTS, "demasiadas solicitudes; espera 24 horas"));
    }
    let pending: i64 = c
        .query_row("SELECT COUNT(*) FROM access_requests WHERE status = 'pending'", [], |r| r.get(0))
        .unwrap_or(0);
    if pending >= MAX_PENDING {
        return Err(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "hay demasiadas solicitudes sin resolver; inténtalo más tarde",
        ));
    }

    // Se inserta primero para obtener el id, y el ticket se calcula con él.
    c.execute(
        "INSERT INTO access_requests
         (display_name, message, ticket_phc, source_ip, status, created_at, expires_at)
         VALUES (?1, ?2, '', ?3, 'pending', ?4, ?5)",
        rusqlite::params![name, message, ip, t, t + REQUEST_TTL_S],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    let (tk, phc) = new_ticket(id);
    c.execute("UPDATE access_requests SET ticket_phc = ?1 WHERE id = ?2", rusqlite::params![phc, id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    tracing::info!("solicitud de acceso #{id} desde {ip}");
    Ok(Json(AccessRes { ticket: tk }))
}

pub async fn status(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<AccessStatus>, (StatusCode, String)> {
    let row = authorize(&app, &ticket(&headers))?;
    let reason: Option<String> = app
        .store
        .conn()
        .query_row("SELECT reason FROM access_requests WHERE id = ?1", [row.id], |r| r.get(0))
        .unwrap_or(None);
    Ok(Json(AccessStatus { status: row.status, display_name: row.display_name, reason }))
}
```

- [ ] **Paso 5: registrar las rutas y el `ConnectInfo`**

En `crates/lumid/src/routes/mod.rs`:

```rust
pub mod access;
```

En `crates/lumid/src/main.rs`, dentro del `Router`, antes de `.with_state(app)`:

```rust
        .route("/v1/access-requests", post(routes::access::create))
        .route("/v1/access-requests/status", get(routes::access::status))
```

Y sustituir la línea del servicio, porque el límite por IP necesita saber la IP de origen:

```rust
    axum_server::bind_rustls(addr, tls_cfg)
        .serve(router.into_make_service_with_connect_info::<SocketAddr>())
        .await?;
```

- [ ] **Paso 6: ejecutar**

```bash
cargo test -p lumid access && cargo build --workspace
```

Se espera: `test result: ok. 1 passed` y compilación limpia del workspace. Si
`into_make_service_with_connect_info` no compila, falta el feature: en
`crates/lumid/Cargo.toml`, `axum = { version = "0.7", features = ["macros"] }` ya trae
`tokio`; el que hace falta es que `axum_server` sirva un `MakeService` con
`ConnectInfo<SocketAddr>`, que soporta de serie.

- [ ] **Paso 7: commit**

```bash
git add crates/lumid/src/routes/access.rs crates/lumid/src/routes/mod.rs \
        crates/lumid/src/main.rs crates/lumi-proto/src/api.rs
git commit -m "Solicitud de acceso: ticket verificable por id y defensas de la ruta abierta"
```

---

## Tarea 5: Crear la cuenta con el ticket

**Ficheros:**
- Modificar: `crates/lumid/src/routes/access.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Produce: `POST /v1/accounts`.
- Consume: `access::authorize`, `access::now`, `limits::set` de la tarea 3,
  `AccountReq` de la tarea 4.

Dos reglas que la spec fija y que es fácil equivocar:
- Si el nombre de usuario está ocupado, **el ticket no se consume**: `409` y se puede
  reintentar con otro nombre. Consumirlo dejaría al usuario fuera por una colisión de
  nombres, que no es culpa suya.
- Los modelos concedidos al aprobar se materializan como **anulación de `models`** para ese
  usuario. Si el admin no eligió ninguno, no se escribe anulación: hereda del global.

- [ ] **Paso 1: implementar**

En `crates/lumid/src/routes/access.rs`, al final (antes de `mod tests`):

```rust
/// Crea la cuenta y consume el ticket. El mismo ticket que identificaba la
/// solicitud es el que autoriza esto: sin él, aprobar exigiría al admin
/// acordarse de enviar algo por fuera, y si no lo hace el usuario espera sin
/// saber por qué.
pub async fn create_account(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<lumi_proto::api::AccountReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let err = |c: StatusCode, m: &str| (c, m.to_string());
    let row = authorize(&app, &ticket(&headers))?;
    if row.status != "approved" {
        return Err(err(StatusCode::CONFLICT, "esta solicitud aún no está aprobada"));
    }
    let username = req.username.trim();
    if username.is_empty() || req.password.len() < 12 {
        return Err(err(
            StatusCode::BAD_REQUEST,
            "usuario vacío o contraseña de menos de 12 caracteres",
        ));
    }
    let phc = hash_password(&req.password)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let uid = {
        let c = app.store.conn();
        // El nombre ocupado NO consume el ticket: es una colisión, no un abuso.
        c.execute(
            "INSERT INTO users (username, display_name, password_phc, is_admin, created_at)
             VALUES (?1, ?2, ?3, 0, ?4)",
            rusqlite::params![username, row.display_name, phc, now()],
        )
        .map_err(|_| err(StatusCode::CONFLICT, "ese nombre de usuario ya existe"))?;
        let uid = c.last_insert_rowid();
        c.execute(
            "UPDATE access_requests SET status = 'consumed' WHERE id = ?1",
            [row.id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        uid
    };

    if let Some(models) = row.granted_models {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&models) {
            let _ = crate::limits::set(&app.store, Some(uid), "models", &v);
        }
    }
    tracing::info!("cuenta creada: {username} (solicitud #{})", row.id);
    Ok(StatusCode::CREATED)
}
```

- [ ] **Paso 2: registrar la ruta**

En `crates/lumid/src/main.rs`:

```rust
        .route("/v1/accounts", post(routes::access::create_account))
```

- [ ] **Paso 3: compilar**

```bash
cargo build --workspace
```

Se espera: compilación limpia.

- [ ] **Paso 4: commit**

```bash
git add crates/lumid/src/routes/access.rs crates/lumid/src/main.rs
git commit -m "Crear cuenta con el ticket: se consume al usarse, no al colisionar el nombre"
```

---

## Tarea 6: Sesiones, dispositivos y cambio de contraseña

**Ficheros:**
- Modificar: `crates/lumid/src/routes/auth.rs`, `crates/lumi-proto/src/api.rs`,
  `crates/lumid/src/main.rs`

**Interfaces:**
- Produce: `auth::require_session(&App, &str) -> Result<(i64, bool), StatusCode>`,
  `auth::session_user(&App, &str) -> Result<(i64, bool), StatusCode>`;
  rutas `POST /v1/auth/change-password`, `GET /v1/me/sessions`,
  `DELETE /v1/sessions/:public_id`; `LoginRes` con `username` y `must_change_password`;
  `LoginReq` con `device`.
- Consume: `DeviceInfo` de la tarea 3, `access::now` de la tarea 4, `require_admin` y
  `bearer`, que ya existen.

Diferencia entre las dos funciones de sesión, que es el corazón de esta tarea:

- `session_user` dice **quién eres**. La usa `change-password` y nada más.
- `require_session` dice **quién eres y puedes operar**. Rechaza a quien tiene el cambio
  de contraseña pendiente. Así el token que devuelve un login con `must_change_password`
  existe pero no sirve para nada más que cambiarla, y no hace falta inventar un segundo
  tipo de credencial.

- [ ] **Paso 1: escribir la comprobación ejecutable**

Al final de `crates/lumid/src/routes/auth.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    /// La bandera de cambio pendiente tiene que cortar TODO menos el cambio en
    /// sí. Si no, un token emitido para "cambia la contraseña" valdría para
    /// operar sin cambiarla nunca.
    #[test]
    fn el_cambio_pendiente_deja_identificarse_pero_no_operar() {
        let dir = std::env::temp_dir().join(format!("lumi-auth-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = crate::store::Store::open(&dir).unwrap();
        {
            let c = s.conn();
            c.execute(
                "INSERT INTO users (id, username, password_phc, is_admin, created_at,
                                    must_change_password) VALUES (1, 'ana', 'x', 0, 0, 1)",
                [],
            )
            .unwrap();
            c.execute(
                "INSERT INTO sessions (token, user_id, expires_at, created_at, last_seen, public_id)
                 VALUES ('tk', 1, 99999999999, 0, 0, 'pub')",
                [],
            )
            .unwrap();
        }
        assert_eq!(lookup(&s, "tk", false).unwrap().0, 1);
        assert!(lookup(&s, "tk", true).is_err());
        s.conn()
            .execute("UPDATE users SET must_change_password = 0 WHERE id = 1", [])
            .unwrap();
        assert!(lookup(&s, "tk", true).is_ok());
        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Paso 2: ejecutarla para verla fallar**

```bash
cargo test -p lumid auth
```

Se espera: `cannot find function lookup`.

- [ ] **Paso 3: ampliar los tipos del protocolo**

En `crates/lumi-proto/src/api.rs`, sustituir `LoginReq` y `LoginRes` por:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
    /// Opcional: el CLI y las pruebas por curl no lo mandan.
    #[serde(default)]
    pub device: Option<DeviceInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct LoginRes {
    pub token: String,
    pub username: String,
    pub is_admin: bool,
    /// Si es `true`, el token solo sirve para `POST /v1/auth/change-password`.
    pub must_change_password: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ChangePasswordReq {
    pub current: String,
    pub new: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SessionInfo {
    pub public_id: String,
    pub device_name: Option<String>,
    pub os: Option<String>,
    pub created_at: i64,
    pub last_seen: i64,
    pub current: bool,
}
```

- [ ] **Paso 4: implementar**

En `crates/lumid/src/routes/auth.rs`, sustituir el cuerpo de `login` y añadir el resto:

```rust
use crate::routes::access::now;
use crate::store::Store;
use lumi_proto::api::{ChangePasswordReq, DeviceInfo, SessionInfo};
use lumi_proto::crypto::hash_password;

/// Registro PASIVO de equipos: audita y permite revocar, no autentica. Copiar
/// el fichero del cliente copia la identidad, y eso es a propósito: exigir
/// dispositivos aprobados costaría un par de claves por equipo, y el coste
/// real de eso no es el código, es el soporte de cada portátil nuevo.
fn upsert_device(c: &rusqlite::Connection, uid: i64, d: &DeviceInfo) -> Option<i64> {
    let t = now();
    c.execute(
        "INSERT INTO devices (user_id, client_id, name, os, first_seen, last_seen)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(user_id, client_id) DO UPDATE SET name = ?3, os = ?4, last_seen = ?5",
        rusqlite::params![uid, d.client_id, d.name, d.os, t],
    )
    .ok()?;
    c.query_row(
        "SELECT id FROM devices WHERE user_id = ?1 AND client_id = ?2",
        rusqlite::params![uid, d.client_id],
        |r| r.get(0),
    )
    .ok()
}

pub async fn login(
    State(app): State<App>,
    Json(req): Json<LoginReq>,
) -> Result<Json<LoginRes>, (StatusCode, String)> {
    let c = app.store.conn();
    let row: Result<(i64, String, i64, i64, i64), _> = c.query_row(
        "SELECT id, password_phc, is_admin, blocked, must_change_password
         FROM users WHERE username = ?1",
        [&req.username],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
    );
    // Mismo mensaje para usuario inexistente y contraseña mala: no filtramos
    // qué nombres existen en el servidor.
    let denied = (StatusCode::UNAUTHORIZED, "usuario o contraseña incorrectos".to_string());
    let Ok((id, phc, is_admin, blocked, must_change)) = row else { return Err(denied) };
    if !verify_password(&req.password, &phc) {
        return Err(denied);
    }
    // Bloqueado es DISTINTO de credenciales malas, y se dice: quien está
    // bloqueado necesita saber que su contraseña está bien y que hable con
    // el administrador, no seguir probando contraseñas.
    if blocked == 1 {
        return Err((
            StatusCode::FORBIDDEN,
            "esta cuenta está bloqueada; habla con el administrador".into(),
        ));
    }

    let device_id = req.device.as_ref().and_then(|d| upsert_device(&c, id, d));
    let token = new_token();
    let public_id = new_token();
    let t = now();
    c.execute(
        "INSERT INTO sessions (token, user_id, expires_at, device_id, created_at, last_seen, public_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
        rusqlite::params![token, id, t + SESSION_TTL_S, device_id, t, public_id],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(Json(LoginRes {
        token,
        username: req.username,
        is_admin: is_admin == 1,
        must_change_password: must_change == 1,
    }))
}

/// `operable = false` responde "quién eres"; `true` responde "quién eres y
/// puedes operar". Separado en una función libre para poder comprobarlo sin
/// levantar un servidor.
fn lookup(store: &Store, token: &str, operable: bool) -> Result<(i64, bool), StatusCode> {
    let (id, is_admin, must_change): (i64, i64, i64) = store
        .conn()
        .query_row(
            "SELECT u.id, u.is_admin, u.must_change_password
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token = ?1 AND s.expires_at > ?2 AND u.blocked = 0",
            rusqlite::params![token, now()],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if operable && must_change == 1 {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok((id, is_admin == 1))
}

/// Sesión válida y en condiciones de operar. Es la puerta por defecto.
///
/// ponytail: no actualiza `last_seen` en cada petición. Sería una escritura en
/// el mutex del store por llamada, para un dato que solo se mira en una vista
/// de auditoría. Se sella al iniciar sesión; el techo es el día en que haga
/// falta "activo hace 2 min" de verdad.
pub fn require_session(app: &App, token: &str) -> Result<(i64, bool), StatusCode> {
    lookup(&app.store, token, true)
}

/// Identifica sin exigir estar en condiciones de operar. SOLO para el cambio
/// de contraseña: es la acción que desbloquea al usuario.
pub fn session_user(app: &App, token: &str) -> Result<(i64, bool), StatusCode> {
    lookup(&app.store, token, false)
}

/// Sustituye por completo a la `require_admin` anterior, que consultaba la base
/// por su cuenta y por tanto no vería ni el bloqueo ni el cambio pendiente.
pub fn require_admin(app: &App, token: &str) -> Result<i64, StatusCode> {
    let (uid, is_admin) = require_session(app, token)?;
    if !is_admin {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(uid)
}

pub async fn change_password(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
    Json(req): Json<ChangePasswordReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let token = bearer(&headers);
    let (uid, _) = session_user(&app, &token).map_err(|c| (c, "sesión inválida".to_string()))?;
    if req.new.len() < 12 {
        return Err((StatusCode::BAD_REQUEST, "la contraseña necesita 12 caracteres o más".into()));
    }
    let c = app.store.conn();
    let phc: String = c
        .query_row("SELECT password_phc FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|_| (StatusCode::UNAUTHORIZED, "sesión inválida".to_string()))?;
    // Nadie puede leer ni fijar la contraseña de otro: el admin solo exige que
    // se cambie. Por eso aquí SIEMPRE se pide la actual, incluso cuando el
    // cambio viene forzado.
    if !verify_password(&req.current, &phc) {
        return Err((StatusCode::UNAUTHORIZED, "la contraseña actual no es correcta".into()));
    }
    let new_phc = hash_password(&req.new)
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    c.execute(
        "UPDATE users SET password_phc = ?1, must_change_password = 0 WHERE id = ?2",
        rusqlite::params![new_phc, uid],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    // Las demás sesiones caen: si cambias la contraseña es porque puede estar
    // comprometida. La actual sobrevive para no echar al usuario de la app.
    c.execute(
        "DELETE FROM sessions WHERE user_id = ?1 AND token != ?2",
        rusqlite::params![uid, token],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn my_sessions(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
) -> Result<Json<Vec<SessionInfo>>, StatusCode> {
    let token = bearer(&headers);
    let (uid, _) = require_session(&app, &token)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT s.public_id, d.name, d.os, s.created_at, s.last_seen, s.token = ?2
             FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = ?1 AND s.public_id IS NOT NULL AND s.expires_at > ?3
             ORDER BY s.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q
        .query_map(rusqlite::params![uid, token, now()], |r| {
            Ok(SessionInfo {
                public_id: r.get(0)?,
                device_name: r.get(1)?,
                os: r.get(2)?,
                created_at: r.get(3)?,
                last_seen: r.get(4)?,
                current: r.get::<_, i64>(5)? == 1,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(rows))
}

/// Revoca por identificador público, nunca por token: el token es un secreto y
/// las rutas acaban en logs de acceso.
pub async fn revoke_session(
    State(app): State<App>,
    axum::extract::Path(public_id): axum::extract::Path<String>,
    headers: axum::http::HeaderMap,
) -> Result<StatusCode, StatusCode> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let n = if is_admin {
        c.execute("DELETE FROM sessions WHERE public_id = ?1", [&public_id])
    } else {
        c.execute(
            "DELETE FROM sessions WHERE public_id = ?1 AND user_id = ?2",
            rusqlite::params![public_id, uid],
        )
    }
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    // Mismo 404 para "no existe" y "no es tuya": no confirmamos la existencia
    // de sesiones ajenas a quien va probando identificadores.
    if n == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(StatusCode::NO_CONTENT)
}
```

Y en `me`, sustituir la llamada a `require_admin` para que valga también a un usuario
normal (hoy solo responde a administradores, y a partir de esta tarea el cliente lo usa
para revalidar cualquier sesión al reabrir la app):

```rust
pub async fn me(
    State(app): State<App>,
    headers: axum::http::HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))?;
    let username: String = app
        .store
        .conn()
        .query_row("SELECT username FROM users WHERE id = ?1", [uid], |r| r.get(0))
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(serde_json::json!({ "username": username, "is_admin": is_admin })))
}
```

- [ ] **Paso 5: registrar las rutas**

En `crates/lumid/src/main.rs`, y añadiendo `delete` al `use axum::routing::…`:

```rust
        .route("/v1/auth/change-password", post(routes::auth::change_password))
        .route("/v1/me/sessions", get(routes::auth::my_sessions))
        .route("/v1/sessions/:public_id", axum::routing::delete(routes::auth::revoke_session))
```

- [ ] **Paso 6: ejecutar**

```bash
cargo test -p lumid && cargo build --workspace
```

Se espera: todos los tests en verde y compilación limpia. Si el cliente Tauri deja de
compilar por `LoginRes`, es esperado: se arregla en la tarea 10.

- [ ] **Paso 7: commit**

```bash
git add crates/lumid/src/routes/auth.rs crates/lumi-proto/src/api.rs crates/lumid/src/main.rs
git commit -m "Sesiones con id público, registro pasivo de equipos y cambio de contraseña"
```

---

## Tarea 7: Administración de solicitudes

**Ficheros:**
- Crear: `crates/lumid/src/routes/admin.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`,
  `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Produce: `GET /v1/admin/access-requests`, `POST /v1/admin/access-requests/:id/resolve`;
  tipos `AdminRequest`, `ResolveReq`.
- Consume: `require_admin` y `bearer` de la tarea 6, `access::now` y `access::APPROVED_TTL_S`
  de la tarea 4.

Aprobar o rechazar es **idempotente por solicitud**: la primera resolución gana y las
siguientes devuelven `409`. Aquí sí se usa el `:id` en la ruta, y está bien: el id de una
solicitud es un número correlativo, no un secreto. El secreto es el ticket, que nunca sale
del cliente que lo pidió.

Al aprobar, `expires_at` pasa de "+7 días desde que se pidió" a "+48 h desde ahora": la
ventana para crear la cuenta no es la misma que la ventana para que el admin conteste.

- [ ] **Paso 1: tipos del protocolo**

En `crates/lumi-proto/src/api.rs`, al final:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AdminRequest {
    pub id: i64,
    pub display_name: String,
    pub message: String,
    pub source_ip: String,
    /// La solicitud viene de fuera del rango privado. Lo calcula el servidor
    /// para que la interfaz no tenga que saber de rangos de red.
    pub external: bool,
    pub status: String,
    pub reason: Option<String>,
    pub created_at: i64,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResolveReq {
    pub approve: bool,
    #[serde(default)]
    pub reason: Option<String>,
    /// Solo al aprobar. Vacío o ausente: hereda los modelos del global.
    #[serde(default)]
    pub granted_models: Option<Vec<String>>,
}
```

- [ ] **Paso 2: implementar**

Crear `crates/lumid/src/routes/admin.rs`:

```rust
//! Superficie de administración. PROVISIONAL en su forma de interfaz, pero no
//! en sus rutas: el subsistema 3 rediseña las pantallas y se queda esta API.

use crate::routes::access::{now, APPROVED_TTL_S};
use crate::routes::auth::{bearer, require_admin};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{AdminRequest, ResolveReq};

/// ¿La dirección está fuera del rango privado? Un aviso, no un bloqueo: puede
/// ser perfectamente legítimo (VPN mal configurada, oficina remota), pero el
/// admin merece verlo antes de aprobar.
fn is_external(ip: &str) -> bool {
    match ip.parse::<std::net::IpAddr>() {
        Ok(std::net::IpAddr::V4(v4)) => !(v4.is_private() || v4.is_loopback() || v4.is_link_local()),
        Ok(std::net::IpAddr::V6(v6)) => !(v6.is_loopback() || v6.segments()[0] & 0xfe00 == 0xfc00),
        Err(_) => true,
    }
}

pub async fn list_requests(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminRequest>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT id, display_name, message, source_ip, status, reason, created_at, expires_at
             FROM access_requests ORDER BY (status = 'pending') DESC, created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let rows = q
        .query_map([], |r| {
            let source_ip: String = r.get(3)?;
            Ok(AdminRequest {
                id: r.get(0)?,
                display_name: r.get(1)?,
                message: r.get(2)?,
                external: is_external(&source_ip),
                source_ip,
                status: r.get(4)?,
                reason: r.get(5)?,
                created_at: r.get(6)?,
                expires_at: r.get(7)?,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn resolve_request(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ResolveReq>,
) -> Result<StatusCode, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let c = app.store.conn();
    let status: String = c
        .query_row("SELECT status FROM access_requests WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| (StatusCode::NOT_FOUND, "no existe esa solicitud".to_string()))?;
    // La primera resolución gana. Dos administradores mirando la misma lista
    // no pueden aprobar y rechazar lo mismo.
    if status != "pending" {
        return Err((StatusCode::CONFLICT, format!("esa solicitud ya está {status}")));
    }
    let t = now();
    if req.approve {
        let models = req
            .granted_models
            .filter(|m| !m.is_empty())
            .and_then(|m| serde_json::to_string(&m).ok());
        c.execute(
            "UPDATE access_requests
             SET status = 'approved', granted_models = ?1, expires_at = ?2,
                 resolved_at = ?2, resolved_by = ?3
             WHERE id = ?4",
            rusqlite::params![models, t + APPROVED_TTL_S, admin, id],
        )
    } else {
        c.execute(
            "UPDATE access_requests
             SET status = 'rejected', reason = ?1, resolved_at = ?2, resolved_by = ?3
             WHERE id = ?4",
            rusqlite::params![req.reason, t, admin, id],
        )
    }
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    tracing::info!("solicitud #{id} {} por el usuario {admin}", if req.approve { "aprobada" } else { "rechazada" });
    Ok(StatusCode::NO_CONTENT)
}
```

Nota sobre `expires_at` al aprobar: el `?2` se reutiliza para `expires_at` y `resolved_at`,
y por eso `expires_at` queda en `t + APPROVED_TTL_S` mientras que `resolved_at` quedaría
igual. Corrígelo usando parámetros distintos:

```rust
            rusqlite::params![models, t + APPROVED_TTL_S, t, admin, id],
```

con la sentencia:

```sql
             SET status = 'approved', granted_models = ?1, expires_at = ?2,
                 resolved_at = ?3, resolved_by = ?4
             WHERE id = ?5
```

- [ ] **Paso 3: registrar**

En `crates/lumid/src/routes/mod.rs`: `pub mod admin;`

En `crates/lumid/src/main.rs`:

```rust
        .route("/v1/admin/access-requests", get(routes::admin::list_requests))
        .route("/v1/admin/access-requests/:id/resolve", post(routes::admin::resolve_request))
```

- [ ] **Paso 4: comprobar el ciclo entero por curl**

Con el daemon corriendo y la huella a mano (`lumi card`, tarea 9; hasta entonces,
`--insecure`), y sustituyendo `$IP`, `$TK` (token de admin) y `$T` (ticket):

```bash
curl -sk -X POST https://$IP:7717/v1/access-requests -H 'content-type: application/json' -d '{"display_name":"Ana","message":"soy del equipo"}'
curl -sk https://$IP:7717/v1/access-requests/status -H "Authorization: Ticket $T"
curl -sk https://$IP:7717/v1/admin/access-requests -H "Authorization: Bearer $TK"
curl -skv -X POST https://$IP:7717/v1/admin/access-requests/1/resolve -H "Authorization: Bearer $TK" -H 'content-type: application/json' -d '{"approve":true,"granted_models":["mini","pro"]}'
curl -sk -X POST https://$IP:7717/v1/accounts -H "Authorization: Ticket $T" -H 'content-type: application/json' -d '{"username":"ana","password":"unacontrasenalarga"}'
```

Se espera, en orden: un `{"ticket":"lt_1_…"}`; `{"status":"pending",…}`; la lista con la
solicitud; `204`; `201`. Y **la cuarta llamada repetida devuelve `409`**: la resolución es
idempotente. Una sexta llamada a `/v1/accounts` con el mismo ticket devuelve `409`
("ya creó su cuenta").

- [ ] **Paso 5: commit**

```bash
git add crates/lumid/src/routes/admin.rs crates/lumid/src/routes/mod.rs \
        crates/lumid/src/main.rs crates/lumi-proto/src/api.rs
git commit -m "Administración de solicitudes: resolución idempotente y aviso de origen externo"
```

---

## Tarea 8: Administración de usuarios y límites globales

**Ficheros:**
- Modificar: `crates/lumid/src/routes/admin.rs`, `crates/lumid/src/main.rs`,
  `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Produce: `GET /v1/admin/users`, `GET /v1/admin/users/:id`, `PATCH /v1/admin/users/:id`,
  `GET /v1/admin/limits`, `PATCH /v1/admin/limits`; tipos `AdminUser`, `UserDetail`,
  `PatchUserReq`, `PatchLimitsReq`.
- Consume: `limits::{effective, global, overrides, set, clear}` de la tarea 3,
  `SessionInfo` de la tarea 6.

El detalle devuelve **el global y las anulaciones por separado**, no solo el valor
efectivo: la interfaz tiene que poder decir `hereda del global` o `anulado · global 50`, y
un límite sin origen visible es indepurable cuando alguien pregunta por qué solo puede
lanzar uno.

Bloquear **invalida las sesiones abiertas** en el acto. No borra nada más: en forense,
quitar a alguien de la lista borraría también el rastro de quién hizo qué.

- [ ] **Paso 1: tipos del protocolo**

En `crates/lumi-proto/src/api.rs`, al final:

```rust
#[derive(Debug, Serialize, Deserialize)]
pub struct AdminUser {
    pub id: i64,
    pub username: String,
    pub display_name: Option<String>,
    pub is_admin: bool,
    pub blocked: bool,
    pub must_change_password: bool,
    pub created_at: i64,
    /// Lo que rige de verdad para este usuario.
    pub limits: Limits,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeviceRow {
    pub name: String,
    pub os: Option<String>,
    pub first_seen: i64,
    pub last_seen: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserDetail {
    pub user: AdminUser,
    /// Los valores del servidor, para poder decir "anulado · global 50".
    pub global: Limits,
    /// Solo las palancas anuladas para este usuario.
    pub overrides: std::collections::HashMap<String, serde_json::Value>,
    pub devices: Vec<DeviceRow>,
    pub sessions: Vec<SessionInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchUserReq {
    #[serde(default)]
    pub blocked: Option<bool>,
    #[serde(default)]
    pub must_change_password: Option<bool>,
    /// Palanca → valor. `null` como valor QUITA la anulación: el usuario
    /// vuelve a heredar del global. Es la única forma de volver atrás.
    #[serde(default)]
    pub limits: std::collections::HashMap<String, serde_json::Value>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PatchLimitsReq {
    pub limits: std::collections::HashMap<String, serde_json::Value>,
}
```

- [ ] **Paso 2: implementar**

Añadir al final de `crates/lumid/src/routes/admin.rs`:

```rust
use lumi_proto::api::{AdminUser, DeviceRow, PatchLimitsReq, PatchUserReq, SessionInfo, UserDetail};

fn user_row(app: &App, id: i64) -> Option<AdminUser> {
    let base: (i64, String, Option<String>, i64, i64, i64, i64) = app
        .store
        .conn()
        .query_row(
            "SELECT id, username, display_name, is_admin, blocked, must_change_password, created_at
             FROM users WHERE id = ?1",
            [id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?)),
        )
        .ok()?;
    Some(AdminUser {
        id: base.0,
        username: base.1,
        display_name: base.2,
        is_admin: base.3 == 1,
        blocked: base.4 == 1,
        must_change_password: base.5 == 1,
        created_at: base.6,
        limits: crate::limits::effective(&app.store, id),
    })
}

pub async fn list_users(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<Vec<AdminUser>>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let ids: Vec<i64> = {
        let c = app.store.conn();
        let mut q = c
            .prepare("SELECT id FROM users ORDER BY created_at")
            .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        let v = q.query_map([], |r| r.get(0)).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
        v.flatten().collect()
    };
    // Los ids se recogen antes de soltar el mutex: `user_row` vuelve a pedirlo.
    Ok(Json(ids.into_iter().filter_map(|i| user_row(&app, i)).collect()))
}

pub async fn get_user(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<UserDetail>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let user = user_row(&app, id).ok_or(StatusCode::NOT_FOUND)?;
    let global = crate::limits::global(&app.store);
    let overrides = crate::limits::overrides(&app.store, id);
    let c = app.store.conn();
    let mut dq = c
        .prepare("SELECT name, os, first_seen, last_seen FROM devices WHERE user_id = ?1 ORDER BY last_seen DESC")
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let devices: Vec<DeviceRow> = dq
        .query_map([id], |r| {
            Ok(DeviceRow { name: r.get(0)?, os: r.get(1)?, first_seen: r.get(2)?, last_seen: r.get(3)? })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    let mut sq = c
        .prepare(
            "SELECT s.public_id, d.name, d.os, s.created_at, s.last_seen
             FROM sessions s LEFT JOIN devices d ON d.id = s.device_id
             WHERE s.user_id = ?1 AND s.public_id IS NOT NULL AND s.expires_at > ?2
             ORDER BY s.created_at DESC",
        )
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let sessions: Vec<SessionInfo> = sq
        .query_map(rusqlite::params![id, now()], |r| {
            Ok(SessionInfo {
                public_id: r.get(0)?,
                device_name: r.get(1)?,
                os: r.get(2)?,
                created_at: r.get(3)?,
                last_seen: r.get(4)?,
                // "La sesión actual" es del que mira, y quien mira es el admin,
                // no este usuario: aquí nunca hay sesión propia que marcar.
                current: false,
            })
        })
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .flatten()
        .collect();
    Ok(Json(UserDetail { user, global, overrides, devices, sessions }))
}

pub async fn patch_user(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<PatchUserReq>,
) -> Result<Json<UserDetail>, (StatusCode, String)> {
    let admin = require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let bad = |m: &str| (StatusCode::BAD_REQUEST, m.to_string());
    if id == admin && req.blocked == Some(true) {
        return Err(bad("no puedes bloquearte a ti mismo"));
    }
    {
        let c = app.store.conn();
        if let Some(b) = req.blocked {
            c.execute("UPDATE users SET blocked = ?1 WHERE id = ?2", rusqlite::params![b as i64, id])
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
            // Bloquear corta el acceso YA: dejar viva una sesión de 12 h
            // convertiría el bloqueo en una sugerencia. Los trabajos ya
            // encolados siguen: qué hacer con ellos es del subsistema 4.
            if b {
                let _ = c.execute("DELETE FROM sessions WHERE user_id = ?1", [id]);
            }
        }
        if let Some(m) = req.must_change_password {
            c.execute(
                "UPDATE users SET must_change_password = ?1 WHERE id = ?2",
                rusqlite::params![m as i64, id],
            )
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
        }
    }
    for (k, v) in &req.limits {
        let r = if v.is_null() {
            crate::limits::clear(&app.store, Some(id), k)
        } else {
            crate::limits::set(&app.store, Some(id), k, v)
        };
        r.map_err(|e| bad(&e.to_string()))?;
    }
    // Se devuelve el detalle recalculado para que la interfaz no tenga que
    // adivinar el resultado ni volver a pedirlo.
    get_user(State(app), Path(id), headers)
        .await
        .map(|d| d)
        .map_err(|c| (c, "no se pudo releer el usuario".to_string()))
}

pub async fn get_limits(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<lumi_proto::api::Limits>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    Ok(Json(crate::limits::global(&app.store)))
}

pub async fn patch_limits(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<PatchLimitsReq>,
) -> Result<Json<lumi_proto::api::Limits>, (StatusCode, String)> {
    require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    for (k, v) in &req.limits {
        let r = if v.is_null() {
            crate::limits::clear(&app.store, None, k)
        } else {
            crate::limits::set(&app.store, None, k, v)
        };
        r.map_err(|e| (StatusCode::BAD_REQUEST, e.to_string()))?;
    }
    Ok(Json(crate::limits::global(&app.store)))
}
```

- [ ] **Paso 3: registrar**

En `crates/lumid/src/main.rs`, con `use axum::routing::patch;`:

```rust
        .route("/v1/admin/users", get(routes::admin::list_users))
        .route("/v1/admin/users/:id", get(routes::admin::get_user).patch(routes::admin::patch_user))
        .route("/v1/admin/limits", get(routes::admin::get_limits).patch(routes::admin::patch_limits))
```

- [ ] **Paso 4: comprobar por curl**

```bash
curl -sk https://$IP:7717/v1/admin/users -H "Authorization: Bearer $TK"
curl -sk -X PATCH https://$IP:7717/v1/admin/limits -H "Authorization: Bearer $TK" -H 'content-type: application/json' -d '{"limits":{"max_daily":200}}'
curl -sk -X PATCH https://$IP:7717/v1/admin/users/2 -H "Authorization: Bearer $TK" -H 'content-type: application/json' -d '{"limits":{"max_daily":5}}'
curl -sk https://$IP:7717/v1/admin/users/2 -H "Authorization: Bearer $TK"
curl -sk -X PATCH https://$IP:7717/v1/admin/users/2 -H "Authorization: Bearer $TK" -H 'content-type: application/json' -d '{"limits":{"max_daily":null}}'
```

Se espera: el detalle muestra `"max_daily": 5` en `user.limits`, `"max_daily": 200` en
`global` y una entrada `max_daily` en `overrides`. Tras el último PATCH, `overrides` queda
vacío y `user.limits.max_daily` vuelve a `200`, **no** a `50`: heredar es heredar del
global, no del defecto de fábrica.

- [ ] **Paso 5: commit**

```bash
git add crates/lumid/src/routes/admin.rs crates/lumid/src/main.rs crates/lumi-proto/src/api.rs
git commit -m "Administración de usuarios: límites con origen visible y bloqueo que cierra sesiones"
```

---

## Tarea 9: Escotilla por CLI

**Ficheros:**
- Crear: `crates/lumi-cli/src/admin.rs`
- Modificar: `crates/lumi-cli/src/main.rs`

**Interfaces:**
- Produce: `lumi card`, `lumi admin reset-password <usuario>`, `lumi admin unblock <usuario>`,
  `lumi admin requests`.
- Consume: `ServerCard` de la tarea 1, `install::DATA` (hacer `pub const DATA`).

Sin esto, el único administrador que se bloquee o pierda la contraseña deja el servidor
inservible. Tener shell en la máquina ya es prueba de propiedad: no hace falta más
ceremonia que ejecutar esto, igual que con `lumi key reissue`.

`reset-password` **no fija** una contraseña: genera una temporal, la imprime una vez y
marca `must_change_password`. Nadie, ni con shell, debe poder dejar una contraseña conocida
en una cuenta ajena sin que su dueño lo note al entrar.

- [ ] **Paso 1: implementar**

Crear `crates/lumi-cli/src/admin.rs`:

```rust
//! Escotilla de emergencia. Se ejecuta EN EL HOST: tener shell en la máquina
//! ya es prueba de propiedad.

use crate::install::DATA;
use anyhow::{Context, Result};
use lumi_proto::crypto::hash_password;
use lumi_proto::key::ServerCard;
use rand::RngCore;

fn db() -> Result<rusqlite::Connection> {
    rusqlite::Connection::open(format!("{DATA}/lumi.db")).context("el servidor no está instalado")
}

fn uid(c: &rusqlite::Connection, username: &str) -> Result<i64> {
    c.query_row("SELECT id FROM users WHERE username = ?1", [username], |r| r.get(0))
        .with_context(|| format!("no existe el usuario {username}"))
}

/// La tarjeta pública. No caduca y no se consume: se publica una vez (wiki
/// interno, canal del equipo) y sirve para todo el mundo.
pub fn card() -> Result<ServerCard> {
    let der = std::fs::read(format!("{DATA}/cert.der")).context("el servidor no está instalado")?;
    let addr = format!("{}:{}", crate::install::local_ip().unwrap_or_else(|| "127.0.0.1".into()), lumi_proto::PORT);
    Ok(ServerCard::new(&addr, &der))
}

pub fn reset_password(username: &str) -> Result<String> {
    let c = db()?;
    let id = uid(&c, username)?;
    let mut b = [0u8; 12];
    rand::thread_rng().fill_bytes(&mut b);
    let temp = bs58::encode(b).into_string();
    // Temporal y de un solo viaje: al entrar con ella, el cliente obliga a
    // cambiarla. Nadie deja una contraseña conocida en una cuenta ajena.
    c.execute(
        "UPDATE users SET password_phc = ?1, must_change_password = 1, blocked = 0 WHERE id = ?2",
        rusqlite::params![hash_password(&temp)?, id],
    )?;
    c.execute("DELETE FROM sessions WHERE user_id = ?1", [id])?;
    Ok(temp)
}

pub fn unblock(username: &str) -> Result<()> {
    let c = db()?;
    let id = uid(&c, username)?;
    c.execute("UPDATE users SET blocked = 0 WHERE id = ?1", [id])?;
    Ok(())
}

pub fn requests() -> Result<()> {
    let c = db()?;
    let mut q = c.prepare(
        "SELECT id, display_name, status, source_ip FROM access_requests ORDER BY created_at DESC",
    )?;
    let rows = q.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?))
    })?;
    for row in rows.flatten() {
        println!("  #{:<4} {:<24} {:<10} {}", row.0, row.1, row.2, row.3);
    }
    Ok(())
}
```

En `crates/lumi-cli/src/install.rs`, hacer públicos los dos elementos que usa el módulo
nuevo (hoy son privados):

```rust
pub const DATA: &str = "/var/lib/lumi";
pub fn local_ip() -> Option<String> {
```

- [ ] **Paso 2: enchufar los subcomandos**

En `crates/lumi-cli/src/main.rs`, añadir `mod admin;` y ampliar el enum:

```rust
    /// Imprime la tarjeta pública del servidor: lo que se reparte al equipo
    Card,
    /// Escotilla de emergencia sobre cuentas, desde el host
    Admin {
        #[command(subcommand)]
        action: AdminAction,
    },
```

```rust
#[derive(Subcommand)]
enum AdminAction {
    /// Genera una contraseña temporal y exige el cambio al entrar
    ResetPassword { username: String },
    /// Levanta el bloqueo de una cuenta
    Unblock { username: String },
    /// Lista las solicitudes de acceso
    Requests,
}
```

Y en el `match`:

```rust
        Cmd::Card => {
            let card = admin::card()?;
            println!();
            println!("  ────────────────────────────────────────────────────────");
            println!("  Tarjeta del servidor · pública · no caduca");
            println!();
            println!("  {card}");
            println!();
            println!("  Repártela al equipo. No es un secreto: sirve para que");
            println!("  cualquiera conecte verificado y pida acceso.");
            println!("  ────────────────────────────────────────────────────────");
        }
        Cmd::Admin { action } => match action {
            AdminAction::ResetPassword { username } => {
                let temp = admin::reset_password(&username)?;
                println!("\n  contraseña temporal de {username}: {temp}");
                println!("  Se pedirá cambiarla al entrar. Solo se muestra ahora.\n");
            }
            AdminAction::Unblock { username } => {
                admin::unblock(&username)?;
                println!("\n  {username} desbloqueado\n");
            }
            AdminAction::Requests => admin::requests()?,
        },
```

- [ ] **Paso 3: comprobar en el host**

```bash
cargo build --release -p lumi-cli && sudo ./target/release/lumi card
```

Se espera: una línea `lumi1s_<ip>:7717_<huella>` cuya huella coincide con la de la clave de
vinculación emitida en la instalación (los dos artefactos salen del mismo certificado).

- [ ] **Paso 4: commit**

```bash
git add crates/lumi-cli/src/admin.rs crates/lumi-cli/src/main.rs crates/lumi-cli/src/install.rs
git commit -m "CLI: tarjeta pública y escotilla de emergencia sobre cuentas"
```

---

## Tarea 10: Puente del cliente

**Ficheros:**
- Modificar: `client/src-tauri/src/main.rs`, `client/src/lib/api.ts`,
  `client/src/lib/session.ts`, `client/src/lib/store.ts`

**Interfaces:**
- Produce: comando Tauri `pair_card(card)`; `request` con `PATCH`/`DELETE` y cabecera
  `Ticket`; `api.patch`, `api.del`, `api.ticketGet`, `api.ticketPost`; tipos TS de todo lo
  añadido en las tareas 3–8; `loadServers`, `addServer`, `forgetServer`, `deviceId()`;
  `session.ticket`.
- Consume: `ServerCard` de la tarea 1.

Nada de esto se ve. Es la capa que hace posibles las cinco tareas siguientes, y hacerla
aparte evita que cada pantalla invente su propia forma de hablar con el servidor.

- [ ] **Paso 1: ampliar el puente Rust**

En `client/src-tauri/src/main.rs`, añadir el comando de la tarjeta:

```rust
/// La tarjeta pública NO lleva secreto: solo dirección y huella. Se parsea en
/// Rust y no en TS para que el error sea el mismo que el de la clave de
/// vinculación, escrito una sola vez en `lumi-proto`.
#[tauri::command]
async fn pair_card(card: String, state: tauri::State<'_, Shared>) -> Result<serde_json::Value, String> {
    let c = lumi_proto::key::ServerCard::parse(&card).map_err(|e| e.to_string())?;
    connect(&c.addr, &c.fingerprint, &state).await
}
```

Sustituir la firma y el cuerpo de `request` para admitir los dos verbos nuevos y el ticket:

```rust
#[tauri::command]
async fn request(
    method: String, path: String, body: Option<String>,
    token: Option<String>, ticket: Option<String>,
    state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client) = {
        let c = state.lock().unwrap();
        (c.base.clone().ok_or("sin servidor vinculado")?, c.client.clone().ok_or("sin cliente")?)
    };
    let url = format!("{base}{path}");
    let mut rb = match method.as_str() {
        "POST" => client.post(url),
        "PATCH" => client.patch(url),
        "DELETE" => client.delete(url),
        _ => client.get(url),
    };
    if let Some(t) = token {
        rb = rb.bearer_auth(t);
    }
    // El ticket va en cabecera, nunca en la ruta: es un secreto.
    if let Some(t) = ticket {
        rb = rb.header("authorization", format!("Ticket {t}"));
    }
    if let Some(b) = body {
        rb = rb.header("content-type", "application/json").body(b);
    }
    let res = rb.send().await.map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.is_success() { Ok(text) } else { Err(text) }
}
```

Y registrar el comando nuevo:

```rust
        .invoke_handler(tauri::generate_handler![pair, pair_card, reconnect, request, start_telemetry, start_task_log])
```

- [ ] **Paso 2: ampliar `api.ts`**

En `client/src/lib/api.ts`, sustituir `LoginRes` y añadir el resto:

```ts
export interface LoginRes {
  token: string;
  username: string;
  is_admin: boolean;
  must_change_password: boolean;
}
export interface Limits {
  models: string[];
  max_concurrent: number;
  max_daily: number;
  max_storage_gb: number;
  queue_priority: number;
  can_create_projects: boolean;
}
export interface AccessStatus { status: "pending" | "approved" | "rejected"; display_name: string; reason: string | null }
export interface AdminRequest {
  id: number; display_name: string; message: string; source_ip: string;
  external: boolean; status: string; reason: string | null;
  created_at: number; expires_at: number;
}
export interface SessionInfo {
  public_id: string; device_name: string | null; os: string | null;
  created_at: number; last_seen: number; current: boolean;
}
export interface DeviceRow { name: string; os: string | null; first_seen: number; last_seen: number }
export interface AdminUser {
  id: number; username: string; display_name: string | null; is_admin: boolean;
  blocked: boolean; must_change_password: boolean; created_at: number; limits: Limits;
}
export interface UserDetail {
  user: AdminUser; global: Limits;
  overrides: Record<string, unknown>;
  devices: DeviceRow[]; sessions: SessionInfo[];
}

/** `lumi1s_<host:puerto>_<huella>`. Se parte desde la derecha: la dirección
 *  lleva puntos y dos puntos. */
export function addrFromCard(card: string): string {
  const rest = card.trim().replace(/^lumi1s_/, "");
  const i = rest.lastIndexOf("_");
  return i > 0 ? rest.slice(0, i) : "";
}
export function fingerprintFromCard(card: string): string {
  const rest = card.trim().replace(/^lumi1s_/, "");
  const i = rest.lastIndexOf("_");
  return i > 0 ? rest.slice(i + 1) : "";
}
export function isCard(s: string): boolean {
  return s.trim().startsWith("lumi1s_");
}
```

Y sustituir el objeto `api` entero:

```ts
const call = (method: string, path: string, body: unknown, token?: string, ticket?: string) =>
  invoke<string>("request", {
    method, path, body: body === undefined ? null : JSON.stringify(body), token, ticket,
  });

export const api = {
  pair: (key: string) => invoke<Hello>("pair", { key }),
  pairCard: (card: string) => invoke<Hello>("pair_card", { card }),
  /** Reestablece el cliente TLS anclado sin la clave original (ya gastada):
   *  basta con la dirección y la huella persistidas. */
  reconnect: (addr: string, fingerprint: string) => invoke<Hello>("reconnect", { addr, fingerprint }),
  get: <T>(path: string, token?: string) => call("GET", path, undefined, token).then(t => JSON.parse(t) as T),
  post: <T>(path: string, body: unknown, token?: string) =>
    call("POST", path, body, token).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
  patch: <T>(path: string, body: unknown, token?: string) =>
    call("PATCH", path, body, token).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
  del: (path: string, token?: string) => call("DELETE", path, undefined, token).then(() => undefined),
  ticketGet: <T>(path: string, ticket: string) =>
    call("GET", path, undefined, undefined, ticket).then(t => JSON.parse(t) as T),
  ticketPost: <T>(path: string, body: unknown, ticket: string) =>
    call("POST", path, body, undefined, ticket).then(t => (t ? (JSON.parse(t) as T) : (null as T))),
};
```

- [ ] **Paso 3: ampliar `session.ts`**

En `client/src/lib/session.ts`, añadir al final y ampliar la interfaz:

```ts
export interface Session {
  addr: string;
  fingerprint: string;
  bootstrapToken?: string;
  token?: string;
  taskId?: string;
  /** Credencial de la solicitud de acceso. Vive aquí sin cifrar, igual que el
   *  token: quien tenga el equipo durante las 48 h puede crear la cuenta en
   *  lugar del usuario. Aceptable para esa ventana, no para una más larga. */
  ticket?: string;
  username?: string;
}

/** Servidor recordado. Solo datos públicos: dirección y huella. */
export interface Server {
  addr: string;
  fingerprint: string;
  label: string;
}

const SERVERS = "lumi.servers";
const DEVICE = "lumi.device";

export function loadServers(): Server[] {
  try {
    return JSON.parse(localStorage.getItem(SERVERS) ?? "[]") as Server[];
  } catch {
    return [];
  }
}

export function addServer(s: Server) {
  // Se indexa por dirección: volver a añadir el mismo servidor actualiza su
  // huella (rotación de certificado) en vez de duplicar la entrada.
  const rest = loadServers().filter((x) => x.addr !== s.addr);
  localStorage.setItem(SERVERS, JSON.stringify([s, ...rest]));
}

export function forgetServer(addr: string) {
  localStorage.setItem(SERVERS, JSON.stringify(loadServers().filter((s) => s.addr !== addr)));
}

/** Identidad del equipo. Registro PASIVO: audita y permite revocar, no
 *  autentica. Copiar este valor copia la identidad, y es a propósito. */
export function deviceId(): string {
  let id = localStorage.getItem(DEVICE);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE, id);
  }
  return id;
}

export function deviceName(): string {
  return navigator.platform || "equipo";
}
```

- [ ] **Paso 4: ampliar el store**

En `client/src/lib/store.ts`, añadir al estado y al creador:

```ts
  username: string;
  isAdmin: boolean;
  setUser: (username: string, isAdmin: boolean) => void;
```

```ts
  username: "", isAdmin: false,
  setUser: (username, isAdmin) => set({ username, isAdmin }),
```

- [ ] **Paso 5: compilar**

```bash
cd client && npm run build
```

Se espera: `tsc` sin errores. `PairStep.tsx` y `ProvisionStep.tsx` siguen compilando: la
firma de `api.get`/`api.post` no ha cambiado, solo se han añadido parámetros opcionales.

- [ ] **Paso 6: commit**

```bash
git add client/src-tauri/src/main.rs client/src/lib/
git commit -m "Puente del cliente: tarjeta pública, PATCH y DELETE, tickets y equipos recordados"
```

---

## Tarea 11: Pantalla de entrada

**Ficheros:**
- Crear: `client/src/entry/EntryScreen.tsx`, `client/src/entry/LoginForm.tsx`,
  `client/src/entry/ServerSelect.tsx`, `client/src/entry/AddServerForm.tsx`
- Modificar: `client/src/ui/Icon.tsx`

**Interfaces:**
- Produce: `<EntryScreen onSignedIn={() => void} onOwnerKey={(key: string) => void} />`,
  con `type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password"`;
  `<ServerSelect value onChange onAdd />`; `<LoginForm />`; `<AddServerForm />`.
- Consume: `api.pairCard`, `api.reconnect`, `api.post`, `loadServers`, `addServer`,
  `deviceId`, `deviceName` de la tarea 10.

Iniciar sesión es la pantalla por defecto: es lo que se hace todos los días, frente a
configurar un servidor, que se hace una vez. **Añadir un servidor vive dentro del
desplegable**, tras un separador, porque es una acción sobre esa lista.

Del mockup se hereda un bug ya resuelto: el clic que abre el menú burbujea hasta el
`document` que lo cierra, y se cerraba en el mismo fotograma. La solución es
`stopPropagation` en el disparador.

- [ ] **Paso 1: añadir los iconos que faltan**

En `client/src/ui/Icon.tsx`, dentro de `PATHS`:

```tsx
  x: <path d="M18 6 6 18M6 6l12 12" />,
  user: <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  device: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /></>,
  shield: <path d="M12 3l8 4v5c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V7l8-4z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
```

- [ ] **Paso 2: el desplegable**

Crear `client/src/entry/ServerSelect.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { loadServers, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ServerSelect({ value, onChange, onAdd }: {
  value: Server | null; onChange: (s: Server) => void; onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const servers = loadServers();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // stopPropagation en cada disparador: sin él, el mismo clic que abre el menú
  // llega al listener del documento y lo cierra en el mismo fotograma.
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };

  return (
    <div ref={box} className="relative">
      <button onClick={(e) => stop(e, () => setOpen((o) => !o))}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-left font-mono text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo hover:border-white/30">
        <span>{value?.addr ?? "sin servidores"}</span>
        <Icon name="chevron" className={`transition-transform duration-300 ease-expo ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 overflow-hidden rounded-lg border border-border bg-[#0d0f12] shadow-lg shadow-black/50"
          style={{ animation: "jg-fade-rise .28s both" }}>
          {servers.map((s) => (
            <button key={s.addr} onClick={(e) => stop(e, () => { onChange(s); setOpen(false); })}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
              {s.addr === value?.addr ? <Icon name="check" /> : <span className="w-[13px]" />}
              <span className="font-mono">{s.addr}</span>
              <span className="ml-auto text-[11px] text-subtle">{s.label}</span>
            </button>
          ))}
          {servers.length > 0 && <div className="h-px bg-border" />}
          <button onClick={(e) => stop(e, () => { onAdd(); setOpen(false); })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
            <Icon name="plus" /> Configurar un servidor nuevo
          </button>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Paso 3: añadir un servidor**

Crear `client/src/entry/AddServerForm.tsx`:

```tsx
import { useState } from "react";
import { addrFromCard, api, fingerprintFromCard, isCard, type Hello } from "../lib/api";
import { addServer } from "../lib/session";
import { Icon } from "../ui/Icon";

export function AddServerForm({ onAdded, onOwnerKey, onBack }: {
  onAdded: (addr: string) => void; onOwnerKey: (key: string) => void; onBack: () => void;
}) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [hello, setHello] = useState<Hello | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    const s = text.trim();
    if (!s) return;
    // Una clave lumi1_ pegada aquí no es un error: significa "soy el owner y
    // vengo a aprovisionar". Se acepta y se lleva a su flujo.
    if (!isCard(s)) { onOwnerKey(s); return; }
    setBusy(true); setError(null);
    try {
      setHello(await api.pairCard(s));
    } catch (e) {
      setHello(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const addr = addrFromCard(text);
    addServer({ addr, fingerprint: fingerprintFromCard(text), label: label.trim() || addr });
    onAdded(addr);
  }

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Clave del servidor</label>
      <input value={text} onChange={(e) => setText(e.target.value)} onBlur={verify}
        placeholder="lumi1s_192.168.1.40:7717_…"
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />
      <p className="mt-2.5 max-w-[52ch] text-[11px] text-muted">Te la pasa quien administra el servidor.</p>

      {busy && (
        <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted">
          <Icon name="spinner" /> Comprobando el servidor
        </div>
      )}

      {hello && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <Icon name="check" /> <span>Servidor verificado</span>
          </div>
          <div className="mt-2 flex items-center gap-2.5 text-xs text-muted">
            <Icon name="user" />
            <span>{hello.state === "unclaimed" ? "Todavía sin administrador" : "Ya tiene administrador"}</span>
          </div>
          <div className="my-3 h-px bg-border" />
          <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Nombre (opcional)</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="equipo León"
            className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none focus:border-white/40" />
        </>
      )}

      {error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onBack}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg transition-transform duration-300 ease-expo active:translate-y-px">
          Atrás
        </button>
        <button onClick={save} disabled={!hello}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          Guardar servidor
        </button>
      </div>
    </>
  );
}
```

- [ ] **Paso 4: el formulario de entrada**

Crear `client/src/entry/LoginForm.tsx`:

```tsx
import { useState } from "react";
import { api, type LoginRes, type Server } from "../lib/api";
import { deviceId, deviceName, updateSession, type Server as Srv } from "../lib/session";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";
import { ServerSelect } from "./ServerSelect";

export function LoginForm({ server, onServer, onAdd, onRequest, onSignedIn, onMustChange }: {
  server: Srv | null; onServer: (s: Srv) => void; onAdd: () => void;
  onRequest: () => void; onSignedIn: () => void; onMustChange: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!server || !username || !password) return;
    setBusy(true); setError(null);
    try {
      await api.reconnect(server.addr, server.fingerprint);
      const res = await api.post<LoginRes>("/v1/auth/login", {
        username, password,
        device: { client_id: deviceId(), name: deviceName(), os: navigator.userAgent },
      });
      useServer.getState().setToken(res.token);
      useServer.getState().setUser(res.username, res.is_admin);
      useServer.getState().setAddr(server.addr);
      updateSession({ addr: server.addr, fingerprint: server.fingerprint, token: res.token, username: res.username });
      if (res.must_change_password) onMustChange(); else onSignedIn();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Servidor</label>
      <ServerSelect value={server} onChange={onServer} onAdd={onAdd} />
      {server && (
        <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted">
          <Icon name="check" /> Servidor verificado
        </div>
      )}
      <div className="my-3.5 h-px bg-border" />

      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Usuario</label>
      <input value={username} onChange={(e) => setUsername(e.target.value)}
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Contraseña</label>
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        <button onClick={onRequest} className="whitespace-nowrap text-[11px] text-muted underline-offset-4 hover:text-fg hover:underline">
          ¿Sin cuenta? · Solicitar acceso
        </button>
        <button onClick={submit} disabled={busy || !server}
          className="shrink-0 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Entrando" : "Entrar"}
        </button>
      </div>
    </>
  );
}
```

El `whitespace-nowrap` en el enlace y el `shrink-0` en el botón son el arreglo del bug del
mockup: sin ellos, "Solicitar acceso" se partía y quedaba pegado al botón.

- [ ] **Paso 5: el contenedor**

Crear `client/src/entry/EntryScreen.tsx`. Se escribe entero aquí, con los casos de las
tareas 12–14 apuntando a componentes que aún no existen; **impórtalos comentados hasta la
tarea que los crea** o el build no pasará.

```tsx
import { useState } from "react";
import { loadServers, loadSession, type Server } from "../lib/session";
import { LoginForm } from "./LoginForm";
import { AddServerForm } from "./AddServerForm";

export type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password";

/** Marco compartido: la marca, el subtítulo y la tarjeta. Mismo esqueleto que
 *  el wizard, sin el stepper: aquí no hay pasos numerados que recorrer. */
export function Pane({ title, subtitle, children }: {
  title: string; subtitle: string; children: React.ReactNode;
}) {
  return (
    <div className="relative z-10 mx-auto w-full max-w-xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
        <span className="text-[17px] font-medium text-fg">{title}</span>
      </div>
      <p className="mb-6 text-xs text-muted" style={{ animation: "jg-fade-rise .7s .06s both" }}>{subtitle}</p>
      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl"
        style={{ animation: "jg-fade-rise .8s .18s both" }}>
        {children}
      </div>
    </div>
  );
}

export function EntryScreen({ onSignedIn, onOwnerKey }: {
  onSignedIn: () => void; onOwnerKey: (key: string) => void;
}) {
  const saved = loadServers();
  const [server, setServer] = useState<Server | null>(saved[0] ?? null);
  // Con un ticket guardado se aterriza en la espera, no en el login: es lo que
  // el usuario estaba haciendo, y sobrevive a cerrar la app.
  const [view, setView] = useState<EntryView>(
    saved.length === 0 ? "add" : loadSession()?.ticket ? "waiting" : "login",
  );

  if (view === "add") {
    return (
      <Pane title="Añadir un servidor" subtitle="pega la clave que te han pasado.">
        <AddServerForm
          onAdded={(addr) => { setServer(loadServers().find((s) => s.addr === addr) ?? null); setView("login"); }}
          onOwnerKey={onOwnerKey}
          onBack={() => setView("login")} />
      </Pane>
    );
  }

  return (
    <Pane title="Lumi Station" subtitle="inicia sesión en tu servidor.">
      <LoginForm server={server} onServer={setServer} onAdd={() => setView("add")}
        onRequest={() => setView("request")} onSignedIn={onSignedIn}
        onMustChange={() => setView("password")} />
    </Pane>
  );
}
```

- [ ] **Paso 6: compilar**

```bash
cd client && npm run build
```

Se espera: build limpio. Todavía no está enganchado a `App.tsx`: eso es la tarea 16.

- [ ] **Paso 7: commit**

```bash
git add client/src/entry/ client/src/ui/Icon.tsx
git commit -m "Pantalla de entrada: login por defecto y añadir servidor dentro del desplegable"
```

---

## Tarea 12: Solicitar acceso y esperar

**Ficheros:**
- Crear: `client/src/entry/RequestForm.tsx`, `client/src/entry/WaitingScreen.tsx`,
  `client/src/ui/Bell.tsx`
- Modificar: `client/src/entry/EntryScreen.tsx`, `client/src/index.css`

**Interfaces:**
- Produce: `<RequestForm server onSent onBack />`, `<WaitingScreen server onResolved onCancel />`,
  `<Bell count onClick />`.
- Consume: `api.post`, `api.ticketGet`, `updateSession`, `Pane` de la tarea 11.

El barrido del radar da **una vuelta cada 30 segundos**, que es exactamente el intervalo del
sondeo. El movimiento informa en vez de decorar, y la cuenta atrás dice cuándo toca la
siguiente comprobación.

- [ ] **Paso 1: los keyframes del radar**

En `client/src/index.css`, junto al resto:

```css
@keyframes jg-sweep { to { transform: rotate(360deg) } }
@keyframes jg-core-pulse {
  0%, 100% { opacity: .55; transform: scale(1) }
  50%      { opacity: 1;   transform: scale(1.2) }
}
```

- [ ] **Paso 2: el formulario**

Crear `client/src/entry/RequestForm.tsx`:

```tsx
import { useState } from "react";
import { api } from "../lib/api";
import { updateSession, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

const MAX_NAME = 80;
const MAX_MESSAGE = 500;

export function RequestForm({ server, onSent, onBack }: {
  server: Server | null; onSent: () => void; onBack: () => void;
}) {
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!server || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      await api.reconnect(server.addr, server.fingerprint);
      const res = await api.post<{ ticket: string }>("/v1/access-requests", {
        display_name: name.trim(), message: message.trim(),
      });
      // El ticket es lo único que prueba que esta solicitud es tuya, y solo se
      // entrega una vez: se persiste antes de cambiar de pantalla.
      updateSession({ addr: server.addr, fingerprint: server.fingerprint, ticket: res.ticket });
      onSent();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Tu nombre</label>
      <input value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} className={field} />
      <div className="h-3.5" />
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Mensaje para el administrador</label>
      <textarea value={message} maxLength={MAX_MESSAGE} rows={4}
        onChange={(e) => setMessage(e.target.value)} className={`${field} resize-none`} />
      <p className="mt-2.5 text-[11px] text-muted">
        Aún no tienes cuenta: eso viene después de que te aprueben.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <button onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          Atrás
        </button>
        <button onClick={send} disabled={busy || !name.trim()}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Enviando" : "Enviar solicitud"}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Paso 3: la espera**

Crear `client/src/entry/WaitingScreen.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type AccessStatus } from "../lib/api";
import { clearSession, loadSession, type Server } from "../lib/session";
import { Icon } from "../ui/Icon";

const POLL_S = 30;

export function WaitingScreen({ server, onResolved, onCancel }: {
  server: Server | null; onResolved: (s: AccessStatus) => void; onCancel: () => void;
}) {
  const [left, setLeft] = useState(POLL_S);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ticket = loadSession()?.ticket;
    if (!ticket || !server) return;
    let alive = true;

    async function check() {
      try {
        await api.reconnect(server!.addr, server!.fingerprint);
        const s = await api.ticketGet<AccessStatus>("/v1/access-requests/status", ticket!);
        if (alive && s.status !== "pending") onResolved(s);
      } catch (e) {
        // 410 (caducada) y 409 (ya consumida) son definitivos; un fallo de red
        // no lo es. Se distingue por el texto porque `request` solo devuelve
        // el cuerpo del error.
        const t = String(e);
        if (alive && (t.includes("caducó") || t.includes("ya creó"))) setError(t);
      }
    }
    check();

    const tick = setInterval(() => {
      setLeft((n) => {
        if (n > 1) return n - 1;
        check();
        return POLL_S;
      });
    }, 1000);
    return () => { alive = false; clearInterval(tick); };
  }, [server, onResolved]);

  return (
    <>
      {/* Una vuelta cada 30 s: el mismo intervalo del sondeo, así el
          movimiento dice algo en vez de decorar. */}
      <div className="relative mx-auto mb-[18px] mt-0.5 h-[92px] w-[92px]">
        <div className="absolute inset-0 rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(133,183,235,.28), transparent 22%)",
            animation: "jg-sweep 30s linear infinite",
          }} />
        {[0, 16, 32].map((i) => (
          <div key={i} className="absolute rounded-full border border-white/[.09]"
            style={{ inset: i }} />
        ))}
        <div className="absolute left-1/2 top-1/2 h-[7px] w-[7px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-draw-fg"
          style={{ boxShadow: "0 0 10px 3px rgba(133,183,235,.4)", animation: "jg-core-pulse 3s ease-in-out infinite" }} />
      </div>

      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="check" /> Recibida por el servidor
      </div>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="spinner" /> Comprobando cada 30 s
        <span className="ml-auto font-mono text-[10.5px] text-subtle">{left} s</span>
      </div>
      <div className="my-3 h-px bg-border" />
      <p className="max-w-[54ch] text-[11px] text-muted">
        Puedes cerrar la app. Al volver se retoma la comprobación sola: la solicitud vive en
        el servidor, no aquí. Caduca a los 7 días sin respuesta.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={() => { clearSession(); onCancel(); }}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          Cancelar
        </button>
      </div>
    </>
  );
}
```

- [ ] **Paso 4: la campana**

Crear `client/src/ui/Bell.tsx`:

```tsx
import { Icon } from "./Icon";

/** La aprobación llega aquí, SIN diálogo que interrumpa: se enciende sin
 *  cortar lo que el usuario esté haciendo. El subsistema 3 la reutiliza para
 *  las notificaciones que el admin envía. */
export function Bell({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="relative p-1 text-fg opacity-80 transition-opacity duration-300 ease-expo hover:opacity-100">
      <Icon name="bell" size={16} />
      {count > 0 && (
        <span className="absolute right-0.5 top-0.5 h-[6px] w-[6px] rounded-full bg-draw-fg"
          style={{ animation: "jg-core-pulse 1.8s ease-in-out infinite" }} />
      )}
    </button>
  );
}
```

- [ ] **Paso 5: enganchar en `EntryScreen`**

En `client/src/entry/EntryScreen.tsx`, añadir los imports y los dos casos, y guardar la
resolución en estado para que la tarea 13 la muestre:

```tsx
import { RequestForm } from "./RequestForm";
import { WaitingScreen } from "./WaitingScreen";
import type { AccessStatus } from "../lib/api";
```

```tsx
  const [resolved, setResolved] = useState<AccessStatus | null>(null);
```

```tsx
  if (view === "request") {
    return (
      <Pane title="Solicitar acceso" subtitle="el administrador recibirá tu petición.">
        <RequestForm server={server} onSent={() => setView("waiting")} onBack={() => setView("login")} />
      </Pane>
    );
  }
  if (view === "waiting") {
    return (
      <Pane title="Solicitud enviada" subtitle="esperando a que el administrador responda.">
        <WaitingScreen server={server}
          onResolved={(s) => { setResolved(s); setView("resolved"); }}
          onCancel={() => setView("login")} />
      </Pane>
    );
  }
```

- [ ] **Paso 6: comprobar a mano**

Con el daemon corriendo y una tarjeta añadida: pulsa "Solicitar acceso", envía, y verifica
que la cuenta atrás baja de 30 a 0 y vuelve a 30, y que **cerrar y reabrir la app aterriza
otra vez en la espera**, no en el login. Aprueba desde `curl` (tarea 7) y comprueba que en
menos de 30 s la pantalla cambia sola.

- [ ] **Paso 7: commit**

```bash
git add client/src/entry/ client/src/ui/Bell.tsx client/src/index.css
git commit -m "Solicitud de acceso y espera: el radar late al ritmo del sondeo"
```

---

## Tarea 13: Resolución y creación de cuenta

**Ficheros:**
- Crear: `client/src/entry/ResolvedScreen.tsx`
- Modificar: `client/src/entry/EntryScreen.tsx`

**Interfaces:**
- Produce: `<ResolvedScreen status onCreated onRetry onBack />`.
- Consume: `api.ticketPost`, `AccessStatus` de la tarea 10, `Pane` de la tarea 11.

Un rechazo **no impide volver a solicitar**: para eso está el bloqueo, que es otra cosa y
se aplica a cuentas existentes. Por eso la pantalla de rechazo lleva "Solicitar de nuevo" y
no un callejón sin salida.

- [ ] **Paso 1: implementar**

Crear `client/src/entry/ResolvedScreen.tsx`:

```tsx
import { useState } from "react";
import { api, type AccessStatus } from "../lib/api";
import { loadSession, updateSession } from "../lib/session";
import { Icon } from "../ui/Icon";

export function ResolvedScreen({ status, onCreated, onRetry, onBack }: {
  status: AccessStatus; onCreated: () => void; onRetry: () => void; onBack: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status.status === "rejected") {
    return (
      <>
        <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
          <Icon name="x" className="text-danger-fg" /> Solicitud rechazada
        </div>
        {status.reason && (
          <>
            <div className="my-3 h-px bg-border" />
            <p className="max-w-[56ch] text-xs leading-relaxed text-muted">«{status.reason}»</p>
          </>
        )}
        <div className="my-3 h-px bg-border" />
        <p className="text-[11px] text-muted">Un rechazo no te impide volver a solicitarlo.</p>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button onClick={onBack} className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
            Volver al inicio
          </button>
          <button onClick={onRetry}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
            Solicitar de nuevo
          </button>
        </div>
      </>
    );
  }

  async function create() {
    const ticket = loadSession()?.ticket;
    if (!ticket) return;
    setBusy(true); setError(null);
    try {
      await api.ticketPost("/v1/accounts", { username: username.trim(), password }, ticket);
      // El ticket ya está consumido: guardarlo solo serviría para que la app
      // volviera a aterrizar en una espera que ya terminó.
      updateSession({ ticket: undefined });
      onCreated();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";

  return (
    <>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="check" /> Acceso aprobado
      </div>
      <div className="flex items-center gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="clock" /> Tienes <b className="font-normal text-fg">48 h</b> para crear la cuenta
      </div>
      <div className="my-3 h-px bg-border" />
      <div className="grid grid-cols-2 gap-3.5">
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Usuario</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} className={field} />
        </div>
        <div>
          <label className="mb-[7px] block text-[11px] text-muted">Contraseña</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </div>
      </div>
      <p className="mt-3 max-w-[54ch] text-[11px] text-muted">
        Mínimo 12 caracteres. Nadie podrá leerla, ni siquiera un administrador: solo pedirte
        que la cambies.
      </p>

      {error && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={create} disabled={busy || password.length < 12 || !username.trim()}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Creando" : "Crear cuenta"}
        </button>
      </div>
    </>
  );
}
```

- [ ] **Paso 2: enganchar**

En `client/src/entry/EntryScreen.tsx`:

```tsx
import { ResolvedScreen } from "./ResolvedScreen";
```

```tsx
  if (view === "resolved" && resolved) {
    const ok = resolved.status === "approved";
    return (
      <Pane title={ok ? "Acceso aprobado" : "Solicitud rechazada"}
        subtitle={ok ? "crea tu cuenta para empezar." : "el administrador no ha concedido el acceso."}>
        <ResolvedScreen status={resolved}
          onCreated={() => setView("login")}
          onRetry={() => setView("request")}
          onBack={() => setView("login")} />
      </Pane>
    );
  }
```

- [ ] **Paso 3: comprobar el ciclo completo a mano**

Solicitar desde la app, aprobar por `curl` concediendo `["mini","pro"]`, esperar a que la
pantalla cambie sola, crear la cuenta, e iniciar sesión con ella. Luego, en la base:

```bash
sudo sqlite3 /var/lib/lumi/lumi.db "SELECT user_id, key, value FROM limits"
```

Se espera una fila con `models` y `["mini","pro"]` para el usuario nuevo: los modelos
concedidos al aprobar se materializan como anulación.

- [ ] **Paso 4: commit**

```bash
git add client/src/entry/
git commit -m "Resolución de la solicitud: crear cuenta con el ticket, y rechazo que no cierra la puerta"
```

---

## Tarea 14: Cambio de contraseña forzado

**Ficheros:**
- Crear: `client/src/entry/ChangePasswordForm.tsx`
- Modificar: `client/src/entry/EntryScreen.tsx`

**Interfaces:**
- Produce: `<ChangePasswordForm onDone />`.
- Consume: `api.post` con el token de la sesión recién abierta, `useServer`.

El token que devuelve un login con `must_change_password` existe pero el servidor lo
rechaza en todo lo demás (tarea 6). Esta pantalla es literalmente lo único que puede hacer.

- [ ] **Paso 1: implementar**

Crear `client/src/entry/ChangePasswordForm.tsx`:

```tsx
import { useState } from "react";
import { api } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

export function ChangePasswordForm({ onDone }: { onDone: () => void }) {
  const token = useServer((s) => s.token);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try {
      await api.post("/v1/auth/change-password", { current, new: next }, token!);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const field = "w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]";
  const mismatch = repeat.length > 0 && repeat !== next;

  return (
    <>
      <div className="flex items-start gap-2.5 py-[7px] text-xs text-muted">
        <Icon name="alert" className="mt-0.5 text-warn-fg" />
        <span>El administrador ha pedido que cambies tu contraseña antes de continuar.</span>
      </div>
      <div className="my-3 h-px bg-border" />
      <label className="mb-[7px] block text-[11px] text-muted">Contraseña actual</label>
      <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} className={field} />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] text-muted">Nueva contraseña</label>
      <input type="password" value={next} onChange={(e) => setNext(e.target.value)} className={field} />
      <div className="h-3" />
      <label className="mb-[7px] block text-[11px] text-muted">Repítela</label>
      <input type="password" value={repeat} onChange={(e) => setRepeat(e.target.value)} className={field} />
      <p className="mt-2.5 max-w-[54ch] text-[11px] text-muted">
        Mínimo 12 caracteres. Las demás sesiones abiertas se cerrarán.
      </p>

      {(error || mismatch) && (
        <div className="mt-3.5 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{mismatch ? "las dos contraseñas no coinciden" : error}</span>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button onClick={submit} disabled={busy || next.length < 12 || mismatch || !current}
          className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Guardando" : "Cambiar y continuar"}
        </button>
      </div>
    </>
  );
}
```

Si `text-warn-fg` no existe en `tailwind.config.ts`, usa el token naranja que ya define
`DESIGN.md` para el estado sellado. **No inventes un color nuevo.**

- [ ] **Paso 2: enganchar**

En `client/src/entry/EntryScreen.tsx`:

```tsx
import { ChangePasswordForm } from "./ChangePasswordForm";
```

```tsx
  if (view === "password") {
    return (
      <Pane title="Cambia tu contraseña" subtitle="hace falta antes de entrar.">
        <ChangePasswordForm onDone={onSignedIn} />
      </Pane>
    );
  }
```

- [ ] **Paso 3: comprobar a mano**

```bash
sudo ./target/release/lumi admin reset-password ana
```

Entra con la contraseña temporal que imprime: debe aparecer esta pantalla y no la
aplicación. Comprueba además que un `GET /v1/me/sessions` con ese token devuelve `403`
antes del cambio y `200` después.

- [ ] **Paso 4: commit**

```bash
git add client/src/entry/
git commit -m "Cambio de contraseña forzado: el token solo sirve para esto hasta que se cambia"
```

---

## Tarea 15: Administración provisional

**Ficheros:**
- Crear: `client/src/admin/AdminPanel.tsx`, `client/src/admin/RequestsView.tsx`,
  `client/src/admin/UsersView.tsx`

**Interfaces:**
- Produce: `<AdminPanel token onClose />`.
- Consume: `api.get`, `api.post`, `api.patch`, y los tipos `AdminRequest`, `AdminUser`,
  `UserDetail`, `Limits` de la tarea 10.

> **Estas vistas son temporales.** Dos pantallas, con el vocabulario existente y **sin
> navegación ni layout de panel**. El subsistema 3 diseña la administración desde cero y
> puede quedarse las piezas interiores o tirarlas enteras. **No inviertas esfuerzo de diseño
> aquí más allá de que funcionen y usen los tokens.**

Dos criterios sí sobreviven al rediseño y hay que respetarlos:

- **Cada límite dice de dónde viene** (`hereda del global` / `anulado · global 50`).
- **Bloquear atenúa la fila, no la borra.** En forense, quitar a alguien de la lista
  borraría también el rastro de quién hizo qué.

- [ ] **Paso 1: solicitudes**

Crear `client/src/admin/RequestsView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type AdminRequest } from "../lib/api";
import { Icon } from "../ui/Icon";

const MODELS = ["mini", "pro", "vision"];

export function RequestsView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminRequest[]>([]);
  const [granted, setGranted] = useState<Record<number, string[]>>({});
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<AdminRequest[]>("/v1/admin/access-requests", token).then(setRows).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  async function resolve(id: number, approve: boolean) {
    try {
      await api.post(`/v1/admin/access-requests/${id}/resolve`,
        { approve, granted_models: approve ? granted[id] ?? ["mini"] : undefined }, token);
      load();
    } catch (e) {
      // 409: otro administrador ya la resolvió. Se recarga para ver qué pasó.
      setError(String(e));
      load();
    }
  }

  const toggle = (id: number, m: string) =>
    setGranted((g) => {
      const cur = g[id] ?? ["mini"];
      return { ...g, [id]: cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m] };
    });

  const pending = rows.filter((r) => r.status === "pending");

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {pending.length} pendientes · provisional, el panel llega en el subsistema 3.
      </p>
      {error && <p className="mb-3 text-xs text-danger-fg">{error}</p>}
      {rows.map((r) => (
        <div key={r.id} className={`mb-2.5 rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-4 ${r.status !== "pending" ? "opacity-45" : ""}`}>
          <div className="flex items-center gap-2.5 text-xs">
            <span className="text-fg">{r.display_name}</span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10.5px] text-subtle">{r.source_ip}</span>
            {r.external && (
              <span className="rounded border border-warn-fg/40 px-1.5 py-0.5 text-[10.5px] text-warn-fg">
                fuera de la red local
              </span>
            )}
            <span className="ml-auto font-mono text-[10.5px] text-subtle">{r.status}</span>
          </div>
          <p className="mt-2.5 max-w-[70ch] text-xs leading-relaxed text-muted">{r.message}</p>
          {r.status === "pending" && (
            <div className="mt-3 flex items-center gap-2">
              <button onClick={() => resolve(r.id, true)}
                className="rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black active:translate-y-px">Aprobar</button>
              <button onClick={() => resolve(r.id, false)}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">Rechazar</button>
              <span className="ml-auto flex items-center gap-1.5 text-[11px] text-subtle">
                conceder:
                {MODELS.map((m) => {
                  const on = (granted[r.id] ?? ["mini"]).includes(m);
                  return (
                    <button key={m} onClick={() => toggle(r.id, m)}
                      className={`rounded border px-1.5 py-0.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                        on ? "border-accent text-fg" : "border-border text-subtle"}`}>
                      {m}
                    </button>
                  );
                })}
              </span>
            </div>
          )}
        </div>
      ))}
      {rows.length === 0 && (
        <div className="flex items-center gap-2.5 text-xs text-muted"><Icon name="user" /> No hay solicitudes.</div>
      )}
    </>
  );
}
```

- [ ] **Paso 2: usuarios y detalle**

Crear `client/src/admin/UsersView.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type AdminUser, type UserDetail } from "../lib/api";

const LEVERS: [string, string][] = [
  ["models", "Modelos"],
  ["max_concurrent", "Concurrentes"],
  ["max_daily", "Al día"],
  ["max_storage_gb", "Almacenamiento (GB)"],
  ["queue_priority", "Prioridad"],
  ["can_create_projects", "Crear proyectos"],
];

export function UsersView({ token }: { token: string }) {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [detail, setDetail] = useState<UserDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => api.get<AdminUser[]>("/v1/admin/users", token).then(setRows).catch((e) => setError(String(e)));
  useEffect(() => { load(); }, []);

  const open = (id: number) => api.get<UserDetail>(`/v1/admin/users/${id}`, token).then(setDetail).catch((e) => setError(String(e)));

  async function patch(id: number, body: unknown) {
    try {
      setDetail(await api.patch<UserDetail>(`/v1/admin/users/${id}`, body, token));
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  if (detail) {
    const u = detail.user;
    return (
      <>
        <button onClick={() => setDetail(null)} className="mb-4 text-[11px] text-muted hover:text-fg">← Usuarios</button>
        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5">
          <div className="mb-3 flex items-center gap-2.5 text-xs">
            <span className="text-fg">{u.username}</span>
            {u.is_admin && <span className="rounded border border-border px-1.5 py-0.5 text-[10.5px] text-subtle">administrador</span>}
            {u.blocked && <span className="rounded border border-danger-fg/40 px-1.5 py-0.5 text-[10.5px] text-danger-fg">bloqueada</span>}
          </div>

          {u.is_admin ? (
            <p className="text-[11px] text-muted">
              Los administradores no tienen límites: se ignoran todos.
            </p>
          ) : (
            <table className="w-full text-xs">
              <tbody>
                {LEVERS.map(([key, label]) => {
                  const overridden = key in detail.overrides;
                  const value = JSON.stringify((u.limits as unknown as Record<string, unknown>)[key]);
                  const g = JSON.stringify((detail.global as unknown as Record<string, unknown>)[key]);
                  return (
                    <tr key={key} className="border-b border-border/60 last:border-0">
                      <td className="py-2 text-muted">{label}</td>
                      <td className="py-2 font-mono text-fg">{value}</td>
                      {/* El origen SIEMPRE visible: un límite sin origen es
                          indepurable cuando alguien pregunta por qué solo
                          puede lanzar uno. */}
                      <td className="py-2 text-[10.5px] text-subtle">
                        {overridden ? `anulado · global ${g}` : "hereda del global"}
                      </td>
                      <td className="py-2 text-right">
                        {overridden && (
                          <button onClick={() => patch(u.id, { limits: { [key]: null } })}
                            className="text-[10.5px] text-muted hover:text-fg">quitar anulación</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          <div className="my-4 h-px bg-border" />
          <div className="mb-2 text-[11px] text-muted">Dispositivos y sesiones</div>
          {detail.devices.map((d) => (
            <div key={d.name + d.first_seen} className="py-1 text-xs text-muted">{d.name} · {d.os ?? "—"}</div>
          ))}
          {detail.sessions.map((s) => (
            <div key={s.public_id} className="flex items-center gap-2 py-1 text-xs text-muted">
              <span className="font-mono text-[10.5px] text-subtle">{s.device_name ?? "sin equipo"}</span>
              <button onClick={() => api.del(`/v1/sessions/${s.public_id}`, token).then(() => open(u.id))}
                className="ml-auto text-[10.5px] text-muted hover:text-fg">revocar</button>
            </div>
          ))}

          <div className="my-4 h-px bg-border" />
          <div className="flex gap-2">
            <button onClick={() => patch(u.id, { blocked: !u.blocked })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              {u.blocked ? "Desbloquear" : "Bloquear"}
            </button>
            <button onClick={() => patch(u.id, { must_change_password: true })}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg active:translate-y-px">
              Exigir cambio de contraseña
            </button>
          </div>
          {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
        </div>
      </>
    );
  }

  return (
    <>
      <p className="mb-4 text-xs text-muted">
        {rows.length} cuentas · {rows.filter((r) => r.blocked).length} bloqueadas.
      </p>
      <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-4">
        <table className="w-full text-xs">
          <thead className="text-[10.5px] text-subtle">
            <tr><th className="pb-2 text-left">Usuario</th><th className="pb-2 text-left">Modelos</th>
              <th className="pb-2 text-left">Al día</th><th className="pb-2 text-left">Estado</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              // Bloquear ATENÚA, no borra: en forense, quitar a alguien de la
              // lista borraría el rastro de quién hizo qué.
              <tr key={u.id} className={`border-t border-border/60 ${u.blocked ? "opacity-45" : ""}`}>
                <td className="py-2 text-fg">{u.username}</td>
                <td className="py-2 font-mono text-muted">{u.is_admin ? "todos" : u.limits.models.join(" ")}</td>
                <td className="py-2 font-mono text-muted">{u.is_admin ? "∞" : u.limits.max_daily}</td>
                <td className="py-2 text-muted">{u.blocked ? "bloqueada" : "activa"}</td>
                <td className="py-2 text-right">
                  <button onClick={() => open(u.id)} className="text-[10.5px] text-muted hover:text-fg">Editar</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && <p className="mt-3 text-xs text-danger-fg">{error}</p>}
    </>
  );
}
```

- [ ] **Paso 3: el contenedor**

Crear `client/src/admin/AdminPanel.tsx`:

```tsx
import { useState } from "react";
import { RequestsView } from "./RequestsView";
import { UsersView } from "./UsersView";

export function AdminPanel({ token, onClose }: { token: string; onClose: () => void }) {
  const [tab, setTab] = useState<"requests" | "users">("requests");
  return (
    <div className="relative z-10 mx-auto w-full max-w-3xl px-6 py-9">
      <div className="mb-1 flex items-center gap-2.5" style={{ animation: "jg-fade-rise .7s both" }}>
        <span className="text-fg">✦</span>
        <span className="text-[17px] font-medium text-fg">
          {tab === "requests" ? "Solicitudes de acceso" : "Usuarios"}
        </span>
        <div className="ml-auto flex gap-2">
          <button onClick={() => setTab(tab === "requests" ? "users" : "requests")}
            className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
            {tab === "requests" ? "Usuarios" : "Solicitudes"}
          </button>
          <button onClick={onClose} className="rounded-lg border border-white/15 px-3 py-1.5 text-[11px] text-fg">
            Cerrar
          </button>
        </div>
      </div>
      <div style={{ animation: "jg-fade-rise .8s .1s both" }}>
        {tab === "requests" ? <RequestsView token={token} /> : <UsersView token={token} />}
      </div>
    </div>
  );
}
```

- [ ] **Paso 4: compilar y comprobar a mano**

```bash
cd client && npm run build
```

Entra como administrador, abre el panel: aprueba una solicitud, edita un límite, bloquea a
un usuario y comprueba que su fila se **atenúa** y que su sesión abierta desaparece de la
lista al recargar el detalle.

- [ ] **Paso 5: commit**

```bash
git add client/src/admin/
git commit -m "Administración provisional: solicitudes y usuarios con el origen de cada límite"
```

---

## Tarea 16: Enrutado y documentación

**Ficheros:**
- Modificar: `client/src/App.tsx`, `client/src/ui/TelemetryStrip.tsx`, `ARCHITECTURE.md`,
  `README.md`

**Interfaces:**
- Consume: `EntryScreen` (11), `Bell` (12), `AdminPanel` (15), `api.get` para `/v1/auth/me`.

Aquí se junta todo. La regla de aterrizaje sigue siendo la del subsistema 1: **la decisión
sale de la verdad del servidor**, no de un número de paso guardado a ciegas.

```
sesión guardada con token válido  →  aplicación (o panel, si es admin)
sesión guardada con ticket        →  espera
servidor guardado en unclaimed
  o clave lumi1_ pegada           →  wizard del owner
en cualquier otro caso            →  entrada
```

- [ ] **Paso 1: reescribir el enrutado**

En `client/src/App.tsx`, sustituir el efecto de reanudación y el bloque de renderizado por:

```tsx
  const [mode, setMode] = useState<"entry" | "wizard" | "app" | "admin">("entry");
  const [notifs, setNotifs] = useState(0);

  useEffect(() => {
    const session = loadSession();
    if (!session?.addr || !session?.fingerprint) { setResuming(false); return; }
    (async () => {
      try {
        const h = await api.reconnect(session.addr, session.fingerprint);
        useServer.getState().setHello(h);
        useServer.getState().setAddr(session.addr);

        // Servidor sin reclamar: esto es el flujo del owner, no el de entrada.
        if (h.state === "unclaimed") {
          if (session.bootstrapToken) {
            useServer.getState().setBootstrapToken(session.bootstrapToken);
            setStep(1);
            setMode("wizard");
          } else {
            setMode("entry");
          }
          return;
        }
        if (session.token) {
          try {
            const me = await api.get<{ username: string; is_admin: boolean }>("/v1/auth/me", session.token);
            useServer.getState().setToken(session.token);
            useServer.getState().setUser(me.username, me.is_admin);
            await invoke("start_telemetry", { token: session.token });
            // El aprovisionamiento sigue siendo cosa del owner: si el servidor
            // no está listo del todo, se vuelve al wizard donde se dejó.
            if (me.is_admin && h.state !== "ready") { setStep(2); setMode("wizard"); }
            else setMode("app");
            return;
          } catch {
            // 403 (cambio pendiente) o token caducado: la entrada lo resuelve.
            updateSession({ token: undefined });
          }
        }
        setMode("entry");
      } catch {
        // No se pudo reconectar (servidor apagado, red, dirección cambiada).
        // No se borra la sesión por un fallo puntual: puede ser pasajero.
        setMode("entry");
      } finally {
        setResuming(false);
      }
    })();
  }, []);
```

Y el árbol:

```tsx
      {resuming ? null : status !== "ok" ? (
        <StatusOverlay status={status} queue={useServer.getState().sample?.queue_depth ?? 0}
          onRetry={() => setStatus("ok")} onUnseal={unseal} />
      ) : mode === "entry" ? (
        <EntryScreen
          onSignedIn={() => setMode(useServer.getState().isAdmin ? "admin" : "app")}
          onOwnerKey={(key) => { useServer.getState().setKey(key); setStep(0); setMode("wizard"); }} />
      ) : mode === "admin" ? (
        <AdminPanel token={useServer.getState().token!} onClose={() => setMode("app")} />
      ) : mode === "wizard" ? (
        <Wizard step={step} title="Lumi Station" subtitle="vincular servidor"
          onBack={step > 0 ? () => setStep((s) => s - 1) : undefined}
          onNext={() => {
            if (step === 1) { document.getElementById("admin-submit")?.click(); return; }
            setStep((s) => s + 1);
          }}
          nextDisabled={step === 0 && !hello}>
          {step === 0 && <PairStep onDone={() => setStep(1)} />}
          {step === 1 && <AdminStep bootstrapToken={bootstrapToken} onDone={() => setStep(2)} />}
          {step === 2 && <ProvisionStep onDone={() => setMode("app")} />}
        </Wizard>
      ) : (
        <div className="text-xs text-muted">
          Sesión iniciada como {useServer.getState().username}. Los proyectos llegan en el subsistema 6.
        </div>
      )}
```

`ReloginStep.tsx` queda **sin usar**: `EntryScreen` hace su trabajo y algo más. Bórralo en
esta misma tarea; dejarlo sería una segunda pantalla de login que nadie mantiene.

- [ ] **Paso 2: la campana en la franja**

En `client/src/ui/TelemetryStrip.tsx`, añadir a la derecha:

```tsx
import { Bell } from "./Bell";
```

```tsx
      <Bell count={notifs} onClick={onNotifs} />
```

con `notifs: number` y `onNotifs: () => void` añadidos a sus props, y pasados desde
`App.tsx`. Que la campana viva en la franja y no en cada pantalla es lo que permite que la
aprobación se encienda **sin diálogo que interrumpa** lo que el usuario esté haciendo.

- [ ] **Paso 3: documentar**

En `ARCHITECTURE.md`:

- Marcar el subsistema 2 como **terminado** en la tabla de estado.
- Añadir la tarjeta pública `lumi1s_` a la sección de artefactos, junto a la clave de
  vinculación, con una línea sobre por qué no es un secreto.
- Añadir a la deuda: **`limits::effective` es la frontera con los subsistemas 4 y 6**; aquí
  los límites se definen y se exponen, no se aplican. Y: **bloquear a un usuario no detiene
  sus trabajos ya encolados**; decidirlo es del subsistema 4.
- Anotar que `POST /v1/access-requests` es la primera ruta escribible sin credenciales y
  que el interruptor `accept_requests` la cierra.

En `README.md`, añadir al apartado de pruebas:

```bash
sudo lumi card                      # la tarjeta pública que se reparte al equipo
sudo lumi admin requests            # solicitudes pendientes
sudo lumi admin reset-password ana  # contraseña temporal + cambio obligatorio
sudo lumi admin unblock ana
```

- [ ] **Paso 4: recorrido completo**

Desde cero, en este orden, sin tocar `curl` salvo donde se indique:

1. `sudo lumi install` → pegar la clave `lumi1_` en el cliente → crear admin → instalar runtime.
2. `sudo lumi card` → en otra máquina (o borrando `localStorage`), pegar la tarjeta.
3. Solicitar acceso. Cerrar la app. Reabrirla: **debe volver a la espera**.
4. Entrar como admin, abrir el panel, aprobar concediendo `mini` y `pro`.
5. En el cliente del solicitante: la pantalla cambia sola en menos de 30 s. Crear la cuenta.
6. Entrar con ella. El panel de admin **no** debe estar disponible.
7. Como admin: bloquear esa cuenta. El otro cliente pierde la sesión al siguiente intento.
8. `sudo lumi admin unblock` y entrar de nuevo.

- [ ] **Paso 5: commit**

```bash
git add client/src/App.tsx client/src/ui/TelemetryStrip.tsx ARCHITECTURE.md README.md
git rm client/src/wizard/ReloginStep.tsx
git commit -m "Enrutado de entrada, campana en la franja y documentación del subsistema 2"
```

---

## Autorrevisión

Repaso de la spec sección por sección contra el plan:

| Spec | Tarea |
|---|---|
| §3 tarjeta pública, dos formatos conviven | 1, y `lumi card` en 9 |
| §4.1 solicitar, ticket, sondeo de 30 s | 4, 12 |
| §4.2 aprobación con modelos, idempotente | 7 |
| §4.3 crear cuenta, 48 h, campana | 5, 12, 13 |
| §4.4 rechazo con motivo, se puede repetir | 7, 13 |
| §4.5 cambio de credenciales | 6, 14 |
| §5 seis palancas, dos niveles, admin sin límites | 3, 8 |
| §6 dispositivos y sesiones, registro pasivo | 6, 8 |
| §7 modelo de datos, índice parcial | 2 |
| §8 API completa y defensas de la ruta abierta | 4–8 |
| §9 nueve pantallas | 11–15 |
| §10 tabla de errores | 4, 5, 6, 7 |

**Dos huecos detectados al repasar, y cómo se cierran:**

1. **El interruptor `accept_requests` no tiene forma de accionarse.** La tarea 4 lo lee de
   `meta` pero nada lo escribe. Se cierra en la **tarea 9**: añadir a `admin.rs` del CLI

   ```rust
   pub fn accept(on: bool) -> Result<()> {
       db()?.execute(
           "INSERT OR REPLACE INTO meta (k, v) VALUES ('accept_requests', ?1)",
           [if on { "1" } else { "0" }],
       )?;
       Ok(())
   }
   ```

   con el subcomando `lumi admin accept-requests <on|off>`. Va en el CLI y no en la app
   porque es la respuesta a un servidor expuesto recibiendo ruido, y en ese momento lo que
   se tiene a mano es la shell.

2. **La caducidad a los 7 días no la aplica nadie.** `authorize` rechaza tickets caducados,
   pero una solicitud sin responder se queda `pending` para siempre y cuenta contra el tope
   de 100. Se cierra en la **tarea 7**: al principio de `list_requests`, antes de leer,

   ```rust
   let _ = app.store.conn().execute(
       "UPDATE access_requests SET status = 'expired'
        WHERE status = 'pending' AND expires_at < ?1",
       [now()],
   );
   ```

   `// ponytail:` la limpieza va aquí y no en una tarea periódica: el único momento en que
   importa que estén caducadas es cuando alguien las mira.

**Consistencia de tipos:** `Limits` (tarea 3) se usa en `AdminUser` y `UserDetail` (8) y en
`api.ts` (10) con los seis mismos campos. `SessionInfo` (6) se reutiliza en `UserDetail`
(8). `now()` vive en `routes::access` (4) y lo importan `auth` (6) y `admin` (7). El
`DeviceInfo` que envía `LoginForm` (11) tiene los tres campos de la tarea 3.

