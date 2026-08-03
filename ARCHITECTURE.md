# Lumi Station — documento general

Documento paraguas del proyecto: qué es, cómo se divide, qué decisiones atraviesan todos
los subsistemas y en qué estado está cada pieza. Los documentos hermanos cubren su parte:

| Documento | Cubre |
|---|---|
| [PRODUCT.md](PRODUCT.md) | Usuarios, tono, principios de producto, anti-referencias |
| [DESIGN.md](DESIGN.md) | Tokens, tipografía, iconografía, movimiento, prohibiciones |
| [README.md](README.md) | Cómo levantarlo y probarlo |
| `docs/superpowers/specs/` | Una spec por subsistema |
| `docs/superpowers/plans/` | Un plan de implementación por subsistema |

---

## 1. Qué es Lumi

Herramienta de **geolocalización de imágenes por inferencia**, de código abierto, para uso
forense y de investigación. Le das una foto y te dice dónde se tomó.

Compite con GeoSpy y Raven, con dos diferencias: es abierta y es **autoalojada** — el
propietario pone sus propias GPUs, nada sale a un servicio de terceros. El objetivo técnico
es llevar modelos como RoMa o M4ster a una precisión muy por encima de lo que dan por
separado, encadenándolos y haciéndolos competir entre sí.

Al ser una herramienta con la que se toman decisiones que afectan a personas reales, la
cadena de custodia y la honestidad sobre lo que el sistema sabe y no sabe importan tanto
como la precisión.

---

## 2. De la v1 a la v2

La **v1** vive en `E:\Lumi`: monorepo pnpm con Next.js (`apps/web`), un worker
(`apps/worker`) y un servicio de inferencia en Python (`services/inference`). Todo junto,
todo en la misma máquina, acceso por navegador.

La **v2** es una reescritura completa desde cero, no una migración. El cambio de fondo es la
separación en dos mitades:

- **Cliente de escritorio (Tauri)** — sustituye la web de la v1. Es lo que instala cada
  investigador en su equipo.
- **Servidor de inferencia** — donde están las GPUs, los modelos y los datos. Lo despliega
  el propietario en su propia máquina.

### Qué se conserva de la v1

Por decisión explícita del owner, la estética del `/setup` y del mapa se mantiene
**prácticamente idéntica**. En la práctica eso significa:

- Los tokens de color de `apps/web/tailwind.config.ts`, valor por valor.
- El `PlanetBackground` completo: ocho estrellas en posiciones fijas, planeta de 520 px
  girando en 70 s, satélite en órbita de 14 s, y su estado `dead` para servidor degradado.
- El vocabulario del wizard: brandline `✦`, stepper de burbujas, tarjeta de cristal de
  552 px, copy en español con subtítulos en minúscula.
- El patrón de iconos: SVG a mano, `viewBox="0 0 24 24"`, sin librería.

Se probó a "mejorar" el fondo (nebulosa, paralaje, luces de ciudad) y se descartó: rompía la
esencia del original. Está anotado como prohibición en `DESIGN.md`.

---

## 3. Actores y flujos

### Owner

Paga el hardware y tiene shell en el servidor.

```
ejecuta el CLI instalador
  → el CLI deja el daemon corriendo (sin modelos, sin pesos, sin runtime)
  → el CLI imprime una clave de vinculación de un solo uso
  → abre el cliente, pega la clave, crea la cuenta de administrador
  → continúa el aprovisionamiento desde la app
```

### Administrador

Todo desde una sección especial del cliente, solo visible con sesión de admin:

- Crear usuarios y aprobar solicitudes de acceso
- Solicitar cambios de credenciales (nunca leerlas)
- Fijar límites de uso globales y por usuario
- Cambiar permisos
- Instalar modelos y controlar qué usuario usa cuál
- Monitorizar y controlar el hardware
- Enviar notificaciones a los usuarios
- Poner el servidor en mantenimiento

### Investigador

```
abre el cliente
  → introduce la IP del servidor
  → envía un mensaje solicitando acceso al administrador
  → si lo aprueban, se le notifica
  → se le pide crear su cuenta
  → empieza a trabajar creando proyectos
```

Los **proyectos** son entornos de trabajo persistentes, en el espíritu de Burp Suite o
Caido: tus imágenes y tus análisis anteriores quedan ahí, accesibles, agrupados por
investigación.

---

