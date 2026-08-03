# Lumi Station

Reescritura completa de Lumi. Cliente de escritorio Tauri + servidor de inferencia
autoalojado. Contexto completo en [PRODUCT.md](PRODUCT.md) y [DESIGN.md](DESIGN.md).

Este README cubre solo el **subsistema 1**: instalador CLI y vinculación. Spec en
[`docs/superpowers/specs/2026-08-03-instalador-y-pairing-design.md`](docs/superpowers/specs/2026-08-03-instalador-y-pairing-design.md),
plan en [`docs/superpowers/plans/2026-08-03-instalador-y-pairing.md`](docs/superpowers/plans/2026-08-03-instalador-y-pairing.md).

## Si vas a probar desde WSL (recomendado)

Todo lo de abajo asume Windows/Git Bash y por eso rodea `systemd` con un atajo de OpenSSL
(sección 1). **En WSL con systemd habilitado no necesitas ese atajo**: `lumi install` está
escrito para Linux y debería completar el flujo real.

```bash
# dentro de WSL, en la copia del repo (ojo: /mnt/e/... es lento; clona o copia
# el repo dentro del filesystem de WSL si el build se nota lento)
cd ~/lumi-station   # o donde tengas el repo en WSL
cargo build
sudo target/debug/lumi install
```

Esto pregunta interactivamente por el modo (nativo/docker) y por la clave maestra
(automática/sellada), con el defecto recomendado marcado con `›` y aceptable con solo
pulsar Enter. Para saltarte las preguntas y que tome directamente los defectos
recomendados:

```bash
sudo target/debug/lumi install --yes
```

Esperado en ambos casos: las secciones de entorno, hardware, modo, capacidades y clave
maestra se imprimen (con `── título ──…`, igual que el mockup), `systemctl is-active lumid`
responde `active`, y al final se imprime la clave de vinculación completa (`lumi1_...`).
Si tu WSL no tiene systemd (`cat /proc/1/comm` no dice `systemd`), habilítalo
en `/etc/wsl.conf` con `[boot]\nsystemd=true` y reinicia WSL (`wsl --shutdown` desde
PowerShell), o usa el atajo con OpenSSL de la sección 1 igual que en Windows puro.

Con `lumi install` completado de verdad, sáltate la sección 1 de abajo entera: ya tienes
`.dev-data`... salvo que ahora la ruta real sea `/var/lib/lumi` (la que usa el instalador en
Linux, no `.dev-data`). Ajusta `LUMI_DATA=/var/lib/lumi` en los comandos siguientes, o
copia el certificado a un `.dev-data` local si prefieres no tocar rutas de sistema mientras
pruebas.

## Qué hay implementado

- `lumi-proto`: formato de clave de vinculación, huella de certificado, cifrado, matriz de
  capacidades, tipos de la API.
- `lumid`: el daemon. TLS con certificado autofirmado, canje de clave, creación del primer
  administrador, sesiones, clave maestra (automática y sellada), runner de tareas con log
  persistente, telemetría por SSE.
- `lumi-cli` (binario `lumi`): detección de entorno/hardware, instalación (`lumi install`),
  reemisión de clave (`lumi key reissue`), diagnóstico (`lumi status`).
- `client`: cliente Tauri. Fondo de planeta de la v1, wizard, verificación de huella TLS en
  el lado Rust, franja de telemetría en vivo, los cuatro estados anómalos (reiniciando,
  error, sellado, sin conexión).

## Importante antes de probar: estás en Windows

El daemon y el CLI están escritos para Linux (`systemd`, `ufw`, `/etc/os-release`,
`/bin/sh`). En Windows:

- **`lumid` arranca y sirve la API igual** — TLS, SQLite, canje, tareas y telemetría no
  dependen de nada de Linux. Es lo que puedes probar de verdad.
- **`lumi install` no completa**: falla adrede en el chequeo de systemd, con el mensaje
  *"este host no usa systemd..."*. Es el comportamiento correcto del guard, no un bug.
