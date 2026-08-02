# Subsistema 1 — Instalador CLI y vinculación

**Fecha:** 2026-08-03
**Estado:** aprobado
**Alcance:** dejar un servidor Lumi arrancado, identificable y reclamable desde el cliente
Tauri, con una cuenta de administrador creada.

---

## 1. Contexto

Lumi v2 se divide en seis subsistemas independientes:

1. **Instalador CLI y vinculación** ← este documento
2. Autenticación, usuarios y permisos
3. Panel de administración
4. Cola y planificador multi-GPU
5. Motor de inferencia (Lumi Mini / Pro / Vision)
6. Cliente Tauri y proyectos

Cada uno tiene su propio ciclo spec → plan → implementación. Este subsistema define además
el protocolo cliente↔servidor y el modelo criptográfico, que los cinco restantes heredan.

No se escribió un documento paraguas previo: decisión del owner. Las decisiones con impacto
transversal quedan marcadas abajo con **(transversal)**.

---

## 2. Decisiones

| # | Decisión | Alternativas descartadas |
|---|---|---|
| 1 | Linux nativo como camino primario, Docker como escape con capacidades recortadas y motivo visible **(transversal)** | solo Linux; solo Docker; multiplataforma como la v1 |
| 2 | El CLI deja **solo el daemon de control**. Runtime de inferencia, base de datos y modelos los instala el asistente desde la app | CLI instala también el entorno Python; CLI lo instala todo incluida la cuenta admin |
| 3 | TLS con certificado autofirmado; la huella del certificado viaja **dentro** de la clave de vinculación **(transversal)** | HTTP + cripto propia; certificado real obligatorio; TOFU a ciegas |
| 4 | Clave maestra automática por defecto (`systemd-creds`), con **modo sellado** opcional **(transversal)** | siempre passphrase en arranque; TPM |
| 5 | Daemon en **Rust**, workers de inferencia en **Python**, crate `lumi-proto` compartido con el cliente Tauri **(transversal)** | todo Python; Go; Node |
| 6 | La clave de vinculación es de **bootstrap de un solo uso**: su único poder es crear el primer administrador | clave como credencial permanente; clave que además fija dispositivo de confianza |
| 7 | Interfaz: dirección «Instrumento» — wizard de la v1 intacto más franja de telemetría permanente | wizard puro; app como consola de operador |
| 8 | Los estados anómalos se muestran con la **composición del wizard**, no con un componente modal propio | modal con cabecera y pie propios |

### Justificaciones que hay que preservar

**Decisión 2 abre un agujero que la 7 cierra.** Al dejar el CLI fino, la descarga de ~8 GB de
torch y CUDA ocurre a través de la app. Sin ver el estado real de la máquina, el usuario mira
una barra de progreso a ciegas. La franja de telemetría existe por eso, no por estética. Y es
además el componente de monitorización del subsistema 3, construido cuatro subsistemas antes
de necesitarlo.

**La decisión 2 exige un runner de tareas del lado servidor.** No son peticiones HTTP largas:
las instalaciones corren en el servidor, escriben a un log persistente y el cliente se
engancha y desengancha. Es el mismo primitivo que consume la cola del subsistema 4.

**La detección de hardware ocurre en el CLI, no en la app.** `nvidia-smi` y `/dev/nvidia*` no
necesitan torch. Si el host no puede ejecutar nada, el CLI falla antes de emitir la clave y no
se llega a instalar el cliente para descubrirlo.

---

## 3. Componentes

```
lumi-install (bin)     detecta hardware, decide modo, instala, emite la clave
lumid (bin)            daemon de control: TLS, API, runner de tareas, cifrado
lumi (bin)             administración local en el host: key reissue, status, logs
lumi-proto (crate)     formato de clave, tipos de la API, envelope encryption
lumi-client (Tauri)    consume lumi-proto desde el lado Rust
```

