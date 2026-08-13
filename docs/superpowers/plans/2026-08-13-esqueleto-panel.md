# Esqueleto del panel de administración · Plan de implementación

> **Para agentes:** SUB-SKILL REQUERIDA: usa `superpowers:subagent-driven-development`
> (recomendada) o `superpowers:executing-plans` para implementarlo tarea a tarea. Los pasos usan
> casillas (`- [ ]`) para llevar la cuenta.

**Objetivo:** que el panel de administración deje de ser una pila de filas con un botón que alterna
dos vistas, y pase a tener barra lateral, secciones y una pantalla de inicio.

**Arquitectura:** `AdminPanel.tsx` pasa a layout de dos columnas con el estado de sección dentro
del propio panel — `App.tsx` sigue con un solo `mode === "admin"`. Las cinco vistas que ya existen
se mudan a su entrada; dos de ellas ganan lo que la spec pide (solicitudes desplegables, tres
vistas de usuarios) y las otras tres se mueven intactas. Un endpoint nuevo sirve el Resumen de una
sola petición.

**Stack:** Rust (`lumid`, `lumi-proto`), React + Tailwind + TypeScript (`client/`), SQLite.

## Restricciones globales

- **Spec:** `docs/superpowers/specs/2026-08-13-esqueleto-panel-design.md`. Mockup interactivo:
  `docs/superpowers/specs/lumi-s3-panel-mockup.html`. Ante duda, manda la spec.
- **NINGUNA prueba nueva.** Este ciclo es mudanza, layout y una consulta de agregados; no hay
  lógica pura no trivial. La convención del proyecto es no añadir pruebas a código mecánico. Se
  verifica con `cargo build`, `cargo clippy`, `npm run lint` y `npm run build`.
- **Un commit por tarea terminada**, no commits intermedios.
- **Español** en documentación, copia de interfaz y comentarios de código.
- **`ponytail`**: la solución más simple que funciona. Una simplificación deliberada lleva un
  comentario `// ponytail:` que nombra el techo con el que chocó y la salida.
- **Diseño**: tema oscuro, **nada de verde** (lo hecho es blanco), mono para lo que produce una
  máquina, iconos SVG del conjunto de `client/src/ui/Icon.tsx` — no se dibujan nuevos si vale uno
  de esos. **Nunca un icono dentro de una caja de color.**
- **En la pantalla no se justifica nada.** Nada de párrafos explicando por qué una decisión es la
  correcta. Solo quedan las dos líneas de instrucción de la §11 de la spec y una frase por hueco.
- **`limits::effective` sigue siendo la única vía legítima** para leer límites por usuario. Este
  ciclo no lee la tabla `limits` directamente en ningún sitio.
- **La telemetría de `TitleBar` no se toca.** Fuera del panel sigue exactamente como está: una
  píldora que se despliega en popover. El panel de administración **añade la franja del mockup**
  (tarea 8), que lee del mismo `sample` de `useServer` — no hay una segunda fuente de verdad, hay
  dos formas de enseñar la misma.
- **Movimiento:** entrada escalonada de 9 px con `ease-expo`, ~45 ms entre hermanas, **tope de
  nueve escalones**. El indicador de la barra lateral es uno solo, 520 ms. `prefers-reduced-motion`
  lo apaga todo.

---

## Estructura de ficheros

**Se crean:**

| Fichero | Responsabilidad |
|---|---|
| `client/src/admin/Franja.tsx` | La franja de telemetría del panel: GPU, VRAM, temperatura, cola y estado. |
| `client/src/admin/Sidebar.tsx` | La barra lateral: grupos, entradas, contadores, marcador deslizante, pie. |
| `client/src/admin/ResumenView.tsx` | Las seis fichas del Resumen y su esqueleto de carga. |
| `client/src/admin/Hueco.tsx` | La pantalla de una sección que todavía no existe. |
| `client/src/admin/KeysView.tsx` | La sección API Keys. |
| `client/src/admin/UserTile.tsx` | El monograma con su punto de conexión, compartido por las tres vistas de usuarios. |

**Se modifican:** `crates/lumi-proto/src/api.rs`, `crates/lumid/src/routes/admin.rs`,
`crates/lumid/src/routes/access.rs`, `crates/lumid/src/queue/mod.rs`, `crates/lumid/src/store.rs`,
`crates/lumid/src/main.rs`, `client/src/lib/api.ts`, `client/src/admin/AdminPanel.tsx`,
`client/src/admin/RequestsView.tsx`, `client/src/admin/UsersView.tsx`, `client/src/App.tsx`,
`ARCHITECTURE.md`, `CLAUDE.md`, `FUTURO.md`.

**Se mueven sin tocarles las tripas:** `QueueRow.tsx`, `MapRow.tsx`, `IndicesPanel.tsx`.

---

## Task 1: El endpoint del Resumen

**Files:**
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `crates/lumid/src/queue/mod.rs`
- Modify: `crates/lumid/src/main.rs`
- Modify: `crates/lumid/src/routes/admin.rs`

**Interfaces:**
- Consume: nada de tareas anteriores.
- Produce: `GET /v1/admin/resumen` devolviendo `lumi_proto::api::Resumen`. La tarea 4 lo consume
  desde el cliente.

- [ ] **Step 1: El tipo**

En `crates/lumi-proto/src/api.rs`, junto a los demás tipos de administración:

```rust
/// Lo que el panel enseña nada más entrar. Va en una sola respuesta y no en
/// cuatro peticiones: pintar la pantalla a trozos daría cuatro estados de
/// carga y cuatro de error para una sola pregunta.
#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Resumen {
    pub solicitudes_pendientes: i64,
    /// Epoch de la más antigua sin resolver. `None` si no hay ninguna.
    pub solicitud_mas_antigua: Option<i64>,
    pub usuarios: i64,
    /// Con el mismo criterio que ya usa la cola: estar suscrito a
    /// `/v1/queue/events` cuenta como estar conectado. Una segunda definición
    /// de «conectado» sería una segunda verdad sobre el mismo hecho.
    pub usuarios_conectados: i64,
    pub analisis_hoy: i64,
    pub analisis_en_cola: i64,
    /// Siete días, el más reciente al final. Alimenta la chispa de la ficha.
    pub analisis_serie: Vec<i64>,
    pub indices: i64,
    pub indices_bytes: i64,
    pub teselas: i64,
    pub arrancado_en: i64,
}
```

- [ ] **Step 2: Cuántos hay conectados**

En `crates/lumid/src/queue/mod.rs`, dentro de `impl Queue`, junto a los demás métodos públicos:

