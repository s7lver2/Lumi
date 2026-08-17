# Hardware (GPU) — diseño

## Resumen

Nueva sección "Hardware" del panel de administración de Lumi Station, hasta ahora un
placeholder "pronto" ([Hueco.tsx](../../../client/src/admin/Hueco.tsx)). Cubre **solo GPU**
en esta entrega — CPU (temperatura por núcleo, PPT/PBO) es una spec hermana aparte, con el
mismo patrón de capacidades, que se escribe en un ciclo posterior.

Monitorización siempre activa (borde/hotspot/memoria, VRAM, reloj, potencia, rpm de
ventilador) más dos modos de edición — básico (un slider de potencia entre los límites de
fábrica) y avanzado (potencia sin techo de fábrica, curva de offset de reloj, curva de
ventilador, ambas editables como un eje de coordenadas con puntos arrastrables) — con alerta
de confirmación explícita antes de aplicar cualquier valor fuera del rango de fábrica.

## Viabilidad técnica (por qué el alcance es este y no "controlar el voltaje")

Ninguna GPU expone el voltaje de núcleo a software de terceros en ninguna plataforma: ni
NVIDIA ni AMD lo permiten vía driver oficial. Lo que sí existe, y es lo que se construye aquí:

- **Límite de potencia** (vatios) — vía NVML (`nvmlDeviceSetPowerManagementLimit`), funciona
  en Linux nativo sin dependencias adicionales. Es el proxy real más cercano a "bajar
  voltaje": un límite de potencia menor empuja el boost a frecuencias (y por tanto voltajes
  de curva V/F) más bajos.
- **Offset de reloj** (núcleo/memoria) y **curva de ventilador** — ambos exclusivamente vía
  `nvidia-settings`, que requiere un servidor X corriendo con `Coolbits` activo. No existe
  equivalente en NVML. Muchas tarjetas de diseño de referencia o blower bloquean además la
  escritura de ventilador a nivel de firmware aunque el software lo permita.

