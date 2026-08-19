# Página de Cola mejorada — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el widget provisional de la página de Cola por una vista
completa con los pendientes uno por uno (con motivo de bloqueo y acción de
cancelar), dos vistas conmutables (Cinta animada / Tabla), enlace directo a
Límites del dueño, y actualización en vivo sin sondeo.

**Architecture:** El backend expone un `pendientes_detalle` en `GET
/v1/queue` (reutilizando la lógica de reparto ya existente en
`Queue::duenos()`), añade un bypass de admin al `DELETE /v1/analyses/:id`
que ya existe, y emite una señal `EventoAdmin::ColaCambio` (sin payload) por
el canal admin ya existente cada vez que la cola cambia de verdad. El
frontend reemplaza `QueueRow` (que sigue viviendo, sin tocar, para el
Resumen) por un nuevo `ColaView.tsx` que pinta el pool de pendientes y los
carriles por trabajador, anima el traspaso de una tarjeta del pool a un
carril cuando el reparto ocurre de verdad (no un timer simulado), y ofrece
una tabla densa como vista alternativa.

**Tech Stack:** Rust (axum, rusqlite, tokio broadcast), React + TypeScript,
Tauri events (`@tauri-apps/api/event`), Tailwind.

**Ponytail — simplificación deliberada:** la Cinta no muestra un historial
de tarjetas resueltas desvaneciéndose tras la línea "ahora" (como sí hacía
el mockup aprobado) porque el backend no guarda qué resolvió cada
trabajador, solo su trabajo *actual* (`WorkerView.trabajo`). Guardar un
historial acotado por trabajador es la vía de salida si hace falta más
adelante — no se añade aquí porque nadie lo pidió todavía y habría que
inventar almacenamiento en memoria + más lookups solo para eso.

---

## Global Constraints

- No hay tests salvo en `lumi-proto` — cada tarea verifica con `cargo build`
  o `npx tsc -b`, no con un test nuevo.
- Un commit por tarea, con el mensaje exacto indicado.
- Español en comentarios y copy de interfaz.
- No tocar `QueueRow.tsx` (sigue siendo el widget del Resumen).

---

### Task 1: Tipos del protocolo (`lumi-proto`)

**Files:**
- Modify: `crates/lumi-proto/src/api.rs:870-886`

**Interfaces:**
- Produces: `RazonBloqueo` (enum de solo unidades, serializa como string
  plano vía serde por defecto: `"bloqueado" | "desconectado" |
  "limite_alcanzado"`), `PendienteView` (struct), `WorkerView` con 3 campos
  nuevos, `QueueView.pendientes_detalle: Vec<PendienteView>`,
  `EventoAdmin::ColaCambio` (variante sin payload, serializa como el string
  plano `"ColaCambio"`).

- [ ] **Step 1: Reemplazar `WorkerView` y `QueueView`, añadir `RazonBloqueo`
  y `PendienteView`**

En `crates/lumi-proto/src/api.rs`, sustituir (líneas 870-886):

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerView {
    pub dispositivo: String,
    /// El modelo cargado ahora mismo. `null` mientras arranca o entre cambios.
    pub modelo: Option<String>,
    /// El análisis que tiene en la mano, si tiene alguno.
    pub trabajo: Option<i64>,
    /// Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado.
    pub listo: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
}
```

por:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkerView {
    pub dispositivo: String,
    /// El modelo cargado ahora mismo. `null` mientras arranca o entre cambios.
    pub modelo: Option<String>,
    /// El análisis que tiene en la mano, si tiene alguno.
    pub trabajo: Option<i64>,
    /// Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado.
    pub listo: bool,
    /// Dueño y caso del trabajo que tiene en la mano ahora mismo, si tiene
    /// alguno — para pintar la Cinta de la Cola sin una segunda petición.
    pub dueno_actual_id: Option<i64>,
    pub dueno_actual: Option<String>,
    pub caso_actual: Option<String>,
}

/// Por qué un pendiente no se reparte, cuando hay una razón real que
/// explicarlo — no confundir con "todavía no le ha tocado turno", que es
/// `None` en `PendienteView.razon`, no una variante de este enum.
#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RazonBloqueo {
    Bloqueado,
    Desconectado,
    LimiteAlcanzado,
}

/// Un pendiente, para pintarlo en la página de Cola uno por uno en vez de
/// solo contarlo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendienteView {
    pub id: i64,
    pub user_id: i64,
    pub username: String,
    pub case_id: i64,
    pub case_nombre: String,
    pub nivel: String,
    pub creado_en: i64,
    pub razon: Option<RazonBloqueo>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueueView {
    pub pendientes: u32,
    pub en_curso: u32,
    pub trabajadores: Vec<WorkerView>,
    pub pendientes_detalle: Vec<PendienteView>,
}
```

- [ ] **Step 2: Añadir `EventoAdmin::ColaCambio`**

Buscar el enum `EventoAdmin` (línea ~381) y añadir la variante al final:

```rust
pub enum EventoAdmin {
    SolicitudCredito {
        user_id: i64,
        username: String,
        tipo: String,
        valor_actual: i64,
        valor_propuesto: i64,
    },
    SolicitudAcceso {
        id: i64,
        display_name: String,
        message: String,
    },
    /// Sin payload: es una señal ("algo cambió en la cola"), no un
    /// snapshot — quien la recibe reacciona pidiendo `GET /v1/queue` de
    /// nuevo, igual que ya haría un sondeo.
    ColaCambio,
}
```

- [ ] **Step 3: Compilar**

Run: `cd "E:/Lumi Station" && cargo build -p lumi-proto`
Expected: compila limpio. (`cargo build -p lumid` fallará todavía —
`queue/mod.rs` construye `WorkerView`/`QueueView` con los campos viejos —
se arregla en la Tarea 2, no hace falta comprobarlo aquí.)

