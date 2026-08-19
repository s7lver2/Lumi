# Optimización del daemon (lumid) — diseño

## Contexto

Hoy se diagnosticó y arregló un freeze completo del daemon: código síncrono
y bloqueante (llamadas NVML/sysinfo/subprocess) ejecutándose directamente
dentro de handlers `async fn` de axum, sin `tokio::task::spawn_blocking`.
Con solo 2 CPUs en la VM de producción (2 hilos de trabajo de tokio por
defecto), bastaban un par de peticiones concurrentes tocando ese código
para dejar el runtime entero sin hilos libres — confirmado con `ss -tlnp`
mostrando la cola de aceptación TCP saturada (`Recv-Q` = `backlog`).

Se pidió una auditoría completa del daemon para encontrar el resto de
sitios con la misma familia de bug antes de que se manifiesten como el
mismo síntoma. Esta spec cubre lo que la auditoría encontró con impacto
real, priorizado por gravedad. Dos hallazgos de bajo impacto se incluyen
igual por ser baratos de arreglar ya que están identificados con precisión;
el resto de hallazgos de bajo impacto/baja confianza quedan fuera (ver
"Fuera de alcance").

## 1. Transacción en la instalación de índices (crítico)

`crates/lumid/src/indices/volcar.rs::paquete()` abre `app.store.conn()` y
mantiene ese `MutexGuard` agarrado durante un bucle `for` sobre **todas**
las filas de `indice.db` de un paquete `.lumidx` (potencialmente miles),
haciendo un `INSERT INTO reference_images` por fila **sin transacción
explícita** — cada inserción es su propio commit/fsync de SQLite. Como el
mutex de `Store::conn()` es el único de todo el daemon (login, cola,
cualquier ruta), instalar un índice grande deja **la base de datos entera
bloqueada** durante el tiempo que tarden esos miles de fsyncs — el mismo
síntoma del freeze de hoy, pero potencialmente durante minutos en vez de
milisegundos, y disparado por una acción de admin perfectamente normal
(instalar un índice).

**Arreglo:** envolver el bucle en una única `Connection::transaction()`
(commit al final). Esto además hace la instalación mucho más rápida —
miles de fsyncs individuales pasan a ser una sola escritura de WAL — así
que es una mejora de rendimiento y de bloqueo a la vez, no un compromiso
entre ambos.

## 2. `spawn_blocking` para trabajo de imagen (alto impacto)

Dos sitios decodifican/recortan/reencodan imágenes de forma síncrona
dentro de un `async fn`, sin `spawn_blocking` — la misma clase exacta que
el bug de hardware ya arreglado:

- `routes/images.rs::upload()`: `image::guess_format`,
  `load_from_memory_with_format`, `.thumbnail(320,320)`, reencode a JPEG y
  `Sha256::digest` sobre payloads de hasta 64 MB. Es un endpoint de uso
  frecuente (cualquier analista subiendo fotos de un caso).
- `perfil.rs::guardar_recortada()` (avatar/banner de usuario y servidor):
  mismo patrón (`resize_to_fill` con Lanczos3, el filtro más caro, +
  reencode), payloads más pequeños (tope 8 MB) pero mismo defecto
  estructural.

**Arreglo:** mover el trabajo de decodificación/recorte/hash a
`tokio::task::spawn_blocking`, igual que ya se hizo hoy para las lecturas
de hardware. En `upload()`, el `execute()` de SQLite y la escritura del
archivo original se quedan donde están (rápidos); solo el trabajo de
`image`/`Sha256` se mueve.

## 3. `spawn_blocking` para escritura de hardware (medio-alto impacto)

Hoy solo se arregló la lectura (`GET /v1/admin/hardware`,
`GET /v1/admin/hardware/cpu`). Los handlers de escritura tienen el mismo
hueco, y encima llaman a la lectura sin envolver al final:

- `hardware::aplicar()` (GPU, `PATCH /v1/admin/hardware/:index`):
  `Nvml::init()`, `device_by_index`, `set_power_management_limit` síncronos.
- `hardware_cpu::aplicar()` (CPU, `PATCH /v1/admin/hardware/cpu`):
  `fabricante()`/`rango()` (lectura de sysfs), `escribir_rapl` (dos
  `std::fs::write` a sysfs en Intel), y al final llama a `dispositivo(app)`
  (la misma función ya envuelta en el GET, aquí sin envolver).

**Arreglo:** envolver el cuerpo síncrono de ambos `aplicar()` en
`spawn_blocking`, igual que sus contrapartidas de lectura. Se activan con
menos frecuencia que las lecturas (acción explícita de admin, no
automática), pero el hueco es idéntico.

## 4. Configuración explícita del runtime de tokio (bajo esfuerzo, cierra el resto)

`main.rs` usa `#[tokio::main]` sin parámetros — 2 hilos de trabajo en la
VM de 2 CPUs, y ningún límite explícito de `max_blocking_threads` (tokio
lo pone en 512 por defecto, que ya es generoso). Se deja explícito con
`#[tokio::main(flavor = "multi_thread", worker_threads = 2)]` — mismo
comportamiento de hoy, pero documentado como decisión y no como valor por
defecto accidental, y como sitio único donde subirlo si algún día el host
tiene más núcleos.

## 5. Limpieza menor (barata, incluida por estar ya identificada)

- `queue/mod.rs::duenos()`: por cada usuario distinto hace 3 llamadas
  separadas a `store.conn()` (límites efectivos, bloqueado, análisis en
  curso) — se combinan en una sola consulta con sub-selects o se agrupan
  en una única función que las pida juntas bajo un solo `conn()`.
- `queue/mod.rs::para_aplicar()`: relockea los `Mutex` en memoria (`geo`,
  `agentes`, `modelos`, etc.) dentro de un `.map()` por candidato — se
  agarran una sola vez antes del `map` y se reutilizan.

## Fuera de alcance

- Lecturas/escrituras de disco síncronas de bajo volumen y tamaño fijo
  pequeño (servir un avatar ya recortado a 256×256, leer `model_task`,
  listar el directorio de pesos, el log de stderr de un worker): la
  auditoría las señaló con confianza baja/media de impacto real — son
  syscalls sobre archivos de kilobytes, no de megabytes ni bucles de
  miles de filas. Envolverlas todas en `spawn_blocking` añadiría
  boilerplate sin beneficio medible.
- El planificador de la cola (`queue/plan.rs::repartir`): la auditoría no
  encontró ninguna GPU quedándose ociosa con trabajo asignable — no hay
  nada que arreglar ahí.
- Cliente (Tauri/React) y servicio de inferencia (workers Python): temas
  aparte, cada uno con su propio ciclo de spec/plan cuando se aborden.
