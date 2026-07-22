<p align="center">
  <img src="docs/assets/banner.svg" alt="Lumi — geolocalización street-view, self-hosted" width="100%" />
</p>

<p align="center">
  <img alt="status" src="https://img.shields.io/badge/status-proof--of--concept-f2c94c" />
  <img alt="platform" src="https://img.shields.io/badge/platform-windows%20%7C%20linux-5dcaa5" />
  <img alt="node" src="https://img.shields.io/badge/node-%E2%89%A520-3c873a" />
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-9.7.0-f69220" />
  <img alt="python" src="https://img.shields.io/badge/python-3.12-3776ab" />
  <img alt="postgres" src="https://img.shields.io/badge/postgres-17%20%2B%20postgis%20%2B%20pgvector-336791" />
</p>

<p align="center">
  Subes una foto tomada en la calle y el sistema busca, dentro de un índice
  que tú mismo generas para una zona concreta, el punto capturado que más
  se parece — con coordenadas, radio de confianza y verificación geométrica
  opcional.
</p>

<p align="center">
  <a href="./INSTALL.md"><b>Guía de instalación</b></a> ·
  <a href="docs/PROOF_OF_CONCEPT.md">Alcance y limitaciones</a> ·
  <a href="#documentacion">Documentación</a>
</p>

---

> **Nota de alcance:** este es un proyecto de prueba de concepto (PoC), no un
> producto terminado. Ver [`docs/PROOF_OF_CONCEPT.md`](docs/PROOF_OF_CONCEPT.md)
> para el detalle de qué está resuelto, qué está deliberadamente fuera de
> alcance, y los riesgos/limitaciones conocidos (incluido un tema de
> Términos de Servicio de Google Maps Platform que conviene leer antes de
> usar esto contra datos reales).

## Contenido