- **El runner de tareas falla si lanzas una tarea real**: intenta ejecutar `/bin/sh`, que no
  existe en Windows. El log recogerá el error de spawn — eso en sí prueba que el mecanismo
  de log persistente funciona, aunque el comando sea Linux-only.

Para probar el flujo de instalación de verdad (`lumi install` completo) necesitas una VM o
máquina Linux con systemd. Para probar el resto —API, cripto, wizard, huella, telemetría,
estados anómalos— Windows basta.

## Requisitos

- Rust estable (`rustup default stable`)
- Node 18+ y npm
- `curl` (viene con Git Bash / WSL)
- Opcional: `python -m json.tool` para leer JSON con formato, o `jq`

## 1. Preparar un servidor de pruebas sin pasar por `lumi install`

`lumi install` comprueba `systemd` **antes** de generar nada (`crates/lumi-cli/src/install.rs:39`),
así que en Windows falla sin llegar a escribir el certificado. Si `.dev-data/` ya tiene
`cert.der` y `key.pem` de una sesión anterior, sáltate este paso. Si no, genera un
certificado de prueba equivalente con OpenSSL (viene con Git Bash):

```bash
mkdir -p .dev-data
MSYS2_ARG_CONV_EXCL="/CN=" openssl req -x509 -newkey ed25519 \
  -keyout .dev-data/key.pem -out .dev-data/cert.pem -days 3650 -nodes -subj "/CN=lumi"
openssl x509 -in .dev-data/cert.pem -outform der -out .dev-data/cert.der
```

(`MSYS2_ARG_CONV_EXCL` evita que Git Bash reescriba `/CN=lumi` como una ruta de Windows; sin
eso, `openssl` falla con *"subject name is expected to be in the format..."*.)

`lumid` solo lee `cert.der` (para la huella) y `key.pem` (para TLS); no le importa cómo se
generaron.

## 2. Arrancar el daemon

```bash
LUMI_DATA=.dev-data cargo run -p lumid
```

Primera vez: compila (15-30 s). Deja la terminal abierta; verás:

```
lumid escuchando en https://0.0.0.0:7717
```

## 3. Probar la API a mano

En otra terminal:

```bash
# Saludo público — sin autenticación, funciona también bloqueado
curl -sk https://localhost:7717/v1/hello | python -m json.tool
```

Esperado: JSON con `"state":"unclaimed"`, tu huella de certificado (`fingerprint`), la
matriz de capacidades con motivos, y tus GPUs reales si tienes NVIDIA (usa NVML, funciona en
Windows).

```bash
# Telemetría en vivo (Ctrl+C para cortar)
curl -skN https://localhost:7717/v1/telemetry
```

Esperado: una línea JSON por segundo con uso de GPU/CPU/disco. Sigue funcionando aunque el
servidor esté "sellado" — es deliberado, para poder monitorizar un servidor bloqueado.

### Canjear la clave y crear el administrador

La clave de vinculación tiene el formato `lumi1_<host:puerto>_<huella>_<secreto>`. Si no
tienes una impresa por `lumi install`, mira la tabla `pair_key` de `.dev-data/lumi.db` o
pide que se reemita:

```bash
sqlite3 .dev-data/lumi.db "SELECT secret_phc FROM pair_key;"
```

(El secreto en claro solo se imprime una vez, en la instalación real. Si perdiste esa
sesión, borra `.dev-data/lumi.db` y reinstala, o inserta manualmente una fila de prueba con
un secreto conocido usando `lumi-proto`.)

Con el secreto en `$SECRET`:

```bash
TOK=$(curl -sk -X POST https://localhost:7717/v1/claim \
  -H 'content-type: application/json' -d "{\"secret\":\"$SECRET\"}" \
  | python -c 'import sys,json;print(json.load(sys.stdin)["bootstrap_token"])')

curl -sk -X POST https://localhost:7717/v1/admin \
  -H 'content-type: application/json' \
  -d "{\"bootstrap_token\":\"$TOK\",\"username\":\"tu_usuario\",\"password\":\"una contraseña de 12+ caracteres\"}" \
  -w '%{http_code}\n'
```

