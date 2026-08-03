# Plan de implementación — Proyectos, casos y mapa (subsistema 6, esqueleto)

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para implementar tarea a tarea. Los pasos
> usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** que un investigador entre, elija un proyecto, cree casos dentro, suba imágenes
a un caso y vea el mapa — con los análisis creándose en `pendiente` porque todavía no hay
motor que los resuelva.

**Arquitectura:** tres niveles (`projects` → `cases` → `analyses`) con una única función de
autorización, `access(user, project) -> Option<Role>`, por la que pasa absolutamente todo lo
que toca un caso, una imagen o un análisis. Los binarios —imágenes, miniaturas y teselas del
mapa— no caben por el puente de texto que ya existe (`invoke("request")` devuelve `String`),
así que se abre un canal nuevo: un **esquema URI propio de Tauri** (`lumi://`) que el webview
puede usar directamente en `<img src>` y en las fuentes de MapLibre, y que por dentro sale
por el mismo cliente TLS anclado. La clave del proveedor de mapas nunca baja al cliente: el
daemon hace de proxy de teselas y reescribe el estilo.

**Stack:** Rust 2021 · axum 0.7 (+ `multipart`) · rusqlite (bundled) · reqwest · `image` ·
`kamadak-exif` · Tauri v2 · React 19 · Vite · Tailwind 3 · zustand · MapLibre GL JS

**Spec:** [`2026-08-04-proyectos-y-casos-design.md`](../specs/2026-08-04-proyectos-y-casos-design.md)
**Diseño:** [`DESIGN.md`](../../../DESIGN.md) · mockup aprobado en `../specs/lumi-s6-mockups.html`
**Aparcado:** [`FUTURO.md`](../../../FUTURO.md)

---

## Restricciones globales

- **Sin tests salvo los indicados.** `PROJECT-CONVENTIONS.md` los considera gasto
  innecesario. Solo dos tareas llevan comprobación ejecutable: la 1 (`access`) y la 4
  (conteo de almacenamiento). Las demás, ninguna.
- **Un commit por tarea terminada.** Nada de commits intermedios.
- **`ponytail` manda.** Antes de escribir: ¿esto necesita existir? ¿lo cubre la stdlib? ¿una
  dependencia ya instalada? Las simplificaciones deliberadas llevan comentario `// ponytail:`
  nombrando el techo y la salida.
- **Los límites se preguntan a `limits::effective`, nunca leyendo la tabla `limits`.** Es
  condición explícita de `ARCHITECTURE.md` §10.
- **Los administradores ignoran todos los límites.** `is_admin` corta la comprobación antes
  de mirar nada, igual que en el subsistema 2.
- **Ningún secreto en una ruta.** El token de sesión viaja en cabecera `Authorization`, y
  eso incluye el esquema `lumi://`: el token vive en el estado del puente, no en la URL.
- **Copy en español, minúscula en subtítulos.** Sin em dashes (`—`) en texto de interfaz.
- **Sin colores fuera de la paleta de `DESIGN.md`. No hay verde.** El ámbar (`warning-fg`,
  `#efb968`) es exclusivamente para el EXIF declarado.
- **Iconos:** `viewBox="0 0 24 24"` siempre, `stroke-width` 1.6–2.0 sin adelgazar al crecer,
  32px máximo, trazo en `fg` salvo cuando el color significa estado.
- **Movimiento:** solo `ease-out` exponencial, `cubic-bezier(.16,1,.3,1)`. Sin rebote.
- **El archivo original de una imagen no se toca jamás.** Ni se reescribe, ni se recomprime,
  ni se le quita el EXIF. La miniatura es un archivo aparte.
- **El estilo del mapa nunca se sirve crudo.** Si la reescritura de fuentes falla, se falla
  ruidosamente con el motivo: servirlo crudo filtraría la clave del proveedor.
- **La fila de configuración del mapa en el panel de admin es provisional.** El subsistema 3
  la rehace. Que funcione y use los tokens; nada más.

---

## Estructura de archivos

```
crates/lumi-proto/
  src/api.rs                  + Project, Member, Case, Image, Analysis, MapConfig

crates/lumid/
  Cargo.toml                  + axum/multipart, reqwest, image, kamadak-exif, sha2
  src/store.rs                + 6 tablas nuevas en SCHEMA
  src/projects.rs             NUEVO · access() y el conteo de almacenamiento
  src/exif.rs                 NUEVO · GPS del EXIF a grados decimales
  src/routes/mod.rs           + projects, cases, images, analyses, map
  src/routes/projects.rs      NUEVO · proyectos y miembros
  src/routes/cases.rs         NUEVO · casos
  src/routes/images.rs        NUEVO · subir, servir, borrar
  src/routes/analyses.rs      NUEVO · crear pendiente, listar, borrar
  src/routes/map.rs           NUEVO · estilo reescrito, proxy de teselas, config de admin
  src/main.rs                 + las rutas nuevas

client/src-tauri/
  Cargo.toml                  + tauri-plugin-dialog
  src/main.rs                 + esquema lumi://, set_auth, upload_images

client/
  package.json                + maplibre-gl, @tauri-apps/plugin-dialog
  src/lib/api.ts              + tipos y llamadas nuevas
  src/lib/bridge.ts           NUEVO · lumiUrl(), setAuth(), uploadImages()
  src/lib/workspace.ts        NUEVO · store de proyecto y caso activos
  src/work/ProjectPicker.tsx  NUEVO · pantalla de arranque
  src/work/ProjectView.tsx    NUEVO · cajón de casos sobre el mapa
  src/work/CaseView.tsx       NUEVO · la pantalla heredada de la v1
  src/work/MapCanvas.tsx      NUEVO · MapLibre, compartido entre las dos vistas
  src/work/Rail.tsx           NUEVO · carril de iconos de 40 px
  src/work/Filmstrip.tsx      NUEVO · tira de miniaturas flotante
  src/work/ResultCard.tsx     NUEVO · tarjeta centrada arriba
  src/work/SummaryBar.tsx     NUEVO · barra inferior
  src/work/MembersDialog.tsx  NUEVO · miembros del proyecto
  src/admin/MapRow.tsx        NUEVO · configuración provisional del mapa
  src/dev/DebugOrb.tsx        + comando `fake`
  src/App.tsx                 + modos "picker", "project", "case"
```

**Por qué `src/work/`:** las pantallas del espacio de trabajo son una familia con su propio
vocabulario (mapa, caso, análisis) y no comparten nada con `entry/`, `wizard/` ni `admin/`.
Mantenerlas juntas y fuera de esas carpetas es lo que evita que `App.tsx` se convierta en el
sitio donde vive todo.

---

## Tarea 1: Esquema de datos y la función de autorización

**Archivos:**
- Modificar: `crates/lumid/src/store.rs` (constante `SCHEMA`)
- Crear: `crates/lumid/src/projects.rs`
- Modificar: `crates/lumid/src/main.rs:1-7` (declarar el módulo)

**Interfaces:**
- Consume: `crate::store::Store`, `crate::routes::access::now`
- Produce: `projects::Role` (`Owner` | `Member`), `projects::access(&Store, i64, i64) -> Option<Role>`,
  `projects::project_of_case(&Store, i64) -> Option<i64>`,
  `projects::project_of_image(&Store, i64) -> Option<i64>`,
  `projects::project_of_analysis(&Store, i64) -> Option<i64>`,
  `projects::used_bytes(&Store, i64) -> i64`

- [ ] **Paso 1: añadir las seis tablas al esquema**

En `crates/lumid/src/store.rs`, dentro de la constante `SCHEMA`, justo antes de la línea
`CREATE UNIQUE INDEX IF NOT EXISTS limits_global`:

```sql
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
CREATE INDEX IF NOT EXISTS cases_by_project ON cases(project_id);
CREATE INDEX IF NOT EXISTS images_by_case ON images(case_id);
CREATE INDEX IF NOT EXISTS analyses_by_case ON analyses(case_id);
```

No hay `REFERENCES` en estas tablas: el store abre con `PRAGMA foreign_keys = OFF` a
propósito (lo explica el comentario de `Store::open`), así que declararlas daría una falsa
sensación de integridad. El borrado en cascada se hace a mano y se ve en la tarea 2.

- [ ] **Paso 2: escribir el módulo de autorización**

Crear `crates/lumid/src/projects.rs`:

```rust
//! La regla de quién puede tocar qué, en un solo sitio.
//!
//! Todo lo que toca un caso, una imagen o un análisis resuelve hacia arriba
//! hasta su proyecto y pasa por `access`. Es el mismo criterio que
//! `limits::effective`: la regla vive en una función o se desincroniza.

use crate::store::Store;

#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum Role {
    Owner,
    Member,
}

impl Role {
    /// Renombrar y borrar el proyecto, y gestionar quién entra. Todo lo demás
    /// —crear casos, subir imágenes, lanzar análisis, borrarlos— lo puede
    /// hacer cualquier miembro.
    pub fn manages(self) -> bool {
        self == Role::Owner
    }
}

/// El papel del usuario en el proyecto, o `None` si no tiene ninguno.
pub fn access(s: &Store, user_id: i64, project_id: i64) -> Option<Role> {
    let role: String = s
        .conn()
        .query_row(
            "SELECT role FROM project_members WHERE project_id = ?1 AND user_id = ?2",
            rusqlite::params![project_id, user_id],
            |r| r.get(0),
        )
        .ok()?;
    match role.as_str() {
        "owner" => Some(Role::Owner),
        "member" => Some(Role::Member),
        _ => None,
    }
}

fn parent(s: &Store, sql: &str, id: i64) -> Option<i64> {
    s.conn().query_row(sql, [id], |r| r.get(0)).ok()
}

pub fn project_of_case(s: &Store, case_id: i64) -> Option<i64> {
    parent(s, "SELECT project_id FROM cases WHERE id = ?1", case_id)
}

pub fn project_of_image(s: &Store, image_id: i64) -> Option<i64> {
    parent(
        s,
        "SELECT c.project_id FROM images i JOIN cases c ON c.id = i.case_id WHERE i.id = ?1",
        image_id,
    )
}

pub fn project_of_analysis(s: &Store, analysis_id: i64) -> Option<i64> {
    parent(
        s,
        "SELECT c.project_id FROM analyses a JOIN cases c ON c.id = a.case_id WHERE a.id = ?1",
        analysis_id,
    )
}

/// Bytes que este usuario ha subido, en TODOS sus proyectos.
///
/// `max_storage_gb` es un límite por usuario, no por proyecto: en un proyecto
/// compartido cada imagen pesa en la cuota de quien la subió. Cargarla al
/// dueño del proyecto convertiría invitar a alguien en un riesgo para tu
/// propia cuota.
pub fn used_bytes(s: &Store, user_id: i64) -> i64 {
    s.conn()
        .query_row(
            "SELECT COALESCE(SUM(bytes), 0) FROM images WHERE uploader_id = ?1",
            [user_id],
            |r| r.get(0),
        )
        .unwrap_or(0)
}
```

- [ ] **Paso 3: declarar el módulo**

En `crates/lumid/src/main.rs`, la lista de módulos del principio pasa a:

```rust
mod limits;
mod master;
mod projects;
mod routes;
mod store;
mod tasks;
mod telemetry;
mod tls;
```

- [ ] **Paso 4: escribir la comprobación ejecutable**