```rust
    /// Cuántos usuarios distintos tienen al menos un flujo SSE abierto.
    /// `presentes` es privado y vive tras el mutex del estado; esto es la
    /// única forma legítima de preguntarlo desde fuera.
    pub fn conectados(&self) -> i64 {
        self.estado.lock().map(|e| e.presentes.len() as i64).unwrap_or(0)
    }
```

- [ ] **Step 3: Desde cuándo lleva en marcha**

En `crates/lumid/src/main.rs`, añade el campo al `pub struct App`, después de `pub dir: PathBuf,`:

```rust
    /// Epoch de arranque. El panel lo resta para decir «en marcha desde hace
    /// 6 d 04 h»; calcularlo en el cliente obligaría a confiar en su reloj.
    pub arrancado_en: i64,
```

y rellénalo donde se construye el `App`, con el mismo reloj que usa el resto del daemon:

```rust
        arrancado_en: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0),
```

- [ ] **Step 4: La ruta**

En `crates/lumid/src/routes/admin.rs`, al final del fichero:

```rust
/// Los números del Resumen, de una vez.
///
/// Los estados de `access_requests` están en inglés (`pending`, `approved`,
/// `rejected`, `expired`) y los de `analyses` en español (`pendiente`,
/// `en_curso`, `hecho`, `error`). No es un descuido que se arregle aquí:
/// cambiarlos es una migración de datos que no pinta en este ciclo.
pub async fn resumen(
    State(app): State<App>,
    headers: HeaderMap,
) -> Result<Json<lumi_proto::api::Resumen>, StatusCode> {
    require_admin(&app, &bearer(&headers))?;
    let c = app.store.conn();
    let ahora = now();
    // Medianoche UTC, no local: el daemon no sabe en qué huso está mirando el
    // administrador, y elegir uno sería inventárselo.
    let hoy = ahora - (ahora % 86_400);

    let (pendientes, mas_antigua): (i64, Option<i64>) = c
        .query_row(
            "SELECT COUNT(*), MIN(created_at) FROM access_requests WHERE status = 'pending'",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap_or((0, None));

    let usuarios: i64 =
        c.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap_or(0);

    let analisis_hoy: i64 = c
        .query_row("SELECT COUNT(*) FROM analyses WHERE created_at >= ?1", [hoy], |r| r.get(0))
        .unwrap_or(0);
    let analisis_en_cola: i64 = c
        .query_row(
            "SELECT COUNT(*) FROM analyses WHERE state IN ('pendiente','en_curso')",
            [],
            |r| r.get(0),
        )
        .unwrap_or(0);

    // Siete cubos de un día. Se cuentan en Rust en vez de con siete consultas
    // o un GROUP BY con huecos: los días sin ni un análisis tienen que salir
    // como cero y no como ausencia, o la chispa mentiría sobre su forma.
    let mut analisis_serie = vec![0i64; 7];
    if let Ok(mut q) =
        c.prepare("SELECT created_at FROM analyses WHERE created_at >= ?1")
    {
        let desde = hoy - 6 * 86_400;
        if let Ok(filas) = q.query_map([desde], |r| r.get::<_, i64>(0)) {
            for t in filas.flatten() {
                let dia = ((t - desde) / 86_400).clamp(0, 6) as usize;
                analisis_serie[dia] += 1;
            }
        }
    }

    let (indices, indices_bytes, teselas): (i64, i64, i64) = c
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(bytes),0), COALESCE(SUM(teselas),0)
               FROM installed_indices WHERE completo = 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap_or((0, 0, 0));

    Ok(Json(lumi_proto::api::Resumen {
        solicitudes_pendientes: pendientes,
        solicitud_mas_antigua: mas_antigua,
        usuarios,
        usuarios_conectados: app.queue.conectados(),
        analisis_hoy,
        analisis_en_cola,
        analisis_serie,
        indices,
        indices_bytes,
        teselas,
        arrancado_en: app.arrancado_en,
    }))
}
```

- [ ] **Step 5: Registrarla**

En `crates/lumid/src/main.rs`, junto a las demás rutas de admin (después de la línea de
`/v1/admin/limits`):

```rust
        .route("/v1/admin/resumen", get(routes::admin::resumen))
```

- [ ] **Step 6: Compilar**

Run: `cargo build --workspace && cargo clippy --workspace --all-targets -- -D warnings`
Expected: compila sin avisos.

> `cargo run -p lumid` no arranca en Windows: exige el certificado que deja `lumi install`, que
> falla a propósito fuera de systemd. Está documentado en `CLAUDE.md` y no es un fallo de esta
> tarea. La verificación aquí es de compilación.

- [ ] **Step 7: Commit**

```bash
git add crates/lumi-proto/src/api.rs crates/lumid/src/queue/mod.rs crates/lumid/src/main.rs crates/lumid/src/routes/admin.rs
git commit -m "Cuatro preguntas del panel se contestan en una sola respuesta"
```

---

## Task 2: El dispositivo desde el que se pide acceso

**Files:**
- Modify: `crates/lumid/src/store.rs`
- Modify: `crates/lumi-proto/src/api.rs`
- Modify: `crates/lumid/src/routes/access.rs`
- Modify: `crates/lumid/src/routes/admin.rs`
- Modify: `client/src/lib/api.ts`

**Interfaces:**
- Consume: nada.
- Produce: `AdminRequest.device: Option<String>` en la API y el campo `device` aceptado al crear
  una solicitud. La tarea 6 lo pinta.

- [ ] **Step 1: La columna**

En `crates/lumid/src/store.rs`, con el mismo patrón de migración que ya usan las demás columnas
añadidas de este fichero (búscalo: es una lista de `(tabla, columna, tipo)` o un `ALTER TABLE`
envuelto en `let _ =`; usa el que de verdad esté ahí):

```rust
let _ = c.execute("ALTER TABLE access_requests ADD COLUMN device TEXT", []);
```

Es **anulable a propósito**: las solicitudes que ya estén pendientes no lo tienen, y se enseñan
con «no consta» en lugar de con un dato inventado.

- [ ] **Step 2: El campo en la API**

En `crates/lumi-proto/src/api.rs`, dentro de `pub struct AdminRequest`, después de
`pub source_ip: String,`:

```rust
    /// Lo que declaró el cliente al pedir acceso. `None` en las solicitudes
    /// anteriores a que esto existiera, y se enseña como «no consta».
    #[serde(default)]
    pub device: Option<String>,
```

Y en `pub struct AccessReq` del mismo fichero (el que hoy tiene solo `display_name` y `message`),
añade:

```rust
    /// Sistema y versión del cliente. Es un dato declarado por quien pide, no
    /// una huella: sirve para decidir, no para identificar.
    #[serde(default)]
    pub device: Option<String>,
```

- [ ] **Step 3: Guardarlo y devolverlo**

En `crates/lumid/src/routes/access.rs`, en el `INSERT INTO access_requests`, añade la columna
`device` y su valor desde el cuerpo de la petición.