- [ ] **Step 4: Commit**

```bash
git add crates/lumi-proto/src/api.rs
git commit -m "feat: tipos para pendientes detallados y aviso de cambio de cola"
```

---

### Task 2: `Queue` emite `ColaCambio` y expone `pendientes_detalle`

**Files:**
- Modify: `crates/lumid/src/queue/mod.rs`
- Modify: `crates/lumid/src/main.rs:85-89`

**Interfaces:**
- Consumes: `lumi_proto::api::{EventoAdmin, PendienteView, RazonBloqueo}`
  (Task 1), `plan::{Candidato, Dueno}` (ya existían).
- Produces: `Queue::arrancar(store, dir, gpus, admin_eventos)` (firma
  cambiada — un parámetro más), `Queue::foto()` ahora rellena
  `pendientes_detalle` y los 3 campos nuevos de `WorkerView`.

- [ ] **Step 1: Importar los tipos nuevos**

En `crates/lumid/src/queue/mod.rs:12`, cambiar:

```rust
use lumi_proto::api::{Cambio, GpuInfo, QueueView, WorkerView};
```

por:

```rust
use lumi_proto::api::{Cambio, EventoAdmin, GpuInfo, PendienteView, QueueView, RazonBloqueo, WorkerView};
```

- [ ] **Step 2: Añadir el campo `admin_eventos` a `Queue` y a su
  constructor**

En el struct `Queue` (línea ~119-142), añadir el campo (junto a `difusion`
tiene sentido, misma naturaleza):

```rust
pub struct Queue {
    store: Arc<Store>,
    estado: Mutex<Estado>,
    avisos: mpsc::UnboundedSender<()>,
    difusion: broadcast::Sender<Cambio>,
    admin_eventos: broadcast::Sender<EventoAdmin>,
    dispositivos: Vec<String>,
    python: PathBuf,
    script: PathBuf,
    dir: PathBuf,
    eventos: mpsc::UnboundedSender<Evento>,
    pub(crate) niveles: Mutex<Vec<lumi_index::niveles::Nivel>>,
    agentes: Mutex<Vec<lumi_index::agentes::Agente>>,
    geo: Mutex<lumi_index::geo::Datos>,
    pub(crate) modelos: Mutex<Vec<lumi_index::registro::Modelo>>,
    pub(crate) verificadores: Mutex<Vec<lumi_index::registro::Verificador>>,
    pub(crate) motores: Mutex<Vec<lumi_index::registro::Motor>>,
    pub(crate) recursos_geo: Mutex<Vec<lumi_index::geo::RecursoGeo>>,
    vectores: Mutex<VectoresPorAnalisis>,
}
```

(Solo cambia respecto al original: se añade la línea
`admin_eventos: broadcast::Sender<EventoAdmin>,` tras `difusion`.)

En `pub fn arrancar` (línea 168), cambiar la firma:

```rust
pub fn arrancar(store: Arc<Store>, dir: PathBuf, gpus: &[GpuInfo]) -> Arc<Self> {
```

por:

```rust
pub fn arrancar(
    store: Arc<Store>,
    dir: PathBuf,
    gpus: &[GpuInfo],
    admin_eventos: broadcast::Sender<EventoAdmin>,
) -> Arc<Self> {
```

Y en la construcción de `Self` dentro de `arrancar` (línea ~199-221),
añadir el campo tras `difusion,`:

```rust
        let cola = Arc::new(Self {
            store,
            estado: Mutex::new(Estado {
                trabajadores: HashMap::new(),
                reintento: HashMap::new(),
                presentes: HashMap::new(),
            }),
            avisos: tx_avisos,
            difusion,
            admin_eventos,
            dispositivos,
            python,
            script,
            dir,
            eventos: tx_ev,
            niveles: Mutex::new(lumi_index::registro::cargar_niveles(&crate::assets::ruta("registros/niveles"))),
            agentes: Mutex::new(lumi_index::registro::cargar_agentes(&crate::assets::ruta("registros/agentes"))),
            geo: Mutex::new(lumi_index::geo::Datos::cargar(&crate::assets::ruta("registros/geo"))),
            modelos: Mutex::new(lumi_index::registro::cargar_modelos(&crate::assets::ruta("registros/modelos"))),
            verificadores: Mutex::new(lumi_index::registro::cargar_verificadores(&crate::assets::ruta("registros/verificadores"))),
            motores: Mutex::new(lumi_index::registro::cargar_motores(&crate::assets::ruta("registros/motores"))),
            recursos_geo: Mutex::new(lumi_index::geo::cargar_recursos(&crate::assets::ruta("registros/geo"))),
            vectores: Mutex::new(HashMap::new()),
        });
```

- [ ] **Step 3: Emitir `ColaCambio` en `anunciar()` y en `Evento::Listo`**

`anunciar()` ya es el único sitio por el que pasa *todo* cambio de estado de
un análisis (`en_curso`, `hecho`, `error`, `pendiente` tras un requeue).
Cambiar (línea ~890-899):

```rust
    fn anunciar(&self, analysis_id: i64, estado: &str) {
        if let Some((user_id, case_id)) = self.dueno_y_caso(analysis_id) {
            let _ = self.difusion.send(Cambio::Estado {
                user_id,
                analysis_id,
                case_id,
                estado: estado.to_string(),
            });
        }
    }
```

por:

```rust
    fn anunciar(&self, analysis_id: i64, estado: &str) {
        if let Some((user_id, case_id)) = self.dueno_y_caso(analysis_id) {
            let _ = self.difusion.send(Cambio::Estado {
                user_id,
                analysis_id,
                case_id,
                estado: estado.to_string(),
            });
        }
        let _ = self.admin_eventos.send(EventoAdmin::ColaCambio);
    }
```