Al final de `crates/lumid/src/projects.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!("lumi-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn el_invitado_ve_pero_no_gobierna_y_el_extrano_no_ve_nada() {
        let dir = tmp("acc");
        let s = Store::open(&dir).unwrap();
        {
            let c = s.conn();
            c.execute("INSERT INTO projects (id, name, created_at, updated_at) VALUES (1, 'p', 0, 0)", [])
                .unwrap();
            c.execute(
                "INSERT INTO project_members (project_id, user_id, role, added_at)
                 VALUES (1, 10, 'owner', 0), (1, 20, 'member', 0)",
                [],
            )
            .unwrap();
            c.execute("INSERT INTO cases (id, project_id, name, created_at) VALUES (5, 1, 'c', 0)", [])
                .unwrap();
            c.execute(
                "INSERT INTO images (id, case_id, uploader_id, filename, bytes, sha256, mime, created_at)
                 VALUES (7, 5, 20, 'a.jpg', 300, 'x', 'image/jpeg', 0)",
                [],
            )
            .unwrap();
        }

        // El dueño gobierna, el invitado no, y quien no es miembro no existe.
        assert_eq!(access(&s, 10, 1), Some(Role::Owner));
        assert!(access(&s, 10, 1).unwrap().manages());
        assert_eq!(access(&s, 20, 1), Some(Role::Member));
        assert!(!access(&s, 20, 1).unwrap().manages());
        assert_eq!(access(&s, 30, 1), None);

        // Resolver hacia arriba desde caso e imagen llega al mismo proyecto.
        assert_eq!(project_of_case(&s, 5), Some(1));
        assert_eq!(project_of_image(&s, 7), Some(1));
        assert_eq!(project_of_case(&s, 999), None);

        // La cuota se le carga a quien subió, no al dueño del proyecto.
        assert_eq!(used_bytes(&s, 20), 300);
        assert_eq!(used_bytes(&s, 10), 0);

        // Y salirse quita el acceso de verdad.
        s.conn()
            .execute("DELETE FROM project_members WHERE project_id = 1 AND user_id = 20", [])
            .unwrap();
        assert_eq!(access(&s, 20, 1), None);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Paso 5: ejecutar la comprobación**

```bash
cargo test -p lumid projects
```

Esperado: `test projects::tests::el_invitado_ve_pero_no_gobierna_y_el_extrano_no_ve_nada ... ok`

- [ ] **Paso 6: commit**

```bash
git add crates/lumid/src/store.rs crates/lumid/src/projects.rs crates/lumid/src/main.rs
git commit -m "Esquema de proyectos, casos, imagenes y analisis, con access() como unica regla"
```

---

## Tarea 2: Proyectos y miembros

**Archivos:**
- Modificar: `crates/lumi-proto/src/api.rs` (tipos nuevos al final)
- Crear: `crates/lumid/src/routes/projects.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`
- Modificar: `crates/lumid/src/main.rs` (rutas)

**Interfaces:**
- Consume: `projects::{access, Role, used_bytes}`, `routes::auth::{bearer, require_session}`,
  `routes::access::now`, `limits::effective`
- Produce: tipos `Project`, `ProjectMember`, `NameReq`, `MemberReq` en `lumi_proto::api`;
  rutas `/v1/projects` y `/v1/projects/:id/members`

- [ ] **Paso 1: añadir los tipos compartidos**

Al final de `crates/lumi-proto/src/api.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Project {
    pub id: i64,
    pub name: String,
    pub role: String,
    pub cases: i64,
    pub images: i64,
    pub bytes: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProjectMember {
    pub user_id: i64,
    pub username: String,
    pub role: String,
    pub added_at: i64,
}

/// Crear y renombrar comparten cuerpo: solo llevan nombre.
#[derive(Serialize, Deserialize)]
pub struct NameReq {
    pub name: String,
}

#[derive(Serialize, Deserialize)]
pub struct MemberReq {
    pub username: String,
}
```

- [ ] **Paso 2: escribir las rutas de proyecto**

Crear `crates/lumid/src/routes/projects.rs`:

```rust
//! Proyectos y quién entra en ellos.
//!
//! El dueño es una fila de `project_members` con `role = 'owner'`: no hay
//! `owner_id`. Así "qué proyectos veo" es una sola unión, idéntica para el
//! dueño y para un invitado.

use crate::projects::{access, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MemberReq, NameReq, Project, ProjectMember};

const MAX_NAME: usize = 80;

/// Error con su motivo escrito, no solo un código. Lo reutilizan los casos,
/// las imágenes y los análisis: es la forma de error de todo el subsistema.
pub type Fail = (StatusCode, String);

pub fn err(c: StatusCode, m: &str) -> Fail {
    (c, m.to_string())
}

/// Sesión válida + papel en el proyecto. `manage` exige ser el dueño.
fn guard(app: &App, headers: &HeaderMap, project_id: i64, manage: bool) -> Result<(i64, Role), Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    // 404 y no 403 cuando no eres miembro: confirmar que el proyecto existe ya
    // sería filtrar que alguien investiga algo.
    let role = access(&app.store, uid, project_id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no existe ese proyecto"))?;
    if manage && !role.manages() {
        return Err(err(StatusCode::FORBIDDEN, "solo el dueño del proyecto puede hacer esto"));
    }
    Ok((uid, role))
}

pub async fn list(State(app): State<App>, headers: HeaderMap) -> Result<Json<Vec<Project>>, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT p.id, p.name, m.role, p.created_at, p.updated_at,
                    (SELECT COUNT(*) FROM cases WHERE project_id = p.id),
                    (SELECT COUNT(*) FROM images i JOIN cases k ON k.id = i.case_id
                      WHERE k.project_id = p.id),
                    (SELECT COALESCE(SUM(i.bytes), 0) FROM images i JOIN cases k ON k.id = i.case_id
                      WHERE k.project_id = p.id)
             FROM projects p JOIN project_members m ON m.project_id = p.id
             WHERE m.user_id = ?1
             ORDER BY p.updated_at DESC",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([uid], |r| {
            Ok(Project {
                id: r.get(0)?,
                name: r.get(1)?,
                role: r.get(2)?,
                created_at: r.get(3)?,
                updated_at: r.get(4)?,
                cases: r.get(5)?,
                images: r.get(6)?,
                bytes: r.get(7)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn create(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<Json<Project>, Fail> {
    let (uid, is_admin) = require_session(&app, &bearer(&headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    // Los administradores ignoran los límites, igual que en el subsistema 2.
    if !is_admin && !crate::limits::effective(&app.store, uid).can_create_projects {
        return Err(err(
            StatusCode::FORBIDDEN,
            "tu cuenta no puede crear proyectos; habla con el administrador",
        ));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO projects (name, created_at, updated_at) VALUES (?1, ?2, ?2)",
        rusqlite::params![name, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    c.execute(
        "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?1, ?2, 'owner', ?3)",
        rusqlite::params![id, uid, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(Json(Project {
        id,
        name: name.to_string(),
        role: "owner".into(),
        cases: 0,
        images: 0,
        bytes: 0,
        created_at: t,
        updated_at: t,
    }))
}

pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    app.store
        .conn()
        .execute(
            "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![name, now(), id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// Borra el proyecto entero. La cascada es a mano porque el store abre con
/// `foreign_keys = OFF`, y los archivos hay que barrerlos igual: la base no
/// sabe nada del disco.
pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    {
        let c = app.store.conn();
        let sql = [
            "DELETE FROM analysis_images WHERE analysis_id IN
               (SELECT a.id FROM analyses a JOIN cases k ON k.id = a.case_id WHERE k.project_id = ?1)",
            "DELETE FROM analyses WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM images   WHERE case_id IN (SELECT id FROM cases WHERE project_id = ?1)",
            "DELETE FROM cases    WHERE project_id = ?1",
            "DELETE FROM project_members WHERE project_id = ?1",
            "DELETE FROM projects WHERE id = ?1",
        ];
        for s in sql {
            c.execute(s, [id])
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    }
    let _ = std::fs::remove_dir_all(app.dir.join("projects").join(id.to_string()));
    tracing::info!("proyecto #{id} borrado");
    Ok(StatusCode::NO_CONTENT)
}

pub async fn members(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<ProjectMember>>, Fail> {
    guard(&app, &headers, id, false)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT m.user_id, u.username, m.role, m.added_at
             FROM project_members m JOIN users u ON u.id = m.user_id
             WHERE m.project_id = ?1 ORDER BY (m.role = 'owner') DESC, u.username",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([id], |r| {
            Ok(ProjectMember {
                user_id: r.get(0)?,
                username: r.get(1)?,
                role: r.get(2)?,
                added_at: r.get(3)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn add_member(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<MemberReq>,
) -> Result<StatusCode, Fail> {
    guard(&app, &headers, id, true)?;
    let c = app.store.conn();
    let uid: i64 = c
        .query_row(
            "SELECT id FROM users WHERE username = ?1",
            [req.username.trim()],
            |r| r.get(0),
        )
        .map_err(|_| err(StatusCode::NOT_FOUND, "no hay ningún usuario con ese nombre"))?;
    c.execute(
        "INSERT INTO project_members (project_id, user_id, role, added_at) VALUES (?1, ?2, 'member', ?3)
         ON CONFLICT(project_id, user_id) DO NOTHING",
        rusqlite::params![id, uid, now()],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

/// El dueño quita a quien quiera; cualquiera puede quitarse a sí mismo. El
/// dueño no puede salirse: no hay a quién dejarle el proyecto porque traspasar
/// la propiedad está aparcado (ver FUTURO.md). Su salida es borrarlo.
pub async fn remove_member(
    State(app): State<App>,
    Path((id, target)): Path<(i64, i64)>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (uid, role) = guard(&app, &headers, id, false)?;
    if target != uid && !role.manages() {
        return Err(err(StatusCode::FORBIDDEN, "solo el dueño del proyecto puede hacer esto"));
    }
    if target == uid && role.manages() {
        return Err(err(
            StatusCode::CONFLICT,
            "eres el dueño: para dejar de tenerlo hay que borrar el proyecto",
        ));
    }
    app.store
        .conn()
        .execute(
            "DELETE FROM project_members WHERE project_id = ?1 AND user_id = ?2 AND role <> 'owner'",
            rusqlite::params![id, target],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 3: declarar el módulo y las rutas**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod projects;` en orden alfabético (entre
`hello` y `tasks`).

En `crates/lumid/src/main.rs`, antes de `.with_state(app)`:

```rust
        .route("/v1/projects", get(routes::projects::list).post(routes::projects::create))
        .route(
            "/v1/projects/:id",
            axum::routing::patch(routes::projects::rename).delete(routes::projects::remove),
        )
        .route(
            "/v1/projects/:id/members",
            get(routes::projects::members).post(routes::projects::add_member),
        )
        .route(
            "/v1/projects/:id/members/:user_id",
            axum::routing::delete(routes::projects::remove_member),
        )
```

- [ ] **Paso 4: compilar**

```bash
cargo build --workspace
```

Esperado: `Finished` sin errores ni avisos.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/projects.rs \
        crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "Proyectos y miembros: el dueño es una fila de project_members, no una columna"
```

---

## Tarea 3: Casos

**Archivos:**
- Modificar: `crates/lumi-proto/src/api.rs`
- Crear: `crates/lumid/src/routes/cases.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `projects::{access, project_of_case}`, `routes::auth::{bearer, require_session}`
- Produce: tipo `Case` en `lumi_proto::api`; `routes::cases::guard_case(&App, &HeaderMap, i64)
  -> Result<(i64, i64, Role), Fail>` (usuario, proyecto, papel), que reutilizan las tareas 4 y 6

- [ ] **Paso 1: añadir el tipo compartido**

Al final de `crates/lumi-proto/src/api.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Case {
    pub id: i64,
    pub project_id: i64,
    pub name: String,
    pub images: i64,
    pub analyses: i64,
    /// Análisis con resultado. La vista de proyecto pinta un marcador por caso
    /// resuelto, y necesita saber si hay alguno sin traerse la lista entera.
    pub resolved: i64,
    /// Del análisis resuelto más reciente, para el marcador. `None` mientras
    /// no haya motor.
    pub lat: Option<f64>,
    pub lng: Option<f64>,
    pub created_at: i64,
}
```

- [ ] **Paso 2: escribir las rutas de caso**

Crear `crates/lumid/src/routes/cases.rs`:

```rust
//! Casos: el contenedor dentro de un proyecto. Las imágenes cuelgan de aquí.

use crate::projects::{access, project_of_case, Role};
use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Case, NameReq};

const MAX_NAME: usize = 80;

/// Sesión + acceso al proyecto del caso. Devuelve (usuario, proyecto, papel).
/// La usan también las imágenes y los análisis: es su único camino a `access`.
pub fn guard_case(app: &App, headers: &HeaderMap, case_id: i64) -> Result<(i64, i64, Role), Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    let missing = || err(StatusCode::NOT_FOUND, "no existe ese caso");
    let pid = project_of_case(&app.store, case_id).ok_or_else(missing)?;
    let role = access(&app.store, uid, pid).ok_or_else(missing)?;
    Ok((uid, pid, role))
}

fn guard_project(app: &App, headers: &HeaderMap, project_id: i64) -> Result<i64, Fail> {
    let (uid, _) = require_session(app, &bearer(headers))
        .map_err(|c| (c, "sesión inválida".to_string()))?;
    access(&app.store, uid, project_id)
        .ok_or_else(|| err(StatusCode::NOT_FOUND, "no existe ese proyecto"))?;
    Ok(uid)
}

pub async fn list(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Case>>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(
            "SELECT k.id, k.project_id, k.name, k.created_at,
                    (SELECT COUNT(*) FROM images WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id),
                    (SELECT COUNT(*) FROM analyses WHERE case_id = k.id AND state = 'hecho'),
                    (SELECT result_lat FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1),
                    (SELECT result_lng FROM analyses WHERE case_id = k.id AND state = 'hecho'
                      ORDER BY finished_at DESC LIMIT 1)
             FROM cases k WHERE k.project_id = ?1 ORDER BY k.created_at",
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([project_id], |r| {
            Ok(Case {
                id: r.get(0)?,
                project_id: r.get(1)?,
                name: r.get(2)?,
                created_at: r.get(3)?,
                images: r.get(4)?,
                analyses: r.get(5)?,
                resolved: r.get(6)?,
                lat: r.get(7)?,
                lng: r.get(8)?,
            })
        })
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn create(
    State(app): State<App>,
    Path(project_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<Json<Case>, Fail> {
    guard_project(&app, &headers, project_id)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    let t = now();
    let c = app.store.conn();
    c.execute(
        "INSERT INTO cases (project_id, name, created_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![project_id, name, t],
    )
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let id = c.last_insert_rowid();
    // Tocar el proyecto: la lista del arranque se ordena por uso reciente, y
    // crear un caso dentro es usarlo.
    let _ = c.execute("UPDATE projects SET updated_at = ?1 WHERE id = ?2", rusqlite::params![t, project_id]);
    Ok(Json(Case {
        id,
        project_id,
        name: name.to_string(),
        images: 0,
        analyses: 0,
        resolved: 0,
        lat: None,
        lng: None,
        created_at: t,
    }))
}

pub async fn rename(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<NameReq>,
) -> Result<StatusCode, Fail> {
    guard_case(&app, &headers, id)?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME {
        return Err(err(StatusCode::BAD_REQUEST, "el nombre está vacío o pasa de 80 caracteres"));
    }
    app.store
        .conn()
        .execute("UPDATE cases SET name = ?1 WHERE id = ?2", rusqlite::params![name, id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (_, pid, _) = guard_case(&app, &headers, id)?;
    // Los archivos de cada imagen, antes de perder sus filas.
    let files: Vec<i64> = {
        let c = app.store.conn();
        let mut q = c
            .prepare("SELECT id FROM images WHERE case_id = ?1")
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let v = q.query_map([id], |r| r.get(0)).map(|it| it.flatten().collect());
        v.unwrap_or_default()
    };
    {
        let c = app.store.conn();
        for sql in [
            "DELETE FROM analysis_images WHERE analysis_id IN (SELECT id FROM analyses WHERE case_id = ?1)",
            "DELETE FROM analyses WHERE case_id = ?1",
            "DELETE FROM images WHERE case_id = ?1",
            "DELETE FROM cases WHERE id = ?1",
        ] {
            c.execute(sql, [id])
                .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
    }
    let base = app.dir.join("projects").join(pid.to_string());
    for img in files {
        let _ = std::fs::remove_file(base.join(img.to_string()));
        let _ = std::fs::remove_file(base.join(format!("{img}.thumb")));
    }
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 3: declarar el módulo y las rutas**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod cases;` en orden alfabético (después de
`auth`).

En `crates/lumid/src/main.rs`:

```rust
        .route(
            "/v1/projects/:id/cases",
            get(routes::cases::list).post(routes::cases::create),
        )
        .route(
            "/v1/cases/:id",
            axum::routing::patch(routes::cases::rename).delete(routes::cases::remove),
        )
```

- [ ] **Paso 4: compilar**

```bash
cargo build --workspace
```

Esperado: `Finished` sin errores ni avisos.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/cases.rs \
        crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "Casos dentro de un proyecto, con guard_case como puerta unica"
```

---

## Tarea 4: Subir imágenes, leer el EXIF y cobrar la cuota

**Archivos:**
- Modificar: `crates/lumid/Cargo.toml`
- Crear: `crates/lumid/src/exif.rs`
- Crear: `crates/lumid/src/routes/images.rs`
- Modificar: `crates/lumid/src/main.rs:1-7` y las rutas
- Modificar: `crates/lumi-proto/src/api.rs`

**Interfaces:**
- Consume: `routes::cases::guard_case`, `routes::projects::{err, Fail}`, `projects::used_bytes`, `limits::effective`
- Produce: tipos `Image` y `Usage` en `lumi_proto::api`; `exif::read(&[u8]) -> ExifRead`;
  `routes::images::{list, upload, remove, my_usage}`

- [ ] **Paso 1: añadir las dependencias**

En `crates/lumid/Cargo.toml`, la línea de axum gana la feature de multipart y se añaden tres
dependencias:

```toml
axum = { version = "0.7", features = ["multipart"] }
image = { version = "0.25", default-features = false, features = ["jpeg", "png", "webp"] }
kamadak-exif = "0.6"
sha2.workspace = true
```

`image` va con `default-features = false` a propósito: los formatos por defecto arrastran
descodificadores que nadie va a usar y engordan el binario del daemon sin motivo.

- [ ] **Paso 2: escribir el lector de EXIF**

Crear `crates/lumid/src/exif.rs`:

```rust
//! El GPS que la cámara ya escribió dentro de la foto.
//!
//! Se lee, se guarda y se muestra APARTE de lo inferido: una parte real de las
//! imágenes que recibe esta herramienta ya trae las coordenadas dentro, y
//! ocultarlo contradice de frente el principio de que nada desaparece en
//! silencio. Falsificar un EXIF es trivial, y por eso se etiqueta como
//! declarado en vez de esconderse.

pub struct ExifRead {
    /// El EXIF entero, como objeto JSON de etiqueta a valor.
    pub json: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

/// Grados/minutos/segundos a grados decimales. `refr` es 'N'/'S'/'E'/'W'.
fn dms(v: &exif::Value, refr: &str) -> Option<f64> {
    let exif::Value::Rational(r) = v else { return None };
    if r.len() < 3 {
        return None;
    }
    let d = r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0;
    Some(if refr.starts_with('S') || refr.starts_with('W') { -d } else { d })
}

pub fn read(bytes: &[u8]) -> ExifRead {
    let none = ExifRead { json: None, lat: None, lng: None };
    let mut cur = std::io::Cursor::new(bytes);
    let Ok(r) = exif::Reader::new().read_from_container(&mut cur) else { return none };

    let mut map = serde_json::Map::new();
    for f in r.fields() {
        map.insert(
            format!("{}", f.tag),
            serde_json::Value::String(f.display_value().with_unit(&r).to_string()),
        );
    }

    let get = |tag: exif::Tag| r.get_field(tag, exif::In::PRIMARY);
    let refr = |tag: exif::Tag| get(tag).map(|f| f.display_value().to_string()).unwrap_or_default();
    let lat = get(exif::Tag::GPSLatitude).and_then(|f| dms(&f.value, &refr(exif::Tag::GPSLatitudeRef)));
    let lng = get(exif::Tag::GPSLongitude).and_then(|f| dms(&f.value, &refr(exif::Tag::GPSLongitudeRef)));

    ExifRead { json: serde_json::to_string(&map).ok(), lat, lng }
}
```

- [ ] **Paso 3: añadir los tipos compartidos**

Al final de `crates/lumi-proto/src/api.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Image {
    pub id: i64,
    pub case_id: i64,
    pub filename: String,
    pub bytes: i64,
    pub width: Option<i64>,
    pub height: Option<i64>,
    pub mime: String,
    /// GPS DECLARADO por la cámara. Nunca se mezcla con el inferido.
    pub exif_lat: Option<f64>,
    pub exif_lng: Option<f64>,
    pub exif: Option<serde_json::Value>,
    pub created_at: i64,
}

/// Cuánto ocupa este usuario y cuánto le dejan.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Usage {
    pub used_bytes: i64,
    pub limit_gb: i64,
    /// `true` si el tope viene de una anulación propia, `false` si se hereda
    /// del global. Un límite sin origen visible es indepurable cuando alguien
    /// pregunta por qué no le caben más imágenes.
    pub overridden: bool,
}
```

- [ ] **Paso 4: escribir las rutas de imagen**

Crear `crates/lumid/src/routes/images.rs`:

```rust
//! Subir, listar y borrar imágenes. El archivo original se escribe una vez y
//! no se vuelve a tocar: en contexto forense, reescribirlo es destruir la
//! prueba. La miniatura es un archivo aparte, al lado.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::cases::guard_case;
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Multipart, Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Image, Usage};
use sha2::{Digest, Sha256};

/// Lado mayor de la miniatura. 320 px basta para la tira a densidad doble.
const THUMB: u32 = 320;
const MAX_BYTES: usize = 64 * 1024 * 1024;

const COLS: &str = "id, case_id, filename, bytes, width, height, mime,
                    exif_lat, exif_lng, exif_json, created_at";

fn dir_for(app: &App, project_id: i64) -> std::path::PathBuf {
    app.dir.join("projects").join(project_id.to_string())
}

fn usage(app: &App, uid: i64) -> Usage {
    Usage {
        used_bytes: crate::projects::used_bytes(&app.store, uid),
        limit_gb: crate::limits::effective(&app.store, uid).max_storage_gb,
        overridden: crate::limits::overrides(&app.store, uid).contains_key("max_storage_gb"),
    }
}

fn row_to_image(r: &rusqlite::Row) -> rusqlite::Result<Image> {
    let raw: Option<String> = r.get(9)?;
    Ok(Image {
        id: r.get(0)?,
        case_id: r.get(1)?,
        filename: r.get(2)?,
        bytes: r.get(3)?,
        width: r.get(4)?,
        height: r.get(5)?,
        mime: r.get(6)?,
        exif_lat: r.get(7)?,
        exif_lng: r.get(8)?,
        exif: raw.and_then(|s| serde_json::from_str(&s).ok()),
        created_at: r.get(10)?,
    })
}

pub async fn list(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Image>>, Fail> {
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!("SELECT {COLS} FROM images WHERE case_id = ?1 ORDER BY created_at"))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let rows = q
        .query_map([case_id], row_to_image)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    Ok(Json(rows))
}

pub async fn upload(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<Vec<Image>>, Fail> {
    let (uid, pid, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);
    let dir = dir_for(&app, pid);
    std::fs::create_dir_all(&dir)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let mut out = Vec::new();
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?
    {
        let filename = field.file_name().unwrap_or("sin-nombre").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?;
        if data.len() > MAX_BYTES {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "esa imagen pasa de 64 MB"));
        }

        // La cuota se comprueba por archivo y no por lote: así el primero de
        // diez entra aunque el décimo no quepa, en vez de perderse todos.
        if !is_admin {
            let u = usage(&app, uid);
            let cap = u.limit_gb * 1024 * 1024 * 1024;
            if u.used_bytes + data.len() as i64 > cap {
                let faltan = (u.used_bytes + data.len() as i64 - cap) as f64 / 1024.0 / 1024.0;
                let origen = if u.overridden {
                    format!("tu límite es de {} GB, anulado para tu cuenta", u.limit_gb)
                } else {
                    format!("tu límite es de {} GB, heredado del global", u.limit_gb)
                };
                return Err(err(
                    StatusCode::INSUFFICIENT_STORAGE,
                    &format!("no caben {faltan:.0} MB más: {origen}"),
                ));
            }
        }

        // Descodificar ANTES de escribir nada: si no es una imagen, el disco
        // no se toca y se dice qué se detectó de verdad.
        let fmt = image::guess_format(&data).map_err(|_| {
            err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("{filename} no es una imagen"))
        })?;
        let decoded = image::load_from_memory_with_format(&data, fmt)
            .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("{filename}: {e}")))?;
        let (w, h) = (decoded.width() as i64, decoded.height() as i64);
        let mime = fmt.to_mime_type().to_string();
        let ex = crate::exif::read(&data);
        let sha = format!("{:x}", Sha256::digest(&data));

        let id = {
            let c = app.store.conn();
            c.execute(
                "INSERT INTO images
                 (case_id, uploader_id, filename, bytes, sha256, width, height, mime,
                  exif_json, exif_lat, exif_lng, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                rusqlite::params![
                    case_id, uid, filename, data.len() as i64, sha, w, h, mime,
                    ex.json, ex.lat, ex.lng, now()
                ],
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            c.last_insert_rowid()
        };

        // El original, byte a byte, sin recomprimir ni quitarle el EXIF.
        std::fs::write(dir.join(id.to_string()), &data)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        // Y la miniatura al lado, siempre JPEG: la tira no necesita más.
        let thumb = decoded.thumbnail(THUMB, THUMB);
        let mut buf = std::io::Cursor::new(Vec::new());
        if thumb.to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
            let _ = std::fs::write(dir.join(format!("{id}.thumb")), buf.into_inner());
        }

        let img = app
            .store
            .conn()
            .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [id], row_to_image)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        out.push(img);
    }

    let _ = app.store.conn().execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), pid],
    );
    Ok(Json(out))
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM images WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;
    {
        let c = app.store.conn();
        let _ = c.execute("DELETE FROM analysis_images WHERE image_id = ?1", [id]);
        c.execute("DELETE FROM images WHERE id = ?1", [id])
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    }
    let dir = dir_for(&app, pid);
    let _ = std::fs::remove_file(dir.join(id.to_string()));
    let _ = std::fs::remove_file(dir.join(format!("{id}.thumb")));
    Ok(StatusCode::NO_CONTENT)
}

/// Cuánto llevas ocupado y cuánto te dejan. Lo pinta la pantalla de arranque.
pub async fn my_usage(State(app): State<App>, headers: HeaderMap) -> Result<Json<Usage>, Fail> {
    let (uid, _) =
        require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    Ok(Json(usage(&app, uid)))
}
```

- [ ] **Paso 5: declarar módulos y rutas**

En `crates/lumid/src/main.rs`, la lista de módulos añade `mod exif;` justo después de
`mod limits;`. En `crates/lumid/src/routes/mod.rs`, añadir `pub mod images;`.

Rutas nuevas en `main.rs`:

```rust
        .route(
            "/v1/cases/:id/images",
            get(routes::images::list).post(routes::images::upload),
        )
        .route("/v1/images/:id", axum::routing::delete(routes::images::remove))
        .route("/v1/me/usage", get(routes::images::my_usage))
```

- [ ] **Paso 6: escribir la comprobación ejecutable del conteo**

Al final de `crates/lumid/src/routes/images.rs`:

```rust
#[cfg(test)]
mod tests {
    use crate::limits;
    use crate::projects::used_bytes;
    use crate::store::Store;

    /// Las dos formas silenciosas de romper esto en una refactorización
    /// distraída: contar por proyecto en vez de por quien sube, y leer la
    /// tabla `limits` en vez de preguntar a `effective`.
    #[test]
    fn la_cuota_es_de_quien_sube_y_el_tope_sale_de_effective() {
        let dir = std::env::temp_dir().join(format!("lumi-cuota-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = Store::open(&dir).unwrap();
        s.conn()
            .execute(
                "INSERT INTO images (case_id, uploader_id, filename, bytes, sha256, mime, created_at)
                 VALUES (1, 20, 'a', 100, 'x', 'image/jpeg', 0),
                        (1, 20, 'b', 250, 'y', 'image/jpeg', 0),
                        (1, 10, 'c', 999, 'z', 'image/jpeg', 0)",
                [],
            )
            .unwrap();

        // Mismo caso y mismo proyecto: cada uno carga con lo suyo igualmente.
        assert_eq!(used_bytes(&s, 20), 350);
        assert_eq!(used_bytes(&s, 10), 999);
        assert_eq!(used_bytes(&s, 30), 0);

        // El tope se hereda del global hasta que hay anulación propia, y la
        // interfaz tiene que poder distinguir un caso del otro.
        limits::set(&s, None, "max_storage_gb", &serde_json::json!(20)).unwrap();
        assert_eq!(limits::effective(&s, 20).max_storage_gb, 20);
        assert!(!limits::overrides(&s, 20).contains_key("max_storage_gb"));

        limits::set(&s, Some(20), "max_storage_gb", &serde_json::json!(5)).unwrap();
        assert_eq!(limits::effective(&s, 20).max_storage_gb, 5);
        assert!(limits::overrides(&s, 20).contains_key("max_storage_gb"));
        assert_eq!(limits::effective(&s, 10).max_storage_gb, 20);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
```

- [ ] **Paso 7: ejecutar la comprobación**

```bash
cargo test -p lumid images
```

Esperado: `test routes::images::tests::la_cuota_es_de_quien_sube_y_el_tope_sale_de_effective ... ok`

- [ ] **Paso 8: commit**

```bash
git add crates/lumid/Cargo.toml crates/lumid/src/exif.rs crates/lumid/src/routes/images.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs crates/lumi-proto/src/api.rs Cargo.lock
git commit -m "Subida de imagenes: EXIF leido aparte, original intacto y cuota por quien sube"
```

---

## Tarea 5: Servir las imágenes y sus miniaturas

**Archivos:**
- Modificar: `crates/lumid/src/routes/images.rs` (dos funciones más)
- Modificar: `crates/lumid/src/main.rs` (dos rutas más)

**Interfaces:**
- Consume: `routes::cases::guard_case`, `projects::project_of_image`
- Produce: `routes::images::{serve_full, serve_thumb}`; rutas `GET /v1/images/:id` y
  `GET /v1/images/:id/thumb`, que devuelven **bytes**, no JSON

- [ ] **Paso 1: añadir las dos funciones que sirven bytes**

Al final de `crates/lumid/src/routes/images.rs`, antes del bloque `#[cfg(test)]`:

```rust
/// Devuelve bytes crudos, no JSON. Es la única familia de rutas del daemon que
/// lo hace, y por eso el cliente necesita un canal aparte del puente de texto
/// (ver la tarea del esquema `lumi://`).
async fn serve(
    app: &App,
    headers: &HeaderMap,
    id: i64,
    thumb: bool,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    let (case_id, mime): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, mime FROM images WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe esa imagen"))?;
    let (_, pid, _) = guard_case(app, headers, case_id)?;

    let dir = dir_for(app, pid);
    let (path, ctype) = if thumb {
        (dir.join(format!("{id}.thumb")), "image/jpeg".to_string())
    } else {
        (dir.join(id.to_string()), mime)
    };
    let bytes = std::fs::read(&path).map_err(|_| {
        // Fila sin archivo: es una inconsistencia real, no un 404 del usuario.
        err(StatusCode::INTERNAL_SERVER_ERROR, "el archivo de esa imagen falta en el disco")
    })?;
    // Inmutable de verdad: una imagen nunca se reescribe, solo se borra.
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, ctype),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000, immutable".into()),
        ],
        bytes,
    ))
}

pub async fn serve_full(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    serve(&app, &headers, id, false).await
}

pub async fn serve_thumb(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    serve(&app, &headers, id, true).await
}
```

- [ ] **Paso 2: enganchar las rutas**

En `crates/lumid/src/main.rs`, la ruta de imagen ya declarada pasa a llevar también el `get`,
y se añade la de miniatura:

```rust
        .route(
            "/v1/images/:id",
            get(routes::images::serve_full).delete(routes::images::remove),
        )
        .route("/v1/images/:id/thumb", get(routes::images::serve_thumb))
```

- [ ] **Paso 3: compilar**

```bash
cargo build --workspace
```

Esperado: `Finished` sin errores ni avisos.

- [ ] **Paso 4: commit**

```bash
git add crates/lumid/src/routes/images.rs crates/lumid/src/main.rs
git commit -m "Servir imagenes y miniaturas como bytes, con el mismo guard que el resto"
```

---

## Tarea 6: Análisis

**Archivos:**
- Modificar: `crates/lumi-proto/src/api.rs`
- Crear: `crates/lumid/src/routes/analyses.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `routes::cases::guard_case`, `routes::projects::{err, Fail}`, `limits::effective`
- Produce: tipos `Analysis` y `AnalysisReq` en `lumi_proto::api`;
  `routes::analyses::{list, create, get_one, remove}`

- [ ] **Paso 1: añadir los tipos compartidos**

Al final de `crates/lumi-proto/src/api.rs`:

```rust
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Analysis {
    pub id: i64,
    pub case_id: i64,
    pub model: String,
    /// `pendiente` | `en_curso` | `hecho` | `error`. Este subsistema solo
    /// escribe `pendiente`: mover de ahí es trabajo de la cola (subsistema 4).
    pub state: String,
    pub error: Option<String>,
    pub result_lat: Option<f64>,
    pub result_lng: Option<f64>,
    pub result_radius_m: Option<f64>,
    pub result_confidence: Option<f64>,
    /// Siempre una imagen hoy. La lista existe desde el primer día para que la
    /// cola no haya que rehacerla cuando un análisis agrupe varias tomas.
    pub image_ids: Vec<i64>,
    pub created_at: i64,
    pub finished_at: Option<i64>,
}

#[derive(Serialize, Deserialize)]
pub struct AnalysisReq {
    pub image_ids: Vec<i64>,
    pub model: String,
}
```

- [ ] **Paso 2: escribir las rutas de análisis**

Crear `crates/lumid/src/routes/analyses.rs`:

```rust
//! Análisis. Este subsistema los CREA y no los resuelve: nacen en `pendiente`
//! y ahí se quedan hasta que existan la cola (subsistema 4) y el motor (5).
//!
//! Esa fila con su `state` y su `model` es literalmente el enchufe del
//! subsistema 4: cuando la cola arranque, encontrará trabajo real esperando.

use crate::routes::access::now;
use crate::routes::auth::{bearer, require_session};
use crate::routes::cases::guard_case;
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Analysis, AnalysisReq};

const COLS: &str = "id, case_id, model, state, error, result_lat, result_lng,
                    result_radius_m, result_confidence, created_at, finished_at";

fn image_ids(c: &rusqlite::Connection, analysis_id: i64) -> Vec<i64> {
    let Ok(mut q) = c.prepare("SELECT image_id FROM analysis_images WHERE analysis_id = ?1") else {
        return vec![];
    };
    q.query_map([analysis_id], |r| r.get(0))
        .map(|it| it.flatten().collect())
        .unwrap_or_default()
}

fn row_to_analysis(r: &rusqlite::Row) -> rusqlite::Result<Analysis> {
    Ok(Analysis {
        id: r.get(0)?,
        case_id: r.get(1)?,
        model: r.get(2)?,
        state: r.get(3)?,
        error: r.get(4)?,
        result_lat: r.get(5)?,
        result_lng: r.get(6)?,
        result_radius_m: r.get(7)?,
        result_confidence: r.get(8)?,
        image_ids: vec![],
        created_at: r.get(9)?,
        finished_at: r.get(10)?,
    })
}

pub async fn list(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Vec<Analysis>>, Fail> {
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut q = c
        .prepare(&format!(
            "SELECT {COLS} FROM analyses WHERE case_id = ?1 ORDER BY created_at DESC"
        ))
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    let mut rows: Vec<Analysis> = q
        .query_map([case_id], row_to_analysis)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .flatten()
        .collect();
    for a in &mut rows {
        a.image_ids = image_ids(&c, a.id);
    }
    Ok(Json(rows))
}

pub async fn get_one(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<Json<Analysis>, Fail> {
    let missing = || err(StatusCode::NOT_FOUND, "no existe ese análisis");
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| missing())?;
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let mut a = c
        .query_row(&format!("SELECT {COLS} FROM analyses WHERE id = ?1"), [id], row_to_analysis)
        .map_err(|_| missing())?;
    a.image_ids = image_ids(&c, id);
    Ok(Json(a))
}

pub async fn create(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<AnalysisReq>,
) -> Result<Json<Analysis>, Fail> {
    let (uid, _, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);
    if req.image_ids.is_empty() {
        return Err(err(StatusCode::BAD_REQUEST, "hay que elegir al menos una imagen"));
    }

    // Las imágenes tienen que ser de ESTE caso. Sin esto, conocer un id de
    // imagen ajena bastaría para arrastrarla a un análisis propio.
    {
        let c = app.store.conn();
        for id in &req.image_ids {
            let ok: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM images WHERE id = ?1 AND case_id = ?2",
                    rusqlite::params![id, case_id],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            if ok == 0 {
                return Err(err(StatusCode::BAD_REQUEST, "esa imagen no es de este caso"));
            }
        }
    }

    if !is_admin {
        let l = crate::limits::effective(&app.store, uid);
        if !l.models.contains(&req.model) {
            return Err(err(
                StatusCode::FORBIDDEN,
                &format!("tu cuenta no tiene acceso al modelo {}", req.model),
            ));
        }
        let hoy: i64 = app
            .store
            .conn()
            .query_row(
                "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND created_at > ?2",
                rusqlite::params![uid, now() - 86400],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if hoy >= l.max_daily {
            return Err(err(
                StatusCode::TOO_MANY_REQUESTS,
                &format!("has llegado a tu tope de {} análisis diarios", l.max_daily),
            ));
        }
    }

    let t = now();
    let id = {
        let c = app.store.conn();
        c.execute(
            "INSERT INTO analyses (case_id, requested_by, model, state, created_at)
             VALUES (?1, ?2, ?3, 'pendiente', ?4)",
            rusqlite::params![case_id, uid, req.model, t],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let id = c.last_insert_rowid();
        for img in &req.image_ids {
            c.execute(
                "INSERT INTO analysis_images (analysis_id, image_id) VALUES (?1, ?2)",
                rusqlite::params![id, img],
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        }
        id
    };
    tracing::info!("análisis #{id} en cola (modelo {}), sin motor todavía", req.model);
    Ok(Json(Analysis {
        id,
        case_id,
        model: req.model,
        state: "pendiente".into(),
        error: None,
        result_lat: None,
        result_lng: None,
        result_radius_m: None,
        result_confidence: None,
        image_ids: req.image_ids,
        created_at: t,
        finished_at: None,
    }))
}

pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
    let c = app.store.conn();
    let _ = c.execute("DELETE FROM analysis_images WHERE analysis_id = ?1", [id]);
    c.execute("DELETE FROM analyses WHERE id = ?1", [id])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Paso 3: declarar el módulo y las rutas**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod analyses;` como primera línea (orden
alfabético). En `crates/lumid/src/main.rs`:

```rust
        .route(
            "/v1/cases/:id/analyses",
            get(routes::analyses::list).post(routes::analyses::create),
        )
        .route(
            "/v1/analyses/:id",
            get(routes::analyses::get_one).delete(routes::analyses::remove),
        )
```

- [ ] **Paso 4: compilar**

```bash
cargo build --workspace
```

Esperado: `Finished` sin errores ni avisos.

- [ ] **Paso 5: commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/routes/analyses.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs
git commit -m "Analisis: nacen en pendiente y son el enchufe que encontrara la cola del 4"
```

---

## Tarea 7: Mapa en el daemon — configuración, estilo reescrito y proxy de teselas

**Archivos:**
- Modificar: `crates/lumid/Cargo.toml`
- Modificar: `crates/lumi-proto/src/api.rs`
- Crear: `crates/lumid/src/routes/map.rs`
- Modificar: `crates/lumid/src/routes/mod.rs`, `crates/lumid/src/main.rs`

**Interfaces:**
- Consume: `store::{get_meta, set_meta}`, `routes::auth::{bearer, require_admin, require_session}`
- Produce: tipos `MapConfig` y `MapConfigReq` en `lumi_proto::api`;
  `routes::map::{config, style, tile, patch_admin}`

- [ ] **Paso 1: añadir reqwest al daemon**

En `crates/lumid/Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls-webpki-roots"] }
```

Raíces `webpki` y no las del sistema: el daemon corre en servidores donde el almacén de
certificados puede estar vacío o desactualizado, y el único destino son proveedores de mapas
públicos con cadenas normales.

- [ ] **Paso 2: añadir los tipos compartidos**

Al final de `crates/lumi-proto/src/api.rs`:

```rust
/// Lo que el cliente puede saber del mapa. **Nunca incluye la clave.**
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct MapConfig {
    /// `mapbox` | `osm` | `none`
    pub provider: String,
    pub style_url: String,
    /// `true` si hay clave guardada. El valor no sale de aquí jamás.
    pub has_key: bool,
    /// Por qué el mapa no está disponible, si no lo está. Nada de lienzo en
    /// blanco ni de spinner eterno.
    pub reason: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct MapConfigReq {
    pub provider: String,
    pub style_url: Option<String>,
    /// `None` deja la clave como estaba; `Some("")` la borra.
    pub key: Option<String>,
}
```

- [ ] **Paso 3: escribir el módulo del mapa**

Crear `crates/lumid/src/routes/map.rs`:

```rust
//! El servidor es el único que habla con el proveedor de mapas.
//!
//! Dos motivos, y el primero manda: la clave es una credencial del owner, y si
//! viaja al equipo de cada investigador cualquiera la extrae del tráfico y
//! gasta la cuota ajena. El segundo es que el proveedor ve una IP en vez de
//! una por investigador, así que no puede correlacionar quién mira qué zona.
//!
//! El estilo TAMBIÉN pasa por aquí: un estilo de Mapbox trae dentro las URLs
//! de sus fuentes, y esas URLs llevan la clave. Servirlo crudo filtraría la
//! clave igual que no hacer nada.

use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MapConfig, MapConfigReq};

const OSM_STYLE: &str = "https://tiles.openfreemap.org/styles/liberty";

type Fail = (StatusCode, String);

fn err(c: StatusCode, m: &str) -> Fail {
    (c, m.to_string())
}

fn provider(app: &App) -> String {
    app.store.get_meta("map_provider").unwrap_or_else(|| "none".into())
}

fn style_url(app: &App) -> String {
    app.store.get_meta("map_style").unwrap_or_else(|| match provider(app).as_str() {
        "osm" => OSM_STYLE.to_string(),
        _ => String::new(),
    })
}

/// Cliente HTTP hacia el proveedor. Se construye por llamada: son peticiones
/// esporádicas y un cliente en el estado sería una pieza más que mantener.
/// ponytail: el techo es un mapa muy usado; ahí conviene un cliente compartido
/// en `App`, que es un campo más y ningún cambio de diseño.
fn outbound() -> Result<reqwest::Client, Fail> {
    reqwest::Client::builder()
        .user_agent("lumi-station")
        .build()
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))
}

/// Qué le contamos al cliente. La clave no está aquí ni por asomo.
pub async fn config(State(app): State<App>, headers: HeaderMap) -> Result<Json<MapConfig>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let p = provider(&app);
    let has_key = app.store.get_meta("map_key").is_some_and(|k| !k.is_empty());
    let reason = match p.as_str() {
        "none" | "" => Some(
            "nadie ha configurado todavía el proveedor de mapas; pídeselo a tu administrador".into(),
        ),
        "mapbox" if !has_key => Some(
            "el proveedor es Mapbox pero no hay clave guardada; pídeselo a tu administrador".into(),
        ),
        _ => None,
    };
    Ok(Json(MapConfig { provider: p, style_url: style_url(&app), has_key, reason }))
}

/// Reescribe cada fuente del estilo para que apunte a NUESTRA ruta de teselas.
///
/// Devuelve `Err` si el JSON no tiene la forma esperada. Es deliberado: fallar
/// ruidosamente es la única alternativa aceptable a servir el estilo crudo.
fn rewrite(mut style: serde_json::Value) -> Result<serde_json::Value, String> {
    let sources = style
        .get_mut("sources")
        .and_then(|s| s.as_object_mut())
        .ok_or("el estilo no trae un objeto `sources`")?;
    let mut tocadas = 0;
    for (name, src) in sources.iter_mut() {
        let Some(obj) = src.as_object_mut() else { continue };
        // Fuente con `url`: es un TileJSON que habría que resolver aparte, y
        // ese TileJSON llevaría la clave dentro. No se sirve a medias.
        if obj.contains_key("url") {
            return Err(format!(
                "la fuente `{name}` usa `url` (TileJSON) y este proxy solo sabe reescribir `tiles`"
            ));
        }
        if let Some(tiles) = obj.get_mut("tiles").and_then(|t| t.as_array_mut()) {
            for t in tiles.iter_mut() {
                *t = serde_json::Value::String("/v1/map/tiles/{z}/{x}/{y}".into());
            }
            tocadas += 1;
        }
    }
    if tocadas == 0 {
        return Err("el estilo no tiene ninguna fuente de teselas que reescribir".into());
    }
    // `sprite` y `glyphs` apuntan al proveedor y también llevarían la clave.
    // Se quitan: MapLibre dibuja sin iconos ni etiquetas antes que filtrarla.
    if let Some(o) = style.as_object_mut() {
        o.remove("sprite");
        o.remove("glyphs");
    }
    Ok(style)
}

pub async fn style(State(app): State<App>, headers: HeaderMap) -> Result<Json<serde_json::Value>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let url = style_url(&app);
    if url.is_empty() {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "no hay proveedor de mapas configurado"));
    }
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let full = if provider(&app) == "mapbox" && !key.is_empty() {
        format!("{url}?access_token={key}")
    } else {
        url
    };
    let raw: serde_json::Value = outbound()?
        .get(&full)
        .send()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el proveedor de mapas no respondió: {e}")))?
        .json()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el estilo del proveedor no es JSON: {e}")))?;
    let fixed = rewrite(raw).map_err(|e| {
        err(
            StatusCode::BAD_GATEWAY,
            &format!("no se pudo reescribir el estilo y servirlo crudo filtraría la clave: {e}"),
        )
    })?;
    Ok(Json(fixed))
}

/// Proxy con caché en disco. El caché no caduca: los mapas base cambian de año
/// en año y una tesela vieja cuesta mucho menos que pedirla en cada sesión.
/// Vaciarlo es borrar `{DATA}/tiles`.
pub async fn tile(
    State(app): State<App>,
    Path((z, x, y)): Path<(u32, u32, u32)>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let p = provider(&app);
    let cached = app.dir.join("tiles").join(&p).join(z.to_string()).join(x.to_string());
    let file = cached.join(y.to_string());
    let ctype = |b: &[u8]| {
        // Vectoriales son protobuf comprimido; las rasterizadas, PNG.
        if b.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "application/x-protobuf" }
    };
    if let Ok(b) = std::fs::read(&file) {
        let t = ctype(&b).to_string();
        return Ok((
            [
                (axum::http::header::CONTENT_TYPE, t),
                (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
            ],
            b,
        ));
    }

    let key = app.store.get_meta("map_key").unwrap_or_default();
    let upstream = match p.as_str() {
        "mapbox" => format!(
            "https://api.mapbox.com/v4/mapbox.mapbox-streets-v8/{z}/{x}/{y}.vector.pbf?access_token={key}"
        ),
        "osm" => format!("https://tiles.openfreemap.org/data/planet/{z}/{x}/{y}.pbf"),
        _ => return Err(err(StatusCode::SERVICE_UNAVAILABLE, "no hay proveedor de mapas configurado")),
    };
    let res = outbound()?
        .get(&upstream)
        .send()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el proveedor no respondió: {e}")))?;
    if !res.status().is_success() {
        let code = res.status();
        let cuerpo = res.text().await.unwrap_or_default();
        // El motivo crudo del proveedor, no un código a secas: una clave
        // caducada tiene que poder diagnosticarse desde la interfaz.
        return Err(err(StatusCode::BAD_GATEWAY, &format!("el proveedor devolvió {code}: {cuerpo}")));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?
        .to_vec();
    let _ = std::fs::create_dir_all(&cached);
    let _ = std::fs::write(&file, &bytes);
    let t = ctype(&bytes).to_string();
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, t),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
        ],
        bytes,
    ))
}

/// Provisional en su interfaz, no en su ruta: el subsistema 3 rehace la
/// pantalla y se queda esta API.
pub async fn patch_admin(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<MapConfigReq>,
) -> Result<Json<MapConfig>, Fail> {
    require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if !["mapbox", "osm", "none"].contains(&req.provider.as_str()) {
        return Err(err(StatusCode::BAD_REQUEST, "el proveedor tiene que ser mapbox, osm o none"));
    }
    let fail = |e: anyhow::Error| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    app.store.set_meta("map_provider", &req.provider).map_err(fail)?;
    let style = req.style_url.unwrap_or_default();
    let style = if style.trim().is_empty() && req.provider == "osm" { OSM_STYLE.into() } else { style };
    app.store.set_meta("map_style", style.trim()).map_err(fail)?;
    // `None` no toca la clave: así se puede cambiar de estilo sin volver a
    // teclearla, que es justo lo que no se puede hacer si se leyera del campo
    // enmascarado de la pantalla.
    if let Some(k) = req.key {
        app.store.set_meta("map_key", k.trim()).map_err(fail)?;
    }
    tracing::info!("proveedor de mapas: {}", req.provider);
    config(State(app), headers).await
}
```

- [ ] **Paso 4: declarar el módulo y las rutas**

En `crates/lumid/src/routes/mod.rs`, añadir `pub mod map;` en orden alfabético. En
`crates/lumid/src/main.rs`:

```rust
        .route("/v1/map/config", get(routes::map::config))
        .route("/v1/map/style", get(routes::map::style))
        .route("/v1/map/tiles/:z/:x/:y", get(routes::map::tile))
        .route("/v1/admin/map", axum::routing::patch(routes::map::patch_admin))
```

- [ ] **Paso 5: compilar**

```bash
cargo build --workspace
```

Esperado: `Finished` sin errores ni avisos.

- [ ] **Paso 6: commit**

```bash
git add crates/lumid/Cargo.toml crates/lumi-proto/src/api.rs crates/lumid/src/routes/map.rs crates/lumid/src/routes/mod.rs crates/lumid/src/main.rs Cargo.lock
git commit -m "Mapa: proxy de teselas con cache y estilo reescrito para que la clave no baje al cliente"
```

---

## Tarea 8: Puente del cliente — esquema `lumi://`, token y subida por ruta

**Archivos:**
- Modificar: `client/src-tauri/Cargo.toml`
- Modificar: `client/src-tauri/src/main.rs`
- Modificar: `client/package.json`
- Crear: `client/src/lib/bridge.ts`

**Interfaces:**
- Consume: el `Shared` (base + cliente TLS anclado) que ya existe
- Produce: esquema URI `lumi`, comandos `set_auth(token)` y `upload_images(case_id, paths)`;
  en TS, `lumiUrl(path)`, `setAuth(token)`, `pickAndUpload(caseId)`, `uploadPaths(caseId, paths)`

**Por qué hace falta esto.** El puente actual, `invoke("request")`, devuelve `String`: sirve
para JSON y para nada más. Las imágenes, las miniaturas y las teselas son binarios, y además
el webview **no puede** hablar con el daemon por su cuenta — el certificado es autofirmado y
el anclaje por huella vive en Rust. Un esquema URI propio resuelve las dos cosas de golpe:
`<img src="lumi://.../v1/images/7/thumb">` y las fuentes de MapLibre salen por el mismo
cliente TLS anclado sin que el webview se entere.

- [ ] **Paso 1: añadir el plugin de diálogo**

En `client/src-tauri/Cargo.toml`, bajo `[dependencies]`:

```toml
tauri-plugin-dialog = "2"
```

En `client/package.json`, bajo `dependencies`:

```json
    "@tauri-apps/plugin-dialog": "^2",
    "maplibre-gl": "^4.7.1",
```

Y después:

```bash
cd client && npm install
```

- [ ] **Paso 2: guardar el token en el puente**

En `client/src-tauri/src/main.rs`, la estructura `Conn` gana un campo y aparece un comando:

```rust
#[derive(Default)]
struct Conn {
    base: Option<String>,
    client: Option<reqwest::Client>,
    /// El token de sesión vive aquí y no en las URLs del esquema `lumi://`:
    /// es un secreto, y las rutas acaban en logs y trazas de error.
    token: Option<String>,
}
```

```rust
/// Lo llama el lado TS cada vez que cambia la sesión. Sin esto, el esquema
/// `lumi://` no tendría con qué autenticarse contra el daemon.
#[tauri::command]
fn set_auth(token: Option<String>, state: tauri::State<'_, Shared>) {
    state.lock().unwrap().token = token;
}
```

- [ ] **Paso 3: registrar el esquema `lumi://`**

En el mismo archivo, la función `main` pasa a:

```rust
fn main() {
    rustls::crypto::ring::default_provider().install_default().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(Shared::default())
        // Bytes del daemon al webview sin que el webview vea el certificado.
        // En Windows el webview lo pide como http://lumi.localhost/<ruta>; en
        // el resto, como lumi://localhost/<ruta>. En los dos casos llega aquí.
        .register_asynchronous_uri_scheme_protocol("lumi", |ctx, request, responder| {
            use tauri::Manager;
            let state = ctx.app_handle().state::<Shared>();
            let (base, client, token) = {
                let c = state.lock().unwrap();
                (c.base.clone(), c.client.clone(), c.token.clone())
            };
            let path = request.uri().path().to_string();
            tauri::async_runtime::spawn(async move {
                let fallo = |code: u16, msg: &str| {
                    http::Response::builder()
                        .status(code)
                        .header("content-type", "text/plain; charset=utf-8")
                        .body(msg.as_bytes().to_vec())
                        .unwrap()
                };
                let (Some(base), Some(client)) = (base, client) else {
                    responder.respond(fallo(503, "sin servidor vinculado"));
                    return;
                };
                let mut rb = client.get(format!("{base}{path}"));
                if let Some(t) = token {
                    rb = rb.bearer_auth(t);
                }
                match rb.send().await {
                    Ok(res) => {
                        let status = res.status().as_u16();
                        let ctype = res
                            .headers()
                            .get("content-type")
                            .and_then(|v| v.to_str().ok())
                            .unwrap_or("application/octet-stream")
                            .to_string();
                        let body = res.bytes().await.unwrap_or_default().to_vec();
                        responder.respond(
                            http::Response::builder()
                                .status(status)
                                .header("content-type", ctype)
                                // El webview de un esquema propio tiene otro
                                // origen que la app: sin esto, MapLibre no
                                // puede leer las teselas.
                                .header("access-control-allow-origin", "*")
                                .body(body)
                                .unwrap(),
                        );
                    }
                    Err(e) => responder.respond(fallo(502, &e.to_string())),
                }
            });
        })
        .invoke_handler(tauri::generate_handler![
            pair, pair_card, reconnect, request, start_telemetry, start_task_log,
            set_auth, upload_images
        ])
        .run(tauri::generate_context!())
        .expect("error al arrancar Tauri");
}
```

Y arriba del archivo, junto a los demás `use`:

```rust
use tauri::UriSchemeContext as _;
```

Si el compilador se queja de que ese `use` sobra, quítalo: solo hace falta si tu versión de
Tauri expone `app_handle()` por rasgo en vez de por método inherente.

- [ ] **Paso 4: subir imágenes por ruta de archivo**

En `client/src-tauri/src/main.rs`:

```rust
/// Sube por RUTA, no por bytes: el archivo lo lee Rust y va directo al daemon
/// como multipart. Mandar 30 MB por el canal de IPC de Tauri costaría
/// serializarlos a JSON por el camino.
#[tauri::command]
async fn upload_images(
    case_id: i64, paths: Vec<String>, state: tauri::State<'_, Shared>,
) -> Result<String, String> {
    let (base, client, token) = {
        let c = state.lock().unwrap();
        (
            c.base.clone().ok_or("sin servidor vinculado")?,
            c.client.clone().ok_or("sin cliente")?,
            c.token.clone().ok_or("sin sesión")?,
        )
    };
    let mut form = reqwest::multipart::Form::new();
    for p in &paths {
        let bytes = std::fs::read(p).map_err(|e| format!("{p}: {e}"))?;
        let name = std::path::Path::new(p)
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "sin-nombre".into());
        form = form.part(
            "file",
            reqwest::multipart::Part::bytes(bytes).file_name(name),
        );
    }
    let res = client
        .post(format!("{base}/v1/cases/{case_id}/images"))
        .bearer_auth(token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    let status = res.status();
    let text = res.text().await.unwrap_or_default();
    if status.is_success() { Ok(text) } else { Err(text) }
}
```

Y añadir `reqwest`'s feature de multipart en `client/src-tauri/Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls-manual-roots", "stream", "multipart"] }
```

- [ ] **Paso 5: el lado TS del puente**

Crear `client/src/lib/bridge.ts`:

```ts
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { Image } from "./api";

/** Windows y Android sirven los esquemas propios como `http://<esquema>.localhost`;
 *  el resto, como `<esquema>://localhost`. No se usa `convertFileSrc` porque
 *  codifica las barras de la ruta y aquí la ruta es una ruta de verdad. */
const LUMI_BASE = navigator.userAgent.includes("Windows")
  ? "http://lumi.localhost"
  : "lumi://localhost";

/** URL que el webview puede cargar directamente: sale por el cliente TLS
 *  anclado sin que el webview vea el certificado autofirmado. */
export const lumiUrl = (path: string) => `${LUMI_BASE}${path}`;

/** El esquema `lumi://` necesita el token para autenticarse, y el token no
 *  puede ir en la URL. Se llama en cada cambio de sesión. */
export const setAuth = (token: string | null) => invoke("set_auth", { token });

export async function uploadPaths(caseId: number, paths: string[]): Promise<Image[]> {
  if (paths.length === 0) return [];
  const raw = await invoke<string>("upload_images", { caseId, paths });
  return JSON.parse(raw) as Image[];
}

/** Selector de archivos del sistema. Devuelve rutas, nunca bytes. */
export async function pickAndUpload(caseId: number): Promise<Image[]> {
  const sel = await open({
    multiple: true,
    filters: [{ name: "Imágenes", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (!sel) return [];
  return uploadPaths(caseId, Array.isArray(sel) ? sel : [sel]);
}
```

- [ ] **Paso 6: llamar a `setAuth` allí donde cambia la sesión**

Tres sitios, todos los que ya llaman a `setToken`:

- `client/src/entry/LoginForm.tsx`, tras `useServer.getState().setToken(res.token);`
- `client/src/wizard/AdminStep.tsx`, tras su propio `setToken`
- `client/src/App.tsx`, en el efecto de reanudación tras `setToken(session.token)`, y en la
  expulsión por desconexión tras `setToken(null)`

En cada uno, añadir la importación `import { setAuth } from "../lib/bridge";` (en `App.tsx`,
`"./lib/bridge"`) y la llamada `setAuth(res.token)` / `setAuth(session.token)` /
`setAuth(null)` justo después.

- [ ] **Paso 7: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores y `vite build` produciendo `dist/`.

```bash
cd client/src-tauri && cargo build
```

Esperado: `Finished` sin errores.

- [ ] **Paso 8: commit**

```bash
git add client/src-tauri/Cargo.toml client/src-tauri/src/main.rs client/package.json client/package-lock.json client/src/lib/bridge.ts client/src/entry/LoginForm.tsx client/src/wizard/AdminStep.tsx client/src/App.tsx
git commit -m "Puente de binarios: esquema lumi:// para imagenes y teselas, subida por ruta"
```

---

## Tarea 9: Tipos del cliente y estado del espacio de trabajo

**Archivos:**
- Modificar: `client/src/lib/api.ts`
- Crear: `client/src/lib/workspace.ts`

**Interfaces:**
- Consume: `api.get/post/patch/del`, `lumiUrl`
- Produce: tipos `Project`, `ProjectMember`, `Case`, `Image`, `Analysis`, `Usage`, `MapConfig`;
  store `useWorkspace` con `{ project, case_, setProject, setCase, clear }`

- [ ] **Paso 1: añadir los tipos al cliente**

Al final de `client/src/lib/api.ts`, antes de `const call = ...`:

```ts
export interface Project {
  id: number; name: string; role: "owner" | "member";
  cases: number; images: number; bytes: number;
  created_at: number; updated_at: number;
}
export interface ProjectMember {
  user_id: number; username: string; role: "owner" | "member"; added_at: number;
}
export interface Case {
  id: number; project_id: number; name: string;
  images: number; analyses: number; resolved: number;
  lat: number | null; lng: number | null; created_at: number;
}
export interface Image {
  id: number; case_id: number; filename: string; bytes: number;
  width: number | null; height: number | null; mime: string;
  /** GPS DECLARADO por la cámara. Nunca se mezcla con el inferido. */
  exif_lat: number | null; exif_lng: number | null;
  exif: Record<string, string> | null;
  created_at: number;
}
export interface Analysis {
  id: number; case_id: number; model: string;
  state: "pendiente" | "en_curso" | "hecho" | "error";
  error: string | null;
  result_lat: number | null; result_lng: number | null;
  result_radius_m: number | null; result_confidence: number | null;
  image_ids: number[]; created_at: number; finished_at: number | null;
}
export interface Usage { used_bytes: number; limit_gb: number; overridden: boolean }
export interface MapConfig {
  provider: "mapbox" | "osm" | "none"; style_url: string;
  has_key: boolean; reason: string | null;
}
```

- [ ] **Paso 2: escribir el store del espacio de trabajo**

Crear `client/src/lib/workspace.ts`:

```ts
import { create } from "zustand";
import type { Case, Project } from "./api";

/** Proyecto y caso abiertos. Vive aparte de `useServer` a propósito: aquello
 *  es la conexión con el servidor y sobrevive al cierre de sesión; esto es
 *  dónde estás trabajando y muere con ella. */
interface Workspace {
  project: Project | null;
  case_: Case | null;
  setProject: (p: Project | null) => void;
  setCase: (c: Case | null) => void;
  clear: () => void;
}

export const useWorkspace = create<Workspace>((set) => ({
  project: null,
  case_: null,
  // Cambiar de proyecto cierra el caso: un caso pertenece a un proyecto y
  // dejarlo abierto al saltar sería enseñar datos del proyecto anterior.
  setProject: (project) => set({ project, case_: null }),
  setCase: (case_) => set({ case_ }),
  clear: () => set({ project: null, case_: null }),
}));
```

- [ ] **Paso 3: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 4: commit**

```bash
git add client/src/lib/api.ts client/src/lib/workspace.ts
git commit -m "Tipos de proyecto, caso, imagen y analisis, y el store del espacio de trabajo"
```

---

## Tarea 10: El mapa como componente compartido

**Archivos:**
- Crear: `client/src/work/MapCanvas.tsx`

**Interfaces:**
- Consume: `api.get<MapConfig>("/v1/map/config")`, `lumiUrl`, `maplibre-gl`
- Produce: `<MapCanvas markers={Marker[]} onMarker={(id) => void} flyTo={…} />`
  y el tipo `Marker = { id: string; lat: number; lng: number; label: string;
  kind: "top" | "alt" | "exif" | "off"; radiusM?: number }`

El mismo componente lo usan la vista de proyecto y la de caso. Al entrar en un caso **no se
monta un mapa nuevo**: se le pasan otros marcadores y otro destino de vuelo. Montar y
desmontar MapLibre en cada navegación tira la caché de teselas del cliente y hace parpadear
la pantalla.

- [ ] **Paso 1: escribir el componente**

Crear `client/src/work/MapCanvas.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { api, type MapConfig } from "../lib/api";
import { lumiUrl } from "../lib/bridge";

export interface Marker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  /** `top` el principal, `alt` otro resultado, `exif` el GPS declarado por la
   *  cámara, `off` un análisis sin resolver todavía. */
  kind: "top" | "alt" | "exif" | "off";
  radiusM?: number;
}

const COLOR = {
  top: { bg: "#f2f3f5", fg: "#000", border: "#f2f3f5" },
  alt: { bg: "#101215", fg: "#e8e8e6", border: "rgba(255,255,255,.22)" },
  exif: { bg: "#101215", fg: "#efb968", border: "#efb968" },
  off: { bg: "#101215", fg: "#6a6c70", border: "#3a3e44" },
} as const;

/** Anillo de 64 puntos que aproxima un círculo de `radiusM` metros. La
 *  corrección por coseno de la latitud es lo que evita que salga un óvalo
 *  cuanto más al norte estés. */
function ring(lat: number, lng: number, radiusM: number): [number, number][] {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: 65 }, (_, i) => {
    const t = (i / 64) * 2 * Math.PI;
    return [lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)] as [number, number];
  });
}

function el(m: Marker): HTMLElement {
  const c = COLOR[m.kind];
  const d = document.createElement("div");
  d.textContent = m.label;
  d.title = m.kind === "exif" ? "GPS declarado por la cámara" : m.label;
  d.style.cssText = `width:22px;height:22px;border-radius:50%;display:flex;
    align-items:center;justify-content:center;font-size:11px;cursor:pointer;
    background:${c.bg};color:${c.fg};border:1px solid ${c.border};
    ${m.kind === "off" ? "border-style:dashed;" : ""}`;
  return d;
}

export function MapCanvas({
  markers, onMarker, flyTo,
}: {
  markers: Marker[];
  onMarker?: (id: string) => void;
  flyTo?: { lat: number; lng: number; zoom: number } | null;
}) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const placed = useRef<maplibregl.Marker[]>([]);
  const [reason, setReason] = useState<string | null>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      const cfg = await api.get<MapConfig>("/v1/map/config").catch((e) => {
        setReason(String(e));
        return null;
      });
      if (dead || !box.current) return;
      if (!cfg) return;
      // Nada de lienzo en blanco ni de spinner eterno: si no hay proveedor,
      // se dice quién tiene que arreglarlo.
      if (cfg.reason) { setReason(cfg.reason); return; }
      setReason(null);
      const m = new maplibregl.Map({
        container: box.current,
        // El estilo lo sirve el daemon con las fuentes ya reescritas hacia su
        // proxy; aquí solo se le antepone el esquema que el webview entiende.
        style: lumiUrl("/v1/map/style"),
        transformRequest: (url) =>
          url.startsWith("/v1/") ? { url: lumiUrl(url) } : { url },
        center: [0, 20],
        zoom: 1.4,
        attributionControl: { compact: true },
      });
      map.current = m;
    })();
    return () => {
      dead = true;
      map.current?.remove();
      map.current = null;
    };
  }, []);

  // Los círculos de confianza van como polígono geográfico y no como
  // `circle-radius` en píxeles: el radio está en metros y tiene que seguir
  // siendo los mismos metros al hacer zoom, que es justo lo que un radio en
  // píxeles no hace.
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const draw = () => {
      const data = {
        type: "FeatureCollection" as const,
        features: markers
          .filter((mk) => mk.radiusM && mk.radiusM > 0)
          .map((mk) => ({
            type: "Feature" as const,
            properties: {},
            geometry: { type: "Polygon" as const, coordinates: [ring(mk.lat, mk.lng, mk.radiusM!)] },
          })),
      };
      const src = m.getSource("conf") as maplibregl.GeoJSONSource | undefined;
      if (src) { src.setData(data); return; }
      m.addSource("conf", { type: "geojson", data });
      m.addLayer({
        id: "conf-fill", type: "fill", source: "conf",
        paint: { "fill-color": "#ffffff", "fill-opacity": 0.055 },
      });
      m.addLayer({
        id: "conf-line", type: "line", source: "conf",
        paint: { "line-color": "#ffffff", "line-opacity": 0.5, "line-width": 1 },
      });
    };
    if (m.isStyleLoaded()) draw();
    else m.once("load", draw);
  }, [markers]);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    placed.current.forEach((p) => p.remove());
    placed.current = markers.map((mk) => {
      const marker = new maplibregl.Marker({ element: el(mk) })
        .setLngLat([mk.lng, mk.lat])
        .addTo(m);
      if (onMarker) marker.getElement().addEventListener("click", () => onMarker(mk.id));
      return marker;
    });
  }, [markers, onMarker]);

  useEffect(() => {
    if (flyTo && map.current) {
      map.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: flyTo.zoom, duration: 1400 });
    }
  }, [flyTo]);

  if (reason) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-surface px-10 text-center">
        <p className="max-w-sm text-xs leading-relaxed text-muted">{reason}</p>
      </div>
    );
  }
  return <div ref={box} className="absolute inset-0" />;
}
```

- [ ] **Paso 2: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 3: commit**

```bash
git add client/src/work/MapCanvas.tsx
git commit -m "MapCanvas: MapLibre sobre el proxy del daemon, con el motivo real si no hay mapa"
```

---

## Tarea 11: Selector de proyecto (la pantalla de arranque)

**Archivos:**
- Crear: `client/src/work/ProjectPicker.tsx`

**Interfaces:**
- Consume: `api`, `useWorkspace`, tipos `Project` y `Usage`
- Produce: `<ProjectPicker onOpen={(p: Project) => void} />`

Es la jerarquía de Burp: el proyecto se elige **antes** de entrar. El mapa mundo desenfocado
detrás y sin carril de iconos, porque todavía no hay nada que navegar.

- [ ] **Paso 1: escribir la pantalla**

Crear `client/src/work/ProjectPicker.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type Project, type Usage } from "../lib/api";
import { useServer } from "../lib/store";
import { Icon } from "../ui/Icon";

