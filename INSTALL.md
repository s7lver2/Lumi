# Guía de instalación completa (Windows + Linux)

Esta guía cubre la instalación desde el código fuente en **Windows** y
**Linux**, incluyendo cómo apuntar el proyecto a una **base de datos remota**
en vez de la de Docker local. Para una instalación rápida vía instalador
empaquetado, ver el `README.md` — esta guía es para quien clona el
repositorio y quiere entender/controlar cada pieza.

## 1. Arquitectura, en resumen

| Pieza | Qué es | Dónde corre |
|---|---|---|
| `apps/web` | Next.js — UI + rutas API | Node.js |
| `apps/worker` | Worker de trabajos en segundo plano (pg-boss) | Node.js |
| `services/inference` | FastAPI — embeddings, clasificación, verificación geométrica | Python (venv propio) |
| `db` | Postgres + PostGIS + pgvector, migraciones | Docker (o remoto) |

Las tres piezas de Node/Python son procesos independientes que se comunican
por HTTP y comparten la misma base de datos Postgres.

## 2. Requisitos

### Comunes (Windows y Linux)

- **Node.js 20.x** — no hay `engines` fijado en el repo, pero es lo que
  usan `@types/node` y el target de esbuild (`--target=node20`); usar otra
  versión mayor puede funcionar pero no está probado.
- **pnpm 9.7.0** — fijado en `package.json` (`packageManager: "pnpm@9.7.0"`).
  La forma más simple de tener la versión exacta:
  ```bash
  corepack enable
  corepack prepare pnpm@9.7.0 --activate
  ```
- **Python 3.12** — es lo que usan los venvs reales de este proyecto (los
  documentos de diseño en `docs/` mencionan 3.11 en algunas secciones, está
  desactualizado, usar 3.12).
- **Git**.
- Una **API key de Google Street View Static API** (se pide en el wizard de
  `/setup`, no va en `.env`).
- (Opcional) Un token de Mapbox — si se deja vacío, el mapa cae de vuelta a
  MapLibre + OpenFreeMap (sin key, gratis).
- (Recomendado) **GPU NVIDIA** — el servicio de inferencia corre en CPU si
  no hay GPU, pero bastante más lento (sobre todo la verificación
  geométrica con RoMa).

### Solo si vas a usar la base de datos local (Docker)

- **Docker Desktop** (Windows) o **Docker Engine + Compose** (Linux).

Si vas a usar una base de datos **remota** (sección 5), Docker no hace
falta en absoluto — ni para Postgres ni para nada más, todo lo demás
(web/worker/inferencia) corre nativo igual.

### Solo Windows

- **Modo de desarrollador de Windows** activado (Configuración > Privacidad
  y seguridad > Para desarrolladores). `next build` con `output: "standalone"`
  crea symlinks dentro de `node_modules`, y Windows los rechaza
  (`EPERM: operation not permitted, symlink`) sin esto o sin correr como
  administrador. Solo hace falta para compilar (`tools/build.py release` o
  `--testing`), no para `next dev`.
- **Inno Setup 6** — solo si vas a generar el instalador `.exe` distribuible
  (`tools/build.py release`). No hace falta para desarrollo normal.
- (Opcional, recomendado si te importa la velocidad de "Refinar") **WSL2**
  — el kernel rápido de RoMa/Laila (la verificación geométrica) está
  deshabilitado fuera de Linux. En Windows nativo, CUDA funciona igual de
  bien para el resto de los modelos, pero el paso de verificación cae a un
  camino más lento. El wizard de `/setup` ofrece instalar las dependencias
  de Python dentro de WSL2 como alternativa opcional — nunca instala WSL2
  por ti, así que si lo querés usar, instalalo primero (`wsl --install`
  desde PowerShell como administrador).

## 3. Clonar e instalar dependencias JS

```bash
git clone <url-del-repo> lumi
cd lumi
corepack enable
pnpm install
```

## 4. Archivo `.env`

```bash
cp .env.example .env
```

Variables que trae `.env.example`, todas relacionadas con infraestructura
local (nunca API keys de terceros — esas van por el wizard/Settings, ver
más abajo):