En `Evento::Listo` (línea ~470-481), que no pasa por `anunciar` porque es
un cambio de trabajador, no de análisis, cambiar:

```rust
            Evento::Listo { dispositivo, modelo } => {
                if let Ok(mut e) = self.estado.lock() {
                    if let Some(w) = e.trabajadores.get_mut(&dispositivo) {
                        w.listo = true;
                        w.modelo = modelo;
                    }
                    // Arrancó bien: la espera creciente vuelve a cero. Si no,
                    // un dispositivo que falló tres veces hace una hora seguiría
                    // esperando un minuto para relanzarse la próxima vez.
                    e.reintento.remove(&dispositivo);
                }
            }
```

por:

```rust
            Evento::Listo { dispositivo, modelo } => {
                if let Ok(mut e) = self.estado.lock() {
                    if let Some(w) = e.trabajadores.get_mut(&dispositivo) {
                        w.listo = true;
                        w.modelo = modelo;
                    }
                    // Arrancó bien: la espera creciente vuelve a cero. Si no,
                    // un dispositivo que falló tres veces hace una hora seguiría
                    // esperando un minuto para relanzarse la próxima vez.
                    e.reintento.remove(&dispositivo);
                }
                let _ = self.admin_eventos.send(EventoAdmin::ColaCambio);
            }
```

- [ ] **Step 4: Añadir `detalle_de()` y reescribir `foto()`**

Sustituir `foto()` completo (línea ~304-334):

```rust
    pub fn foto(&self) -> QueueView {
        let cuenta = |estado: &str| {
            self.store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE state = ?1",
                    [estado],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0) as u32
        };
        let trabajadores = self
            .estado
            .lock()
            .map(|e| {
                let mut v: Vec<WorkerView> = e
                    .trabajadores
                    .iter()
                    .map(|(d, w)| WorkerView {
                        dispositivo: d.clone(),
                        modelo: w.modelo.clone(),
                        trabajo: w.trabajo,
                        listo: w.listo,
                    })
                    .collect();
                v.sort_by(|a, b| a.dispositivo.cmp(&b.dispositivo));
                v
            })
            .unwrap_or_default();
        QueueView { pendientes: cuenta("pendiente"), en_curso: cuenta("en_curso"), trabajadores }
    }
```

por:

```rust
    pub fn foto(&self) -> QueueView {
        let cuenta = |estado: &str| {
            self.store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE state = ?1",
                    [estado],
                    |r| r.get::<_, i64>(0),
                )
                .unwrap_or(0) as u32
        };
        let trabajadores = self
            .estado
            .lock()
            .map(|e| {
                let mut v: Vec<WorkerView> = e
                    .trabajadores
                    .iter()
                    .map(|(d, w)| {
                        let (dueno_actual_id, dueno_actual, caso_actual) = w
                            .trabajo
                            .and_then(|id| self.detalle_de(id))
                            .map(|(_, uid, username, caso)| (Some(uid), Some(username), Some(caso)))
                            .unwrap_or((None, None, None));
                        WorkerView {
                            dispositivo: d.clone(),
                            modelo: w.modelo.clone(),
                            trabajo: w.trabajo,
                            listo: w.listo,
                            dueno_actual_id,
                            dueno_actual,
                            caso_actual,
                        }
                    })
                    .collect();
                v.sort_by(|a, b| a.dispositivo.cmp(&b.dispositivo));
                v
            })
            .unwrap_or_default();

        let candidatos = self.candidatos();
        let duenos = self.duenos(&candidatos);
        let pendientes_detalle = candidatos
            .iter()
            .map(|cand| {
                let (case_id, _, username, case_nombre) = self
                    .detalle_de(cand.analysis_id)
                    .unwrap_or((0, cand.user_id, String::new(), String::new()));
                let razon = duenos.get(&cand.user_id).and_then(|d| {
                    if d.bloqueado {
                        Some(RazonBloqueo::Bloqueado)
                    } else if !d.conectado && !d.segundo_plano {
                        Some(RazonBloqueo::Desconectado)
                    } else if d.en_curso >= d.max_concurrent {
                        Some(RazonBloqueo::LimiteAlcanzado)
                    } else {
                        None
                    }
                });
                PendienteView {
                    id: cand.analysis_id,
                    user_id: cand.user_id,
                    username,
                    case_id,
                    case_nombre,
                    nivel: cand.modelo.clone(),
                    creado_en: cand.created_at,
                    razon,
                }
            })
            .collect();

        QueueView {
            pendientes: cuenta("pendiente"),
            en_curso: cuenta("en_curso"),
            trabajadores,
            pendientes_detalle,
        }
    }

    /// Caso y dueño de un análisis, para pintarlo en la Cola. Aparte de
    /// `Candidato`/`Dueno` (en `plan.rs`, que solo cargan lo que el
    /// planificador necesita) porque esto es puramente para mostrar, no
    /// para decidir el reparto.
    fn detalle_de(&self, analysis_id: i64) -> Option<(i64, i64, String, String)> {
        self.store
            .conn()
            .query_row(
                "SELECT a.case_id, a.requested_by, u.username, c.name
                   FROM analyses a
                   JOIN users u ON u.id = a.requested_by
                   JOIN cases c ON c.id = a.case_id
                  WHERE a.id = ?1",
                [analysis_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .ok()
    }
```

- [ ] **Step 5: Reordenar `main.rs` para crear `admin_eventos` antes de la
  cola**

En `crates/lumid/src/main.rs:85-89`, cambiar:

```rust
    let (tls_cfg, fingerprint) = tls::load(&dir).await?;
    let store = Arc::new(store::Store::open(&dir)?);
    let gpus = gpus();
    let queue = queue::Queue::arrancar(store.clone(), dir.clone(), &gpus);
    let (admin_eventos, _) = tokio::sync::broadcast::channel(64);
```

por:

```rust
    let (tls_cfg, fingerprint) = tls::load(&dir).await?;
    let store = Arc::new(store::Store::open(&dir)?);
    let gpus = gpus();
    // Antes se creaba después de `Queue::arrancar` — la cola necesita este
    // remitente para avisar a la página de Cola cuando algo cambia
    // (`EventoAdmin::ColaCambio`), así que tiene que existir primero.
    let (admin_eventos, _) = tokio::sync::broadcast::channel(64);
    let queue = queue::Queue::arrancar(store.clone(), dir.clone(), &gpus, admin_eventos.clone());
```

(El resto de la construcción de `App { ... admin_eventos }` que sigue
justo debajo no cambia — `admin_eventos` sigue viva y se mueve ahí igual
que antes.)

- [ ] **Step 6: Compilar**

Run: `cd "E:/Lumi Station" && cargo build -p lumid`
Expected: compila limpio.

- [ ] **Step 7: Commit**

```bash
git add crates/lumid/src/queue/mod.rs crates/lumid/src/main.rs
git commit -m "feat: la cola expone pendientes detallados y avisa en vivo de cambios"
```

---

### Task 3: Cancelar un pendiente como administrador

**Files:**
- Modify: `crates/lumid/src/routes/analyses.rs:8`, `:257-288`

**Interfaces:**
- Consumes: `require_admin` (ya existe en `routes::auth`).

- [ ] **Step 1: Importar `require_admin`**

En `crates/lumid/src/routes/analyses.rs:8`, cambiar:

```rust
use crate::routes::auth::{bearer, require_session};
```

por:

```rust
use crate::routes::auth::{bearer, require_admin, require_session};
```

- [ ] **Step 2: Bypass de admin en `remove()`**

Cambiar (línea 257-269):

```rust
pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (case_id, state): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, state FROM analyses WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    guard_case(&app, &headers, case_id)?;
```

por:

```rust
pub async fn remove(
    State(app): State<App>,
    Path(id): Path<i64>,
    headers: HeaderMap,
) -> Result<StatusCode, Fail> {
    let (case_id, state): (i64, String) = app
        .store
        .conn()
        .query_row("SELECT case_id, state FROM analyses WHERE id = ?1", [id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese análisis"))?;
    // Un administrador puede cancelar cualquier pendiente desde la página
    // de Cola aunque no sea miembro del proyecto de ese caso. Cualquier
    // otra persona sigue necesitando `guard_case`.
    if require_admin(&app, &bearer(&headers)).is_err() {
        guard_case(&app, &headers, case_id)?;
    }
```

(El resto de la función —el chequeo de `en_curso` y los `DELETE`— no
cambia.)

- [ ] **Step 3: Compilar**

Run: `cd "E:/Lumi Station" && cargo build -p lumid`
Expected: compila limpio.

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/routes/analyses.rs
git commit -m "feat: un administrador puede cancelar cualquier pendiente desde la Cola"
```

---

### Task 4: Tipos del cliente + filtro de `ColaCambio` en el toast

**Files:**
- Modify: `client/src/lib/api.ts:112-117`, `:325-334`
- Modify: `client/src/admin/AdminEventToast.tsx:18-27`

**Interfaces:**
- Produces: `RazonBloqueo`, `PendienteView`, `WorkerView` (3 campos
  nuevos), `QueueView.pendientes_detalle`, `EventoAdmin` (unión con el
  string plano `"ColaCambio"`).

- [ ] **Step 1: Extender `EventoAdmin`**

En `client/src/lib/api.ts:112-117`, cambiar:

```ts
export type EventoAdmin =
  | { SolicitudCredito: {
      user_id: number; username: string; tipo: "diario" | "semanal";
      valor_actual: number; valor_propuesto: number;
    } }
  | { SolicitudAcceso: { id: number; display_name: string; message: string } };
```

por:

```ts
export type EventoAdmin =
  | { SolicitudCredito: {
      user_id: number; username: string; tipo: "diario" | "semanal";
      valor_actual: number; valor_propuesto: number;
    } }
  | { SolicitudAcceso: { id: number; display_name: string; message: string } }
  | "ColaCambio";
```

- [ ] **Step 2: Extender `WorkerView`, añadir `RazonBloqueo`/`PendienteView`,
  extender `QueueView`**

En `client/src/lib/api.ts:325-334`, cambiar:

```ts
export interface WorkerView {
  dispositivo: string;
  /** El modelo cargado ahora mismo. `null` mientras arranca o entre cambios. */
  modelo: string | null;
  /** El análisis que tiene en la mano, si tiene alguno. */
  trabajo: number | null;
  /** Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado. */
  listo: boolean;
}
export interface QueueView { pendientes: number; en_curso: number; trabajadores: WorkerView[] }
```

por:

```ts
export interface WorkerView {
  dispositivo: string;
  /** El modelo cargado ahora mismo. `null` mientras arranca o entre cambios. */
  modelo: string | null;
  /** El análisis que tiene en la mano, si tiene alguno. */
  trabajo: number | null;
  /** Si ya dijo `listo`. Uno que no lo ha dicho está cargando, no colgado. */
  listo: boolean;
  dueno_actual_id: number | null;
  dueno_actual: string | null;
  caso_actual: string | null;
}
/** `null` en `PendienteView.razon` significa "solo espera un hueco libre" —
 *  no confundir con una de estas tres, que sí son un motivo real. */