const GB = 1024 * 1024 * 1024;

function size(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < GB) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${(bytes / GB).toFixed(1)} GB`;
}

function ago(ts: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - ts);
  if (s < 3600) return `hace ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  return `hace ${Math.floor(s / 86400)} d`;
}

export function ProjectPicker({ onOpen }: { onOpen: (p: Project) => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [list, setList] = useState<Project[] | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [p, u] = await Promise.all([
        api.get<Project[]>("/v1/projects", token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setList(p);
      setUsage(u);
      setSel((s) => s ?? p[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, []);

  async function create() {
    if (!name.trim()) return;
    setError(null);
    try {
      const p = await api.post<Project>("/v1/projects", { name }, token);
      setName("");
      setCreating(false);
      onOpen(p);
    } catch (e) {
      setError(String(e));
    }
  }

  const open = () => {
    const p = list?.find((x) => x.id === sel);
    if (p) onOpen(p);
  };

  return (
    <div className="w-[420px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.86)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
      <p className="text-[13px] text-fg">Elige un proyecto</p>
      <p className="mb-3.5 text-[11px] text-muted">
        cada proyecto tiene sus casos y sus imágenes, separados del resto
      </p>

      {list === null ? (
        <p className="py-6 text-center text-[11px] text-subtle">cargando</p>
      ) : (
        <div className="max-h-[46vh] space-y-2 overflow-y-auto">
          {list.map((p) => (
            <button key={p.id} onClick={() => setSel(p.id)} onDoubleClick={() => onOpen(p)}
              className={`block w-full rounded-lg border p-2.5 text-left transition-colors duration-300 ease-expo ${
                sel === p.id ? "border-white/25 bg-white/[.05]" : "border-border hover:border-white/15"
              }`}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate text-[12.5px] text-fg">{p.name}</span>
                <span className="shrink-0 font-mono text-[10px] text-subtle">{ago(p.updated_at)}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted">
                {p.cases} casos · {p.images} imágenes · {size(p.bytes)}
                {p.role === "member" && " · invitado"}
              </div>
            </button>
          ))}

          {creating ? (
            <div className="rounded-lg border border-dashed border-border p-2.5">
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
                placeholder="nombre del proyecto"
                className="w-full bg-transparent text-[12.5px] text-fg outline-none placeholder:text-subtle" />
            </div>
          ) : (
            <button onClick={() => setCreating(true)}
              className="block w-full rounded-lg border border-dashed border-border p-2.5 text-center text-[11px] text-subtle hover:text-fg">
              + nuevo proyecto
            </button>
          )}
        </div>
      )}

      {error && (
        <div className="mt-3 flex items-start gap-2.5 text-xs">
          <Icon name="alert" className="mt-0.5 text-danger-fg" />
          <span className="text-muted">{error}</span>
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-4">
        {/* El origen del límite se dice siempre: uno sin origen visible es
            indepurable cuando alguien pregunta por qué no le caben más. */}
        <span className="font-mono text-[10px] text-subtle">
          {usage
            ? `${size(usage.used_bytes)} de ${usage.limit_gb} GB · ${usage.overridden ? "límite propio" : "heredado del global"}`
            : ""}
        </span>
        <button onClick={creating ? create : open} disabled={!creating && sel === null}
          className="shrink-0 rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {creating ? "Crear" : "Abrir"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 3: commit**

```bash
git add client/src/work/ProjectPicker.tsx
git commit -m "Selector de proyecto: se elige antes de entrar, con las dos cuotas a la vista"
```

---

## Tarea 12: Carril de iconos y vista de proyecto

**Archivos:**
- Crear: `client/src/work/Rail.tsx`
- Crear: `client/src/work/ProjectView.tsx`

**Interfaces:**
- Consume: `MapCanvas`, `api`, `useWorkspace`
- Produce: `<Rail active onProjects onMembers />`, `<ProjectView onOpenCase={(c: Case) => void}
  onLeaveProject={() => void} />`

- [ ] **Paso 1: escribir el carril**

Crear `client/src/work/Rail.tsx`:

```tsx
import { Icon } from "../ui/Icon";

/** 40 px, iconos sin etiqueta, translúcido sobre el mapa. Es el carril de la
 *  v1: la navegación no ocupa sitio porque el mapa es el trabajo. */
export function Rail({
  onProjects, onMembers, canManage,
}: { onProjects: () => void; onMembers: () => void; canManage: boolean }) {
  const btn = "text-subtle transition-colors duration-300 ease-expo hover:text-fg";
  return (
    <nav className="absolute inset-y-0 left-0 z-30 flex w-10 flex-col items-center gap-4 border-r border-border bg-[rgba(13,15,17,.86)] py-3 backdrop-blur">
      <span className="text-fg"><Icon name="logo" size={15} /></span>
      <button onClick={onProjects} title="Proyectos" className={btn}>
        <Icon name="layers" size={15} />
      </button>
      {canManage && (
        <button onClick={onMembers} title="Miembros del proyecto" className={btn}>
          <Icon name="users" size={15} />
        </button>
      )}
      <div className="flex-1" />
    </nav>
  );
}
```

Esto necesita tres iconos nuevos. `client/src/ui/Icon.tsx` guarda **elementos JSX**, no
cadenas de ruta: se añaden tres entradas al objeto `PATHS` que ya existe, sin tocar el
`viewBox` ni el `strokeWidth` que el componente aplica por su cuenta.

```tsx
  logo: <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />,
  layers: (
    <>
      <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
      <path d="M3 12l9 4.5 9-4.5" />
      <path d="M3 17l9 4.5 9-4.5" />
    </>
  ),
  users: (
    <>
      <path d="M16 20v-1.5a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4V20" />
      <circle cx="9" cy="7" r="3.5" />
      <path d="M22 20v-1.5a4 4 0 0 0-3-3.87M16 3.6a4 4 0 0 1 0 7.75" />
    </>
  ),
```

- [ ] **Paso 2: escribir la vista de proyecto**

Crear `client/src/work/ProjectView.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { api, type Case, type Project, type Usage } from "../lib/api";
import { useServer } from "../lib/store";
import { MapCanvas, type Marker } from "./MapCanvas";

const GB = 1024 * 1024 * 1024;
const size = (b: number) =>
  b < GB ? `${Math.round(b / 1024 / 1024)} MB` : `${(b / GB).toFixed(1)} GB`;

export function ProjectView({
  project, onOpenCase, rail,
}: { project: Project; onOpenCase: (c: Case) => void; rail: React.ReactNode }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [cases, setCases] = useState<Case[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const [k, u] = await Promise.all([
        api.get<Case[]>(`/v1/projects/${project.id}/cases`, token),
        api.get<Usage>("/v1/me/usage", token),
      ]);
      setCases(k);
      setUsage(u);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [project.id]);

  async function create() {
    if (!name.trim()) return;
    try {
      const c = await api.post<Case>(`/v1/projects/${project.id}/cases`, { name }, token);
      setName("");
      setCreating(false);
      setCases((v) => [...v, c]);
    } catch (e) {
      setError(String(e));
    }
  }

  // Un marcador por caso resuelto. Es la lectura que la v1 no daba: la
  // investigación entera repartida geográficamente.
  const markers: Marker[] = useMemo(
    () =>
      cases
        .filter((c) => c.lat !== null && c.lng !== null)
        .map((c, i) => ({
          id: String(c.id), lat: c.lat!, lng: c.lng!, label: String(i + 1),
          kind: i === 0 ? ("top" as const) : ("alt" as const),
        })),
    [cases],
  );

  const pending = cases.reduce((n, c) => n + (c.analyses - c.resolved), 0);
  const projectBytes = project.bytes;

  return (
    <div className="relative h-full w-full">
      <MapCanvas markers={markers} onMarker={(id) => {
        const c = cases.find((x) => String(x.id) === id);
        if (c) onOpenCase(c);
      }} />
      {rail}

      <aside className="absolute inset-y-0 left-10 z-20 w-[236px] overflow-y-auto border-r border-border bg-[rgba(16,18,21,.94)] p-3 backdrop-blur-xl">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="truncate text-[13px] text-fg">{project.name}</span>
          <span className="shrink-0 text-[8px] uppercase tracking-[.11em] text-subtle">
            {cases.length} casos
          </span>
        </div>

        {cases.map((c, i) => (
          <button key={c.id} onClick={() => onOpenCase(c)}
            className="mb-1.5 block w-full rounded-lg border border-border p-2 text-left transition-colors duration-300 ease-expo hover:border-white/20">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-[11.5px] text-fg">{c.name}</span>
              {c.resolved > 0 && (
                <span className="rounded border border-border px-1 text-[8.5px] text-subtle">resuelto</span>
              )}
            </div>
            <div className="mt-1 font-mono text-[10px] text-muted">
              {c.images} imágenes ·{" "}
              {c.analyses === 0
                ? "sin análisis"
                : c.resolved === c.analyses
                  ? `${c.analyses} análisis`
                  : `${c.analyses - c.resolved} esperando al motor`}
            </div>
          </button>
        ))}

        {creating ? (
          <div className="rounded-lg border border-dashed border-border p-2">
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void create(); if (e.key === "Escape") setCreating(false); }}
              placeholder="nombre del caso"
              className="w-full bg-transparent text-[11.5px] text-fg outline-none placeholder:text-subtle" />
          </div>
        ) : (
          <button onClick={() => setCreating(true)}
            className="block w-full rounded-lg border border-dashed border-border p-2 text-center text-[11px] text-subtle hover:text-fg">
            + nuevo caso
          </button>
        )}

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-3.5">
          <p className="text-[8px] uppercase tracking-[.11em] text-subtle">
            Almacenamiento del proyecto
          </p>
          <div className="mt-1.5 h-0.5 rounded bg-elevated">
            <div className="h-full rounded bg-fg"
              style={{ width: usage ? `${Math.min(100, (projectBytes / (usage.limit_gb * GB)) * 100)}%` : "0%" }} />
          </div>
          <p className="mt-1 font-mono text-[10px] text-subtle">
            {size(projectBytes)}
            {usage && ` · ${size(usage.used_bytes)} de ${usage.limit_gb} GB en total`}
          </p>
        </div>
      </aside>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between bg-gradient-to-t from-[rgba(10,11,13,.92)] to-transparent px-4 py-2.5 pl-[286px]">
        <div className="flex items-end">
          <Field k="Proyecto" v={project.name} />
          <Field k="Casos resueltos" v={`${cases.filter((c) => c.resolved > 0).length} de ${cases.length}`} />
          {pending > 0 && <Field k="Pendientes" v={`${pending} · sin motor`} dim />}
        </div>
      </div>
    </div>
  );
}

function Field({ k, v, dim }: { k: string; v: string; dim?: boolean }) {
  return (
    <div className="mr-6">
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`text-[11.5px] ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
```

- [ ] **Paso 3: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 4: commit**

```bash
git add client/src/work/Rail.tsx client/src/work/ProjectView.tsx client/src/ui/Icon.tsx
git commit -m "Vista de proyecto: cajon de casos sobre el mapa, con un marcador por caso resuelto"
```

---

## Tarea 13: Vista de caso — la pantalla heredada de la v1

**Archivos:**
- Crear: `client/src/work/Filmstrip.tsx`
- Crear: `client/src/work/ResultCard.tsx`
- Crear: `client/src/work/SummaryBar.tsx`
- Crear: `client/src/work/CaseView.tsx`

**Interfaces:**
- Consume: `MapCanvas` + `Marker`, `lumiUrl`, `pickAndUpload`, `uploadPaths`, `api`
- Produce: `<CaseView project case_ rail onBack />`

Es la captura de la v1: tarjeta de resultado centrada arriba con su anillo y su enlace de
acción, tira de miniaturas flotante abajo a la izquierda, lista de análisis a la derecha con
la imagen de consulta arriba, y barra inferior con *Identificado · Coordenadas · Radio de
búsqueda* y el porcentaje grande a la derecha.

- [ ] **Paso 1: la tira de miniaturas**

Crear `client/src/work/Filmstrip.tsx`:

```tsx
import type { Image } from "../lib/api";
import { lumiUrl } from "../lib/bridge";

export function Filmstrip({
  images, selected, onSelect, onAdd,
}: {
  images: Image[];
  selected: number | null;
  onSelect: (id: number) => void;
  onAdd: () => void;
}) {
  return (
    <div className="absolute bottom-[46px] left-[50px] z-20 flex gap-1.5 rounded-card border border-white/10 bg-[rgba(24,26,30,.93)] p-1.5 shadow-lg shadow-black/40 backdrop-blur">
      {images.map((im) => (
        <button key={im.id} onClick={() => onSelect(im.id)} title={im.filename}
          className={`h-[30px] w-[40px] overflow-hidden rounded border transition-colors duration-300 ease-expo ${
            selected === im.id ? "border-fg" : "border-white/10 hover:border-white/25"
          }`}>
          <img src={lumiUrl(`/v1/images/${im.id}/thumb`)} alt="" className="h-full w-full object-cover" />
        </button>
      ))}
      <button onClick={onAdd} title="Añadir imágenes"
        className="h-[30px] w-[40px] rounded border border-dashed border-white/15 text-[13px] leading-none text-subtle hover:text-fg">
        +
      </button>
    </div>
  );
}
```

- [ ] **Paso 2: la tarjeta de resultado**

Crear `client/src/work/ResultCard.tsx`:

```tsx
import type { Analysis, Image } from "../lib/api";

/** Metros entre dos coordenadas. Haversine con el radio medio de la Tierra:
 *  la precisión de sobra para decir "el EXIF declara un GPS a 300 m de aquí". */
export function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function Ring({ pct }: { pct: number }) {
  const r = 6.5;
  const c = 2 * Math.PI * r;
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="shrink-0">
      <circle cx="12" cy="12" r={r * (24 / 15)} stroke="#33373d" strokeWidth="1.8" />
      <circle cx="12" cy="12" r={r * (24 / 15)} stroke="currentColor" strokeWidth="1.8"
        strokeLinecap="round" transform="rotate(-90 12 12)"
        strokeDasharray={`${(c * pct) / 100} ${c}`} pathLength={c} />
    </svg>
  );
}

export function ResultCard({ analysis, image }: { analysis: Analysis | null; image: Image | null }) {
  if (!analysis) return null;

  if (analysis.state !== "hecho") {
    const texto =
      analysis.state === "error"
        ? analysis.error ?? "el análisis falló y no dejó motivo"
        : "esperando al motor de inferencia";
    return (
      <div className="absolute left-1/2 top-12 z-20 w-[268px] -translate-x-1/2 rounded-card border border-white/[.07] bg-[rgba(24,26,30,.93)] p-3.5 shadow-lg shadow-black/40 backdrop-blur">
        <p className="text-[13px] text-fg">
          {analysis.state === "error" ? "El análisis falló" : "Análisis en cola"}
        </p>
        <p className={`mt-1 text-[10.5px] ${analysis.state === "error" ? "text-danger-fg" : "text-subtle"}`}>
          {texto}
        </p>
      </div>
    );
  }

  const pct = Math.round((analysis.result_confidence ?? 0) * 100);
  const km = ((analysis.result_radius_m ?? 0) / 1000).toFixed(2);
  const gap =
    image?.exif_lat != null && image.exif_lng != null && analysis.result_lat != null
      ? metersBetween(analysis.result_lat, analysis.result_lng!, image.exif_lat, image.exif_lng)
      : null;

  return (
    <div className="absolute left-1/2 top-12 z-20 w-[268px] -translate-x-1/2 rounded-card border border-white/[.07] bg-[rgba(24,26,30,.93)] p-3.5 shadow-lg shadow-black/40 backdrop-blur">
      <div className="mb-2.5 flex items-center gap-2.5 text-fg">
        <Ring pct={pct} />
        <span className="text-[13px]">{pct}% · Resultado principal</span>
      </div>
      <p className="text-[10.5px] text-muted">Radio de búsqueda: {km} km.</p>
      {gap !== null && (
        <p className="text-[10.5px] text-warning-fg">
          El EXIF declara un GPS a {gap < 1000 ? `${Math.round(gap)} m` : `${(gap / 1000).toFixed(1)} km`} de aquí.
        </p>
      )}
    </div>
  );
}
```

- [ ] **Paso 3: la barra inferior**

Crear `client/src/work/SummaryBar.tsx`:

```tsx
import type { Analysis } from "../lib/api";

export function SummaryBar({ analysis }: { analysis: Analysis | null }) {
  const hecho = analysis?.state === "hecho";
  const pct = Math.round((analysis?.result_confidence ?? 0) * 100);
  const coords = hecho
    ? `${analysis!.result_lat!.toFixed(6)}, ${analysis!.result_lng!.toFixed(6)}`
    : "—";
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex items-end justify-between bg-gradient-to-t from-[rgba(10,11,13,.92)] to-transparent px-4 py-2.5 pl-[50px]">
      <div className="flex items-end">
        {/* Vacío hasta que haya motor: el nombre de lugar sale de una
            geocodificación inversa que no tiene nada que traducir todavía. */}
        <Field k="Identificado" v="—" dim />
        <Field k="Coordenadas" v={coords} mono dim={!hecho} />
        <Field k="Radio de búsqueda"
          v={hecho ? `~${((analysis!.result_radius_m ?? 0) / 1000).toFixed(2)} km` : "—"} dim={!hecho} />
      </div>
      {hecho && (
        <div className="text-right">
          <div className="text-[26px] leading-none text-fg">{pct}%</div>
          <div className="text-[8px] uppercase tracking-[.11em] text-subtle">coincidencia</div>
        </div>
      )}
    </div>
  );
}

function Field({ k, v, mono, dim }: { k: string; v: string; mono?: boolean; dim?: boolean }) {
  return (
    <div className="mr-6">
      <div className="text-[8px] uppercase tracking-[.11em] text-subtle">{k}</div>
      <div className={`text-[11.5px] ${mono ? "font-mono" : ""} ${dim ? "text-subtle" : "text-fg"}`}>{v}</div>
    </div>
  );
}
```

- [ ] **Paso 4: la vista de caso**

Crear `client/src/work/CaseView.tsx`:

```tsx
import { useEffect, useMemo, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { api, type Analysis, type Case, type Image, type Project } from "../lib/api";
import { lumiUrl, pickAndUpload, uploadPaths } from "../lib/bridge";
import { useServer } from "../lib/store";
import { Filmstrip } from "./Filmstrip";
import { MapCanvas, type Marker } from "./MapCanvas";
import { ResultCard } from "./ResultCard";
import { SummaryBar } from "./SummaryBar";

export function CaseView({
  project, case_, rail, onBack,
}: { project: Project; case_: Case; rail: React.ReactNode; onBack: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [images, setImages] = useState<Image[]>([]);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [sel, setSel] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const [im, an] = await Promise.all([
        api.get<Image[]>(`/v1/cases/${case_.id}/images`, token),
        api.get<Analysis[]>(`/v1/cases/${case_.id}/analyses`, token),
      ]);
      setImages(im);
      setAnalyses(an);
      setSel((s) => s ?? im[0]?.id ?? null);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [case_.id]);

  async function add(paths?: string[]) {
    setBusy(true);
    setError(null);
    try {
      const nuevas = paths ? await uploadPaths(case_.id, paths) : await pickAndUpload(case_.id);
      if (nuevas.length) {
        setImages((v) => [...v, ...nuevas]);
        setSel((s) => s ?? nuevas[0].id);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  // Soltar imágenes sobre el mapa, como en la v1. Tauri entrega rutas, no
  // bytes, así que va por el mismo camino que el selector de archivos.
  useEffect(() => {
    const un = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type === "drop") void add(e.payload.paths);
    });
    return () => { void un.then((f) => f()); };
  }, [case_.id]);

  const image = images.find((i) => i.id === sel) ?? null;
  const mine = useMemo(
    () => (sel === null ? [] : analyses.filter((a) => a.image_ids.includes(sel))),
    [analyses, sel],
  );
  const top = mine.find((a) => a.state === "hecho") ?? mine[0] ?? null;

  const markers: Marker[] = useMemo(() => {
    const out: Marker[] = [];
    mine.forEach((a, i) => {
      if (a.result_lat != null && a.result_lng != null) {
        out.push({
          id: `a${a.id}`, lat: a.result_lat, lng: a.result_lng, label: String(i + 1),
          kind: i === 0 ? "top" : "alt", radiusM: a.result_radius_m ?? undefined,
        });
      }
    });
    // El GPS declarado, aparte y en ámbar. Nunca mezclado con lo inferido.
    if (image?.exif_lat != null && image.exif_lng != null) {
      out.push({ id: "exif", lat: image.exif_lat, lng: image.exif_lng, label: "E", kind: "exif" });
    }
    return out;
  }, [mine, image]);

  const flyTo = useMemo(
    () =>
      top?.result_lat != null && top.result_lng != null
        ? { lat: top.result_lat, lng: top.result_lng, zoom: 13 }
        : image?.exif_lat != null && image.exif_lng != null
          ? { lat: image.exif_lat, lng: image.exif_lng, zoom: 13 }
          : null,
    [top, image],
  );

  async function analyze() {
    if (sel === null) return;
    setBusy(true);
    setError(null);
    try {
      const a = await api.post<Analysis>(
        `/v1/cases/${case_.id}/analyses`, { image_ids: [sel], model: "mini" }, token,
      );
      setAnalyses((v) => [a, ...v]);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative h-full w-full">
      <MapCanvas markers={markers} flyTo={flyTo} />
      {rail}

      <div className="absolute left-[50px] top-[34px] z-30 flex items-center gap-1.5 text-[11px]">
        <button onClick={onBack} className="text-subtle hover:text-fg">{project.name}</button>
        <span className="text-[#3a3e44]">/</span>
        <span className="text-fg">{case_.name}</span>
      </div>

      <ResultCard analysis={top} image={image} />
      <Filmstrip images={images} selected={sel} onSelect={setSel} onAdd={() => void add()} />

      <aside className="absolute inset-y-0 right-0 z-20 w-[196px] overflow-y-auto border-l border-white/[.06] bg-[rgba(16,18,21,.9)] p-2.5 backdrop-blur-xl">
        {image && (
          <div className="mb-2.5 flex items-center gap-2">
            <img src={lumiUrl(`/v1/images/${image.id}/thumb`)} alt=""
              className="h-[30px] w-[38px] shrink-0 rounded object-cover" />
            <span className="truncate font-mono text-[10px] text-muted">{image.filename}</span>
          </div>
        )}
        <p className="mb-2 text-[8px] uppercase tracking-[.11em] text-subtle">
          Caso · {images.length} imágenes, {analyses.length} análisis
        </p>

        {mine.map((a, i) => (
          <div key={a.id} className="mb-1.5 rounded-lg border border-white/[.07] p-2">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[9px] text-subtle">{i + 1}</span>
              <span className="flex-1 truncate text-[11.5px] text-fg">{a.model}</span>
              <span className="rounded border border-border px-1 text-[8.5px] text-subtle">
                {a.state === "hecho" ? "sin verificar" : a.state}
              </span>
            </div>
            {a.state === "hecho" ? (
              <p className="mt-1 font-mono text-[10px] text-muted">
                {a.result_lat!.toFixed(6)}, {a.result_lng!.toFixed(6)}
              </p>
            ) : (
              <p className="mt-1 font-mono text-[10px] text-subtle">
                {a.state === "error" ? a.error : "esperando al motor de inferencia"}
              </p>
            )}
          </div>
        ))}

        {/* El EXIF declarado tiene tarjeta propia y borde ámbar: no es una
            candidata, es lo que la cámara dice. */}
        {image?.exif_lat != null && image.exif_lng != null && (
          <div className="mb-1.5 rounded-lg border border-warning/30 p-2">
            <p className="text-[11.5px] text-warning-fg">EXIF declarado</p>
            <p className="mt-1 font-mono text-[10px] text-muted">
              {image.exif_lat.toFixed(6)}, {image.exif_lng.toFixed(6)}
            </p>
          </div>
        )}

        {/* Los widgets auxiliares de la v1 siguen ahí, bloqueados y diciendo
            el motivo real en vez de un candado: una función no disponible se
            muestra deshabilitada, nunca se oculta. */}
        {["Hora estimada", "Clima", "Objetos detectados"].map((t) => (
          <div key={t} className="mb-1.5 rounded-lg border border-white/[.07] p-2 opacity-60">
            <p className="text-[11.5px] text-subtle">{t}</p>
            <p className="mt-1 font-mono text-[10px] text-subtle">modelo no instalado</p>
          </div>
        ))}

        <button onClick={analyze} disabled={sel === null || busy}
          className="mt-2 w-full rounded-lg bg-accent px-3 py-1.5 text-[11px] font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px disabled:opacity-40">
          {busy ? "Un momento" : "Analizar esta imagen"}
        </button>
        {error && <p className="mt-2 text-[10.5px] leading-snug text-danger-fg">{error}</p>}
      </aside>

      <SummaryBar analysis={top} />
    </div>
  );
}
```

- [ ] **Paso 5: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 6: commit**

```bash
git add client/src/work/Filmstrip.tsx client/src/work/ResultCard.tsx client/src/work/SummaryBar.tsx client/src/work/CaseView.tsx
git commit -m "Vista de caso: la pantalla de la v1 con el EXIF declarado siempre aparte"
```

---

## Tarea 14: Miembros del proyecto

**Archivos:**
- Crear: `client/src/work/MembersDialog.tsx`

**Interfaces:**
- Consume: `api`, tipo `ProjectMember`
- Produce: `<MembersDialog project onClose />`

- [ ] **Paso 1: escribir el diálogo**

Crear `client/src/work/MembersDialog.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type Project, type ProjectMember } from "../lib/api";
import { useServer } from "../lib/store";

export function MembersDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const token = useServer((s) => s.token) ?? undefined;
  const [rows, setRows] = useState<ProjectMember[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<ProjectMember[]>(`/v1/projects/${project.id}/members`, token));
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => { void load(); }, [project.id]);

  async function add() {
    if (!name.trim()) return;
    setError(null);
    try {
      await api.post(`/v1/projects/${project.id}/members`, { username: name }, token);
      setName("");
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  async function drop(userId: number) {
    setError(null);
    try {
      await api.del(`/v1/projects/${project.id}/members/${userId}`, token);
      await load();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/50"
      onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}
        className="w-[360px] rounded-card border border-white/[.13] bg-[rgba(16,19,25,.9)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
        <p className="text-[13px] text-fg">Quién entra en {project.name}</p>
        <p className="mb-3.5 text-[11px] text-muted">
          un invitado puede trabajar dentro; renombrar, borrar e invitar son solo del dueño
        </p>

        {rows.map((m) => (
          <div key={m.user_id} className="mb-1.5 flex items-center gap-2 rounded-lg border border-border p-2">
            <span className="flex-1 truncate text-[11.5px] text-fg">{m.username}</span>
            <span className="text-[8.5px] uppercase tracking-[.11em] text-subtle">
              {m.role === "owner" ? "dueño" : "invitado"}
            </span>
            {m.role !== "owner" && (
              <button onClick={() => void drop(m.user_id)}
                className="text-[11px] text-subtle hover:text-danger-fg">quitar</button>
            )}
          </div>
        ))}

        <div className="mt-3 flex gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
            placeholder="nombre de usuario"
            className="flex-1 rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40" />
          <button onClick={add}
            className="rounded-lg border border-white/15 px-3 text-xs text-fg active:translate-y-px">
            Invitar
          </button>
        </div>

        {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}

        <div className="mt-4 text-right">
          <button onClick={onClose} className="text-[11px] text-muted hover:text-fg">Cerrar</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: compilar**

```bash
cd client && npm run build
```

Esperado: `tsc` sin errores.

- [ ] **Paso 3: commit**

```bash
git add client/src/work/MembersDialog.tsx
git commit -m "Miembros del proyecto: invitar por nombre de usuario, quitar solo el dueño"
```

---

## Tarea 15: Configuración del mapa en admin y resultado falso en desarrollo

**Archivos:**
- Crear: `client/src/admin/MapRow.tsx`
- Modificar: `client/src/admin/AdminPanel.tsx`
- Modificar: `client/src/dev/DebugOrb.tsx`

**Interfaces:**
- Consume: `api.patch<MapConfig>("/v1/admin/map")`, `api.get<MapConfig>("/v1/map/config")`
- Produce: `<MapRow />`; comando `fake <id>` en el orbe

- [ ] **Paso 1: la fila de configuración del mapa**

Crear `client/src/admin/MapRow.tsx`:

```tsx
import { useEffect, useState } from "react";
import { api, type MapConfig } from "../lib/api";

/** PROVISIONAL. El subsistema 3 rehace el panel entero; esto solo tiene que
 *  funcionar y usar los tokens. */
export function MapRow({ token }: { token: string }) {
  const [cfg, setCfg] = useState<MapConfig | null>(null);
  const [provider, setProvider] = useState("none");
  const [style, setStyle] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<MapConfig>("/v1/map/config", token).then((c) => {
      setCfg(c);
      setProvider(c.provider);
      setStyle(c.style_url);
    }).catch((e) => setError(String(e)));
  }, []);

  async function save() {
    setError(null);
    try {
      // Clave vacía = no la toques. Así se cambia de estilo sin volver a
      // teclearla, que es imposible si se leyera del campo enmascarado.
      const c = await api.patch<MapConfig>(
        "/v1/admin/map",
        { provider, style_url: style, key: key === "" ? null : key },
        token,
      );
      setCfg(c);
      setKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 1600);
    } catch (e) {
      setError(String(e));
    }
  }

  const input =
    "rounded-lg border border-border bg-[#0d0f12] px-3 py-2 text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo focus:border-white/40";

  return (
    <div className="rounded-card border border-border p-3.5">
      <p className="text-[12.5px] text-fg">Mapa</p>
      <p className="mb-3 text-[11px] text-muted">
        el servidor pide las teselas por ti: la clave no sale de aquí
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} className={input}>
          <option value="none">sin mapa</option>
          <option value="osm">OpenStreetMap</option>
          <option value="mapbox">Mapbox</option>
        </select>
        <input value={style} onChange={(e) => setStyle(e.target.value)}
          placeholder="URL del estilo" className={`${input} min-w-[220px] flex-1`} />
        <input value={key} onChange={(e) => setKey(e.target.value)} type="password"
          placeholder={cfg?.has_key ? "clave guardada · escribe para sustituirla" : "clave del proveedor"}
          className={`${input} min-w-[180px]`} />
        <button onClick={save}
          className="rounded-lg border border-white/15 px-4 py-2 text-xs text-fg active:translate-y-px">
          {saved ? "guardado" : "Guardar"}
        </button>
      </div>

      {cfg?.reason && <p className="mt-2.5 text-[11px] text-warning-fg">{cfg.reason}</p>}
      {error && <p className="mt-2.5 text-[11px] text-danger-fg">{error}</p>}
    </div>
  );
}
```

- [ ] **Paso 2: enchufarla al panel**

En `client/src/admin/AdminPanel.tsx`, importar `import { MapRow } from "./MapRow";` y
renderizar `<MapRow token={token} />` como una sección más, debajo de las que ya existen.

- [ ] **Paso 3: el resultado falso del orbe**

En `client/src/dev/DebugOrb.tsx`, la función `run()` interpreta `[name, arg]` de un `split`.
Se añade una rama antes de la de comando desconocido:

```tsx
    } else if (name === "fake" && arg) {
      // Sin motor no hay nada que dibujar, y el mapa y la tarjeta de
      // resultado no se pueden construir a ciegas. Solo en desarrollo: este
      // archivo entero desaparece del bundle de producción.
      const token = useServer.getState().token ?? undefined;
      api
        .patch(`/v1/analyses/${arg}/fake`, {}, token)
        .then(() => setMsg(`análisis ${arg} relleno con coordenadas falsas`))
        .catch((e) => setMsg(String(e)));
    } else if (name === "fake") {
      setMsg("uso: fake <id de análisis>");
    } else if (name) {
```

Y arriba del archivo, dos importaciones más:

```tsx
import { api } from "../lib/api";
import { useServer } from "../lib/store";
```

El texto de ayuda del campo (`placeholder="env 2 · reset"`) pasa a
`placeholder="env 2 · reset · fake 3"`.

Y su contraparte en el daemon, en `crates/lumid/src/routes/analyses.rs`:

```rust
/// SOLO PARA DESARROLLO. Rellena un análisis con un resultado inventado para
/// poder construir el mapa y la tarjeta contra algo real mientras no exista
/// el motor. Compilado fuera en release: `debug_assertions` es false ahí.
#[cfg(debug_assertions)]
pub async fn fake(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let case_id: i64 = app
        .store
        .conn()
        .query_row("SELECT case_id FROM analyses WHERE id = ?1", [id], |r| r.get(0))
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
    // Fijos y no aleatorios: así dos ejecuciones del mismo comando dan lo
    // mismo y una captura de pantalla sigue valiendo mañana.
    app.store
        .conn()
        .execute(
            "UPDATE analyses SET state = 'hecho', result_lat = 43.3612, result_lng = -8.4104,
                                 result_radius_m = 1400, result_confidence = 0.72,
                                 finished_at = ?1 WHERE id = ?2",
            rusqlite::params![now(), id],
        )
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

Y en `crates/lumid/src/main.rs`, la ruta detrás de la misma condición de compilación:

```rust
    #[cfg(debug_assertions)]
    let router = router.route("/v1/analyses/:id/fake", axum::routing::patch(routes::analyses::fake));
```

colocado justo antes de `.with_state(app)` — para eso, separa la cadena en
`let router = Router::new()…;` y aplica el `#[cfg]` después.

- [ ] **Paso 4: comprobar que nada de esto llega a producción**

```bash
cd client && npm run build && grep -c "DebugOrb\|/fake" dist/assets/*.js
```

Esperado: `0`. Es la misma verificación que se hizo con el orbe: que exista en desarrollo no
sirve de nada si además existe en el binario que se reparte.

```bash
cargo build --workspace --release && grep -c "analyses/:id/fake" target/release/lumid || echo "0 (bien)"
```

Esperado: `0 (bien)`.

- [ ] **Paso 5: commit**

```bash
git add client/src/admin/MapRow.tsx client/src/admin/AdminPanel.tsx client/src/dev/DebugOrb.tsx crates/lumid/src/routes/analyses.rs crates/lumid/src/main.rs
git commit -m "Configuracion provisional del mapa y resultado falso solo en desarrollo"
```

---

## Tarea 16: Enrutado y documentación

**Archivos:**
- Modificar: `client/src/App.tsx`
- Modificar: `README.md`
- Modificar: `ARCHITECTURE.md`

**Interfaces:**
- Consume: todo lo anterior
- Produce: los modos `"picker"`, `"project"` y `"case"` en `App.tsx`

- [ ] **Paso 1: los modos nuevos**

En `client/src/App.tsx`:

1. El tipo de `mode` pasa a
   `"entry" | "wizard" | "picker" | "project" | "case" | "admin"`. Desaparece `"app"`: el
   marcador de posición que decía que los proyectos llegaban en el subsistema 6 ya no tiene
   razón de ser, y todas sus apariciones se sustituyen por `"picker"`.
2. Importar `useWorkspace`, `ProjectPicker`, `ProjectView`, `CaseView`, `Rail`,
   `MembersDialog`, y un estado `const [members, setMembers] = useState(false);`.
3. La rama de render, sustituyendo el bloque final del ternario:

```tsx
      ) : mode === "picker" ? (
        <ProjectPicker onOpen={(p) => {
          useWorkspace.getState().setProject(p);
          setMode("project");
        }} />
      ) : mode === "project" || mode === "case" ? (
        (() => {
          const { project, case_ } = useWorkspace.getState();
          if (!project) { setMode("picker"); return null; }
          const rail = (
            <Rail canManage={project.role === "owner"}
              onProjects={() => { useWorkspace.getState().clear(); setMode("picker"); }}
              onMembers={() => setMembers(true)} />
          );
          return (
            <>
              {mode === "case" && case_ ? (
                <CaseView project={project} case_={case_} rail={rail}
                  onBack={() => { useWorkspace.getState().setCase(null); setMode("project"); }} />
              ) : (
                <ProjectView project={project} rail={rail}
                  onOpenCase={(c) => { useWorkspace.getState().setCase(c); setMode("case"); }} />
              )}
              {members && <MembersDialog project={project} onClose={() => setMembers(false)} />}
            </>
          );
        })()
      ) : (
```

4. Las dos vistas de trabajo ocupan la ventana entera: el contenedor que hoy centra el
   wizard (`items-center justify-center`) tiene que dejar de hacerlo cuando el modo es
   `project` o `case`. Sustituye su `className` por:

```tsx
      <div className={`relative flex flex-1 overflow-hidden ${
        mode === "project" || mode === "case" ? "" : "items-center justify-center overflow-y-auto"
      } ${blockedByDisconnect ? "pointer-events-none opacity-50" : ""}`}>
```

5. En el efecto de reanudación y en `onSignedIn`, donde hoy se decide entre `"admin"` y
   `"app"`, sustituir `"app"` por `"picker"`. Un admin sigue aterrizando en `"admin"`.
6. Al expulsar por desconexión, además de limpiar el token: `useWorkspace.getState().clear();`.
   Si no, al volver a entrar se abriría el proyecto del usuario anterior.

- [ ] **Paso 2: documentar**

En `README.md`, una sección nueva al nivel de la de auth:

```markdown
### Proyectos, casos y mapa (subsistema 6, esqueleto)

Al iniciar sesión se elige un **proyecto** antes de entrar, como en Burp. Dentro hay
**casos**, y dentro de un caso sus imágenes y sus **análisis**. Nada de un proyecto se ve
desde otro. Los proyectos se crean privados; el dueño puede invitar a otros investigadores.

El **motor de inferencia no existe todavía** (subsistema 5): los análisis se crean en estado
`pendiente` y ahí se quedan. Es a propósito — son el trabajo que la cola del subsistema 4
encontrará esperando cuando arranque.

El mapa lo sirve el propio daemon: un administrador configura el proveedor (Mapbox u
OpenStreetMap) y su clave, y el servidor hace de proxy de teselas con caché en disco. La
clave nunca baja al cliente, y el proveedor ve una IP en vez de una por investigador.

El GPS que la cámara escribió en el EXIF se lee y se muestra **aparte** de lo inferido, en
ámbar. El archivo original nunca se toca.

Configurar el mapa: panel de administración, sección *Mapa*. La caché de teselas vive en
`{DATA}/tiles` y se vacía borrando ese directorio.
```

En `ARCHITECTURE.md`, en la tabla de §5, el subsistema 6 pasa de `Pendiente` a
`Esqueleto terminado`, y en §9 se añade un párrafo con lo que quedó fuera (motor, cola,
geocodificación inversa) apuntando a `FUTURO.md`.

- [ ] **Paso 3: comprobar de punta a punta a mano**

```bash
npm run tauri dev
```

Recorrido mínimo, con el daemon corriendo:

1. Iniciar sesión con un usuario que no sea admin → aparece el selector de proyecto.
2. Crear un proyecto → entra en la vista de proyecto, mapa vacío, cajón de casos.
3. Crear un caso, abrirlo, arrastrar una foto con GPS encima del mapa → aparece en la tira y
   el marcador ámbar cae donde dice el EXIF.
4. Pulsar *Analizar esta imagen* → aparece un análisis `pendiente` con su motivo real.
5. En el orbe: `fake <id>` → el mapa vuela al punto, sale la tarjeta con el porcentaje y la
   barra inferior se rellena; el aviso de a cuántos metros está el EXIF aparece.
6. Volver a proyectos, invitar a otro usuario, entrar con él → ve el proyecto y no puede
   renombrarlo ni invitar.
7. Sin proveedor de mapa configurado, el lienzo dice quién tiene que arreglarlo.

- [ ] **Paso 4: commit**

```bash
git add client/src/App.tsx README.md ARCHITECTURE.md
git commit -m "Enrutado del espacio de trabajo y documentacion del subsistema 6"
```

---

## Notas de revisión

Tres cosas que la autorrevisión de este plan dejó anotadas en vez de resolver:

**El caché de teselas no tiene tope.** Está en los riesgos del spec y sigue sin resolverse
aquí. En un servidor con disco justo, un investigador paseando por el mapa puede llenarlo.

**El estilo se pide entero en cada arranque del mapa.** No se cachea como las teselas porque
puede cambiar cuando el admin toca la configuración, y una pantalla de mapa por sesión no
justifica invalidación. El techo es un servidor con muchos usuarios simultáneos.

**`ResultCard` y `SummaryBar` repiten el formateo del porcentaje y del radio.** Son cuatro
líneas y viven en archivos distintos por buena razón (uno flota sobre el mapa, el otro es la
barra). Si aparece un tercer consumidor, ahí sí toca extraerlo.