En `crates/lumid/src/routes/admin.rs`, en `list_requests`, añade `device` al `SELECT` y al literal
que construye cada `AdminRequest`.

- [ ] **Step 4: Que el cliente lo mande**

En `client/src/lib/api.ts`, añade a la interfaz `AdminRequest`:

```ts
  /** Lo que declaró el cliente al pedir acceso. `null` en las anteriores a
   *  que esto existiera. */
  device: string | null;
```

Y en `client/src/entry/RequestForm.tsx:22`, en el cuerpo del `api.post("/v1/access-requests", {…})`,
añade:

```ts
        device: navigator.userAgent,
```

- [ ] **Step 5: Compilar**

Run: `cargo build --workspace && cargo clippy --workspace --all-targets -- -D warnings && cd client && npm run build`
Expected: todo verde.

- [ ] **Step 6: Commit**

```bash
git add crates/lumid/src/store.rs crates/lumi-proto/src/api.rs crates/lumid/src/routes/access.rs crates/lumid/src/routes/admin.rs client/src/lib/api.ts
git commit -m "Aprobar a alguien se decidia con un nombre y una fecha"
```

---

## Task 3: El armazón

**Files:**
- Create: `client/src/admin/Sidebar.tsx`
- Create: `client/src/admin/Hueco.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`

**Interfaces:**
- Consume: nada.
- Produce: el tipo `Seccion` y el componente `Sidebar`, que las tareas 4 a 7 rellenan.

```ts
export type Seccion =
  | "resumen" | "modelos" | "indices" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "mantenimiento" | "notificaciones" | "hardware";
```

- [ ] **Step 1: La barra lateral**

Crea `client/src/admin/Sidebar.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from "react";
import { useServer } from "../lib/store";

export type Seccion =
  | "resumen" | "modelos" | "indices" | "claves"
  | "solicitudes" | "usuarios"
  | "cola" | "mantenimiento" | "notificaciones" | "hardware";

/** Las que todavía no existen se ven, atenuadas, con su «pronto». Aparecer de
 *  la nada dentro de tres meses es peor que estar desde el principio diciendo
 *  que no estás — es la matriz de capacidades aplicada a la navegación. */
const GRUPOS: { grupo: string; items: { id: Seccion; label: string; pronto?: boolean }[] }[] = [
  {
    grupo: "Servidor",
    items: [
      { id: "resumen", label: "Resumen" },
      { id: "modelos", label: "Modelos", pronto: true },
      { id: "indices", label: "Índices" },
      { id: "claves", label: "API Keys" },
    ],
  },
  {
    grupo: "Personas",
    items: [
      { id: "solicitudes", label: "Solicitudes" },
      { id: "usuarios", label: "Usuarios" },
    ],
  },
  {
    grupo: "Operación",
    items: [
      { id: "cola", label: "Cola" },
      { id: "mantenimiento", label: "Mantenimiento", pronto: true },
      { id: "notificaciones", label: "Notificaciones", pronto: true },
      { id: "hardware", label: "Hardware", pronto: true },
    ],
  },
];

export function Sidebar({ actual, onIr, contadores }: {
  actual: Seccion;
  onIr: (s: Seccion) => void;
  /** Solo las secciones que tienen algo que contar. En ámbar las que esperan
   *  por el administrador. */
  contadores: Partial<Record<Seccion, { n: number; espera?: boolean }>>;
}) {
  const nav = useRef<HTMLElement>(null);
  const [marca, setMarca] = useState<{ top: number; height: number } | null>(null);
  const usuario = useServer((s) => s.username) ?? "";

  // El marcador es UNO y se desliza. Un elemento compartido hace que cambiar
  // de sección se lea como movimiento, no como dos cosas apagándose y
  // encendiéndose. Se mide tras pintar, que es cuando el botón ya tiene sitio.
  useLayoutEffect(() => {
    const b = nav.current?.querySelector<HTMLElement>(`[data-s="${actual}"]`);
    if (b) setMarca({ top: b.offsetTop + 6, height: b.offsetHeight - 12 });
  }, [actual]);

  return (
    <aside className="flex flex-col border-r border-border bg-surface px-[9px] pb-[11px] pt-[13px]">
      <div className="flex items-center gap-2.5 px-2 pb-3">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]
          border border-border bg-elevated text-muted">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2l9 4.5-9 4.5-9-4.5L12 2z" />
          </svg>
        </span>
        <span className="text-[11.5px] leading-tight text-fg">
          {usuario}
          <small className="block text-[9px] tracking-[.03em] text-subtle">propietario</small>
        </span>
      </div>

      <nav ref={nav} className="relative flex flex-col gap-px">
        {marca && (
          <span aria-hidden className="absolute -left-[9px] w-0.5 rounded-r-sm bg-fg
            transition-[top,height] duration-[520ms] ease-expo"
            style={{ top: marca.top, height: marca.height }} />
        )}
        {GRUPOS.map((g) => (
          <div key={g.grupo} className="contents">
            <div className="px-2 pb-[5px] pt-[13px] text-[8.5px] uppercase tracking-[.13em] text-subtle">
              {g.grupo}
            </div>
            {g.items.map((it) => {
              const on = it.id === actual;
              const c = contadores[it.id];
              return (
                <button key={it.id} data-s={it.id} onClick={() => onIr(it.id)}
                  className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-[6.5px] text-left
                    text-[11.5px] transition-[background-color,color,padding-left] duration-[360ms]
                    ease-expo hover:bg-white/[.04] hover:pl-[11px] hover:text-fg
                    ${on ? "bg-white/[.06] text-fg" : "text-muted"} ${it.pronto ? "opacity-40" : ""}`}>
                  {it.label}
                  {it.pronto ? (
                    <span className="ml-auto text-[8.5px] uppercase tracking-[.1em] text-subtle">
                      pronto
                    </span>
                  ) : c ? (
                    <span className={`ml-auto font-mono text-[9px] tabular-nums
                      ${c.espera ? "text-warning-fg" : "text-subtle"}`}>{c.n}</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-border px-2 pt-2.5">
        <Pie k="huella" v={(useServer.getState().hello?.fingerprint ?? "").slice(0, 12)} />
        <Pie k="puerto" v="7717" />
      </div>
    </aside>
  );
}

function Pie({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between py-px text-[9.5px] text-subtle">
      <span>{k}</span><b className="font-mono font-normal text-muted">{v}</b>
    </div>
  );
}
```

- [ ] **Step 2: El hueco declarado**

Crea `client/src/admin/Hueco.tsx`:

```tsx
/** Una sección que todavía no existe. Una frase de qué será y en qué ciclo,
 *  y nada más: la pantalla no justifica decisiones, eso está en la spec. */
