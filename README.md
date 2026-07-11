#  Lumi

Herramienta de geolocalización a partir de imágenes a nivel de calle,
self-hosted. Subís una foto tomada en la calle y el sistema busca, dentro de
un índice que vos mismo generás para una zona concreta, el punto capturado
que más se parece — con coordenadas, radio de confianza y verificación
geométrica opcional.

> **Nota de alcance:** este es un proyecto de prueba de concepto (PoC), no un
> producto terminado. Ver [`docs/PROOF_OF_CONCEPT.md`](docs/PROOF_OF_CONCEPT.md)
> para el detalle de qué está resuelto, qué está deliberadamente fuera de
> alcance, y los riesgos/limitaciones conocidos (incluido un tema de
> Términos de Servicio de Google Maps Platform que conviene leer antes de
> usar esto contra datos reales).

---

## Qué hace, en capturas reales

**1. Indexar un área.** Dibujás un polígono sobre el mapa, el sistema
samplea puntos siguiendo la red de calles real (vía Overpass/OpenStreetMap,
no un grid ciego) y lanza un job de indexado en segundo plano.

![Indexando un área en León](docs/screenshots/indexing-area.png)

**2. Subir una imagen y elegir modelo.** El pase de retrieval usa el modelo
expuesto como **Lumi Preview**; podés tener más de un modelo disponible en
`/settings`.

![Selección de imagen y modelo de búsqueda](docs/screenshots/search-region.png)

**3. Resultados agrupados por zona, con nivel de confianza.** Los candidatos
del top-k se agrupan espacialmente en regiones (círculos translúcidos =
radio de confianza), cada uno con su % de similitud y estado
(`unreviewed`/`confirmed`). Desde ahí podés pedir un refinamiento más caro
(verificación geométrica) sobre una región concreta.

![Resultados agrupados por región de confianza](docs/screenshots/results-clustering.png)

---

## Arquitectura

```
Imagen query
   │
   ▼
Lumi Preview (MegaLoc congelado) ──► descriptor 8448-d L2-normalizado
   │
   ▼
Búsqueda por similitud coseno (pgvector) + clustering espacial (regiones)
   │
   ▼
Top-k candidatos por región, con lat/lng/heading/pano_id
   │
   ▼ (solo bajo demanda, al pulsar "Refinar")
Verificación geométrica: Laila (RoMa congelado) sobre el top-k de la región
   │
   ▼
Resultado final: coordenadas exactas + score + imagen(es) de referencia
```

- **`apps/web`** — Next.js (App Router). Dashboard de búsqueda, panel de
  indexado, gestión de áreas, settings y wizard de primer arranque
  (`/setup`). El mapa (Mapbox/MapLibre) se monta client-only.
- **`apps/worker`** — worker Node que consume la cola de jobs de indexado:
  llama a Overpass, descarga imágenes de Street View, las manda en batch al
  servicio de inferencia, y escribe progreso para que `/index` lo lea por SSE.
- **`services/inference`** — FastAPI (Python) con MegaLoc y RoMa cargados en
  memoria una sola vez al arrancar. Expone `POST /embed` y `POST /verify`.
  Nunca se llama a PyTorch directamente desde Node.
- **`packages/`** — código compartido: tipos TS (`shared-types`), sampling
  de calles sobre Overpass (`geo-sampling`), repositorio de settings cifrados
  (`settings-repo`), tracking de uso/coste de API (`api-usage`).
- **`db/`** — migraciones SQL (node-pg-migrate) para Postgres +
  **pgvector** (similitud de embeddings) + **PostGIS** (consultas
  espaciales por área/polígono).
- **Cola de jobs:** **pg-boss** sobre el propio Postgres — no hay Redis en
  el stack (Redis no tiene soporte oficial en Windows, que es el target de
  despliegue principal).

