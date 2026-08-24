# Pestaña Doctor — diseño

## Contexto

Del repaso de qué falta en los subsistemas 3b/3c salieron dos huecos que el
usuario pidió combinar en una sola sección nueva del panel de administración,
llamada **Doctor**: monitorización con histórico (hoy solo hay lectura en
vivo de hardware, sin serie temporal) y una pestaña de logs (hoy la única
forma de ver el log de `lumid` es `journalctl -u lumid` a mano en la máquina
del servidor).

Durante el brainstorming, con mockups interactivos de por medio, el alcance
creció en una dirección más: Doctor no solo debe **enseñar** el estado del
servidor, sino ayudar a **arreglar** algunos problemas con un clic, allí
donde arreglarlos es seguro y no ambiguo. Se investigó el código de la cola
(`crates/lumid/src/queue/`) para separar lo que ya se autorrepara de lo que
no:

- Un trabajador que se cuelga **cargando** (nunca llega a decir `listo`) ya
  se detecta y se relanza solo — hay un vigilante (`Queue::revisar`, tick
  cada `TICK_S`) que lo mata y lo vuelve a lanzar con backoff exponencial.
  Esto **no cambia**; Doctor no necesita hacer nada aquí salvo que se vea en
  el log.
- Un trabajador que ya dijo `listo`, tomó un análisis, y se quedó colgado
  **a mitad** de ese análisis **no** está cubierto por ese vigilante (que
  solo mira `!w.listo`). Este es un hueco real: hoy la única forma de
  recuperarlo es reiniciar el daemon entero.
- Qdrant puede caerse sin que el daemon principal se entere por su cuenta —
  la búsqueda por índices se rompe en silencio hasta que alguien lo nota.
- Disco casi lleno, GPU cerca de su límite térmico, y el historial de
  reinicios del propio daemon son señales útiles, pero **no** tienen un
  arreglo automático seguro: qué borrar o cuánto bajar la potencia son
  decisiones que ya tienen su propio flujo en el panel (Hardware, con su
  confirmación explícita) y no deben duplicarse ni automatizarse a ciegas
  aquí.

Se probó también la idea de darle a Doctor una mascota (una carita con
expresión, tipo Clippy) para reforzar la idea de "salud" — el usuario la
vio montada en el mockup y decidió que no encajaba; se retiró. La tarjeta de
salud usa un simple icono de estado (check / alerta) en su lugar, coherente
con el resto de iconografía del panel (trazo, sin relleno, un color).

## Alcance

Una sección nueva en la barra lateral, al final del grupo "Operación"
(después de Hardware). Icono nuevo `pulse` (línea de latido), siguiendo el
patrón de trazo de `client/src/ui/Icon.tsx`.

La página tiene dos bloques, uno encima del otro — no son pestañas
separadas, ambos se ven siempre:

1. **Salud** (arriba, siempre visible): un resumen de si hay problemas
   activos, y si los hay, una tarjeta por problema con la acción posible.
2. **Detalle** (debajo): el switcher de dos vistas ya validado en mockup,
   **Logs** e **Histórico** — mismo patrón visual que Cinta/Tabla en Cola.

Fuera de alcance: mascota (descartada), downsampling del histórico (a 1
muestra/min y 7 días de retención, 10.080 filas como mucho, no hace falta),
cualquier fix automático de disco o GPU, un log de incidentes persistido
(los problemas se calculan al vuelo en cada consulta, no se guardan).

## Salud: detección

`GET /v1/admin/telemetry/salud` (nueva ruta, admin-gated) calcula la lista
de problemas activos en el momento de la petición — nada se persiste ni se
computa en segundo plano; es barato de calcular bajo demanda y así no hay
estado de "incidente" que pueda quedar obsoleto. El frontend la sondea cada
10s con `setInterval` mientras la pestaña Doctor está abierta (no hace falta
otra conexión SSE persistente — a diferencia de la telemetría en vivo, que
importa que llegue cada segundo, aquí un problema que tarde hasta 10s en
aparecer en pantalla no cambia nada).

```rust
// lumi-proto/src/api.rs
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Problema {
    pub id: String,           // "trabajador:cuda:0", "qdrant", "disco", "gpu:0", "reinicios"
    pub titulo: String,
    pub detalle: String,
    /// `Some(x)` = hay un botón real; su texto es `x`. `None` = solo alerta,
    /// con `enlace` diciendo dónde se resuelve a mano.
    pub accion: Option<String>,
    pub enlace: Option<String>, // sección del panel, ej. "hardware", "doctor:logs"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SaludView {
    pub problemas: Vec<Problema>,
}
```

Comprobaciones, cada una independiente (una que falle no debe tumbar las
demás — cada una se envuelve en su propio `Result`/`Option` y un error se
trata como "sin problema detectado", no como un quinto problema):