- [Qué hace, en capturas reales](#capturas)
- [Arquitectura](#arquitectura)
- [Stack](#stack)
- [Instalación](#instalacion)
- [Empaquetar un instalador distribuible](#empaquetar)
- [Documentación](#documentacion)
- [Benchmarks](#benchmarks)
- [Licencia y atribución](#licencia)

<h2 id="capturas"><img src="docs/assets/title-capturas.svg" alt="Qué hace, en capturas reales" /></h2>

**1. Indexar un área.** Dibujas un polígono sobre el mapa, el sistema
samplea puntos siguiendo la red de calles real (vía Overpass/OpenStreetMap,
no un grid ciego) y lanza un job de indexado en segundo plano.

![Indexando un área en León](docs/screenshots/indexing-area.png)

**2. Subir una imagen y elegir modelo.** El pase de retrieval usa el modelo
expuesto como **Lumi Preview**; puedes tener más de un modelo disponible en
`/settings`.

![Selección de imagen y modelo de búsqueda](docs/screenshots/search-region.png)

**3. Resultados agrupados por zona, con nivel de confianza.** Los candidatos
del top-k se agrupan espacialmente en regiones (círculos translúcidos =
radio de confianza), cada uno con su % de similitud y estado
(`unreviewed`/`confirmed`). Desde ahí puedes pedir un refinamiento más caro
(verificación geométrica) sobre una región concreta.

![Resultados agrupados por región de confianza](docs/screenshots/results-clustering.png)

---

<h2 id="arquitectura"><img src="docs/assets/title-arquitectura.svg" alt="Arquitectura" /></h2>

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

| Componente | Responsabilidad |
|---|---|
| **`apps/web`** | Next.js (App Router). Dashboard de búsqueda, panel de indexado, gestión de áreas, settings y wizard de primer arranque (`/setup`). El mapa (Mapbox/MapLibre) se monta client-only. |
| **`apps/worker`** | Worker Node que consume la cola de jobs de indexado: llama a Overpass, descarga imágenes de Street View, las manda en batch al servicio de inferencia, y escribe progreso para que `/index` lo lea por SSE. |
| **`services/inference`** | FastAPI (Python) con MegaLoc y RoMa cargados en memoria una sola vez al arrancar. Expone `POST /embed` y `POST /verify`. Nunca se llama a PyTorch directamente desde Node. |
| **`packages/`** | Código compartido: tipos TS (`shared-types`), sampling de calles sobre Overpass (`geo-sampling`), repositorio de settings cifrados (`settings-repo`), tracking de uso/coste de API (`api-usage`). |
| **`db/`** | Migraciones SQL (node-pg-migrate) para Postgres + **pgvector** (similitud de embeddings) + **PostGIS** (consultas espaciales por área/polígono). |

**Cola de jobs:** **pg-boss** sobre el propio Postgres — no hay Redis en el
stack (Redis no tiene soporte oficial en Windows, que es el target de
despliegue principal).

<h2 id="stack"><img src="docs/assets/title-stack.svg" alt="Stack" /></h2>

| Capa | Tecnología |
|---|---|
| Frontend/API | Next.js 14 (App Router), TypeScript, Tailwind CSS |
| Mapa | Mapbox GL JS / MapLibre GL JS + turf.js |
| Worker | Node.js + pg-boss |
| Inferencia | FastAPI, PyTorch (CUDA), MegaLoc (retrieval), RoMa (verificación) |
| Base de datos | PostgreSQL + pgvector + PostGIS |
| Monorepo | pnpm workspaces |

<h2 id="instalacion"><img src="docs/assets/title-instalacion.svg" alt="Instalación" /></h2>

> **[Ver la guía completa, paso a paso, comando a comando →](./INSTALL.md)**
> Cubre Windows y Linux, prerequisitos, cómo usar una base de datos remota
> en vez de la de Docker local, la skill de Claude Code, y troubleshooting.

```bash
pnpm db:logs     # logs del contenedor de Postgres
pnpm db:down     # apagar (los datos persisten en el volumen)
pnpm db:reset    # apagar + borrar volumen + levantar limpio
pnpm test        # tests de todo el monorepo
pnpm build       # build de todo el monorepo
```

<h2 id="empaquetar">Empaquetar un instalador distribuible (para maintainers)</h2>

```bash
services/inference/venv/bin/pip install pyinstaller   # una vez — Scripts/pip.exe en Windows
python3 tools/build.py release
```

Compila `apps/web` (`next build --standalone`) y `apps/worker` (esbuild),
los empaqueta junto con el resto del proyecto (sin `node_modules` propios,
entornos virtuales de Python, cachés de pesos de modelo ni historial de
`.git`), y genera el instalador nativo de la plataforma en la que corriste
el comando: `dist/LumiSetup-<version>.exe` (Inno Setup) en Windows,
`dist/LumiSetup-<version>.sh` (script bash autoextraíble, sin dependencias
externas) en Linux. Ver el docstring de `tools/build.py` para las flags de
`release` (`--version`, `--keep-staging`; `--nopublish`/`--versionnotes`
están reservadas para un futuro flujo de publicación a GitHub Releases,
todavía no implementado).

<h2 id="documentacion"><img src="docs/assets/title-documentacion.svg" alt="Documentación" /></h2>

Todo el detalle de diseño y las decisiones de arquitectura viven en
`docs/`: spec inicial del fork, setup de base de datos, pipeline de
indexado, pass 1/pass 2 de búsqueda, tracking de coste, UI del dashboard y
del wizard de setup. Es la referencia si quieres levantar cada pieza a mano
o entender por qué se tomó tal o cual decisión.

<h2 id="benchmarks"><img src="docs/assets/title-benchmarks.svg" alt="Benchmarks" /></h2>

Números reales, medidos con [`tools/benchmark.py`](tools/benchmark.py)
contra este mismo hardware de prueba (NVIDIA RTX 3050 Laptop, 6 GB VRAM,
`INFERENCE_LOW_VRAM_MODE` activo) — no son cifras inventadas ni
extrapoladas. Cualquiera puede reproducirlos con los mismos comandos.

<p align="center">
  <img src="docs/assets/chart-embed.svg" alt="Throughput y latencia de POST /embed por tamaño de batch" width="100%" />
</p>

```bash
python tools/benchmark.py embed --url http://localhost:8000 --batch-sizes 1 4 8 16 32
```

El throughput sube con el batch hasta 16 (~42 img/s) y cae en 32 — el
punto donde el costo de una request más grande empieza a superar la
ganancia de paralelismo en esta GPU concreta.

<p align="center">
  <img src="docs/assets/chart-index-scale.svg" alt="Latencia de búsqueda coseno en pgvector según tamaño del índice" width="100%" />
</p>

```bash
python tools/benchmark.py index-scale --dsn postgresql://netryx:changeme@localhost:5432/netryx_dev --sizes 1000 10000 50000
```

Búsqueda coseno **exacta** (sin índice ANN todavía) — la latencia crece
mucho más rápido que el tamaño del índice, la señal de que a partir de
unas pocas decenas de miles de filas hace falta HNSW/IVFFlat en vez de un
escaneo completo.

**`POST /verify` (verificación geométrica con RoMa):** en este mismo
hardware de 6 GB, `/verify` agota la VRAM disponible tras cargar el modelo
de verificación (`torch.cuda.OutOfMemoryError`, capturado como 503) — un
resultado real, no una cifra faltante. Es exactamente la limitación que
motivó `INFERENCE_LOW_VRAM_MODE` y el aviso de OOM ya manejado en
`services/inference/main.py`. Con más VRAM libre (o una GPU de escritorio),
correr `python tools/benchmark.py verify --url http://localhost:8000
--candidates 1 5 10 25 50` sí debería completar.

Proyección de coste/tiempo de indexado (determinista, sin necesitar
ningún servicio corriendo):

```bash
python tools/benchmark.py cost-model --area-km2 0.2 1 5 20 100
```

| Área (km²) | Imágenes | Coste (USD) | Chunks de embed | Tiempo est. (min) |
|---|---|---|---|---|
| 0.2 | 1,280 | $8.96 | 80 | 2.0 |
| 1.0 | 6,400 | $44.80 | 400 | 9.9 |
| 5.0 | 32,000 | $224.00 | 2,000 | 49.3 |
| 20.0 | 128,000 | $896.00 | 8,000 | 197.3 |
| 100.0 | 640,000 | $4,480.00 | 40,000 | 986.7 |

Ver [`docs/PROOF_OF_CONCEPT.md`](docs/PROOF_OF_CONCEPT.md#4-benchmarks)
para el detalle completo y cómo se generó cada número.

<h2 id="licencia"><img src="docs/assets/title-licencia.svg" alt="Licencia y atribución" /></h2>

Este proyecto construye sobre pesos congelados de **MegaLoc** (MIT) y
**RoMa**, sin fine-tuning propio. Ver `docs/PROOF_OF_CONCEPT.md` para el
detalle de qué modelos se usan y sus términos.

<p align="center">
  <br/>
  <img src="docs/assets/footer.svg" alt="Lumi" width="100%" />
</p>