const QUE: Record<string, { titulo: string; grupo: string; ciclo: string; que: string }> = {
  modelos: {
    titulo: "Modelos", grupo: "Servidor", ciclo: "ciclo 3a",
    que: "Descargar pesos, aceptar sus licencias y verificar el sha256.",
  },
  mantenimiento: {
    titulo: "Mantenimiento", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Poner el servidor en MAINTENANCE sin pararlo.",
  },
  notificaciones: {
    titulo: "Notificaciones", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Avisos escritos por el administrador para quien esté conectado.",
  },
  hardware: {
    titulo: "Hardware", grupo: "Operación", ciclo: "ciclo 3c",
    que: "Dispositivos, VRAM y temperaturas con su histórico.",
  },
};

export function Hueco({ seccion }: { seccion: string }) {
  const d = QUE[seccion];
  if (!d) return null;
  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">{d.grupo}</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">{d.titulo}</h2>
        <span className="ml-auto pb-0.5 text-[10.5px] text-subtle">{d.ciclo}</span>
      </div>
      <div className="mt-[18px] max-w-[620px] rounded-[11px] border border-dashed border-border p-[24px_22px]">
        <h3 className="mb-[7px] flex items-center gap-2.5 text-[12.5px] font-medium">
          Todavía no está
          <span className="rounded-[5px] border border-border px-1.5 py-px text-[8.5px]
            tracking-[.05em] text-subtle">pronto</span>
        </h3>
        <p className="text-[11px] leading-[1.75] text-muted">{d.que}</p>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: El panel de dos columnas**

Reescribe `client/src/admin/AdminPanel.tsx` entero:

```tsx
import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { useServer } from "../lib/store";
import { Hueco } from "./Hueco";
import { IndicesPanel } from "./IndicesPanel";
import { KeysView } from "./KeysView";
import { QueueRow } from "./QueueRow";
import { RequestsView } from "./RequestsView";
import { ResumenView } from "./ResumenView";
import { Sidebar, type Seccion } from "./Sidebar";
import { UsersView } from "./UsersView";

const PRONTO: Seccion[] = ["modelos", "mantenimiento", "notificaciones", "hardware"];

export function AdminPanel({ token }: { token: string }) {
  const [seccion, setSeccion] = useState<Seccion>("resumen");
  const [cuentas, setCuentas] = useState<Partial<Record<Seccion, { n: number; espera?: boolean }>>>({});
  const capIndices = useServer((s) => s.hello?.capabilities.find((c) => c.id === "indices"));

  // Los contadores de la barra lateral salen del mismo Resumen que pinta la
  // primera pantalla: una sola petición alimenta las dos cosas.
  useEffect(() => {
    api.get<import("../lib/api").Resumen>("/v1/admin/resumen", token)
      .then((r) => setCuentas({
        indices: { n: r.indices },
        solicitudes: { n: r.solicitudes_pendientes, espera: r.solicitudes_pendientes > 0 },
        usuarios: { n: r.usuarios },
        cola: { n: r.analisis_en_cola },
        claves: { n: 1, espera: true },
      }))
      .catch(() => setCuentas({}));
  }, [token]);

  return (
    <div className="relative z-10 grid h-full grid-cols-[206px_1fr] overflow-hidden">
      <Sidebar actual={seccion} onIr={setSeccion} contadores={cuentas} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        {PRONTO.includes(seccion) ? <Hueco seccion={seccion} />
          : seccion === "resumen" ? <ResumenView token={token} onIr={setSeccion} />
          : seccion === "solicitudes" ? <Seccion titulo="Solicitudes de acceso" grupo="Personas">
              <RequestsView token={token} /></Seccion>
          : seccion === "usuarios" ? <UsersView token={token} />
          : seccion === "claves" ? <KeysView token={token} />
          : seccion === "cola" ? <Seccion titulo="Cola" grupo="Operación">
              <QueueRow token={token} /></Seccion>
          : <Seccion titulo="Índices instalados" grupo="Servidor">
              {capIndices?.state === "on" ? <IndicesPanel token={token} /> : (
                <p className="mt-[19px] text-[11px] text-muted">{capIndices?.reason ?? "no disponible"}</p>
              )}
            </Seccion>}
      </div>
    </div>
  );
}

/** La cabecera común de una sección mudada. Existe para que las cinco vistas
 *  que se mudan no tengan que aprender a pintar su propio título. */
export function Seccion({ titulo, grupo, accion, children }: {
  titulo: string; grupo: string; accion?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">{grupo}</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">{titulo}</h2>
        {accion && <span className="ml-auto pb-px">{accion}</span>}
      </div>
      <div className="mt-[19px]">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Quitar el `onClose` que ya no hace falta**

`AdminPanel` ya no recibe `onClose`: salir del panel es cosa de las migas de `TitleBar`, que
`App.tsx` ya rellena con `[Proyectos, Administración]` y donde «Proyectos» ya vuelve al selector.
En `client/src/App.tsx`, cambia la línea que monta el panel a:

```tsx
      ) : mode === "admin" ? (
        <AdminPanel token={useServer.getState().token!} />
```

- [ ] **Step 5: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: compila. Fallará mientras no existan `ResumenView` y `KeysView`, que son las tareas 4 y 5
— **si eso pasa, crea los dos ficheros como un componente vacío que devuelva `null`**, termina esta
tarea, y las tareas 4 y 5 los rellenan. Anótalo con un comentario en cada uno.

- [ ] **Step 6: Commit**

```bash
git add client/src/admin/Sidebar.tsx client/src/admin/Hueco.tsx client/src/admin/AdminPanel.tsx client/src/admin/ResumenView.tsx client/src/admin/KeysView.tsx client/src/App.tsx
git commit -m "Una pila que crece por abajo no es navegacion"
```

---

## Task 4: El Resumen

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify (o crea si la tarea 3 lo dejó vacío): `client/src/admin/ResumenView.tsx`

**Interfaces:**
- Consume: `GET /v1/admin/resumen` (tarea 1), `Seccion` (tarea 3).
- Produce: `ResumenView({ token, onIr })`.

- [ ] **Step 1: El tipo en el cliente**

En `client/src/lib/api.ts`, junto a los demás tipos de administración:

```ts
export interface Resumen {
  solicitudes_pendientes: number;
  /** Epoch de la más antigua sin resolver. `null` si no hay ninguna. */
  solicitud_mas_antigua: number | null;
  usuarios: number;
  usuarios_conectados: number;
  analisis_hoy: number;
  analisis_en_cola: number;
  /** Siete días, el más reciente al final. */
  analisis_serie: number[];
  indices: number;
  indices_bytes: number;
  teselas: number;
  arrancado_en: number;
}
```

- [ ] **Step 2: La pantalla**

Escribe `client/src/admin/ResumenView.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { api, type Resumen } from "../lib/api";
import type { Seccion } from "./Sidebar";

const KB = 1024;
function tamano(bytes: number): string {
  if (bytes < KB * KB * KB) return `${(bytes / KB / KB).toFixed(0)} MiB`;
  return `${(bytes / KB / KB / KB).toFixed(1)} GiB`;
}

function desdeHace(epoch: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - epoch);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600);
  if (d > 0) return `${d} d ${String(h).padStart(2, "0")} h`;
  return `${h} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} min`;
}