**WSL2 (el entorno de desarrollo actual) pasa la GPU en modo de solo lectura**: NVML puede
leer todo (por eso Resumen ya muestra telemetría de GPU hoy), pero cualquier llamada de
escritura falla siempre, sin excepción, porque el driver real vive en Windows y la distro solo
tiene un stub de monitorización ([detect.rs:110](../../../crates/lumi-cli/src/detect.rs#L110)).

Consecuencia de diseño: **todo control de escritura pasa por la matriz de capacidades** ya
usada en el resto del panel — si el entorno no lo permite (WSL2, o Linux nativo sin X), el
control aparece deshabilitado con el motivo real, nunca oculto y nunca fingiendo que funcionó.
La monitorización, en cambio, no depende de esto y funciona siempre que NVML esté disponible.

## Alcance

**Corrección tras verificar contra el código fuente de `nvml-wrapper` 0.10** (la versión que ya
trae el workspace): la librería solo expone **un** sensor de temperatura por GPU
(`temperature(TemperatureSensor::Gpu)`) — no hay hotspot ni memoria-junction en su API, así
que el mockup de tres sensores no es alcanzable con esta dependencia sin FFI adicional fuera
de alcance. Y el ventilador se lee como **porcentaje** (`fan_speed(fan_idx)`), no como rpm —
no existe ninguna métrica de rpm expuesta. Ambas cosas se corrigen abajo.

**Dentro:**
- Monitorización por GPU: temperatura (un único sensor por tarjeta), % de uso, VRAM
  usada/total, reloj núcleo actual, potencia actual, velocidad de ventilador en %. Multi-GPU:
  una fila por dispositivo.
- Modo básico: slider de límite de potencia entre el mínimo y máximo de fábrica que NVML
  reporta para esa tarjeta (nunca por debajo ni por encima).
- Modo avanzado: el mismo slider de potencia pero sin techo (hasta el máximo absoluto que
  NVML permite fijar), más dos curvas editables por puntos arrastrables — offset de reloj
  (potencia→MHz para núcleo y memoria) y ventilador (temperatura→%).
- Alerta de confirmación al aplicar cualquier valor fuera del rango de fábrica: modal con
  icono de advertencia grande centrado, texto explicando el motivo, y un campo que exige
  escribir "soy consciente" para habilitar "Aplicar cambios".
- Persistencia: el último perfil aplicado (potencia, offsets, curva de ventilador) se guarda
  en SQLite y `lumid` lo reaplica automáticamente al arrancar y detectar cada GPU.
- Capacidades: dos nuevas entradas en la matriz — control de potencia (requiere NVML de
  escritura) y control de reloj/ventilador (requiere `nvidia-settings` + Coolbits) — cada
  una con su `reason` real cuando no está disponible.

**Fuera de esta entrega** (anotado en FUTURO.md al cerrar el plan):
- CPU (temperatura por núcleo, PPT/PBO) — spec hermana aparte.
- Comprobación previa de si el ventilador de una tarjeta concreta acepta escritura a nivel de
  firmware — se intenta y, si NVIDIA/el driver la rechaza, el error de esa aplicación
  concreta se muestra tal cual venga, no se intenta adivinar de antemano.

## Arquitectura

**Lecturas** (`crates/lumid/src/hardware.rs`, nuevo): sobre NVML, una función por dispositivo
que junta lo que ya expone `telemetry::sample`'s `GpuSample` (que se amplía: reloj núcleo
actual, ventilador en %) con el rango de fábrica de cada tarjeta
(`power_management_limit_constraints`, `temperature_threshold`). El rango de fábrica se lee
una vez por conexión de telemetría, no en cada muestra — no cambia mientras la tarjeta no
cambia.

**Escrituras**: dos caminos distintos, cada uno en su propia función, cada uno detrás de su
propia entrada de capacidad:
- Potencia: `nvmlDeviceSetPowerManagementLimit` directo, sin subproceso.
- Offset de reloj / curva de ventilador: subprocess `tokio::process::Command` a
  `nvidia-settings -a [gpu:N]/GPUGraphicsClockOffset[3]=X -a [fan:N]/GPUTargetFanSpeed=Y`,
  siguiendo el mismo patrón async que ya usa `verificar.rs` para no bloquear el runtime.
  Antes de ofrecer el control, se comprueba una vez si hay un `$DISPLAY` con Coolbits
  (`nvidia-settings -q GPUGraphicsClockOffset` sin fallar) y ese resultado alimenta el
  `reason` de la capacidad.

**Persistencia**: nueva tabla `hardware_profiles` (`gpu_index`, `power_limit_mw`,
`core_offset_mhz`, `mem_offset_mhz`, `fan_curve` como JSON de puntos `{temp_c, fan_pct}`,
`updated_at`). Al arrancar, tras detectar las GPUs, `lumid` reaplica cada fila que exista para
el índice detectado — si una GPU con perfil guardado no aparece (se quitó, o cambió de
índice), el perfil queda huérfano en la tabla sin reaplicarse a otra tarjeta por error.

**Rutas** (`crates/lumid/src/routes/hardware.rs`, nuevo):
- `GET /v1/admin/hardware` — lista de dispositivos con su lectura actual + rango de fábrica +
  perfil aplicado. Alimenta tanto la vista básica como la fila de cada dispositivo en avanzado.
- `PATCH /v1/admin/hardware/{gpu_index}` — aplica un nuevo perfil (potencia y/o offsets y/o
  curva). Si el valor pedido sale del rango de fábrica y la petición no incluye una bandera
  `confirmado: true`, responde `409` con el motivo — el modal de "soy consciente" es lo que
  reintenta la petición con esa bandera puesta, nunca el primer intento silencioso.

**Tiempo real**: no hace falta un canal nuevo — se reutiliza la SSE de telemetría existente
(`routes::telemetry::sse`), ampliando `Sample` con los campos de reloj y ventilador que
faltan. La sección Hardware, además, hace su propio `GET /v1/admin/hardware` al entrar (para
el rango de fábrica y el perfil persistido, que no viajan por telemetría) y luego se apoya en
la SSE ya abierta para las cifras que cambian.

## Interfaz

**Pantalla principal**: cabecera con interruptor Básico/Avanzado global (afecta a todos los
dispositivos a la vez, con el mismo motivo de píldora deslizante que ya usa la barra lateral).
Debajo, una fila por GPU: icono de dispositivo dibujado a mano (mismo lenguaje de trazo que
`ui/Icon.tsx`), anillo de temperatura como protagonista visual, métricas secundarias en línea
(potencia, reloj, ventilador en %), una miniatura de historial reciente, y una etiqueta discreta
si algo está fuera de fábrica. En básico la fila no es interactiva más allá de sus propios
datos; en avanzado, un clic en la fila abre el editor.

**Editor** (modal aparte, no expansión in-line): cabecera con el dispositivo, cuatro pestañas
— Potencia (gauge + slider + histórico), Ventilador (curva por puntos + tabla editable
sincronizada + histórico), Reloj (misma curva reutilizada para offset núcleo/memoria, dos
series), Sensores (tabla de lecturas con su rango de fábrica). Cada punto de una curva se
arrastra directamente sobre el propio eje de coordenadas (temperatura/potencia en X, según la
pestaña; %/MHz en Y), con la zona por encima del umbral de fábrica sombreada en el propio
gráfico — la tabla de la derecha refleja el punto seleccionado en vivo mientras se arrastra, y
también se puede editar el número directamente ahí. Pie con "Cancelar" / "Aplicar cambios".

**Confirmación**: al aplicar con algún valor fuera de fábrica, un modal centrado con un icono
de advertencia grande en un círculo, el motivo exacto (qué valor y qué límite de fábrica
supera), y un campo que exige escribir "soy consciente" antes de habilitar "Aplicar de todas
formas". Se dispara en cada aplicación que siga fuera de rango, no solo la primera vez.

## Testing

Sigue la convención del proyecto: sin tests salvo lo no trivial. `hardware.rs` (cálculo de si
un valor está dentro/fuera del rango de fábrica, y el ensamblado del perfil a reaplicar al
arrancar) es lógica pura sin GPU real de por medio — candidata a `cargo test -p lumid` igual
que ya existe para `lumi-proto`. La llamada real a NVML/`nvidia-settings` no se testea
automáticamente: se prueba a mano contra hardware real, como ya ocurre con el resto de
detección de hardware del proyecto.