## 4. Los tres modelos

Solo habrá tres, y la diferencia entre ellos no es la arquitectura sino **cuántos modelos
distintos corren dentro**:

| Nombre | Composición | Coste |
|---|---|---|
| **Lumi Mini** | Un solo verificador geométrico (p. ej. RoMa) | Bajo |
| **Lumi Pro** | Varios modelos en cadena | Medio |
| **Lumi Vision** | Tres o cuatro verificadores compitiendo por acercarse más | Resultados muy superiores, problemas de cómputo reales |

La idea es que la precisión sale de la competencia entre verificadores, no de un modelo
mejor. Eso es lo que justifica el soporte multi-GPU y el sistema de cola.

---

## 5. Los seis subsistemas

El proyecto no cabe en una sola spec. Se divide en seis piezas, cada una con su propio ciclo
spec → plan → implementación, y cada una debe producir software que funcione por sí solo.

| # | Subsistema | Qué cubre | Estado |
|---|---|---|---|
| **1** | **Instalador CLI y vinculación** | Bootstrap del owner, clave de un solo uso, primer contacto cliente↔servidor, cuenta de administrador | **Implementado**, en pruebas |
| **2** | **Auth, usuarios y permisos** | Solicitudes de acceso, creación de cuentas, roles, límites por usuario, dispositivos de confianza | Pendiente |
| **3** | **Panel de administración** | Hardware, monitorización, notificaciones, mantenimiento, gestión de modelos | Pendiente |
| **4** | **Cola y planificador** | Cientos de usuarios, pausa por desconexión, prioridades, multi-GPU y GPU+CPU | Pendiente |
| **5** | **Motor de inferencia** | Lumi Mini / Pro / Vision, ensemble de verificadores geométricos | Pendiente |
| **6** | **Cliente y proyectos** | Workspaces tipo Burp/Caido, imágenes, historial, mapa | Pendiente |

**Orden acordado:** `1 → 2 → 6 (esqueleto) → 4 → 5 → 3`. El razonamiento: el handshake, la
autenticación y el esqueleto del cliente son el andamio sin el cual nada más se puede
probar; la cola va antes que el motor porque el motor es un consumidor de la cola; el panel
de admin va último porque es interfaz sobre cosas que ya deben existir.

Se decidió **no** escribir un documento paraguas antes de empezar (este documento se escribe
a posteriori). La consecuencia asumida: el protocolo cliente↔servidor y el modelo
criptográfico se definieron dentro del subsistema 1 y los otros cinco los heredan.

---

## 6. Arquitectura técnica

```
crates/lumi-proto      formato de clave, tipos de API, criptografía  ← compartido
crates/lumid           el daemon: TLS, API, runner de tareas, cifrado
crates/lumi-cli        binario `lumi`: install, uninstall, key reissue, status
client/                Tauri v2 + React + Tailwind
  src-tauri/           lado Rust: verificador de huella, puente SSE
  src/                 interfaz
tools/build.py         dev: arranca lumid en 7717 y el cliente
tools/package.py       zip de todo lo no excluido por .gitignore
```

`lumi-proto` es la pieza que justifica elegir Rust para el daemon: formato de clave, huella,
tipos del protocolo y envelope encryption definidos una vez y compilados por daemon, CLI y
cliente. En un producto con handshake criptográfico, un desajuste de serialización silencioso
entre cliente y servidor son días perdidos; aquí directamente no compila.

Los **workers de inferencia son Python** (los modelos lo son, pase lo que pase). La frontera
Rust↔Python es explícita, no añadida.

---

## 7. Decisiones transversales

Estas atraviesan todos los subsistemas. Se tomaron en el subsistema 1 y el resto las hereda.

### Despliegue

**Linux nativo es el camino primario. Docker es un escape con capacidades recortadas.** Las
GPUs están en el servidor, y "servidor con GPUs" en la práctica es Linux. Multi-GPU y GPU+CPU
son un dolor real en Windows y en Docker sin `--gpus all` bien configurado. La v1 soportaba
Windows/WSL/Linux y esa fue parte de la deuda técnica que motivó la reescritura.

### Matriz de capacidades