`lumi-proto` es la pieza que justifica Rust: formato de clave, huella, tipos del protocolo y
envelope encryption definidos una vez y compilados por daemon, CLI y cliente. Un desajuste de
serialización silencioso entre cliente y servidor en un producto con handshake criptográfico
son días perdidos; aquí no compila.

**Puerto fijo: 7717.** Definido en `tools/build.py` según convenciones del proyecto.

---

## 4. Instalación

`sudo ./lumi-install`, un binario estático sin dependencias de host.

1. **Entorno.** Distribución, kernel, systemd, espacio libre en `/var/lib/lumi`, estado del
   cortafuegos. Un aviso si `ufw` está activo, y se añade la regla para 7717.
2. **Hardware.** Enumera GPUs vía NVML (modelo, VRAM, dirección PCIe), CPU y RAM.
3. **Modo.** Nativo o Docker. Se calcula la matriz de capacidades de cada uno y se muestran
   los recortes con su motivo antes de elegir.
4. **Clave maestra.** Automática o sellada.
5. **Instalación.** Binario en `/usr/local/bin/lumid`, unit de systemd habilitada,
   certificado ed25519 autofirmado a 10 años, escucha en `0.0.0.0:7717`.
6. **Emisión de la clave.** Se imprime una vez. El servidor queda en `UNCLAIMED`.

Salida en terminal: spinner braille (`⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏`, 72 ms) en la línea activa, check al
completar, barra de bloques con bytes, velocidad y ETA para descargas. Solo se mueve la línea
en curso.

### Matriz de capacidades

El daemon publica su inventario, y cada capacidad recortada lleva un `reason` legible que la
interfaz muestra allí donde la opción aparece deshabilitada. Un solo origen de verdad; la
columna del motivo nunca está vacía.

| Capacidad | Nativo | Docker | Motivo del recorte |
|---|---|---|---|
| Sharding multi-GPU | sí | no | El contenedor solo recibe `gpu0`; requiere `--gpus all` y acceso directo a `/dev/nvidia*` |
| Offload GPU + CPU | sí | no | Sin `cpuset` del host no se puede fijar afinidad de núcleos; el offload degradaría en vez de acelerar |
| Telemetría NVML | completa | parcial | Uso y VRAM sí; temperatura y potencia requieren `--privileged` |
| Modo sellado | sí | sí | — |

---

## 5. Clave de vinculación

```
lumi1.<host:puerto>.<huella>.<secreto>
```

- **Huella**: SHA-256 del certificado DER, truncado a **128 bits**, codificado en base58
  (22 caracteres). Los mockups muestran una huella corta por legibilidad; la real es esta.
- **Secreto**: 160 bits aleatorios de un CSPRNG, base58.
- El servidor almacena únicamente `Argon2id(secreto)`.
- Se imprime **una sola vez**.
- **Caducidad 24 h**, `--no-expiry` para instalaciones sin prisa.
- `lumi key reissue` en el host revoca la anterior y emite otra. Tener shell en la máquina ya
  es prueba de propiedad; no hace falta más ceremonia.
- Si caduca sin usarse, el daemon permanece en `UNCLAIMED` y rechaza todo salvo el canje.

### Canje

1. El cliente extrae host y huella de la clave.
2. Abre TLS y compara la huella del certificado presentado con la de la clave. **Si no
   coinciden, aborta**: no hay diálogo de «¿confías?».
3. `POST /v1/claim` con el secreto. El servidor verifica contra el hash y lo marca consumido
   de forma atómica.
4. Devuelve una sesión de bootstrap de vida corta que solo autoriza crear el administrador.
5. Creado el administrador, el servidor pasa a `CLAIMED` y la clave queda muerta para siempre.

El canal fuera de banda por el que el owner transmite la clave se convierte así en
verificación real de la identidad del servidor, que es para lo que sirve una clave de un solo
uso. La misma estructura la reutilizará la invitación de usuarios del subsistema 2, cambiando
solo el rol que otorga.

---

## 6. Estados del daemon

