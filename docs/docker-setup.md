# Setup de base de datos con Docker (reemplaza el flujo manual de `problems.md`)

`docs/problems.md` documenta el dolor de instalar Postgres nativo en Windows
más las extensiones PostGIS/pgvector a mano. Con Docker ese flujo entero deja
de ser necesario: se construye una sola vez una imagen con todo preinstalado
y se usa igual en Windows, Mac, Linux o un servidor.

## Requisito único

Tener **Docker Desktop** instalado (Windows/Mac) o **Docker Engine** (Linux).
Nada de PATH, nada de Stack Builder, nada de binarios de pgvector a mano.

## Uso

```bash
# 1. Copiar el .env de ejemplo (si no existe todavía)
cp .env.example .env

# 2. Levantar la base (build la primera vez, después es instantáneo)
pnpm db:up

# 3. Correr las migraciones
pnpm db:migrate

# 4. Correr los tests (usan netryx_test, creada automáticamente)
pnpm --filter @netryx/db test
```

Otros comandos:

```bash
pnpm db:logs    # ver logs del contenedor
pnpm db:down    # apagar (los datos persisten en el volumen)
pnpm db:reset   # apagar + borrar volumen + levantar de cero (base limpia)
```

## Qué resuelve esto de `problems.md`

| Problema original | Con Docker |
|---|---|
| `createdb` no reconocido / PATH | No aplica — no se instala Postgres en el SO |
| Autenticación con usuario de Windows | No aplica — el contenedor solo expone el usuario `netryx` |
| `&&` / env vars en PowerShell | No aplica — `pnpm db:up` es el mismo comando en cualquier SO |
| Usuario `netryx` no existe | Se crea automáticamente vía `POSTGRES_USER`/`POSTGRES_PASSWORD` |
| Extensiones `vector`/`postgis` no instaladas | Vienen preinstaladas en la imagen (`docker/postgres/Dockerfile`) |
| Base de test corrupta a medias | `pnpm db:reset` la recrea limpia en un comando |

## En producción

El mismo `docker-compose.yml` sirve como base para:
- Un servidor propio con Docker (agregar backups del volumen).
- Adaptarlo a un proveedor cloud, o directamente usar un Postgres gestionado
  que ya trae pgvector + PostGIS preinstalados (ej. Supabase o Neon), sin
  mantener el Dockerfile vos mismo.

`docs/problems.md` queda como registro histórico de por qué se tomó esta
decisión — no hace falta seguir esos pasos nunca más.
