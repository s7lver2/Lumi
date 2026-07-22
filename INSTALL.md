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
```

No hace falta correr las migraciones a mano acá — el wizard de `/setup`
(Paso 8) las corre por vos. Seguí al Paso 7.

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

Nota: el wizard de `/setup` (Paso 8) también tiene su propio paso
"Migrar", pero corre `pnpm migrate:up` sin pasarle `TEST_DATABASE_URL` —
por el mismo motivo del 6B.3, apunta a `localhost` y no a tu servidor
remoto. Como ya migraste a mano acá, ese paso del wizard no hace nada útil
para vos (no rompe nada, simplemente no aplica).

## Paso 7 — Levantar todo

Por ahora, el comando a usar es:

```bash
python3 tools/build.py release --testing
```

(en Windows, `python tools/build.py release --testing`). Esto compila
`apps/web` y `apps/worker` igual que un release real, pero sin empaquetar
ningún instalador — corre el build recién compilado directamente,
reutilizando Postgres/migraciones de este mismo checkout. Todavía no hace
falta tener nada de Python instalado — eso lo resuelve el wizard en el
paso siguiente. Se abre solo en `http://localhost:3000`. Ctrl+C corta todo
junto.

## Paso 8 — Ir a `/setup` y dejar que el wizard haga el resto

Al abrir `http://localhost:3000` por primera vez te redirige a `/setup`.
No hace falta instalar nada de Python a mano — simplemente segui el
wizard en pantalla y él se encarga de todo:

1. Verifica los prerequisitos automáticamente.
2. Corre las migraciones pendientes de la base de datos.
3. Crea el entorno virtual de `services/inference` e instala sus
   dependencias (en Windows ofrece un toggle opcional para instalarlas
   dentro de WSL2 en vez de nativo — usalo solo si ya instalaste WSL2 vos
   mismo, Paso 1).
4. Descarga los pesos de los modelos.
5. Arranca (o reinicia) el propio servicio de inferencia con esas
   dependencias ya instaladas.
6. Te pide la API key de **Google Street View Static API** (obligatoria) y
   opcionalmente un token de **Mapbox** — estas se guardan cifradas en la
   base de datos, no van en `.env`.

Listo, la app queda funcionando.

## Paso 9 (opcional) — Skill de Claude Code para geolocalizar fotos

El repo trae una skill de Claude Code en
`.claude/skills/lumi-geolocate/SKILL.md` que le permite a Claude usar la
propia API de Lumi (subir una foto, esperar el refinamiento, mostrar el
resultado) cuando le compartís una imagen y le preguntás dónde fue tomada.

**Si corrés Claude Code con este repo como directorio de trabajo**, no
hace falta instalar nada — Claude Code detecta automáticamente cualquier
skill dentro de `.claude/skills/` del proyecto abierto.

**Si querés que esté disponible en cualquier sesión de Claude Code, sin
importar el directorio**, copiala a tu carpeta global de skills:

**Linux/macOS:**

```bash
mkdir -p ~/.claude/skills
cp -r .claude/skills/lumi-geolocate ~/.claude/skills/
```

**Windows (PowerShell):**

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.claude\skills"
Copy-Item -Recurse .claude\skills\lumi-geolocate "$env:USERPROFILE\.claude\skills\"
```

No hace falta invocarla a mano con un `/comando` — Claude la detecta sola
cuando le compartís una foto y le preguntás dónde fue tomada, siempre que
Lumi esté corriendo (por defecto asume `http://localhost:3000`; si tu
instancia está en otro host/puerto, mencionáselo en el mensaje).

## Troubleshooting

| Síntoma | Causa | Solución |
|---|---|---|
| La migración falla en el primer `CREATE EXTENSION` | El rol remoto no tiene privilegio, o el proveedor no tiene la extensión disponible | Ver Paso 6B.1 |
| La app conecta bien pero las tablas nunca existen | Las migraciones corrieron contra `localhost` en vez del servidor remoto | Repetí el Paso 6B.3 con los datos correctos |
| `EPERM: operation not permitted, symlink` al compilar en Windows | Falta el Modo de desarrollador | Activarlo (Paso 1) |
| `ModuleNotFoundError: No module named 'romatch'` | La instalación de dependencias de Python del wizard no corrió limpio, o es una instalación vieja | Reintentar ese paso del wizard (Paso 8) |

Para el historial de problemas ya resueltos al migrar de Postgres nativo a
Docker en Windows, ver `docs/problems.md` (registro histórico, no hace
falta seguir esos pasos hoy).