/** Cuenta hasta el valor en vez de saltar: un número que salta se lee como un
 *  fallo de render, uno que sube se lee como un dato que cambió. */
function Cifra({ n }: { n: number }) {
  const [v, setV] = useState(0);
  const desde = useRef(0);
  useEffect(() => {
    const d0 = desde.current, t0 = performance.now(), dur = 620;
    let vivo = true;
    const paso = (t: number) => {
      if (!vivo) return;
      const p = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      setV(Math.round(d0 + (n - d0) * e));
      if (p < 1) requestAnimationFrame(paso);
      else desde.current = n;
    };
    requestAnimationFrame(paso);
    return () => { vivo = false; };
  }, [n]);
  return <>{v}</>;
}

function Chispa({ serie }: { serie: number[] }) {
  const max = Math.max(...serie, 1);
  return (
    <div className="mt-[11px] flex h-[15px] items-end gap-[3px]">
      {serie.map((v, i) => (
        <i key={i} className={`min-h-0.5 max-w-[9px] flex-1 rounded-[1px] transition-[height]
          duration-700 ease-expo ${i === serie.length - 1 ? "bg-subtle" : "bg-border"}`}
          style={{ height: `${Math.max(8, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function Ficha({ k, valor, unidad, sub, serie, i, onClick }: {
  k: string; valor: React.ReactNode; unidad?: string; sub: string;
  serie?: number[]; i: number; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
      style={{ animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both` }}
      className="rounded-[11px] border border-border bg-panel p-[13px_14px] text-left
        shadow-[inset_0_1px_0_rgba(255,255,255,.045)] transition-[border-color,transform]
        duration-[450ms] ease-expo enabled:hover:-translate-y-0.5 enabled:hover:border-white/20">
      <span className="block text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
      <div className="mt-2 text-[25px] font-medium leading-none tracking-[-.035em] tabular-nums">
        {valor}
        {unidad && <small className="ml-[5px] text-[10.5px] font-normal tracking-normal text-subtle">{unidad}</small>}
      </div>
      <div className="mt-1.5 text-[9.5px] text-subtle">{sub}</div>
      {serie && <Chispa serie={serie} />}
    </button>
  );
}

/** Solo al entrar. Cambiar de sección no vuelve a pedir, así que el esqueleto
 *  no reaparece cada vez que miras. */
function Esqueleto() {
  return (
    <div className="px-6 pt-5">
      <div className="h-[21px] w-[186px] animate-pulse rounded-[7px] bg-elevated" />
      <div className="mt-[19px] grid grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[104px] animate-pulse rounded-[11px] bg-elevated" />
        ))}
      </div>
      <p className="mt-4 font-mono text-[10.5px] text-subtle">pidiendo /v1/admin/resumen</p>
    </div>
  );
}

