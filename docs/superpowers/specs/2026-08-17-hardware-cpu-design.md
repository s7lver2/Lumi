# Hardware (CPU) — diseño

## Resumen

Spec hermana de `2026-08-17-hardware-gpu-design.md`: añade la CPU como otra fila en la misma
pantalla `HardwareView` ya construida para GPU, reutilizando `HardwareEditor` y
`ConfirmarPeligro`. Cubre monitorización (temperatura por núcleo, uso por núcleo) y control
de potencia — con dos mecanismos completamente distintos según fabricante, y perfiles de
riesgo muy distintos entre ellos.

## Viabilidad técnica

**WSL2 no expone nada de esto.** Verificado empíricamente en este mismo host:
`/sys/class/hwmon/` y `/sys/class/powercap/` están **completamente vacíos** dentro de WSL2 —
a diferencia de la GPU (que al menos se lee), aquí no hay ni un solo sensor ni la interfaz
RAPL. WSL2 corre como una VM ligera de Hyper-V sin acceso a los MSR ni al hardware de sensores
del host, así que en este entorno de desarrollo toda la sección CPU aparecerá deshabilitada
con ese motivo. En Linux nativo (el despliegue real de un "GPU box propio") sí existe todo lo
de abajo.

**Monitorización** (ambos fabricantes, Linux nativo):
- Temperatura por núcleo físico vía `hwmon` — `coretemp` en Intel, `k10temp` en AMD.
- Uso por núcleo — ya lo da `sysinfo::System::cpus()`, que `telemetry.rs` ya usa hoy
  promediado; solo hace falta exponer el desglose.

**Control de potencia — dos mecanismos, no uno genérico:**
- **Intel**: RAPL vía sysfs (`/sys/class/powercap/intel-rapl:0/constraint_0_power_limit_uw` =
  PL1, `constraint_1_power_limit_uw` = PL2). Interfaz oficial de kernel — mismo nivel de
  seguridad que el límite de potencia de NVML en GPU.
- **AMD**: no existe interfaz de kernel oficial para PPT. El control pasa por `ryzenadj`
  (subprocess, mismo patrón que `nvidia-settings` para GPU), que escribe directamente en
  registros del SMU vía acceso crudo a memoria/PCI. **Esto es, con diferencia, el control de
  más riesgo de toda la sección Hardware** — sin garantía del fabricante, sin la abstracción
  seria que sí tienen NVML y RAPL. La interfaz lo dice explícitamente en su propia etiqueta,
  no se disfraza de control tan seguro como los demás.

Cuál de las dos rutas aplica se decide leyendo el fabricante (`/proc/cpuinfo` — ya lo hace
`lumi-cli::detect::cpu_summary()` para el resumen de CPU del instalador; se reutiliza la misma
detección). Nunca las dos capacidades a la vez `On`: la que no aplica sale `off` con el motivo
"esta CPU es de otro fabricante", distinto del motivo de "no disponible".

## Alcance

**Dentro:**
- Fila de CPU en `HardwareView`, con el mismo interruptor global básico/avanzado que ya rige
  las filas de GPU.
- Monitorización: temperatura por núcleo (mapa de calor, ya maquetado en el mockup aprobado de
  GPU+CPU juntos), uso por núcleo, potencia actual (RAPL en Intel; `ryzenadj` en lectura para
  AMD).
- Modo básico: slider de potencia acotado a un rango seguro — en Intel, el rango real que
  reporta RAPL (`constraint_0_max_power_uw`); en AMD, al no haber rango de fábrica fiable por
  software, se aproxima al 50–100% del TDP declarado de la CPU (`sysinfo`/`/proc/cpuinfo`),
  documentado como aproximación, no como dato leído del hardware.
- Modo avanzado: el mismo slider sin el techo del rango seguro, con el modal de "soy
  consciente" al salirse — en AMD, el modal lleva además una línea fija, SIEMPRE visible al
  editar potencia en AMD (no solo al salirse de rango): "este control no tiene garantía del
  fabricante".
- `HardwareEditor` reutilizado con dos pestañas para CPU (no cuatro): Potencia y Sensores — sin
  Ventilador ni Reloj, que no aplican.
