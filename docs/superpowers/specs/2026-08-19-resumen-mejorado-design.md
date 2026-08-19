# Resumen mejorado — diseño

## Contexto

`ResumenView.tsx` es la pantalla de aterrizaje del panel de administración:
hoy muestra un título fijo "Resumen", cuatro fichas de estadísticas
(solicitudes pendientes, usuarios, análisis de hoy, índices instalados) y
dos placeholders punteados a la espera de la gestión de modelos. No hay
ningún indicio de identidad del servidor, ni de su estado operativo
(cola/hardware), ni de qué ha pasado recientemente, ni de qué le falta
configurar a un servidor recién instalado.

Esta spec añade, en orden de arriba abajo en la página:

1. Una lista de **primeros pasos** (dismissible), solo mientras falte algo.
2. Una **cabecera con identidad del servidor** (perfil + tarjeta de
   servidor copiable), con fallback al título simple de hoy si no hay
   perfil configurado.
3. Las cuatro fichas de estadísticas de siempre (sin cambios).
4. Dos tarjetas lado a lado: **cola/trabajadores** y **hardware** (ambas de
   solo lectura, condensadas).
5. Una **actividad reciente** (feed de los últimos eventos).

Aprobado con mockups (ver `.superpowers/brainstorm/613-1787161176/content/resumen-v2.html`
para el tratamiento visual de referencia): bordes finos de 1px, color
contenido, mono para valores técnicos, la tarjeta de servidor como pastilla
dentro de la cabecera (no como fila aparte).

## 1. Primeros pasos (checklist)

Cuatro chequeos, todos derivables de datos que **ya existen** — sin tabla
nueva:

| Chequeo | Se cumple cuando | Fuente |
|---|---|---|
| Perfil del servidor | `GET /v1/admin/server-profile` → `title` no vacío | ya existe |
| Modelo instalado | `Resumen.modelos_instalados == true` (campo nuevo, ver §3) | nuevo campo en endpoint existente |
| Índice instalado | `Resumen.indices > 0` | ya existe |
| Más de un usuario | `Resumen.usuarios > 1` | ya existe |

Cada fila pendiente lleva un enlace corto ("Modelos →", "Índices →",
"Solicitudes →") que navega a esa sección (mismo `onIr` que ya usan las
fichas). El bloque entero:

- Se **oculta solo** en cuanto los cuatro chequeos están cumplidos — no
  hace falta que el admin la cierre a mano para que desaparezca.
- Se puede cerrar a mano (✕) antes de eso; el cierre se recuerda en
  `localStorage` (`lumi.resumen.primerosPasos.oculto`, mismo patrón que
  `lumi.notificaciones.leido`) y es permanente para ese perfil de
  navegador — no vuelve a aparecer aunque se desinstale un modelo después.
- Es puramente de cliente: no hay endpoint que marque "visto", igual que
  el resto de estado de UI que no necesita sincronizarse entre sesiones.

## 2. Cabecera con identidad del servidor

Reutiliza `ServerProfileCard` (ya existente, usado en el popup de
bienvenida) en una variante de ancho completo: banner de fondo con
degradado oscuro, foto circular superpuesta, título y descripción. Dentro
de esa misma cabecera, una pastilla en la esquina superior derecha con la
tarjeta de servidor (`lumi1s_...`, dato que `GET /v1/admin/network` ya
devuelve como `server_card` desde la spec de red — no se dejó de calcular,
solo de mostrarse en esa vista) y un botón "Copiar".

**Sin perfil configurado** (`title` vacío): se mantiene la cabecera simple
de hoy (título "Resumen" + "en marcha desde hace…"), con la pastilla de
tarjeta de servidor añadida igual — la tarjeta no depende de que exista un
perfil.

## 3. Estadísticas (sin cambios) + campo nuevo en el endpoint

Las cuatro `Ficha` de siempre no cambian. Se añade un campo al struct
`Resumen` (`lumi-proto::api`) y a `admin::resumen()`:

```rust
pub modelos_instalados: bool,
```

calculado reutilizando el mismo criterio que ya usa `routes::models::estado`
(licencia presente junto al peso) — se factoriza a una función compartida
`models::hay_alguno_instalado(&App) -> bool` que ambos handlers llaman, en
vez de duplicar el escaneo del directorio.

## 4. Cola y hardware (condensados, solo lectura)

Dos tarjetas en una fila de dos columnas:

- **Cola**: reutiliza `QueueRow` tal cual (ya sondea `/v1/queue` cada 2s,
  ya muestra cada trabajador y su estado) — se monta directamente, sin
  duplicar su lógica.
- **Hardware**: nuevo componente `HardwareGlance.tsx`, de solo lectura
  (sin los sliders/editores de `HardwareView`), que lee `/v1/admin/hardware`
  y `/v1/admin/hardware/cpu` (ambos ya existentes) y pinta una fila por GPU
  (temperatura, VRAM usada/total, potencia) y una fila para CPU
  (temperatura, potencia) — mismos datos que ya expone `HardwareView`,
  presentados sin controles.

## 5. Actividad reciente

**Único endpoint nuevo de esta spec**: `GET /v1/admin/actividad` (admin) →
`Vec<ActividadItem>`, los últimos 15 eventos combinando cuatro fuentes que
ya existen, cada una con su propio `SELECT ... ORDER BY <fecha> DESC LIMIT 15`,
fusionadas en Rust y reordenadas por fecha antes de recortar a 15:

```rust
#[serde(tag = "tipo", rename_all = "snake_case")]
pub enum ActividadItem {
    CuentaCreada { username: String, at: i64 },
    AnalisisResuelto { id: i64, estado: String, at: i64 },
    AvisoPublicado { extracto: String, at: i64 },
    SolicitudResuelta { display_name: String, aprobada: bool, at: i64 },
}
```

- `CuentaCreada`: `users (username, created_at)`.
- `AnalisisResuelto`: `analyses (id, state, finished_at)` donde
  `state IN ('hecho','error')` y `finished_at IS NOT NULL`.
- `AvisoPublicado`: `avisos (contenido, created_at)` — `extracto` es texto
  plano truncado (~50 caracteres), extraído del documento Tiptap JSON con
  un recorrido recursivo simple sobre sus nodos `text` (función nueva y
  pequeña, vive junto al handler — no hay ninguna extracción de texto plano
  del lado Rust hoy; la que existe, `textoPlano`, es del lado cliente y no
  aplica aquí).
- `SolicitudResuelta`: `access_requests (display_name, status, resolved_at)`
  donde `status IN ('approved','rejected')` y `resolved_at IS NOT NULL`.

El cliente (`ActividadFeed.tsx`) formatea cada variante a una línea de
texto según su `tipo`, con el "hace cuánto" a la derecha. La función
`ago()` (formato compacto "12 min"/"3 h") ya vive duplicada en
`NotificationsPopover.tsx`; se extrae a `client/src/lib/time.ts` y ambos
sitios pasan a importarla de ahí en vez de mantener dos copias.

## Animaciones

Reutiliza el vocabulario ya establecido en el resto del panel (`jg-fade-rise`,
`jg-press`, `ease-expo`), no introduce ninguno nuevo:

- Las filas de "Primeros pasos" entran con el mismo `jg-fade-rise` escalonado
  que ya usan las `Ficha`; al completarse un chequeo, su fila se tacha con
  una transición de color/`text-decoration` (no desaparece de golpe) y la
  barra de progreso anima su ancho con `ease-expo`.
- Cuando el último chequeo se completa, el bloque entero colapsa con la
  misma técnica `grid-template-rows: 1fr → 0fr` que ya usa `SecurityView`
  para sus paneles expandibles, en vez de desaparecer en un frame.
- La cabecera, las fichas de stats, y las tarjetas de cola/hardware/actividad
  entran con `jg-fade-rise` escalonado por índice, igual que las `Ficha`
  actuales.
- Las filas de actividad nuevas (cuando llega una vía sondeo, si se decide
  refrescar en vivo) entran con el mismo `jg-fade-rise` en vez de aparecer
  sin transición.
- Hover en las tarjetas de cola/hardware/actividad: mismo
  `hover:-translate-y-0.5` + `hover:border-white/20` que ya usan las
  `Ficha`, para que toda la página se sienta como una sola superficie con
  el mismo lenguaje de interacción.

## Fuera de alcance

- Editar hardware desde el Resumen (sigue siendo exclusivo de Hardware).
- Actividad en tiempo real vía SSE — el feed se pide una vez al entrar,
  igual que el resto del Resumen hoy (no hay sondeo continuo).
- Chequeos adicionales de "primeros pasos" (Zero Trust, políticas de
  aceptación, red): son decisiones opcionales del admin, no requisitos —
  marcarlas como "pendientes" sería un juicio de valor que esta spec no
  pretende hacer.