export function ResumenView({ token, onIr }: { token: string; onIr: (s: Seccion) => void }) {
  const [r, setR] = useState<Resumen | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<Resumen>("/v1/admin/resumen", token).then(setR).catch((e) => setError(String(e)));
  }, [token]);

  if (error) return <p className="px-6 pt-5 text-[11px] text-danger-fg">{error}</p>;
  if (!r) return <Esqueleto />;

  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">Servidor</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">Resumen</h2>
        <span className="ml-auto pb-0.5 font-mono text-[10.5px] text-subtle">
          en marcha desde hace {desdeHace(r.arrancado_en)}
        </span>
      </div>

      <div className="mt-[19px] grid grid-cols-4 gap-3">
        <Ficha i={0} k="Pendiente de ti" valor={<Cifra n={r.solicitudes_pendientes} />}
          unidad="solicitudes" onClick={() => onIr("solicitudes")}
          sub={r.solicitud_mas_antigua
            ? `la más antigua, hace ${desdeHace(r.solicitud_mas_antigua)}`
            : "nada esperando"} />
        <Ficha i={1} k="Usuarios" valor={<Cifra n={r.usuarios} />}
          sub={`${r.usuarios_conectados} conectados ahora`} onClick={() => onIr("usuarios")} />
        <Ficha i={2} k="Análisis hoy" valor={<Cifra n={r.analisis_hoy} />}
          sub={`${r.analisis_en_cola} en cola`} serie={r.analisis_serie}
          onClick={() => onIr("cola")} />
        <Ficha i={3} k="Índices instalados" valor={<Cifra n={r.indices} />}
          unidad={`· ${tamano(r.indices_bytes)}`} sub={`${r.teselas} teselas cubiertas`}
          onClick={() => onIr("indices")} />
      </div>

      {/* Dependen del gestor de modelos y no se pueden construir todavía. Se
          declaran en punteado, igual que las entradas atenuadas de la barra. */}
      <div className="mt-3 grid max-w-[596px] grid-cols-2 gap-3">
        {[["Niveles listos"], ["Pesos en disco"]].map(([k], i) => (
          <div key={k} className="rounded-[11px] border border-dashed border-border p-[13px_14px] opacity-[.48]"
            style={{ animation: `jg-fade-rise .58s ${(4 + i) * 45}ms cubic-bezier(.16,1,.3,1) both` }}>
            <span className="block text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
            <div className="mt-2 text-[25px] font-medium leading-none text-muted">—</div>
            <div className="mt-1.5 text-[9.5px] text-subtle">llega con la gestión de modelos</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts client/src/admin/ResumenView.tsx
git commit -m "Que espera por ti, cuantos sois, cuanto se usa y que hay puesto"
```

---

## Task 5: API Keys, y el botón de instalar índice

**Files:**
- Modify (o crea si la tarea 3 lo dejó vacío): `client/src/admin/KeysView.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`

**Interfaces:**
- Consume: `Seccion` y `Seccion` (la cabecera) de la tarea 3, `MapRow` tal cual está.
- Produce: `KeysView({ token })`.

- [ ] **Step 1: La sección**

Escribe `client/src/admin/KeysView.tsx`:

```tsx
import { MapRow } from "./MapRow";
import { Seccion } from "./AdminPanel";

/** Todas las credenciales de terceros DEL SERVIDOR. `MapRow` se muda aquí tal
 *  cual: es la configuración del proveedor de mapas, y su sitio es este. */
export function KeysView({ token }: { token: string }) {
  return (
    <Seccion titulo="API Keys" grupo="Servidor">
      <p className="text-[11px] leading-[1.72] text-subtle">
        Ninguna se muestra entera, ni después de guardarla.
      </p>

      <div className="mt-4">
        <MapRow token={token} />
      </div>

      {/* Declarada, no escondida: el 3a la pedirá para los pesos cuyo
          proveedor exige token propio. */}
      <div className="mt-3 flex items-center gap-3 rounded-[11px] border border-dashed
        border-border p-[11px_14px]">
        <span className="min-w-0 text-[11.5px] text-muted">
          Proveedor de pesos
          <small className="ml-2 text-[9.5px] text-subtle">
            para modelos tras la puerta de su proveedor
          </small>
        </span>
        <span className="ml-auto rounded-[5px] border border-warning/40 px-1.5 py-px
          text-[8.5px] tracking-[.05em] text-warning-fg">la pide el gestor de modelos</span>
      </div>

      <p className="mt-4 text-[11px] leading-[1.72] text-subtle">
        Las de los orígenes de red —Mapillary, Flickr, Google— viven en el Lumi Indexer.
      </p>
    </Seccion>
  );
}
```

- [ ] **Step 2: El botón de instalar índice**

En `client/src/admin/AdminPanel.tsx`, la rama de `indices` pasa a llevar su acción en la cabecera:

```tsx
          : <Seccion titulo="Índices instalados" grupo="Servidor"
              accion={
                <button disabled title="Abrirá el catálogo remoto; todavía no hace nada"
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-2.5 py-1
                    text-[10.5px] font-medium text-black opacity-40">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Instalar índice
                </button>
              }>
```

Va **deshabilitado y con su motivo en el `title`**: la regla del proyecto es que un botón apagado
siempre dice por qué.

- [ ] **Step 3: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: verde.

- [ ] **Step 4: Commit**

```bash
git add client/src/admin/KeysView.tsx client/src/admin/AdminPanel.tsx
git commit -m "Las claves del servidor dejan de estar cada una en su esquina"
```

---

## Task 6: Solicitudes desplegables

**Files:**
- Modify: `client/src/admin/RequestsView.tsx`

**Interfaces:**
- Consume: `AdminRequest.device` (tarea 2).
- Produce: nada que otra tarea use.

- [ ] **Step 1: La fila que se abre**

En `client/src/admin/RequestsView.tsx`, sustituye el cuerpo que pinta cada fila por una cabecera
pulsable más un cuerpo desplegable. Añade el estado de cuál está abierta:

```tsx
  const [abierta, setAbierta] = useState<number | null>(null);
```

y la fila:

```tsx
        <div key={r.id} className="border-t border-border first:border-t-0">
          <button onClick={() => setAbierta(abierta === r.id ? null : r.id)}
            className="grid w-full grid-cols-[1fr_122px_92px_22px] items-center gap-3 px-3.5 py-3
              text-left transition-[background-color,padding-left] duration-[400ms] ease-expo
              hover:bg-white/[.03] hover:pl-[17px]">
            <span className="flex min-w-0 items-baseline gap-2 text-[11.5px] text-fg">
              {r.display_name}
              <small className="truncate text-[9.5px] text-subtle">{r.message.slice(0, 48)}</small>
            </span>
            <span className="font-mono text-[10.5px] text-muted">{cuando(r.created_at)}</span>
            <span className="text-right">
              <span className="rounded-[5px] border border-warning/40 px-1.5 py-px text-[8.5px]
                tracking-[.05em] text-warning-fg">esperando</span>
            </span>
            <span className={`flex justify-end text-subtle transition-transform duration-500 ease-expo
              ${abierta === r.id ? "rotate-180 text-fg" : ""}`}>
              <Icon name="chevron" size={13} />
            </span>
          </button>

          {/* 0fr → 1fr anima una altura automática sin medirla a mano ni fijar
              un máximo que se quede corto con un mensaje largo. */}
          <div className={`grid transition-[grid-template-rows] duration-[550ms] ease-expo
            ${abierta === r.id ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
            <div className="overflow-hidden">
              <div className="grid grid-cols-[1fr_262px] gap-5 px-3.5 pb-4 pt-0.5">
                <div>
                  <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">
                    Lo que escribió
                  </span>
                  <p className="border-l-2 border-border py-0.5 pl-3 text-[11.5px] italic
                    leading-[1.75] text-muted">{r.message}</p>
                </div>
                <div className="flex flex-col">
                  <Dato k="dispositivo" v={r.device ?? "no consta"} />
                  <Dato k="dirección" v={`${r.source_ip} · ${r.external ? "fuera de la red local" : "red local"}`} />
                  <Dato k="solicitado" v={new Date(r.created_at * 1000).toISOString().slice(0, 16).replace("T", " ")} />
                </div>
                <div className="col-span-2 flex items-center gap-2.5 pt-1">
                  <span className="mr-auto text-[10px] text-subtle">
                    Al aprobar entra con los límites globales; se ajustan luego en Usuarios.
                  </span>
                  {/* Los botones de resolver son los que ya había: no se
                      rediseñan, solo cambian de sitio. */}
                </div>
              </div>
            </div>
          </div>
        </div>
```

Y el ayudante, al final del fichero:

```tsx
function Dato({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border py-[5px]
      text-[10px] last:border-none">
      <span className="tracking-[.03em] text-subtle">{k}</span>
      <b className="text-right font-mono font-normal text-muted">{v}</b>
    </div>
  );
}
```

**Conserva los botones de aprobar y rechazar tal como están hoy** —con su selector de
`granted_models` y su llamada a `resolve(id, approve)`— moviéndolos al pie del desplegable. No se
rediseñan: eso es el 3b.

`cuando(created_at)` es el ayudante de fecha que el fichero ya tenga; si no tiene ninguno, usa
`new Date(created_at * 1000).toLocaleDateString()`.

- [ ] **Step 2: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: verde.

- [ ] **Step 3: Commit**

```bash
git add client/src/admin/RequestsView.tsx
git commit -m "El mensaje y el dispositivo llevaban guardados desde el subsistema 2 sin ensenarse"
```

---

## Task 7: Usuarios, tres densidades

**Files:**
- Create: `client/src/admin/UserTile.tsx`
- Modify: `client/src/admin/UsersView.tsx`

**Interfaces:**
- Consume: nada.
- Produce: `UserTile({ nombre, conectado, size })`.

> **No se llama `Avatar`**: `client/src/ui/Avatar.tsx` ya existe —un círculo con una inicial, que
> usa la barra de título— y dos componentes con el mismo nombre en el mismo cliente es una
> confusión garantizada al importar. Este es otra pieza: cuadrado redondeado, dos iniciales y punto
> de conexión. El de `ui/` **no se toca**.

- [ ] **Step 1: La ficha de usuario**

Crea `client/src/admin/UserTile.tsx`:

```tsx
/** Monograma sobre superficie neutra. El punto de conexión va FUERA de la caja
 *  y no la tiñe: un icono dentro de una caja de color es de las prohibiciones
 *  explícitas de DESIGN.md. */
export function UserTile({ nombre, conectado, size = 38 }: {
  nombre: string; conectado: boolean; size?: number;
}) {
  const ini = nombre.replace(/[^a-zA-Z]/g, "").slice(0, 2).toUpperCase();
  return (
    <span className="relative grid shrink-0 place-items-center rounded-[11px] border border-border
      bg-elevated font-medium tracking-[-.02em] text-fg
      shadow-[inset_0_1px_0_rgba(255,255,255,.045)]"
      style={{ width: size, height: size, fontSize: size < 30 ? 9.5 : 13,
        borderRadius: size < 30 ? 7 : 11 }}>
      {ini}
      <span className={`absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full ring-[2.5px]
        ring-panel ${conectado ? "bg-fg" : "bg-subtle"}`} />
    </span>
  );
}
```

- [ ] **Step 2: Las tres vistas**

En `client/src/admin/UsersView.tsx`, añade el estado de vista, que se recuerda en el navegador
—es una preferencia de quien mira, no un ajuste del servidor:

```tsx
type Vista = "lista" | "foto" | "nombre";

  const [vista, setVista] = useState<Vista>(
    () => (localStorage.getItem("lumi.usuarios.vista") as Vista) ?? "lista");
  useEffect(() => { localStorage.setItem("lumi.usuarios.vista", vista); }, [vista]);
```

el segmentado, en la cabecera de la sección:

```tsx
  const seg = (
    <span className="flex overflow-hidden rounded-[8px] border border-border bg-panel
      shadow-[inset_0_1px_0_rgba(255,255,255,.045)]">
      {([["lista", "Lista"], ["foto", "Retícula"], ["nombre", "Retícula con nombre"]] as const)
        .map(([v, t], i) => (
        <button key={v} title={t} onClick={() => setVista(v)}
          className={`flex items-center px-2 py-[4.5px] transition-colors duration-[340ms] ease-expo
            ${i > 0 ? "border-l border-border" : ""}
            ${vista === v ? "bg-white/[.075] text-fg" : "text-subtle hover:text-muted"}`}>
          <Icon name={v === "lista" ? "layers" : v === "foto" ? "boxes" : "image"} size={13} />
        </button>
      ))}
    </span>
  );
```

`layers`, `boxes` e `image` están los tres en `client/src/ui/Icon.tsx`. **No dibujes iconos
nuevos:** el conjunto es cerrado y es una regla de `DESIGN.md`.

y el cuerpo según la vista:

```tsx
  const cuerpo = vista === "lista" ? (
    <div className="overflow-hidden rounded-[11px] border border-border bg-panel">
      {rows.map((u, i) => (
        <div key={u.id} onClick={() => open(u.id)}
          style={{ animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both` }}
          className="grid cursor-pointer grid-cols-[1fr_96px_108px] items-center gap-3 border-t
            border-border px-3.5 py-2.5 first:border-t-0 transition-colors duration-[400ms]
            ease-expo hover:bg-white/[.026]">
          <span className="flex min-w-0 items-center gap-2.5 text-[11.5px] text-fg">
            <UserTile nombre={u.username} conectado={false} size={24} />
            {u.username}
          </span>
          <span className="text-[10.5px] text-muted">{u.is_admin ? "administrador" : "analista"}</span>
          <span className="text-right font-mono text-[10.5px] text-muted">#{u.id}</span>
        </div>
      ))}
    </div>
  ) : (
    <div className={`grid gap-3 ${vista === "foto"
      ? "grid-cols-[repeat(auto-fill,minmax(76px,1fr))]"
      : "grid-cols-[repeat(auto-fill,minmax(124px,1fr))]"}`}>
      {rows.map((u, i) => (
        <button key={u.id} onClick={() => open(u.id)}
          style={{ animation: `jg-fade-rise .58s ${Math.min(i, 8) * 45}ms cubic-bezier(.16,1,.3,1) both` }}
          className="flex flex-col items-center gap-2.5 rounded-[11px] border border-border bg-panel
            p-[13px_10px] shadow-[inset_0_1px_0_rgba(255,255,255,.045)]
            transition-[border-color,transform] duration-[450ms] ease-expo
            hover:-translate-y-[3px] hover:border-white/[.22]">
          <UserTile nombre={u.username} conectado={false} />
          {vista === "nombre" && (
            <>
              <span className="max-w-full truncate text-[11px] text-fg">{u.username}</span>
              <span className="text-[9px] tracking-[.04em] text-subtle">
                {u.is_admin ? "administrador" : "analista"}
              </span>
            </>
          )}
        </button>
      ))}
    </div>
  );