1. **Trabajador colgado a mitad** — para cada `Vivo` en
   `Queue::trabajadores` con `trabajo: Some(id)`, si lleva más de 10
   minutos sin que llegue un evento de progreso/resultado/fallo para ese
   `id`, es un problema. Requiere un campo nuevo `en_curso_desde:
   Option<Instant>` en `Vivo` (`crates/lumid/src/queue/mod.rs`), fijado a
   `Some(Instant::now())` junto con `w.trabajo = Some(a.analysis_id)` (hoy
   en la línea ~1038, dentro del despacho) y puesto a `None` junto con
   `w.trabajo = None` (hoy en la línea ~948, cuando se libera el
   dispositivo al terminar el análisis). Se expone un método nuevo
   `Queue::colgados(&self, umbral: Duration) -> Vec<(String, i64)>`
   (dispositivo, analysis_id) que recorre `trabajadores` bajo el mismo
   `Mutex` que ya usa `revisar()`, sin bloqueo nuevo.
   - `accion`: `"Reiniciar este trabajador"`.

2. **Qdrant no responde** — `GET http://127.0.0.1:6333/` con
   `reqwest::Client` y un timeout corto (1.5s, un cliente dedicado con ese
   timeout — el `Cliente` de `qdrant.rs` tiene 120s pensado para búsquedas
   reales, no vale para un ping). Si no responde 200 a tiempo, problema.
   - `accion`: `"Reiniciar Qdrant"`.

3. **Disco casi lleno** — reusa `telemetry::sample()` (ya con
   `spawn_blocking`); si `disk_free_mb < 5000` (5GB), problema.
   - `accion`: `None`, `enlace`: `"hardware"`.

4. **GPU cerca del límite térmico** — de la misma muestra, si algún
   `GpuSample.temp_c` supera 85°C, problema (uno por GPU si hay varias).
   - `accion`: `None`, `enlace`: `"hardware"`.

5. **El daemon se reinició hace poco** — cuenta cuántas líneas
   `journalctl -u lumid --since "-1hour" -o cat | grep -c "^lumid escuchando en"`
   aparecen en la última hora (cada arranque limpio deja exactamente una,
   así que dos o más significa que hubo al menos un reinicio de por medio,
   voluntario o por crash). Con 2 o más, problema.
   - `accion`: `None`, `enlace`: `"doctor:logs"` (cambia a la vista Logs
     dentro de la misma página).
   - Si `journalctl` no está disponible (dev en Windows), esta comprobación
     se omite en silencio — no es un problema del servidor, es que no se
     puede saber; no tiene sentido fingir una alerta ni un error.

## Salud: arreglar

Dos rutas, ambas `POST`, admin-gated, cada una hace UNA cosa y devuelve
`204` o un error con motivo:

- `POST /v1/admin/doctor/arreglar/trabajador/:dispositivo` — busca
  `dispositivo` en `Queue::trabajadores`, le manda la señal `matar` (el
  mismo `oneshot::Sender<()>` que ya usa `revisar()` para el caso de
  arranque colgado) y confía en el vigilante existente para relanzarlo en
  su siguiente tick — no hace falta relanzarlo aquí mismo. Nuevo método
  `Queue::forzar_reinicio(&self, dispositivo: &str) -> bool` (`true` si
  había un trabajador vivo al que matar).

- `POST /v1/admin/doctor/arreglar/qdrant` — `tokio::process::Command::new("systemctl").args(["restart", "qdrant"]).output().await` (la versión de `tokio::process`, no la de `std::process` — ya es async por sí sola, así que no hace falta `spawn_blocking` aquí). Devuelve `500` con el `stderr` si el comando falla; en dev sin systemd el propio mensaje de error ya explica por qué (`No such file or directory` al buscar `systemctl`), sin necesitar un caso especial para esa plataforma.

Ninguna de las dos comprueba que el arreglo funcionó — el frontend vuelve a
sondear `/v1/admin/telemetry/salud` a los pocos segundos (mismo intervalo de
10s) y si el problema ya no aparece, la tarjeta pasa sola a "resuelto"; no
hace falta que el propio endpoint de arreglar lo confirme de forma
síncrona.

## Logs

`GET /v1/admin/logs/stream` (SSE, admin-gated). Al conectar, lanza como
subproceso:

```
journalctl -u lumid -n 300 -f -o cat --no-pager
```

con `tokio::process::Command`, `stdout(Stdio::piped())`,
`kill_on_drop(true)` (para que muera si el cliente SSE se desconecta), y
reenvía cada línea leída de su stdout como un evento SSE (`Event::default().data(linea)`)
tal cual, sin parsear nada en el servidor. Si el `spawn()` falla (typicamente
porque `journalctl` no existe: dev en Windows, o una instalación sin
systemd), se manda un único evento con `.event("error")` y un mensaje claro,
y se cierra el stream.

El frontend abre un `EventSource`, mantiene un buffer de hasta 2000 líneas
(las más viejas se descartan del DOM), hace auto-scroll salvo que el admin
haya subido manualmente, y aplica dos filtros **solo en el cliente** (el
servidor no sabe nada de niveles ni módulos, solo reenvía texto):