```
UNCLAIMED ──canje──► CLAIMED ──aprovisionado──► READY
                        │                         │
                        └────── PROVISIONING ─────┘

LOCKED        ortogonal: activo tras reiniciar en modo sellado
MAINTENANCE   ortogonal: lo introduce el subsistema 3
```

En `LOCKED` el daemon responde al saludo, se identifica y **sirve telemetría** —no depende de
la clave maestra—, pero no descifra nada y la cola queda pausada. Que la telemetría siga viva
es deliberado: demuestra que la máquina está sana y que solo falta desbloquear.

---

## 7. Cifrado

**No hay cifrado extremo a extremo de las imágenes y no se va a afirmar que lo haya.** El
servidor necesita el píxel en claro para ejecutar los modelos. Lo que sí se garantiza:

| Dato | Mecanismo | Quién puede leerlo |
|---|---|---|
| Contraseñas | Argon2id, sin reversa | Nadie. El administrador solicita cambio, nunca lee ni fija |
| Secretos de configuración, claves de API | XChaCha20-Poly1305 con clave maestra | El daemon en ejecución |
| Metadatos de proyecto | Envelope: DEK por proyecto, envuelta por la maestra | El daemon, para el dueño del proyecto y administradores |
| Imágenes | En reposo con la DEK del proyecto; en claro solo en RAM durante inferencia | El daemon durante el trabajo |
| Tránsito | TLS 1.3 con anclaje por huella | — |

**Protege contra:** disco robado, copia de seguridad filtrada, instantánea de máquina virtual,
otro proceso del host leyendo `/var/lib/lumi`, administrador curioso buscando contraseñas.

**No protege contra:** un atacante con root en el servidor mientras el daemon corre. Es un
límite físico, no una decisión de diseño, y se documenta como tal.

### Clave maestra

**Automática** (por defecto): 32 bytes aleatorios en `systemd-creds`, el servicio arranca solo.
Protege del disco robado en frío.

**Sellada** (opcional): derivada de la passphrase del owner con Argon2id. Tras reiniciar, el
daemon arranca en `LOCKED` y espera a que un administrador desbloquee desde la app. Protege
también contra incautación en caliente y contra el proveedor de la máquina virtual.

El defecto es la automática porque un servicio forense compartido que se cae en cada
actualización de kernel se acaba desactivando. El modo sellado existe para el despliegue de una
investigación concreta. La elección es del owner, en el instalador, con el coste explicado.

---

## 8. API

Sobre TLS 1.3 en 7717. Tipos en `lumi-proto`.

| Ruta | Auth | Descripción |
|---|---|---|
| `GET /v1/hello` | ninguna | versión, estado, modo, matriz de capacidades, huella |
| `POST /v1/claim` | secreto de la clave | canjea, devuelve sesión de bootstrap |
| `POST /v1/admin` | sesión de bootstrap | crea el primer administrador, pasa a `CLAIMED` |
| `POST /v1/auth/login` | credenciales | sesión normal |
| `POST /v1/unseal` | admin | desbloquea la clave maestra, reanuda la cola |
| `GET /v1/telemetry` | sesión | SSE: GPUs, CPU, red, disco, cola. Disponible en `LOCKED` |
| `POST /v1/tasks` | admin | lanza una tarea de aprovisionamiento |
| `GET /v1/tasks/:id` | sesión | estado de la tarea |
| `GET /v1/tasks/:id/log?from=<offset>` | sesión | SSE del log, reanudable por offset |

### Runner de tareas

Cada tarea de aprovisionamiento (runtime de inferencia, base de datos, descarga de modelos)
es un trabajo del servidor con log persistente en disco. El cliente se engancha por SSE con un
offset y puede desengancharse sin abortar nada. Reintentos con espera exponencial; las
descargas se reanudan por rango de bytes, no desde cero.

Es el mismo primitivo que la cola del subsistema 4. Se diseña aquí pensando en eso.

---

## 9. Interfaz