```

Envuelve todo en la cabecera común, con el segmentado como acción:

```tsx
  return (
    <Seccion titulo="Usuarios" grupo="Personas" accion={seg}>
      {error && <p className="mb-3 text-[11px] text-danger-fg">{error}</p>}
      {cuerpo}
      {/* El panel de detalle de un usuario es el que ya había: no se rediseña. */}
    </Seccion>
  );
```

Conserva intacto el `detail`/`LEVERS` que el fichero ya tiene: es el 3b quien lo rehará.

Los campos que uses de `AdminUser` tienen que ser los que ese tipo de verdad tenga en
`client/src/lib/api.ts` — si no hay `is_admin` o `username`, usa los que haya y ajusta el texto.

- [ ] **Step 3: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: verde. Abre las tres vistas y confirma que la elegida sigue puesta al recargar.

- [ ] **Step 4: Commit**

```bash
git add client/src/admin/UserTile.tsx client/src/admin/UsersView.tsx
git commit -m "Once cuentas caben de tres maneras y el que mira elige cual"
```

---

## Task 8: La franja de telemetría, dentro del panel

**Files:**
- Create: `client/src/admin/Franja.tsx`
- Modify: `client/src/admin/AdminPanel.tsx`

**Interfaces:**
- Consume: `useServer().sample` y `useServer().hello`, que ya existen y ya se refrescan solos.
- Produce: `Franja()`.

**Por qué solo aquí.** Fuera del panel la telemetría sigue siendo la píldora de `TitleBar`, que un
ciclo anterior eligió a propósito para no comerse 70 px permanentes de la pantalla donde se trabaja.
Dentro del panel el argumento se invierte: administrar **es** mirar la máquina, y esconder su estado
tras un clic obliga a abrir el popover cada vez. Es la misma fuente —`sample`— enseñada de dos
formas, no dos verdades.

- [ ] **Step 1: La franja**

Crea `client/src/admin/Franja.tsx`:

```tsx
import { useServer } from "../lib/store";