| Variable | Default | Para qué |
|---|---|---|
| `POSTGRES_HOST` | `localhost` | Host de Postgres. **Esta es la que cambiás para una DB remota** (sección 5). |
| `POSTGRES_PORT` | `5432` | Puerto de Postgres. |
| `POSTGRES_USER` | `netryx` | Usuario de Postgres. |
| `POSTGRES_PASSWORD` | `changeme` | Contraseña. Cambiala si es una DB remota real. |
| `POSTGRES_DB` | `netryx_dev` | Nombre de la base de datos. |
| `PORT` | `3000` | Puerto HTTP de `apps/web`. |
| `NODE_ENV` | `development` | — |
| `SETTINGS_ENCRYPTION_KEY` | (autogenerada) | Clave para cifrar settings sensibles (API keys) en la DB. Si la dejás sin definir, `apps/web` genera y persiste una en `apps/web/data/settings.key` la primera vez que arranca. |
| `SETTINGS_KEY_PATH` | `apps/web/data/settings.key` | Ruta alternativa para el archivo de clave de arriba. |
| `MODELS_CACHE_DIR` | `data/models-cache` | Dónde cachea los pesos de los modelos (PyTorch/HuggingFace). Útil para moverlo a un disco más grande. |
| `STREET_VIEW_IMAGE_DIR` | `data/street-view` | Dónde guarda las imágenes de Street View descargadas. |

Dos variables más que el código sí lee pero que **no** están en
`.env.example` (agregalas a mano si tu setup las necesita):

| Variable | Default si falta | Para qué |
|---|---|---|
| `INFERENCE_SERVICE_URL` | `http://localhost:8000` | URL del servicio de inferencia — cambiala si corre en otra máquina (ej. un servidor con GPU separado). La leen tanto `apps/web` como `apps/worker`. |
| `TEST_DATABASE_URL` | hardcodeada en `db/package.json` | Ver sección 5.3 — control aparte de las migraciones, no sigue automáticamente a `POSTGRES_*`. |

**Importante:** `GOOGLE_MAPS_API_KEY` y `MAPBOX_TOKEN` **no son variables de
entorno**. Se guardan cifradas dentro de la tabla `system_settings` de
Postgres, a través del wizard de `/setup` o de la página `/settings` — no
las pongas en `.env`, no se leerían de ahí.

## 5. Base de datos

### 5.1 Opción A — Local con Docker (la más simple)

```bash
pnpm db:up        # docker compose up -d --build db
pnpm db:migrate   # corre las migraciones pendientes
```

`db:up` construye una imagen propia (`db/docker/postgres/Dockerfile`,
basada en `postgis/postgis:17-3.5` + el paquete apt
`postgresql-17-pgvector`) — PostGIS y pgvector ya vienen instalados en la
imagen, y el rol por defecto es superusuario, así que las migraciones
pueden habilitar las extensiones ellas mismas sin pasos extra. También se
crea automáticamente una base `netryx_test` (para `pnpm test`) la primera
vez que se crea el contenedor.

Otros comandos:

```bash
pnpm db:logs     # logs del contenedor
pnpm db:down     # apagar (los datos persisten en el volumen)
pnpm db:reset    # apagar + borrar volumen + levantar limpio
```

### 5.2 Opción B — Base de datos remota

Cualquier Postgres 14+ alcanzable por red sirve (una VM propia, RDS,
Supabase, Neon, etc.), siempre que cumpla dos condiciones:

1. **Las extensiones `postgis` y `vector` (pgvector) deben estar
   disponibles** en esa instancia. La primera migración
   (`db/migrations/1720400000000_init.js`) corre literalmente:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   CREATE EXTENSION IF NOT EXISTS postgis;
   ```
   — no asume que ya están habilitadas, pero sí asume que **puede**
   habilitarlas. En un servidor propio (una VM con Postgres instalado por
   vos) esto es instalar los paquetes de PostGIS/pgvector para tu versión
   de Postgres y listo. En un proveedor administrado, Supabase y Neon
   soportan ambas extensiones como "trusted extensions" — activalas antes
   de correr las migraciones (por su propio dashboard/CLI, o simplemente
   dejá que la migración lo intente si tu rol tiene permiso). En AWS RDS,
   `postgis` está soportado nativamente; pgvector requiere una versión de
   RDS Postgres reciente (16+) que lo incluya en `shared_preload_libraries`
   — confirmá esto antes de migrar.
2. **El rol que usás para conectarte necesita privilegio para
   `CREATE EXTENSION`** (superusuario, o el mecanismo de extensiones de
   confianza que exponga el proveedor). Si no lo tiene, la primerísima
   sentencia de la primera migración falla, y todo lo que depende de esas
   tablas falla en cascada detrás (mismo síntoma que documenta
   históricamente `docs/problems.md` para el Postgres nativo de Windows,
   solo que ahora la causa es un permiso del lado del proveedor en vez de
   un PATH mal configurado).

Una vez confirmado lo anterior, apuntá `.env` al host remoto:

```env
POSTGRES_HOST=tu-host-remoto.ejemplo.com
POSTGRES_PORT=5432
POSTGRES_USER=tu_usuario
POSTGRES_PASSWORD=tu_password_real
POSTGRES_DB=netryx_dev
```

Esto alcanza para que **la app en sí** (`apps/web`, `apps/worker`,
`services/inference`) se conecte al host remoto — los tres leen estas
mismas cinco variables (`POSTGRES_HOST/PORT/USER/PASSWORD/DB`) de forma
consistente.

### 5.3 El gotcha: las migraciones NO siguen automáticamente a `.env`

`db/package.json` corre las migraciones con una variable completamente
distinta, `TEST_DATABASE_URL` (un connection-string completo, no los cinco
campos separados), **con el valor hardcodeado dentro del propio script**:

```json
"migrate:up": "cross-env TEST_DATABASE_URL=postgres://netryx:changeme@localhost:5432/netryx_dev node-pg-migrate up -d TEST_DATABASE_URL --envPath ../.env"
```

Como `cross-env` fija `TEST_DATABASE_URL` en el propio comando, **el valor
que pongas en `.env` para `POSTGRES_HOST` nunca llega a `pnpm db:migrate`**
— vas a terminar con la app apuntando correctamente al servidor remoto,
pero las migraciones corriendo (o fallando por no poder conectarse) contra
`localhost:5432/netryx_dev`, sin ningún error obvio que lo delate más allá
de que las tablas nunca aparecen del lado remoto.

Para migrar contra el servidor remoto, sobreescribí `TEST_DATABASE_URL` vos
mismo al invocar el comando (esto sí gana sobre el valor del script):

```bash
cross-env TEST_DATABASE_URL=postgres://tu_usuario:tu_password_real@tu-host-remoto.ejemplo.com:5432/netryx_dev \
  pnpm --filter @netryx/db exec node-pg-migrate up -d TEST_DATABASE_URL
```

(En PowerShell, `cross-env` sigue funcionando igual — es justamente lo que
evita la sintaxis `VAR=value comando` que rompe en `cmd.exe`/PowerShell.)

Si además vas a correr los tests del monorepo (`pnpm test`) contra el
servidor remoto, necesitás crear manualmente una base `netryx_test` ahí
(en Docker esto lo hace solo `db/docker/postgres/init-test-db.sh`, pero
ese script solo corre en el primer arranque de un contenedor nuevo — un
Postgres remoto no lo ejecuta nunca) y apuntar `test`/`migrate:up:test` de
la misma forma que arriba, cambiando el nombre de la base.

## 6. Servicio de inferencia (Python)

```bash
cd services/inference

# Linux
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/python -m uvicorn main:app --host 0.0.0.0 --port 8000

# Windows
python -m venv venv
venv\Scripts\pip.exe install -r requirements.txt
venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
```

`requirements.txt` fija `torch==2.5.1+cu121` /
`torchvision==0.20.1+cu121` vía
`--extra-index-url https://download.pytorch.org/whl/cu121` — este índice
sirve wheels de CUDA 12.1 para **Windows y Linux por igual**, así que el
mismo `pip install -r requirements.txt` resuelve correctamente en ambos
sistemas operativos sin ningún comando condicional por OS. Lo que sí varía
por sistema:

- Necesitás un **driver NVIDIA** compatible con el runtime de CUDA 12.1
  (se instala aparte de pip — desde nvidia.com en Windows, o el paquete de
  tu distro en Linux).
- Sin GPU (o sin ese driver), todo cae automáticamente a CPU
  (`torch.cuda.is_available()` en `loader.py`) — mucho más lento, en
  particular para verificación geométrica, pero funciona igual.
- En Windows nativo (sin WSL2), el kernel rápido de RoMa/Laila está
  deshabilitado — la CUDA en sí funciona igual, pero ese paso puntual de
  verificación es más lento que en Linux/WSL2. Ver la nota de WSL2 en la
  sección 2.

## 7. Levantar todo en modo desarrollo

Con `.env` listo y la base de datos migrada (local o remota):

```bash
python3 tools/build.py             # o "python" en Windows
python3 tools/build.py --tui       # dashboard interactivo (requiere pip install textual)
```

Esto levanta Postgres si es local (`docker compose up -d --build db`),
corre migraciones pendientes (tolerando el error si ya están al día),
arranca el servicio de inferencia si ya existe `services/inference/venv`
(si no, avisa que falta completar `/setup`), arranca `apps/worker`, y
finalmente `next dev` en primer plano — abre `http://localhost:3000` solo,
y Ctrl+C corta todo junto. Detecta el sistema operativo automáticamente
(usa `venv/Scripts/...` o `venv/bin/...` según corresponda).

Si preferís levantar cada pieza a mano en vez de `tools/build.py`, ver la
sección "Modo desarrollo" del `README.md` — es el mismo procedimiento
descrito ahí, sin repetirlo acá.

## 8. Primer arranque — wizard de `/setup`

La primera vez que abrís la app te redirige a `/setup`, que:

- Valida que Node/Python/Docker (si aplica) estén disponibles.
- Te deja instalar las dependencias de Python (si no lo hiciste a mano en
  la sección 6) — en Windows, ofrece el toggle opcional de instalarlas
  dentro de WSL2 en vez de nativo; en Linux no aparece ese toggle.
  Directamente **no lo uses** si no instalaste WSL2 vos mismo antes.
- Descarga los pesos de los modelos.
- Te pide la API key de Google Street View Static API (y opcionalmente el
  token de Mapbox) — estas quedan guardadas cifradas en la base de datos,
  no en `.env`.

## 9. Empaquetar un instalador distribuible (maintainers)

Fuera del alcance de esta guía de instalación para desarrollo — ver la
sección correspondiente en `README.md` (`tools/build.py release`).

## 10. Troubleshooting

- **La migración falla en el primerísimo `CREATE EXTENSION`** contra una
  DB remota → el rol de conexión no tiene privilegio para crear
  extensiones, o el proveedor no las tiene disponibles. Ver sección 5.2.
- **La app se conecta bien pero las tablas nunca existen** → casi seguro
  el gotcha de `TEST_DATABASE_URL` de la sección 5.3: las migraciones
  corrieron contra `localhost` en vez del host remoto.
- **`EPERM: operation not permitted, symlink` al compilar en Windows** →
  falta activar el Modo de desarrollador de Windows (sección 2).
- **Instalación de dependencias de Python falla con
  `ModuleNotFoundError: No module named 'romatch'`** → confirmá que
  `pip install -r requirements.txt` corrió limpio contra el `requirements.txt`
  actual del repo (esa dependencia se agregó explícitamente a él;
  instalaciones viejas hechas a mano antes de ese cambio pueden no
  tenerla).
- **Errores de sintaxis tipo `'python3' no se reconoce como un comando
  interno o externo`** → en Windows el binario se llama `python`, no
  `python3` (ver los comandos exactos de la sección 6).
- Para el historial completo de problemas ya resueltos al migrar de
  Postgres nativo a Docker (PATH, usuarios de OS vs. roles de Postgres,
  sintaxis de PowerShell), ver `docs/problems.md` — es un registro
  histórico, no hace falta seguir esos pasos hoy.