Tokens, iconografía y movimiento en [`DESIGN.md`](../../../DESIGN.md). Mockup aprobado en
`lumi-s1-v3.html`.

### Franja de telemetría

Aparece en el instante en que se verifica la huella y ya no se va: es la barra permanente de
la app. 70 px de alto, colapsable a 28 px con la posición recordada por vista, pensada para
que el mapa quede a pantalla casi completa. Celdas: servidor y estado, una por GPU con uso y
VRAM, CPU en minigráfico, cola, última señal. En modo sellado, candado ámbar junto a la IP.

### Wizard

Seis pasos: Vincular · Admin · Runtime · Datos · Modelos · Listo. Composición de la v1 sin
cambios: fondo de planeta, brandline `✦`, stepper de burbujas, tarjeta de cristal de 552 px,
fila de botones Atrás / Siguiente.

Paso 1: campo de clave, y al verificar, la huella se bloquea carácter a carácter.
Paso 3: barra de progreso, log crudo embebido y el botón «Cerrar y seguir en segundo plano»,
que dice literalmente lo que hace el runner.

### Estados anómalos

Cuatro, con la composición del wizard sobre el fondo atenuado y el planeta en estado `dead`:

| Estado | Icono | Copy |
|---|---|---|
| Reiniciando | flecha circular girando, `draw-fg` | «Vuelve solo. Nada perdido.» |
| Error | triángulo con `!`, `danger-fg` | «Fallo al arrancar.» + `stderr` crudo |
| Sellado | candado, `warning` | «Nada se ha descifrado.» + campo de desbloqueo |
| Sin conexión | señal tachada, `subtle` | «Puede ser tu red. Allí todo sigue corriendo.» |

Los cuatro declaran explícitamente qué sobrevivió: trabajo en curso, cola congelada con su
número, descarga reanudable. Esa es la mitad de la razón de que exista el runner.

Al desbloquear, el candado se abre: el arco sube y gira, su color pasa de ámbar a blanco y el
halo pierde el tinte, todo en el mismo gesto.

---

## 10. Errores

| Situación | Comportamiento |
|---|---|
| Huella no coincide | Aborta la conexión. Sin diálogo de confianza. Mensaje que nombra el ataque |
| Clave caducada | `UNCLAIMED` se mantiene; se indica `lumi key reissue` en el host |
| Clave ya canjeada | Rechazo. El servidor ya tiene administrador; hay que entrar con credenciales |
| Servidor se reinicia durante el aprovisionamiento | Popup de reinicio, reconexión con espera exponencial, reenganche al log por offset |
| El daemon vuelve pero falla | Popup de error con el `stderr` crudo y el arreglo sugerido. Sin reintento automático |
| Cliente pierde la red | Popup de sin conexión. El trabajo sigue en el servidor |
| Reinicio en modo sellado | `LOCKED`. Telemetría viva, cola pausada, desbloqueo desde la app |

---

## 11. Fuera de alcance

Registro de dispositivos de confianza (subsistema 2). Gestión de usuarios y permisos
(subsistema 2). Modo mantenimiento (subsistema 3). Planificación multi-GPU real: aquí solo se
**detecta** y se **publica** la capacidad (subsistema 4). Descarga y ejecución de modelos
(subsistema 5). Proyectos (subsistema 6).

---

## 12. Riesgos

**El aprovisionamiento por la app es el punto frágil de la decisión 2.** Se mitiga con el
runner, el log persistente y las descargas reanudables, pero sigue siendo más superficie que
un `apt install`. Si en la práctica resulta doloroso, la salida es mover el paso de runtime al
CLI, que era la alternativa descartada.

**La huella anclada rompe la rotación de certificado.** Renovar el certificado invalida las
claves emitidas y obliga a re-vincular. Aceptable a 10 años de validez; hay que documentarlo
en `lumi key reissue`.

**La frontera Rust↔Python hay que definirla antes del subsistema 5.** No es trabajo de este
subsistema, pero el runner de tareas ya la roza al lanzar el instalador de Python.