El servidor publica su inventario y **cada capacidad recortada viaja con un `reason`
legible**. La interfaz nunca esconde una función: la muestra deshabilitada con el motivo
real ("el contenedor solo recibe gpu0; requiere `--gpus all` y acceso directo a
`/dev/nvidia*`"). Un solo origen de verdad, y la columna del motivo nunca está vacía.

Este es un principio de producto, no un detalle del instalador: aplica a cada sitio de la
app donde algo aparezca deshabilitado.

### Confianza y transporte

**TLS con certificado autofirmado, y la huella del certificado viaja dentro de la clave de
vinculación.**

```
lumi1_<host:puerto>_<huella>_<secreto>
```

El cliente compara la huella del certificado que recibe contra la que trae la clave. Si no
coinciden, **aborta**: no hay diálogo de "¿confías?", porque ese diálogo es por donde entra
el atacante. Así, el canal fuera de banda por el que el owner te pasa la clave se convierte
en verificación real de identidad del servidor.

- Huella: SHA-256 del DER truncado a 128 bits, base58.
- Secreto: 160 bits, base58. El servidor guarda solo su hash Argon2id.
- Un solo uso, caduca en 24 h, `lumi key reissue` para reemitir.

La misma estructura la reutilizará la invitación de usuarios del subsistema 2, cambiando solo
el rol que otorga.

### Cifrado

**No hay cifrado extremo a extremo de las imágenes, y no se va a afirmar que lo haya.** El
servidor necesita el píxel en claro para ejecutar los modelos. Cualquiera que venda "E2E" en
una herramienta de visión por servidor está cifrando el transporte y llamándolo otra cosa.

| Dato | Mecanismo | Quién puede leerlo |
|---|---|---|
| Contraseñas | Argon2id, sin reversa | Nadie. El admin solicita cambio, nunca lee |
| Secretos de configuración | XChaCha20-Poly1305 con la maestra | El daemon en ejecución |
| Metadatos de proyecto | Envelope: DEK por proyecto envuelta por la maestra | El daemon, para el dueño y admins |
| Imágenes | En reposo con la DEK; en claro solo en RAM durante inferencia | El daemon durante el trabajo |
| Tránsito | TLS 1.3 con anclaje por huella | — |

**Protege contra:** disco robado, copia de seguridad filtrada, instantánea de VM, otro
proceso del host leyendo `/var/lib/lumi`, administrador curioso.
**No protege contra:** root en el servidor con el daemon corriendo. Es un límite físico, no
una decisión de diseño, y se documenta como tal.

### Clave maestra

Dos modos, elegidos por el owner en el instalador con el coste explicado:

- **Automática** (por defecto): 32 bytes en `systemd-creds`, el servicio arranca solo.
  Protege del disco robado en frío.
- **Sellada**: derivada de una passphrase. Tras reiniciar, el daemon arranca en `LOCKED` y
  espera a que un admin desbloquee desde la app. Protege también contra incautación en
  caliente y contra el proveedor de la VM.

El defecto es la automática porque un servicio forense compartido que se cae en cada
actualización de kernel se acaba desactivando.

En `LOCKED` **la telemetría sigue viva** — no depende de la maestra, y que siga funcionando
demuestra que la máquina está sana y que solo falta desbloquear.

### Runner de tareas

El CLI deja **solo el daemon de control**. El runtime de inferencia, la base de datos y los
modelos los instala el asistente desde la app.

La consecuencia: las instalaciones pesadas (torch, CUDA, ~8 GB) **no son peticiones HTTP
largas**. Corren en el servidor, escriben a un log persistente en disco, y el cliente se
engancha y desengancha por offset (`GET /v1/tasks/:id/log?from=<bytes>`). Cerrar la app no
aborta nada.

Es el mismo primitivo que consumirá la cola del subsistema 4. Se diseñó aquí pensando en eso.

### Estado del servidor

```
UNCLAIMED ──canje──► CLAIMED ──aprovisionado──► READY
                        │                         │
                        └────── PROVISIONING ─────┘

LOCKED        ortogonal: activo tras reiniciar en modo sellado
MAINTENANCE   ortogonal: lo introduce el subsistema 3
```

### Puerto

**7717**, fijo. No configurable por entorno (convención del proyecto: puerto fijo por
proyecto, definido en `tools/build.py`).

---

## 8. Decisiones de interfaz

### Dirección: «Instrumento»

De tres direcciones propuestas, se eligió la que conserva el wizard de la v1 intacto y añade
una **franja de telemetría permanente** que aparece en el instante en que se verifica la
huella y ya no se va.

El argumento no es estético: al dejar el CLI fino, el aprovisionamiento pesado pasa por la
app; sin ver el estado real de la máquina estás mirando una barra de progreso a ciegas. Y esa
franja *es* el componente de monitorización del subsistema 3, construido cuatro subsistemas
antes de necesitarlo. Es colapsable a 28 px, pensando en cuando el mapa ocupe la pantalla.

### Estados anómalos

Cuatro (reiniciando, error, sellado, sin conexión), y **no son un componente nuevo**:
reutilizan la composición del wizard (misma `pane`, misma tarjeta de cristal, misma fila de
botones). Solo desaparece el stepper y se atenúa lo de detrás. Un intento previo con
cabecera propia, footer propio e icono en cajita de color se descartó por romper con todo lo
demás.

Los cuatro **declaran explícitamente qué sobrevivió**: trabajo en curso, cola congelada con
su número, descarga reanudable. Esa es la mitad de la razón de que exista el runner. El de
error muestra el `stderr` crudo dentro de la tarjeta.

### Color de estado

La paleta de la v1 **no tiene verde**. "Completado" es blanco, como el paso `done` del
stepper. El color solo entra cuando significa estado: `draw-fg` en curso, `danger-fg` error,
`warning` sellado/cifrado, `subtle` sin conexión.

---

## 9. Estado actual

**Subsistema 1 implementado y parcialmente probado.** 16 tareas, 24 commits.

Verificado en WSL con hardware real:
- `lumi install` / `lumi uninstall`, detección de entorno y GPU vía NVML
- `POST /v1/claim` → `POST /v1/admin`
- `cargo test -p lumi-proto` (clave, cripto, capacidades)

Verificado en el cliente Tauri sobre Windows:
- Ventana nativa, fondo de planeta, wizard y stepper
- Vinculación con anclaje de huella

Sin verificar todavía:
- Runner de tareas de punta a punta desde el cliente
- Telemetría en vivo en la franja
- Modo sellado desde la app
- Rechazo de huella alterada (la prueba que valida todo el modelo de confianza)

---

## 10. Deuda y decisiones pendientes

**Base de datos.** Hoy es SQLite (`rusqlite` con `bundled`), una sola conexión bajo mutex.
Se coló como detalle de implementación sin discutirse. Encaja para el plano de control
actual (usuarios, sesiones, claves, estado de tareas: decenas de operaciones por minuto),
pero **hay que revisarlo al llegar al subsistema 4**: si la cola necesita cientos de
escritores concurrentes, el mutex es el cuello de botella. Salidas: Postgres, o mantener
SQLite para el plano de control y sacar la cola a otro sitio.

**Rotación de certificado.** Anclar la huella significa que renovar el certificado invalida
las claves emitidas y obliga a re-vincular. Aceptable con validez de 10 años; hay que
documentarlo en `lumi key reissue`.

**Frontera Rust↔Python.** Hay que definirla antes del subsistema 5. El runner de tareas ya
la roza al lanzar el instalador de Python.

**Aprovisionamiento por la app.** Es el punto frágil de dejar el CLI fino. Mitigado con el
runner, el log persistente y las descargas reanudables, pero sigue siendo más superficie que
un `apt install`. Si duele en la práctica, la salida es mover el paso de runtime al CLI.

**Dispositivos de confianza.** Se propuso que la clave de vinculación además registrara el
equipo como aprobado. Se aparcó al subsistema 2 por ser política de autenticación, no
bootstrap.

---

## 11. Convenciones

De `workflow/PROJECT-CONVENTIONS.md`, resumidas por lo que más afectan aquí:

- **Monorepo** por defecto. Scripts estándar en Python bajo `tools/`.
- **Puerto fijo** por proyecto, no variable.
- **Un commit por feature terminada**, no commits intermedios.
- **Sin tests** salvo que se pidan. Regla aplicada: una sola comprobación ejecutable en las
  tareas con lógica no trivial (clave, cripto, capacidades), ninguna en las mecánicas.
- **`ponytail` manda en el código**: la solución más simple que funcione. Las
  simplificaciones deliberadas llevan comentario `// ponytail:` nombrando el techo y la
  salida.
- **Diseño**: proponer 2-3 direcciones antes de comprometerse. Filtro anti-slop siempre
  activo (nada de iconos en cajitas de color, gradientes morado-azul, tarjetas apiladas).