- Nivel mínimo (todos / INFO / WARN / ERROR) — parseado con una regex sobre
  cada línea: `^\S+\s+(TRACE|DEBUG|INFO|WARN|ERROR)\s+([^:]+):\s*(.*)$`
  (formato real de `tracing_subscriber::fmt::init()`, confirmado contra el
  journal en producción). Una línea que no matchea (un panic con
  backtrace, por ejemplo) se muestra igual, sin nivel ni target, y nunca se
  oculta por el filtro de nivel.
- Módulo — campo de texto libre, compara contra el `target` extraído por la
  misma regex (subcadena, insensible a mayúsculas).

Fuente monoespaciada para toda la línea (DESIGN.md: mono para cualquier cosa
de máquina — timestamps, logs).

## Histórico

Una tarea en segundo plano, arrancada una vez en `main.rs` (no por cliente,
a diferencia del SSE de telemetría en vivo):

```rust
tokio::spawn({
    let app = app.clone();
    async move { telemetry::muestrear_historial(app).await }
});
```

```rust
// telemetry.rs
pub async fn muestrear_historial(app: App) {
    loop {
        let app2 = app.clone();
        if let Ok(s) = tokio::task::spawn_blocking(move || sample(&app2, None)).await {
            persistir(&app, &s);
        }
        tokio::time::sleep(std::time::Duration::from_secs(60)).await;
    }
}

fn persistir(app: &App, s: &Sample) {
    let gpus_json = serde_json::to_string(&s.gpus).unwrap_or_default();
    let c = app.store.conn();
    let _ = c.execute(
        "INSERT INTO telemetry_historial (created_at, cpu_pct, ram_used_mb, disk_free_mb, queue_depth, gpus_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![ahora(), s.cpu_pct, s.ram_used_mb, s.disk_free_mb, s.queue_depth, gpus_json],
    );
    // Poda en el mismo tick: una tabla que crece sin límite es peor que
    // gastar un DELETE barato una vez por minuto.
    let hace_7_dias = ahora() - 7 * 24 * 3600;
    let _ = c.execute("DELETE FROM telemetry_historial WHERE created_at < ?1", [hace_7_dias]);
}
```

Nueva tabla en `store.rs` (mismo `SCHEMA` de siempre, `CREATE TABLE IF NOT
EXISTS`):

```sql
CREATE TABLE IF NOT EXISTS telemetry_historial (
    id          INTEGER PRIMARY KEY,
    created_at  INTEGER NOT NULL,
    cpu_pct     REAL NOT NULL,
    ram_used_mb INTEGER NOT NULL,
    disk_free_mb INTEGER NOT NULL,
    queue_depth INTEGER NOT NULL,
    gpus_json   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telemetry_historial_created_at ON telemetry_historial (created_at);
```

`GET /v1/admin/telemetry/historial?rango=1h|24h|7d` (admin-gated) traduce
`rango` a un `created_at >=` y devuelve las filas tal cual, deserializando
`gpus_json` de vuelta a `Vec<GpuSample>`:

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MuestraHistorial {
    pub created_at: i64,
    pub cpu_pct: f32,
    pub ram_used_mb: u64,
    pub disk_free_mb: u64,
    pub queue_depth: u32,
    pub gpus: Vec<GpuSample>,
}
```

Frontend: selector 1h/24h/7d (por defecto 24h, mismo patrón visual que los
botones de rango ya probados en el mockup), gráficos de línea dibujados a
mano en SVG inline — curva suavizada con Bézier por puntos medios, relleno
de área con degradado hacia transparente del mismo color de la línea,
líneas guía punteadas de fondo, mín/máx al pie, flecha de tendencia
(primera mitad del rango contra la segunda), y el trazo se anima al
dibujarse usando su longitud real (`path.getTotalLength()`) — todo esto ya
construido y probado en el mockup interactivo (`doctor-full.html`), se
traslada tal cual a componentes React. Sin librería de gráficas nueva.

## Frontend: ficheros

- `client/src/admin/DoctorView.tsx` — nuevo. Compone `SaludPanel`,
  `LogsPane`, `HistoricoPane` (o los tres inline si quedan cortos; se
  decide en la fase de implementación según cómo de largo salga cada uno,
  siguiendo la convención de archivos pequeños y con una responsabilidad).
- `client/src/admin/Sidebar.tsx` — añade `"doctor"` a `Seccion` y una
  entrada en el grupo "Operación" con el icono `pulse`.
- `client/src/ui/Icon.tsx` — añade `pulse` (línea de latido, mismo estilo
  de trazo que el resto).
- `client/src/admin/AdminPanel.tsx` — añade la rama
  `seccion === "doctor" ? <DoctorView token={token} onIr={setSeccion} /> `.
  `onIr` es lo que usa el enlace de un problema de disco/GPU para saltar a
  Hardware.
- `client/src/lib/api.ts` — tipos `Problema`, `SaludView`, `MuestraHistorial`.

## Autorreferencia

Doctor lee el estado del propio daemon que lo sirve — si el daemon está
completamente caído, Doctor tampoco carga (es una vista dentro del panel,
no un proceso aparte). Esto es aceptable: cubre el rango de problemas
"el daemon vive pero algo dentro de él está mal", no una caída total, que
ya la cubre systemd (`Restart=on-failure`) sin que nadie tenga que mirar
un panel.