export type RazonBloqueo = "bloqueado" | "desconectado" | "limite_alcanzado";
export interface PendienteView {
  id: number;
  user_id: number;
  username: string;
  case_id: number;
  case_nombre: string;
  nivel: string;
  creado_en: number;
  razon: RazonBloqueo | null;
}
export interface QueueView {
  pendientes: number;
  en_curso: number;
  trabajadores: WorkerView[];
  pendientes_detalle: PendienteView[];
}
```

- [ ] **Step 3: Filtrar `"ColaCambio"` en `AdminEventToast`**

En `client/src/admin/AdminEventToast.tsx:18-27`, cambiar:

```tsx
  useEffect(() => {
    let vivo = true;
    void startAdminEvents(token);
    const un = listen<EventoAdmin>("admin-events", (e) => {
      if (!vivo) return;
      setCerrado(false);
      setEv(e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);
```

por:

```tsx
  useEffect(() => {
    let vivo = true;
    void startAdminEvents(token);
    const un = listen<EventoAdmin>("admin-events", (e) => {
      // Sin toast para esto: es una señal muda para la página de Cola, no
      // algo que el resto del panel deba anunciar.
      if (!vivo || e.payload === "ColaCambio") return;
      setCerrado(false);
      setEv(e.payload);
    });
    return () => { vivo = false; void un.then((f) => f()); };
  }, [token]);
```

- [ ] **Step 4: Comprobar tipos**

Run: `cd "E:/Lumi Station/client" && npx tsc -b`
Expected: sin errores nuevos (`ColaView.tsx` y su uso en `AdminPanel.tsx`
todavía no existen — llegan en las Tareas 6 y 7).

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts client/src/admin/AdminEventToast.tsx
git commit -m "feat: tipos de pendientes detallados y aviso de cola en el cliente"
```

---

### Task 5: `UsersView` acepta abrir un usuario directamente

**Files:**
- Modify: `client/src/admin/UsersView.tsx:11-39`

**Interfaces:**
- Produces: `UsersView({ token, abrirUserId? })` — antes solo `{ token }`.

- [ ] **Step 1: Añadir el prop y el efecto que abre el detalle**

En `client/src/admin/UsersView.tsx:11`, cambiar:

```tsx
export function UsersView({ token }: { token: string }) {
```

por:

```tsx
export function UsersView({ token, abrirUserId }: { token: string; abrirUserId?: number }) {
```

Justo después del bloque `const open = (id: number) => ...` (línea 35-39),
añadir:

```tsx
  // Enlace directo desde la página de Cola: si llega con un usuario ya
  // indicado, se abre su detalle y su editor de Límites sin tener que
  // buscarlo en la lista. `UsersView` se remonta entera al cambiar de
  // sección (AdminPanel usa `key={seccion}`), así que este efecto corre
  // cada vez que se llega aquí desde la Cola, aunque sea el mismo usuario.
  useEffect(() => {
    if (abrirUserId == null) return;
    api
      .get<UserDetail>(`/v1/admin/users/${abrirUserId}`, token)
      .then((d) => { setDetail(d); setEditando("usuario"); })
      .catch((e) => setError(String(e)));
  }, [abrirUserId, token]);
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd "E:/Lumi Station/client" && npx tsc -b`
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/UsersView.tsx
git commit -m "feat: Usuarios puede abrir directamente el detalle de uno dado"
```

---

### Task 6: `ColaView.tsx` — la página nueva

**Files:**
- Create: `client/src/admin/ColaView.tsx`

**Interfaces:**
- Consumes: `api.get<QueueView>`, `api.del`, `ago` (`lib/time.ts`),
  `UserTile` (`ui/UserTile.tsx`), `Icon` (`ui/Icon.tsx`), `Seccion`
  (`./AdminPanel`), `listen` (`@tauri-apps/api/event`), `EventoAdmin`,
  `PendienteView`, `QueueView` (`lib/api.ts`).
- Produces: `ColaView({ token, onAbrirUsuario })`.

- [ ] **Step 1: Crear el archivo completo**

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, type EventoAdmin, type PendienteView, type QueueView } from "../lib/api";
import { ago } from "../lib/time";
import { Icon } from "../ui/Icon";
import { UserTile } from "../ui/UserTile";
import { Seccion } from "./AdminPanel";

const RAZON_LABEL: Record<string, string> = {
  bloqueado: "bloqueado",
  desconectado: "sin conexión",
  limite_alcanzado: "límite alcanzado",
};

type Vista = "cinta" | "tabla";

export function ColaView({ token, onAbrirUsuario }: {
  token: string; onAbrirUsuario: (id: number) => void;
}) {
  const [q, setQ] = useState<QueueView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.cola.vista") as Vista) ?? "cinta"
  );

  useEffect(() => {
    localStorage.setItem("lumi.cola.vista", vista);
  }, [vista]);

  const cargar = useCallback(
    () =>
      api.get<QueueView>("/v1/queue", token)
        .then((v) => { setQ(v); setError(null); })
        .catch((e) => setError(String(e))),
    [token]
  );

  useEffect(() => {
    void cargar();
    const un = listen<EventoAdmin>("admin-events", (e) => {
      if (e.payload === "ColaCambio") void cargar();
    });
    return () => { void un.then((f) => f()); };
  }, [cargar]);

  const listos = q?.trabajadores.filter((w) => w.listo).length ?? 0;

  return (
    <Seccion titulo="Cola" grupo="Operación">
      <div className="mb-4 flex gap-2.5">
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{q?.pendientes ?? "—"}</div>
          <div className="mt-0.5 text-[10px] text-muted">pendientes</div>
        </div>
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{q?.en_curso ?? "—"}</div>
          <div className="mt-0.5 text-[10px] text-muted">en curso</div>
        </div>
        <div className="flex-1 rounded-[11px] border border-border bg-panel p-3">
          <div className="font-mono text-[19px] text-fg">{listos}/{q?.trabajadores.length ?? 0}</div>
          <div className="mt-0.5 text-[10px] text-muted">trabajadores listos</div>
        </div>
      </div>

      <div className="mb-4 inline-flex gap-0.5 rounded-lg border border-border bg-elevated p-[3px]">
        {(["cinta", "tabla"] as const).map((v) => (
          <button key={v} onClick={() => setVista(v)}
            className={`rounded-md px-3 py-1 text-[11px] capitalize transition-colors ${
              vista === v ? "bg-panel text-fg" : "text-subtle hover:text-fg"
            }`}>
            {v}
          </button>
        ))}
      </div>

      {error && <p className="text-[11px] text-danger-fg">{error}</p>}
      {!error && q === null && <p className="text-[11px] text-subtle">cargando</p>}

      {q && (vista === "cinta"
        ? <VistaCinta q={q} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={cargar} />
        : <VistaTabla q={q} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={cargar} />)}
    </Seccion>
  );
}

function BadgeRazon({ razon }: { razon: PendienteView["razon"] }) {
  if (!razon) return <span className="text-[10.5px] text-subtle">esperando hueco</span>;
  return (
    <span className={`rounded-full px-2 py-0.5 text-[9.5px] ${
      razon === "bloqueado" ? "bg-danger/[.12] text-danger-fg" : "bg-warning/[.12] text-warning-fg"
    }`}>
      {RAZON_LABEL[razon]}
    </span>
  );
}

function VistaTabla({ q, token, onAbrirUsuario, onCambiado }: {
  q: QueueView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  return (
    <>
      <table className="w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="text-left text-[9.5px] uppercase tracking-[.08em] text-subtle">
            <th className="border-b border-border px-2.5 py-2 font-normal">Dueño</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Caso</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Nivel</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Esperando</th>
            <th className="border-b border-border px-2.5 py-2 font-normal">Motivo</th>
            <th className="border-b border-border px-2.5 py-2 font-normal" />
          </tr>
        </thead>
        <tbody>
          {q.pendientes_detalle.length === 0 ? (
            <tr><td colSpan={6} className="px-2.5 py-4 text-[11px] text-subtle">nada esperando turno</td></tr>
          ) : q.pendientes_detalle.map((p) => (
            <FilaPendiente key={p.id} p={p} token={token} onAbrirUsuario={onAbrirUsuario} onCambiado={onCambiado} />
          ))}
        </tbody>
      </table>

      <div className="mb-2 mt-6 text-[8.5px] uppercase tracking-[.15em] text-subtle">Trabajadores</div>
      {q.trabajadores.length === 0 ? (
        <p className="text-[11px] text-subtle">ningún trabajador ha llegado a lanzarse</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {q.trabajadores.map((w) => (
            <div key={w.dispositivo}
              className="flex items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
              <Icon name={w.listo ? "check" : "clock"} size={12}
                className={w.listo ? "text-draw-fg" : "text-subtle"} />
              <span className="font-mono text-[11px] text-fg">{w.dispositivo}</span>
              <span className="text-[10.5px] text-subtle">
                {w.listo
                  ? (w.modelo ? `listo · ${w.modelo}` : "listo · sin modelo cargado")
                  : "cargando todavía"}
              </span>
              {w.trabajo !== null && (
                <span className="ml-auto font-mono text-[10.5px] text-muted">análisis #{w.trabajo}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function FilaPendiente({ p, token, onAbrirUsuario, onCambiado }: {
  p: PendienteView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [fallo, setFallo] = useState<string | null>(null);

  async function cancelar() {
    setCancelando(true);
    setFallo(null);
    try {
      await api.del(`/v1/analyses/${p.id}`, token);
      onCambiado();
    } catch (e) {
      setFallo(String(e));
      setCancelando(false);
      setConfirmando(false);
    }
  }

  return (
    <tr className="hover:bg-white/[.015]">
      <td className="border-b border-border px-2.5 py-2">
        <button onClick={() => onAbrirUsuario(p.user_id)}
          className="text-fg underline decoration-border decoration-1 underline-offset-2 hover:decoration-fg">
          {p.username}
        </button>
      </td>
      <td className="border-b border-border px-2.5 py-2 text-fg">{p.case_nombre}</td>
      <td className="border-b border-border px-2.5 py-2 font-mono text-muted">{p.nivel}</td>
      <td className="border-b border-border px-2.5 py-2 font-mono text-muted">{ago(p.creado_en)}</td>
      <td className="border-b border-border px-2.5 py-2"><BadgeRazon razon={p.razon} /></td>
      <td className="border-b border-border px-2.5 py-2 text-right">
        {fallo && <div className="mb-1 text-[9.5px] text-danger-fg">{fallo}</div>}
        {confirmando ? (
          <span className="inline-flex items-center gap-2 text-[10.5px]">
            <span className="text-warning-fg">¿seguro?</span>
            <button onClick={() => setConfirmando(false)} className="text-subtle">no</button>
            <button onClick={cancelar} disabled={cancelando}
              className="rounded-lg border border-danger/40 px-2 py-1 text-danger-fg">sí</button>
          </span>
        ) : (
          <button onClick={() => setConfirmando(true)}
            className="rounded-lg border border-danger/40 px-2.5 py-1 text-[10.5px] text-danger-fg">
            cancelar
          </button>
        )}
      </td>
    </tr>
  );
}

/** Anima una tarjeta volando de su posición actual (el pool de pendientes)
 *  hasta el carril del trabajador que la recogió — un nodo aparte, fuera de
 *  React, porque es una animación de un único disparo entre dos árboles de
 *  React distintos (el pool y los carriles), no un estado que algo deba
 *  recordar. Se borra sola al terminar. */
function volar(origenEl: HTMLElement, laneEl: HTMLElement, texto: string) {
  const from = origenEl.getBoundingClientRect();
  const to = laneEl.getBoundingClientRect();
  const ghost = document.createElement("div");
  ghost.className = "rounded-[10px] border border-border bg-panel px-2.5 py-2 text-[11px] text-fg";
  ghost.style.position = "fixed";
  ghost.style.zIndex = "60";
  ghost.style.pointerEvents = "none";
  ghost.style.left = `${from.left}px`;
  ghost.style.top = `${from.top}px`;
  ghost.style.width = `${from.width}px`;
  ghost.style.transition = "transform .55s cubic-bezier(.22,1,.36,1), opacity .55s ease";
  ghost.textContent = texto;
  document.body.appendChild(ghost);
  const dx = to.left + 44 - from.width / 2 - from.left;
  const dy = to.top + to.height / 2 - from.height / 2 - from.top;
  requestAnimationFrame(() => {
    ghost.style.transform = `translate(${dx}px, ${dy}px) scale(.82)`;
    ghost.style.opacity = "0";
  });
  setTimeout(() => ghost.remove(), 600);
}

function VistaCinta({ q, token, onAbrirUsuario, onCambiado }: {
  q: QueueView; token: string; onAbrirUsuario: (id: number) => void; onCambiado: () => void;
}) {
  const [pool, setPool] = useState<PendienteView[]>(q.pendientes_detalle);
  const [saliendo, setSaliendo] = useState<Set<number>>(new Set());
  const poolRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const laneRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const primerRender = useRef(true);

  // Cuando llega un `q` nuevo, un pendiente que estaba en el pool y ya no
  // está pudo pasar por dos caminos: un trabajador lo recogió (vuela hasta
  // su carril) o alguien lo canceló (se desvanece donde estaba). Ambos se
  // quedan un instante en pantalla en vez de desaparecer de golpe.
  useEffect(() => {
    if (primerRender.current) {
      primerRender.current = false;
      setPool(q.pendientes_detalle);
      return;
    }
    const nuevosIds = new Set(q.pendientes_detalle.map((p) => p.id));
    const seFueron = pool.filter((p) => !nuevosIds.has(p.id));
    if (seFueron.length === 0) {
      setPool(q.pendientes_detalle);
      return;
    }
    seFueron.forEach((p) => {
      const destino = q.trabajadores.find((w) => w.trabajo === p.id);
      const origenEl = poolRefs.current.get(p.id);
      const laneEl = destino && laneRefs.current.get(destino.dispositivo);
      if (origenEl && laneEl) volar(origenEl, laneEl, p.username);
    });
    setSaliendo((s) => new Set([...s, ...seFueron.map((p) => p.id)]));
    const t = setTimeout(() => {
      setSaliendo((s) => {
        const n = new Set(s);
        seFueron.forEach((p) => n.delete(p.id));
        return n;
      });
      setPool(q.pendientes_detalle);
    }, 560);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="grid grid-cols-[224px_1fr] gap-5">
      <div>
        <div className="mb-2.5 text-[8.5px] uppercase tracking-[.16em] text-subtle">Pendientes</div>
        <div className="flex flex-col gap-2">
          {pool.length === 0 && <p className="text-[11px] text-subtle">nada esperando turno</p>}
          {pool.map((p) => (
            <div key={p.id}
              ref={(el) => { if (el) poolRefs.current.set(p.id, el); else poolRefs.current.delete(p.id); }}
              className={`flex items-center gap-2 rounded-[11px] border border-border bg-panel p-2 transition-all duration-300 ${
                saliendo.has(p.id) ? "scale-95 opacity-0" : "opacity-100"
              }`}
              style={saliendo.has(p.id) ? undefined : { animation: "jg-fade-rise .4s cubic-bezier(.22,1,.36,1) both" }}>
              <UserTile nombre={p.username} conectado={!p.razon} userId={p.user_id} size={27} />
              <div className="min-w-0 flex-1">
                <button onClick={() => onAbrirUsuario(p.user_id)}
                  className="block truncate text-[10.5px] text-fg hover:underline">
                  {p.username}
                </button>
                <div className="truncate text-[9px] text-muted">{p.case_nombre}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span className="rounded-[4px] bg-elevated px-1.5 py-px text-[8.5px] text-muted">{p.nivel}</span>
                  {p.razon && (
                    <span className={`rounded-full px-1.5 py-px text-[8.5px] ${
                      p.razon === "bloqueado" ? "bg-danger/[.13] text-danger-fg" : "bg-warning/[.13] text-warning-fg"
                    }`}>
                      {RAZON_LABEL[p.razon]}
                    </span>
                  )}
                </div>
              </div>
              <BotonCancelar id={p.id} token={token} onCambiado={onCambiado} />
            </div>
          ))}
        </div>
      </div>

      <div>
        {q.trabajadores.length === 0 ? (
          <p className="text-[11px] text-subtle">ningún trabajador ha llegado a lanzarse</p>
        ) : q.trabajadores.map((w) => (
          <div key={w.dispositivo} className="border-t border-border py-3.5 first:border-t-0">
            <div className="mb-2.5 flex items-baseline gap-2 px-1">
              <span className="font-mono text-[12px] text-fg">{w.dispositivo}</span>
              <span className="text-[9.5px] text-subtle">
                {w.listo ? (w.modelo ? `nivel ${w.modelo} cargado` : "listo") : "cargando todavía"}
              </span>
            </div>
            <div ref={(el) => { if (el) laneRefs.current.set(w.dispositivo, el); else laneRefs.current.delete(w.dispositivo); }}
              className="relative flex h-[62px] items-center overflow-hidden rounded-[11px] border border-border bg-panel/40 px-[44px]">
              <div className="absolute inset-y-0 left-[44px] w-0 border-l border-dashed border-border" />
              {w.trabajo !== null ? (
                <div key={w.trabajo}
                  className="relative flex w-[150px] items-center gap-2 rounded-[10px] border border-white/[.18] bg-elevated p-2 shadow-[0_2px_10px_rgba(0,0,0,.25)]"
                  style={{ animation: "jg-fade-rise .4s cubic-bezier(.22,1,.36,1) both" }}>
                  <div className="pointer-events-none absolute inset-0 animate-pulse rounded-[10px] border border-white/20" />
                  <UserTile nombre={w.dueno_actual ?? "?"} conectado userId={w.dueno_actual_id ?? undefined} size={26} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10.5px] text-fg">{w.dueno_actual}</div>
                    <div className="truncate text-[9px] text-muted">{w.caso_actual}</div>
                  </div>
                </div>
              ) : (
                <span className="text-[10.5px] text-subtle">sin trabajo activo</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BotonCancelar({ id, token, onCambiado }: { id: number; token: string; onCambiado: () => void }) {
  const [confirmando, setConfirmando] = useState(false);
  const [cancelando, setCancelando] = useState(false);

  async function cancelar() {
    setCancelando(true);
    try {
      await api.del(`/v1/analyses/${id}`, token);
      onCambiado();
    } catch {
      setCancelando(false);
      setConfirmando(false);
    }
  }

  if (confirmando) {
    return (
      <span className="ml-auto flex shrink-0 items-center gap-1.5 text-[9.5px]">
        <button onClick={() => setConfirmando(false)} className="text-subtle">no</button>
        <button onClick={cancelar} disabled={cancelando} className="text-danger-fg">sí</button>
      </span>
    );
  }
  return (
    <button onClick={() => setConfirmando(true)}
      className="ml-auto shrink-0 text-[9.5px] text-subtle hover:text-danger-fg">
      cancelar
    </button>
  );
}
```

- [ ] **Step 2: Comprobar tipos**

Run: `cd "E:/Lumi Station/client" && npx tsc -b`
Expected: sin errores nuevos (`AdminPanel.tsx` todavía no importa
`ColaView` — llega en la Tarea 7).

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/ColaView.tsx
git commit -m "feat: página de Cola completa (pool animado + tabla + cancelar)"
```

---

### Task 7: Conectar `ColaView` en `AdminPanel`

**Files:**
- Modify: `client/src/admin/AdminPanel.tsx`

- [ ] **Step 1: Cambiar imports**

Cambiar (línea 13):

```tsx
import { QueueRow } from "./QueueRow";
```

por:

```tsx
import { ColaView } from "./ColaView";
```

- [ ] **Step 2: Añadir el estado `abrirUserId`**

Tras la línea `const [licenciasPendientes, setLicenciasPendientes] = useState(false);`
(línea 27), añadir:

```tsx
  const [abrirUserId, setAbrirUserId] = useState<number | undefined>(undefined);
```

- [ ] **Step 3: Pasar `abrirUserId` a `UsersView` y reemplazar la sección
  de Cola**

Cambiar:

```tsx
          : seccion === "usuarios" ? <UsersView token={token} />
```

por:

```tsx
          : seccion === "usuarios" ? <UsersView token={token} abrirUserId={abrirUserId} />
```

Y cambiar:

```tsx
          : seccion === "cola" ? <Seccion titulo="Cola" grupo="Operación">
              <QueueRow token={token} /></Seccion>
```

por:

```tsx
          : seccion === "cola" ? (
              <ColaView token={token} onAbrirUsuario={(id) => { setAbrirUserId(id); setSeccion("usuarios"); }} />
            )
```

- [ ] **Step 4: Compilar y comprobar tipos**

Run: `cd "E:/Lumi Station" && cargo build -p lumid && cd client && npx tsc -b`
Expected: ambos compilan limpio.

- [ ] **Step 5: Commit**

```bash
git add client/src/admin/AdminPanel.tsx
git commit -m "feat: la sección Cola usa la página completa en vez del widget provisional"
```

---

## Self-Review

**Cobertura de la spec:**
- §1 (datos de `/v1/queue`) → Task 1 + Task 2.
- §2 (cancelar como admin) → Task 3.
- §3 (aviso en vivo) → Task 1 (tipo) + Task 2 (emisión) + Task 4 (filtro en
  el toast) + Task 6 (consumo en `ColaView`).
- §4 (estructura de la página, dos vistas, enlace a Límites) → Task 5
  (enlace) + Task 6 (la página) + Task 7 (conexión).
- §5 (errores y vacíos) → cubierto dentro de Task 6 (`error`/`cargando`,
  "nada esperando turno", "ningún trabajador...", fallo inline en
  `FilaPendiente`).
- Fuera de alcance (prioridad por trabajo, reordenar a mano, historial
  extendido) → respetado; el ponytail de cabecera documenta la única
  desviación real (sin historial de resueltos en la Cinta).

**Placeholders:** ninguno — cada paso trae el código completo, sin "TODO"
ni "similar a la tarea N".

**Consistencia de tipos:** `PendienteView`/`WorkerView`/`RazonBloqueo`
coinciden campo a campo entre `lumi-proto` (Task 1), `queue/mod.rs`
(Task 2) y `client/src/lib/api.ts` (Task 4); `ColaView` (Task 6) usa
exactamente esos nombres (`dueno_actual`, `dueno_actual_id`, `caso_actual`,
`case_nombre`, `creado_en`, `razon`) sin inventar ninguno nuevo.