- Persistencia y reaplicación al arrancar: tabla `cpu_profile` (fila única, no hay multi-CPU),
  misma `reaplicar_al_arrancar` de GPU extendida para incluir CPU.
- Dos capacidades nuevas: `cpu_potencia_intel`, `cpu_potencia_amd` (mutuamente excluyentes por
  fabricante), y `cpu_temperatura` (independiente de si hay control de potencia).

**Fuera de esta entrega:**
- Cualquier control de ventilador de CPU (PWM de placa base vía `fancontrol`/`lm-sensors`) —
  no estaba en el alcance original ("temperatura por núcleo, PPT/PBO") y es un mecanismo
  distinto por completo (por placa, no por CPU).

## Arquitectura

**Lecturas** (`crates/lumid/src/hardware_cpu.rs`, nuevo, hermano de `hardware.rs`):
- Uso y modelo por núcleo: del mismo `sysinfo::System` que ya vive en `App.sysinfo` (no uno
  nuevo — el comentario de `telemetry.rs` ya explica por qué debe seguir vivo entre muestras).
- Temperatura por núcleo: se busca el `hwmon` cuyo `name` sea `coretemp` o `k10temp` en
  `/sys/class/hwmon/hwmon*/name`, y se leen sus `tempN_input` (cada uno en miligrados,
  dividido entre 1000).
- Fabricante: `/proc/cpuinfo`, campo `vendor_id` (`GenuineIntel` | `AuthenticAMD`).

**Escrituras**, cada una detrás de su propia capacidad:
- `aplicar_potencia_intel`: escribe directo en los ficheros sysfs de RAPL
  (`constraint_0_power_limit_uw`, `constraint_1_power_limit_uw`) — `lumid` corre como root, ya
  puede escribir en sysfs sin permisos adicionales.
- `aplicar_potencia_amd`: subprocess `tokio::process::Command` a `ryzenadj --stapm-limit=X
  --fast-limit=Y --slow-limit=Z` (aproximación de PL1/PL2 en términos de AMD).

**Capacidades**: se comprueban una vez por conexión a `/v1/hello`, igual que GPU — para Intel,
que exista `/sys/class/powercap/intel-rapl:0`; para AMD, que el binario `ryzenadj` esté
instalado y responda a una lectura (`ryzenadj --info` o similar, sin escribir nada).

**Persistencia**: tabla `cpu_profile` con una única fila (no hace falta índice — solo hay una
CPU): `potencia_w_pl1`, `potencia_w_pl2` (o su equivalente STAPM/fast/slow en AMD, guardado en
las mismas columnas con la semántica que aplique según fabricante), `updated_at`.

## Interfaz

Fila de CPU en `HardwareView`, con el icono de CPU ya construido en `Icon.tsx` durante la
entrega de GPU (`device`, o uno nuevo dibujado a mano si `device` no encaja visualmente con el
resto). En vez de un anillo de temperatura único (una CPU no es un solo chip como la GPU),
mapa de calor por núcleo — ya maquetado en el mockup aprobado de GPU+CPU (`full-screen-v2.html`
trae esta misma fila).

Clic en la fila (solo en avanzado, solo si alguna de las dos capacidades de potencia está
`On`) abre `HardwareEditor` con dos pestañas en vez de cuatro. La pestaña Potencia, si el
fabricante es AMD, muestra la línea de aviso permanente descrita arriba encima del slider,
no solo dentro del modal de confirmación.

## Seguridad y testing

Mismo patrón que GPU: `fuera_de_rango`-equivalente para CPU es lógica pura testeable con
`cargo test -p lumid` sin hardware real — se prueba con rangos ficticios de Intel (por
ejemplo, PL1 mín/máx) y con el TDP aproximado de AMD. La detección de fabricante
(`GenuineIntel` vs `AuthenticAMD` vs cualquier otra cosa) también es pura y se testea con
cadenas de `/proc/cpuinfo` de ejemplo. Nada de tests para la lectura RAPL real ni para el
subprocess `ryzenadj`: se prueban a mano contra hardware, como el resto de detección de
hardware del proyecto.
