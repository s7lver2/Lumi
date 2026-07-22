# Guía de instalación — paso a paso

Sigue estos pasos en orden. Cada uno indica el comando exacto a correr, y
si Windows y Linux difieren, se muestran ambos por separado.

## Paso 1 — Instalar prerequisitos

| Programa | Verificar con | Notas |
|---|---|---|
| Node.js 20.x | `node --version` | |
| Python 3.12 | `python3 --version` (Linux) / `python --version` (Windows) | |
| Git | `git --version` | |
| Docker Desktop (Windows) / Docker Engine + Compose (Linux) | `docker --version` | Solo si vas a usar Postgres local (Paso 6, opción A). Si vas a usar una DB remota (opción B), saltalo. |

Solo Windows, además:

- Activar **Modo de desarrollador**: Configuración → Privacidad y
  seguridad → Para desarrolladores → activar. (Necesario para compilar más
  adelante; no hace falta para correr en modo desarrollo.)
- (Opcional, recomendado) **WSL2**, si querés que la verificación
  geométrica (RoMa) corra a velocidad completa:
  ```powershell
  wsl --install
  ```

## Paso 2 — Activar pnpm 9.7.0

```bash
corepack enable
corepack prepare pnpm@9.7.0 --activate
```

## Paso 3 — Clonar el repositorio

```bash
git clone <url-del-repo> lumi
cd lumi
```

## Paso 4 — Instalar dependencias del monorepo

```bash
pnpm install
```

## Paso 5 — Crear el archivo `.env`

```bash
cp .env.example .env
```

No edites nada todavía si vas a usar la base de datos local (Paso 6,
opción A) — los valores por defecto ya sirven. Si vas a usar una base de
datos remota, seguí el Paso 6, opción B, que te dice exactamente qué
líneas cambiar.

## Paso 6 — Base de datos

### Opción A — Local con Docker

```bash
pnpm db:up
pnpm db:migrate
```

Listo, seguí al Paso 7.

### Opción B — Base de datos remota

**6B.1 — Confirmar que el servidor remoto soporta las extensiones
necesarias.**

Necesitás Postgres 14+ con `postgis` y `vector` (pgvector) disponibles, y
un rol con privilegio para `CREATE EXTENSION` (o el mecanismo de
"trusted extensions" del proveedor, si es uno administrado). En Supabase y
Neon, activá ambas extensiones desde su panel antes de seguir. En RDS,
necesitás Postgres 16+ para pgvector.

**6B.2 — Editar `.env` con los datos del servidor remoto:**

```env
POSTGRES_HOST=tu-host-remoto.ejemplo.com
POSTGRES_PORT=5432
POSTGRES_USER=tu_usuario
POSTGRES_PASSWORD=tu_password_real
POSTGRES_DB=netryx_dev
```

**6B.3 — Correr las migraciones contra ese mismo servidor** (las
migraciones NO leen `.env` automáticamente — usan una variable aparte,
`TEST_DATABASE_URL`, que hay que pasar a mano con los mismos datos):

```bash
cross-env TEST_DATABASE_URL=postgres://tu_usuario:tu_password_real@tu-host-remoto.ejemplo.com:5432/netryx_dev \
  pnpm --filter @netryx/db exec node-pg-migrate up -d TEST_DATABASE_URL
```

**6B.4 — (Opcional) Si vas a correr los tests del monorepo**, creá también
una base `netryx_test` en el servidor remoto (a mano, con tu cliente de
Postgres de preferencia) y repetí el comando del paso anterior apuntando
a esa base antes de correr `pnpm test`.

## Paso 7 — Servicio de inferencia (Python)

**Linux:**

```bash
cd services/inference
python3 -m venv venv
venv/bin/pip install -r requirements.txt
```

**Windows:**

```powershell
cd services/inference
python -m venv venv
venv\Scripts\pip.exe install -r requirements.txt
```

El mismo comando de `pip install` sirve para GPU (NVIDIA + driver CUDA
12.1 instalado aparte) o para CPU-only (cae solo, más lento). No hace
falta ningún comando distinto por sistema operativo ni por GPU/CPU.

```bash
cd ../..
```

(volvés a la raíz del repo para el siguiente paso.)

## Paso 8 — Levantar todo

```bash
python3 tools/build.py
```

(en Windows, `python tools/build.py`). Esto levanta Postgres si es local,
corre migraciones pendientes, arranca el servicio de inferencia, el
worker, y `next dev`. Se abre solo en `http://localhost:3000`. Ctrl+C
corta todo junto.

Alternativa con dashboard interactivo:

```bash
pip install textual
python3 tools/build.py --tui
```

## Paso 9 — Completar el wizard de primer arranque

Al abrir `http://localhost:3000` por primera vez te redirige a `/setup`.
Seguí el wizard en pantalla:

1. Verifica prerequisitos automáticamente.
2. Te deja instalar dependencias de Python si no lo hiciste en el Paso 7
   (en Windows ofrece un toggle opcional para instalarlas dentro de WSL2 —
   usalo solo si ya instalaste WSL2 vos mismo).
3. Descarga los pesos de los modelos.
4. Te pide la API key de **Google Street View Static API** (obligatoria) y
   opcionalmente un token de **Mapbox** — estas se guardan cifradas en la
   base de datos, no van en `.env`.

Listo, la app queda funcionando.

## Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| La migración falla en el primer `CREATE EXTENSION` | El rol remoto no tiene privilegio, o el proveedor no tiene la extensión disponible | Ver Paso 6B.1 |
| La app conecta bien pero las tablas nunca existen | Las migraciones corrieron contra `localhost` en vez del servidor remoto | Repetí el Paso 6B.3 con los datos correctos |
| `EPERM: operation not permitted, symlink` al compilar en Windows | Falta el Modo de desarrollador | Activarlo (Paso 1) |
| `ModuleNotFoundError: No module named 'romatch'` | El `pip install -r requirements.txt` no corrió limpio, o es una instalación vieja | Repetir el Paso 7 |
| `'python3' no se reconoce como un comando` | En Windows el binario se llama `python`, no `python3` | Usar los comandos de Windows del Paso 7/8 |

Para el historial de problemas ya resueltos al migrar de Postgres nativo a
Docker en Windows, ver `docs/problems.md` (registro histórico, no hace
falta seguir esos pasos hoy).