Esperado: `201`. Repetir el canje con el mismo secreto debe dar `401` con
*"la clave ya se canjeó"*.

### Iniciar sesión y usar el runner de tareas

```bash
T=$(curl -sk -X POST https://localhost:7717/v1/auth/login \
  -H 'content-type: application/json' \
  -d '{"username":"tu_usuario","password":"tu contraseña"}' \
  | python -c 'import sys,json;print(json.load(sys.stdin)["token"])')

curl -sk -X POST https://localhost:7717/v1/tasks \
  -H "authorization: Bearer $T" -H 'content-type: application/json' \
  -d '{"kind":"database"}'
```

Guarda el `id` de la respuesta y sigue el log:

```bash
curl -skN "https://localhost:7717/v1/tasks/<ID>/log?from=0"
```

`"kind":"database"` funciona en Windows (es solo un `echo`). `"kind":"inference_runtime"`
fallará porque lanza `/bin/sh`: verás el error de spawn en el log, lo que confirma que el
runner en sí funciona.

## 4. Probar el modo sellado

Con `lumid` parado:

```bash
head -c 16 /dev/urandom > .dev-data/master.salt   # o: openssl rand -out .dev-data/master.salt 16
LUMI_DATA=.dev-data cargo run -p lumid
```

```bash
curl -sk https://localhost:7717/v1/hello | grep -o '"locked":[a-z]*'   # locked:true

curl -sk -X POST https://localhost:7717/v1/unseal \
  -H 'content-type: application/json' -d '{"passphrase":"la frase que quieras"}' \
  -w '%{http_code}\n'    # 204

curl -sk https://localhost:7717/v1/hello | grep -o '"locked":[a-z]*'   # locked:false
```

Reinicia `lumid` y prueba con **otra** frase: debe dar `401` con *"frase incorrecta"*.

## 5. Probar el cliente (React en navegador)

No hace falta abrir la ventana nativa de Tauri para ver la interfaz: el mismo código React
corre en un navegador normal contra Vite.

```bash
cd client
npm install
npm run dev
```

Abre `http://localhost:5173`.

Esto te enseña el wizard, el fondo de planeta y el stepper, pero **no** los comandos
`invoke()` de Tauri (verificación de huella, telemetría en vivo, log de tareas) —
esos solo existen dentro del proceso nativo de Tauri, que necesita el runtime WebView2.

### Ventana nativa completa (Windows)

Requiere el [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
(suele venir con Windows 10/11) y Visual Studio Build Tools con el componente de C++.

```bash
cd client
npm install
npm run tauri dev
```

Esto abre la ventana real. Con `lumid` corriendo en otra terminal, pega tu clave de
vinculación en el paso «Vincular» del wizard.

**La prueba que de verdad importa**: cambia un solo carácter de la huella dentro de la clave
antes de pegarla. Debe rechazar la conexión con *"la huella del certificado no coincide"* y
el botón «Siguiente» debe seguir deshabilitado. Si en cambio conecta, el anclaje de huella no
está funcionando.

## Desinstalar

```bash
sudo target/debug/lumi uninstall
```

Pide confirmación (el mismo estilo de sección `── desinstalación ──…` y advertencia antes
de borrar, porque `/var/lib/lumi` puede tener administradores y proyectos reales) y luego
detiene `lumid.service`, borra la unit, el binario y todo `/var/lib/lumi`. Con `--yes` se
salta la confirmación.

## Apagar todo

```bash
# Detén lumid con Ctrl+C en su terminal, o:
pkill -f "target.*lumid" 2>/dev/null || taskkill //F //IM lumid.exe

rm -rf .dev-data   # borra certificado, base de datos y claves de prueba
```

## Verificaciones automáticas

Las únicas comprobaciones ejecutables del plan (`ponytail`: una por lógica no trivial, nada
más):

```bash
cargo test -p lumi-proto
```

Esperado: 3 tests en verde (`key`, `crypto`, `caps`).

```bash
cargo build       # workspace completo: lumi-proto, lumid, lumi-cli
cd client && npm run build   # frontend
```