## Stack

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Mapa | Mapbox GL JS / MapLibre GL JS + turf.js |
| Worker | Node.js + pg-boss |
| Inferencia | FastAPI, PyTorch (CUDA), MegaLoc (retrieval), RoMa (verificación) |
| Base de datos | PostgreSQL + pgvector + PostGIS |
| Monorepo | pnpm workspaces |

## Requisitos

- Node.js + [pnpm](https://pnpm.io/installation)
- Python 3 (para `services/inference`)
- Docker + Docker Compose (para Postgres con pgvector/PostGIS preinstalados)
- (Recomendado) GPU NVIDIA — el servicio de inferencia corre en CPU si no
  hay GPU, pero considerablemente más lento
- Una API key de Google Street View Static API (se pide en el wizard de
  `/setup`)

## Instalación rápida

Si recibiste un bundle (`lumi-<version>.zip`): descomprimilo y ejecutá
**`LumiInstaller.exe`** en la raíz. Verifica que tengas Node.js + pnpm,
Python 3 y Docker Desktop, crea `.env` desde `.env.example`, corre
`pnpm install`, levanta Postgres vía `docker compose`, y abre el navegador
en `/setup` para el wizard de primer arranque (dependencias de Python,
descarga de pesos del modelo, esquema de base de datos, API key).

### Manual (sin instalador)

```bash
# 1. Variables de entorno
cp .env.example .env

# 2. Base de datos (Postgres + pgvector + PostGIS vía Docker)
pnpm db:up
pnpm db:migrate

# 3. Dependencias del monorepo
pnpm install

# 4. Servicio de inferencia (en otra terminal)
cd services/inference
python -m venv venv
venv/Scripts/pip.exe install -r requirements.txt   # Windows
# ./venv/bin/pip install -r requirements.txt       # Linux/Mac
venv/Scripts/python.exe -m uvicorn main:app         # o el equivalente uvicorn de tu venv

# 5. Web + worker
pnpm --filter @netryx/web dev
pnpm --filter @netryx/worker dev
```

La primera vez, la app te lleva a `/setup` — un wizard que valida
prerequisitos, descarga los pesos de los modelos y te pide la API key de
Street View antes de dejarte indexar ninguna área.

### Otros comandos útiles

```bash
pnpm db:logs     # logs del contenedor de Postgres
pnpm db:down     # apagar (los datos persisten en el volumen)
pnpm db:reset    # apagar + borrar volumen + levantar limpio
pnpm test        # tests de todo el monorepo
pnpm build       # build de todo el monorepo
```

## Empaquetar un bundle distribuible (para mantainers)

```bash
services/inference/venv/Scripts/pip.exe install pyinstaller   # una vez
services/inference/venv/Scripts/python.exe tools/build.py
```

Genera `dist/lumi-<version>.zip`: una copia limpia del proyecto (código,
docs, configs — sin `node_modules`, entornos virtuales de Python, cachés de
pesos de modelo ni historial de `.git`) con `LumiInstaller.exe` compilado
en la raíz.

## Documentación

Todo el detalle de diseño y las decisiones de arquitectura viven en
`docs/`: spec inicial del fork, setup de base de datos, pipeline de
indexado, pass 1/pass 2 de búsqueda, tracking de coste, UI del dashboard y
del wizard de setup. Es la referencia si querés levantar cada pieza a mano
o entender por qué se tomó tal o cual decisión.

## Benchmarks

`scripts/benchmark.py` mide throughput de embedding, latencia de
verificación geométrica, escala del índice pgvector y proyecta coste/tiempo
de indexado por área. Ver [`docs/PROOF_OF_CONCEPT.md`](docs/PROOF_OF_CONCEPT.md#4-benchmarks)
para el detalle y los resultados.

## Licencia y atribución

Este proyecto construye sobre pesos congelados de **MegaLoc** (MIT) y
**RoMa**, sin fine-tuning propio. Ver `docs/PROOF_OF_CONCEPT.md` para el
detalle de qué modelos se usan y sus términos.