function Celda({ k, v, pct, warm }: { k: string; v: string; pct?: number; warm?: boolean }) {
  return (
    <div className="flex h-full items-center gap-[7px] border-r border-border px-[13px] last:border-none">
      <span className="text-[8.5px] uppercase tracking-[.13em] text-subtle">{k}</span>
      <span className="min-w-[46px] font-mono text-[10.5px] tabular-nums text-fg">{v}</span>
      {pct !== undefined && (
        <span className="h-[3px] w-[52px] overflow-hidden rounded-sm bg-elevated">
          <i className={`block h-full transition-[width] duration-[900ms] ease-expo
            ${warm ? "bg-warning" : "bg-muted"}`}
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </span>
      )}
    </div>
  );
}

/** El estado de la máquina, siempre a la vista mientras administras. Lee del
 *  mismo `sample` que la píldora de la barra de título: una sola fuente. */
export function Franja() {
  const { hello, sample } = useServer();
  const gpu = hello?.gpus[0];
  const m = gpu ? sample?.gpus.find((x) => x.index === gpu.index) : undefined;
  const vramPct = m && m.vram_total_mb > 0 ? (m.vram_used_mb / m.vram_total_mb) * 100 : 0;

  return (
    <div className="flex h-[30px] shrink-0 items-center border-b border-border
      bg-gradient-to-b from-[#121417] to-[#0f1114] px-1.5">
      {gpu ? (
        <>
          <Celda k="GPU" v={m ? `${m.util_pct} %` : "—"} pct={m?.util_pct ?? 0}
            warm={(m?.util_pct ?? 0) > 85} />
          <Celda k="VRAM" v={m ? `${(m.vram_used_mb / 1024).toFixed(1)} GiB` : "—"} pct={vramPct} />
          <Celda k="Temp" v={m?.temp_c != null ? `${m.temp_c} °C` : "—"} />
        </>
      ) : (
        // Sin GPU el servidor corre en CPU y lo dice, en vez de enseñar tres
        // celdas vacías que parecen una avería.
        <Celda k="CPU" v={sample ? `${sample.cpu_pct.toFixed(0)} %` : "—"}
          pct={sample?.cpu_pct ?? 0} warm={(sample?.cpu_pct ?? 0) > 85} />
      )}
      <Celda k="Cola" v={sample ? String(sample.queue_depth) : "—"} />
      <Celda k="Estado" v={sample?.queue_paused ? "EN PAUSA" : (hello?.state ?? "—")} />
    </div>
  );
}
```

- [ ] **Step 2: Ponerla arriba del panel**

En `client/src/admin/AdminPanel.tsx`, envuelve el `grid` de dos columnas para que la franja quede
encima y ocupe el ancho completo:

```tsx
  return (
    <div className="relative z-10 flex h-full flex-col overflow-hidden">
      <Franja />
      <div className="grid min-h-0 flex-1 grid-cols-[206px_1fr] overflow-hidden">
        <Sidebar actual={seccion} onIr={setSeccion} contadores={cuentas} />
        <div key={seccion} className="overflow-y-auto"
          style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
          {/* … el mismo contenido condicional que ya tenía … */}
        </div>
      </div>
    </div>
  );
```

y añade el import `import { Franja } from "./Franja";`.

- [ ] **Step 3: Comprobar**

Run: `cd client && npm run lint && npm run build`
Expected: verde. Con `npm run dev` la franja sale con guiones, porque sin daemon no hay `sample`
— y eso es lo correcto: dice «no lo sé», no cero.

- [ ] **Step 4: Commit**

```bash
git add client/src/admin/Franja.tsx client/src/admin/AdminPanel.tsx
git commit -m "Administrar es mirar la maquina, y esconderla tras un clic sobra"
```

---

## Task 9: Cerrar los documentos

**Files:**
- Modify: `ARCHITECTURE.md`
- Modify: `CLAUDE.md`
- Modify: `FUTURO.md`

- [ ] **Step 1: `ARCHITECTURE.md`**

En la tabla de subsistemas, sustituye la fila del **3** por cuatro:

```markdown
| **3** | **Panel de administración · esqueleto** | Barra lateral, secciones, Resumen, API Keys; las vistas del 2 y del 6 mudadas a su sitio | **Terminado** |
| **3a** | **Gestión de modelos** | Descargar pesos, aceptar licencias, verificar sha256, recargar registros en caliente | Con spec, pendiente |
| **3b** | **Rediseño de las vistas mudadas** | Solicitudes, usuarios, cola, mapa e índices por dentro | Pendiente |
| **3c** | **La máquina** | Hardware, monitorización con histórico, modo mantenimiento, notificaciones | Pendiente |
```

Y en el estado del servidor, donde dice `MAINTENANCE   ortogonal: lo introduce el subsistema 3`,
cambia `subsistema 3` por `subsistema 3c`.

- [ ] **Step 2: `CLAUDE.md`**

En «Subsystem status», sustituye lo que diga del 3 por:

```markdown
3 is **skeleton done** (sidebar, sections, Resumen, API Keys; the provisional views from
subsystems 2 and 6 moved into place) with **3a** (model management — spec written), **3b** (redesign
of the moved views) and **3c** (hardware, monitoring, maintenance, notifications) pending
```

- [ ] **Step 3: `FUTURO.md`**

En «Panel de administración real», quita de la lista **«una forma de rotar la clave del proveedor
de mapas para un admin que no tenga shell en el servidor»** —lo resuelve la sección API Keys de este
ciclo— y deja el resto, anotando que pasa a ser el 3b.

- [ ] **Step 4: Comprobar**

Run: `grep -n "subsistema 3\b" ARCHITECTURE.md FUTURO.md`
Expected: ninguna mención que prometa como pendiente algo que este ciclo ya hizo.

- [ ] **Step 5: Commit**

```bash
git add ARCHITECTURE.md CLAUDE.md FUTURO.md
git commit -m "El 3 deja de ser una fila y pasa a ser cuatro"
```

---

## Verificación final

```bash
cargo build --workspace && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace
cd client && npm run lint && npm run build
```

Todo verde, y **sin pruebas nuevas**: `cargo test` tiene que seguir dando exactamente los mismos
casos que antes de empezar.

Lo que **no** se puede verificar en Windows: arrancar `lumid` y abrir el panel de verdad. `lumi
install` falla a propósito fuera de systemd y sin él no hay certificado. La verificación aquí es
compilar, pasar el linter, y `npm run dev` en `client/` para ver el layout en el navegador —sin
`invoke()`, así que el panel se ve pero no habla con el daemon.
