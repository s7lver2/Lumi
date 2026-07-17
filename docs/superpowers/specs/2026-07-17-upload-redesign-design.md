# Rediseño de subida de imágenes, librería en memoria, y panel de resultados modular — Design Spec

**Fecha:** 2026-07-17
**Estado:** Aprobado (mockups validados con la companion visual — ver `.superpowers/brainstorm/16651-1784320173/content/`)

## 1. Contexto y objetivo

Esta es una spec combinada (por decisión explícita del usuario: "Quiero meter todo junto en un solo diseño ahora") que cubre el trabajo de preparación antes de construir las "2 nuevas herramientas que van a usar 2 o más modelos distintos" (fuera de alcance de esta spec — se abordarán después). El alcance real de esta spec:

1. Rediseño visual completo del punto de entrada de subida de imágenes en la página principal (`apps/web/app/components/MapDropTarget.tsx`, `UploadPopup.tsx`, `SearchDashboard.tsx`), igualando el nivel de acabado de las capturas de referencia del usuario.
2. Recorte de imagen (crop) como acción opcional post-subida.
3. Importar imagen desde un enlace (URL), con protecciones de seguridad.
4. Seguridad: validación real de contenido de imagen en servidor (no confiar en extensión/MIME del cliente), protección SSRF para la importación por enlace.
5. Soporte real de múltiples imágenes: librería en memoria (persiste hasta reiniciar el servidor), selección de cuáles usar, búsqueda por tandas usando la cola de trabajo (`pg-boss`) ya existente.
6. Rediseño del panel de resultados lateral (`ResultsPanel.tsx`) a un sistema modular de "widgets" expandibles, preparando el terreno para que las futuras herramientas cuelguen ahí sus propios resultados.
7. Un primer widget nuevo real ("Hora estimada") más dos widgets de metadatos/estimación (EXIF, y dos widgets-plantilla para futuras herramientas), todos con un patrón común de bloqueo-por-modelo y una notificación de carga unificada que reemplaza la actual barra de `ModelLoadingNotice.tsx`.
8. Un selector de modo/modelo rediseñado dentro del popup de imágenes seleccionadas, reemplazando el dropdown plano actual, preparado para alojar los modos futuros.

### No-goals (explícitamente fuera de esta spec)

- Las "2 nuevas herramientas" en sí (identificación de vehículos, detección de imágenes generadas por IA, etc.) — solo se scaffoldea su lugar en la UI (widgets bloqueados, filas bloqueadas en el selector de modo), sin implementar los modelos reales.
- Los widgets "Clima estimado" y "Objetos detectados" se crean como componentes reales pero con un comentario indicando que no están conectados a ningún modelo todavía — son placeholders intencionales, no deuda técnica.
- No se modifica `services/inference`, `download_weights.py`, ni `packages/shared-types`'s `MODEL_BUNDLES` más allá de lo que ya existe (Lumi Preview sigue siendo el único bundle real).
- No se añade autenticación/multi-usuario — la librería de imágenes en memoria es global y compartida, consistente con el resto de la app (sin sesiones).

## 2. Arquitectura general

### 2.1 Librería de imágenes en memoria

Nuevo módulo `apps/web/lib/image-library.ts` (servidor, proceso único de Next.js):

- Estructura en memoria (`Map<string, LibraryImage>`, no persistida a disco ni base de datos), vive mientras el proceso `next start`/`next dev` esté arriba — se vacía al reiniciar (comportamiento pedido explícitamente por el usuario).
- `LibraryImage`: `{ id: string; filename: string; bytes: Buffer; mimeType: string; sizeBytes: number; width: number; height: number; addedAt: number; sourceKind: "upload" | "url" }`.
- **Límites** (razonables para un proceso Node de un solo usuario, sin caché de disco):
  - Máximo **10 MB** por imagen individual (rechazada antes de decodificar si el `Content-Length`/tamaño del buffer excede esto — cierra la puerta a bombas de descompresión antes de que `sharp` intente decodificar).
  - Máximo **30 imágenes** en la librería a la vez. Al superar el límite, se expulsa la más antigua por `addedAt` (LRU simple por inserción, no por último acceso — más simple y suficiente para este caso de uso).
  - Peor caso de memoria: 10 MB × 30 = 300 MB — aceptable para un proceso self-hosted.
- Funciones exportadas: `addImage(bytes, filename, mimeType): LibraryImage`, `getImage(id): LibraryImage | undefined`, `listImages(): LibraryImage[]` (orden por `addedAt` descendente), `removeImage(id): void`, `replaceImageBytes(id, newBytes, newWidth, newHeight): void` (usado por el guardado de recorte).

### 2.2 Validación real de imagen (servidor)

Nueva dependencia: **`sharp`** (añadida a `apps/web/package.json`). Nuevo helper `apps/web/lib/image-validation.ts`:

- `validateImageBytes(bytes: Buffer): Promise<{ ok: true; width: number; height: number; format: string } | { ok: false; reason: string }>`.
- Implementación: `sharp(bytes, { limitInputPixels: 268402689 /* ~16384x16384, sharp's own safe default */ }).metadata()`. Si `sharp` lanza o el `format` no está en el allowlist (`jpeg`, `png`, `webp`, `gif`, `avif`), se rechaza. Esto reemplaza la actual confianza ciega en `file.type` (client-controlled) tanto en `POST /api/models/[modelId]/estimate` (`apps/web/app/api/models/[modelId]/estimate/route.ts`) como en el nuevo endpoint de librería.
- El `imageExt` usado por `apps/web/lib/query-image-store.ts` pasa a derivarse del `format` real detectado por `sharp`, no de `file.type`.

### 2.3 Importar por enlace (URL) — protección SSRF

Nuevo helper `apps/web/lib/fetch-image-url.ts`:

- Solo esquemas `http:`/`https:`.
- Resuelve el hostname a IP (`dns.lookup`) **antes** de conectar, y rechaza si la IP resuelta cae en rangos privados/reservados: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (incluye el bloque de metadata cloud, `169.254.169.254`), `::1`, `fc00::/7`, `fe80::/10`. Reutilizable como lista de constantes `PRIVATE_IP_RANGES`.
- Timeout de conexión + lectura: 8 segundos total.
- Límite de tamaño de descarga: 10 MB (igual que el límite de la librería), cortando el stream si se excede antes de completarse — no confía en `Content-Length` (puede mentir), cuenta bytes reales según llegan.
- Tras descargar, los bytes pasan por el mismo `validateImageBytes()` de §2.2 antes de aceptar la imagen — una URL que devuelve HTML/ejecutable con `Content-Type: image/png` falsificado se rechaza igual.

### 2.4 Búsqueda por tandas (worker queue)

Reutiliza el patrón ya existente de `apps/web/lib/queue.ts` + `apps/worker` (mismo patrón que `EMBED_PENDING_IMAGES_JOB_NAME`, ver `apps/worker/src/jobs/embed-pending-images.ts`):

- Nuevo job `ANALYZE_IMAGE_BATCH_JOB_NAME` en `@netryx/shared-types`, payload `{ imageIds: string[]; modelId: string; searchId: string }`.
- Encolado desde un nuevo `POST /api/search/batch` (reemplaza la limitación actual de `SearchDashboard.tsx`'s `handleTriggerSearch()`, que hoy solo busca `selected[0].file` — comentario en la línea 167 documentando el límite de un-solo-archivo desaparece).
- El worker (`apps/worker/src/jobs/analyze-image-batch.ts`, nuevo) itera las imágenes seleccionadas, llama al mismo pipeline de estimación por imagen (reutilizando la lógica ya extraída para `/api/models/[modelId]/estimate`, factorizada a una función compartida en vez de solo vivir en el route handler), y persiste resultados. Progreso expuesto vía el mismo patrón de polling SSE que ya usa `apps/web/app/api/areas/[id]/progress/route.ts` (una tabla o estructura equivalente para `searchId`, no una tabla nueva de área — detalle de implementación para el plan).
- `useSearchStore` (`apps/web/app/stores/useSearchStore.ts`) gana un campo `batchProgress: { done: number; total: number } | null` para reflejar esto en la UI (la barra de progreso ya existente en el estilo `ProgressMeter` se reutiliza).

## 3. Punto de entrada de subida (estado vacío)

Sustituye el actual `MapDropTarget.tsx` (que solo aparece mientras se arrastra) por una card flotante **siempre visible** cuando no hay imágenes en curso, con el diseño calcado de la captura de referencia del usuario:

- Card centrada, borde punteado, ícono de imagen minimalista, título "Sube fotos para empezar tu búsqueda", subtítulo "Arrastra y suelta imágenes desde tu equipo".
- **Selector de 3 pestañas al pie de la card**, con ícono de línea + etiqueta en fila (no apilados), usando la paleta real de la app (`bg`, `panel`, `border`, `fg`, `muted`, `subtle`, `accent` de `tailwind.config.ts` — sin colores nuevos, sin azul):
  - **Imágenes**: contenido actual (drag-and-drop + botón "Seleccionar archivos…").
  - **Enlace**: campo de texto para pegar una URL + botón "Cargar imagen". Estados: reposo → verificando (spinner) → verificado (previsualización + check "Enlace verificado — imagen segura", usando fg/accent, sin verde) → rechazado (ícono de error + texto explicando que no es una imagen válida o no es accesible de forma segura). El check de verificación es el resultado de §2.2 + §2.3 corriendo en servidor.
  - **Recientes**: grid scrolleable (3 columnas) de las imágenes ya en la librería en memoria (§2.1), cada miniatura con checkbox de selección (borde/relleno blanco-negro al seleccionar, consistente con el botón primario — sin azul) y contador "N seleccionadas".
- Todo el conjunto (botones, pestañas, miniaturas) tiene animaciones de "press" (`scale` con `cubic-bezier(.34,1.56,.64,1)` al hover/click, `scale(.92-.95)` al soltar) y el estado de arrastre activo muestra el borde punteado "marchando" alrededor de la card (técnica de `stroke-dasharray` + `stroke-dashoffset` animado — no un pulso de color) más el ícono con un rebote sutil.

## 4. Popup de imágenes seleccionadas (extiende `UploadPopup.tsx`)

Al confirmar una selección (archivo, enlace verificado, o marcar imágenes de "Recientes"), se transiciona al popup existente, extendido así:

### 4.1 Selector de modo/modelo (nuevo, reemplaza la fila plana "Modelo: [dropdown]")

- **Colapsado (por defecto):** fila con ícono + "Lumi Preview" + subtítulo "Geolocalización aproximada · cobertura global" + "Cambiar ⌄" a la derecha.
- **Expandido (al pulsar "Cambiar"):** lista completa, calcada del layout de referencia del usuario (ícono + título + subtítulo + estado a la derecha por fila):
  - **Lumi Preview** — real, seleccionable, marca de check cuando activo.
  - **Identificar vehículo**, **Detectar IA generativa** — filas atenuadas (`opacity: .5`, texto en `subtle`), con el mismo ícono de candado usado en los widgets (§6.2) a la derecha en vez de badges de color. Estas son las únicas dos entradas placeholder por ahora; más se añadirán cuando existan modelos reales.
- Implementación: nuevo componente `apps/web/app/components/ModePicker.tsx`, reemplaza el bloque `Menu`+`RETRIEVAL_MODELS` actual dentro de `UploadPopup.tsx`. Sigue leyendo `RETRIEVAL_MODELS` de `@netryx/shared-types` para la entrada real; las entradas bloqueadas son una constante local `UPCOMING_MODES` (no un registro compartido — son puramente de UI, no bundles reales).

### 4.2 Fila por imagen

Cada imagen seleccionada mantiene el patrón actual (miniatura, nombre, peso, tag "① METADATA", botón ✕ de quitar) y gana un botón **"Recortar"** debajo del nombre (ícono de recorte + texto, mismo estilo que "Añadir más"). Al pulsarlo se abre la pantalla de recorte (§5) para esa imagen específica; al guardar, `replaceImageBytes()` (§2.1) actualiza la imagen en la librería y la miniatura se refresca in-place — no crea una imagen nueva.

### 4.3 Acciones al pie

"Añadir más" (igual que hoy) y "Buscar (N)" — el botón ahora dispara `POST /api/search/batch` (§2.4) en vez de solo la primera imagen.

## 5. Recorte de imagen (crop)

Reutiliza la lógica de recorte ya existente pero huérfana en `apps/web/app/components/ImageDropzone.tsx` (su función `cropToFile` y el uso de `react-easy-crop`'s `<Cropper>`, ya dependencia instalada). Nuevo componente `apps/web/app/components/CropDialog.tsx`:

- Modal con: preview de recorte (marco con esquinas tipo cámara + cuadrícula de tercios, arrastrable), slider de zoom, selector de proporción (**"Libre" por defecto**, con atajos rápidos "1:1" y "16:9" — no se fuerza ningún aspecto por defecto ya que el modelo de geolocalización no lo requiere).
- Acciones: **"Cancelar"** (cierra sin cambios — la imagen original en la librería queda intacta) y **"Guardar recorte"** (llama `replaceImageBytes`).
- Aplica tanto a imágenes de origen "archivo" como "enlace" — el mismo botón "Recortar" del popup, sin distinción de origen.
- El recorte **nunca es un paso obligatorio**: una imagen recién añadida (por archivo, enlace, o elegida de "Recientes") entra directo al popup de §4 sin pasar por esta pantalla; "Recortar" es una acción disponible después, no antes.

## 6. Panel de resultados modular (rediseño de `ResultsPanel.tsx`)

### 6.1 Sistema de widgets tipo "bento"

- Cada resultado (geolocalización, y cada herramienta futura) se renderiza como un **widget**: `{ id: string; title: string; icon: ReactNode; colSpan: 1 | 2 | 4; locked: boolean; render(): ReactNode }`.
- **Colapsados (estado por defecto de los widgets bloqueados):** tira angosta lateral junto al mapa a pantalla completa, cada widget es una fila con ícono + título + insignia de estado (ej. "12 candidatos"). Los widgets **siempre activos y sin bloqueo** (Geolocalización, Metadatos EXIF) arrancan **expandidos** por defecto — igual que el comportamiento actual del panel, donde los resultados de geolocalización son visibles de inmediato sin acción del usuario. Un widget bloqueado se muestra colapsado hasta que se instala/lanza su modelo, momento en el que pasa a expandido automáticamente.
- **Expandidos:** el panel se ensancha, el mapa se encoge horizontalmente (franja lateral fija) para dar espacio — confirmado como el comportamiento correcto frente a la alternativa de encoger el mapa verticalmente. No existe un botón separado para "ocultar todos los widgets": el ancho del panel es una función directa de cuántos widgets están expandidos, así que colapsar todos los widgets (uno a uno, o con una acción de conveniencia "Colapsar todo") devuelve el mapa a su ancho completo — no hay estado de UI adicional que sincronizar. Los widgets expandidos se distribuyen con **CSS Grid** (`grid-template-columns: repeat(auto-fill, minmax(110px, 1fr))`, `grid-auto-flow` natural), cada widget declarando su propio `colSpan` según cuánto contenido necesita (Geolocalización = 2, widgets pequeños = 1, EXIF/anchos = 4/completo). **El orden de aparición es siempre el mismo** (Geolocalización primero, luego el resto en el orden en que se registran) — no hay arrastrar ni reordenar; el grid solo decide cuántos caben por fila según el ancho disponible.
- Geolocalización (el `ResultsPanel` actual) se migra a ser el primer widget de este sistema, sin cambiar su lógica interna (`ResultRow`, `RefinedCandidateCard`, etc. se reutilizan tal cual dentro del widget).

### 6.2 Patrón de bloqueo por modelo

Los widgets que dependen de un modelo que no es Lumi Preview aparecen **bloqueados por defecto** (nunca se activan automáticamente):

- Contenido de fondo con `filter: blur(4px)` + `opacity: .5`.
- Overlay centrado: ícono de candado (con animación de "respiración" — pulso sutil de escala/opacidad en bucle, `2.6s ease-in-out infinite`) + botón de acción.
- **Copy del botón** (nota de implementación, no cambia ningún mockup): el texto es **"Instalar {nombre del modelo}"** la primera vez que ese modelo se usa (pesos aún no presentes localmente) y **"Lanzar {nombre del modelo}"** las veces siguientes (pesos ya instalados, solo hay que cargarlos a memoria/GPU) — el frontend decide cuál mostrar consultando si el modelo ya fue instalado antes (mismo mecanismo de detección que ya usa el catálogo de modelos).
- Metadatos EXIF (§6.4) es la única excepción: **no depende de ningún modelo**, así que siempre está activo y nunca bloqueado.

### 6.3 Notificación de carga unificada (reemplaza `ModelLoadingNotice.tsx`)

Nuevo componente `apps/web/app/components/ModelLoadNotification.tsx`, reemplaza el uso actual de `ModelLoadingNotice` en `ResultRow` y en cualquier otro lugar donde se muestre la barra de carga de Lumi Preview:

- Posición: esquina inferior derecha, apilable verticalmente si cargan varios modelos a la vez (ej. Lumi Preview + un widget nuevo simultáneamente).
- Contenido por notificación: **recorte pequeño (36×36) de la propia foto que se está analizando** (no texto largo) + nombre del modelo/widget + barra de progreso delgada (indeterminada, tonos neutros `fg`/`white-8%`, sin azul).
- Entrada animada: `slide-up + fade-in` (`translateY(10px)→0`, `opacity 0→1`).
- Sigue consultando `GET /api/model-status` (mecanismo ya existente, sin cambios) para saber qué modelo está cargando — solo cambia la presentación, no la fuente de verdad ("nunca se muestra por una suposición de timeout", regla ya documentada en `ModelLoadingNotice.tsx`, se mantiene).
- Se auto-oculta cuando el modelo termina de cargar (no requiere cierre manual).

### 6.4 Widgets incluidos en esta spec

Cuatro widgets nuevos, cada uno en su propio archivo bajo `apps/web/app/components/widgets/`:

1. **`ExifMetadataWidget.tsx`** — siempre activo (no requiere modelo). Grid de 2 columnas, ícono+valor por campo (cámara, apertura, velocidad, ISO, fecha, GPS), leídos directamente del EXIF del archivo (nueva utilidad `apps/web/lib/exif-read.ts`, usando los metadatos que `sharp` ya expone via `.metadata().exif` o una librería EXIF dedicada si `sharp` no basta — decisión de implementación en el plan). Entrada animada: cada campo aparece con fade+rise escalonado (~60ms de diferencia entre campos).
   - **Ícono de advertencia (⚠, color `warning` de `tailwind.config.ts`, `#ef9f27`) junto a cualquier campo fácilmente modificable o que contradiga otra estimación** — ej. el campo "Fecha" EXIF, que el usuario puede editar trivialmente y que puede no coincidir con el resultado del widget "Hora estimada"; al hacer hover explica la razón ("El EXIF se puede editar fácilmente y no coincide con la hora estimada por sombras"). Este patrón (`.jg-warn`-equivalente) es reutilizable para cualquier futuro campo con la misma ambigüedad.

2. **`EstimatedTimeWidget.tsx`** — bloqueado (modelo nuevo, no construido en esta spec — placeholder con comentario `// TODO: sin modelo real todavía; conectar cuando exista un modelo de estimación de hora por sombras`). Visualización: **semicírculo** (no círculo completo — decisión final tras iteración), representando el domo del cielo de horizonte a horizonte. El marcador (sol o luna según la hora) se posiciona sobre el arco según una proyección lineal hora→ángulo (0h/24h en los extremos, 12h en el ápice). El sol se dibuja como un ícono propio (círculo relleno + 8 "pétalos" redondeados rotados a 45°, con un halo suave alrededor) cuyo color pasa de **amarillo** (`#f2c94c`, cerca del mediodía) a **rojo/naranja** (`#d9432e`/`#e8863c`, cerca de los bordes/amanecer-atardecer) según su posición en el arco; de noche se reutiliza el mismo semicírculo con un ícono de luna creciente (dos círculos superpuestos, sin color). Al revelarse un resultado, todo el grupo (arco + marcador) gira desde `-540deg` hasta `0deg` con easing de asentamiento (~1.3s) — un giro decorativo que siempre termina alineado, no una rotación permanente del arco.

3. **`WeatherEstimateWidget.tsx`** — bloqueado, placeholder (`// TODO: sin modelo real todavía`). Muestra rango de temperatura estimado + condición ("Despejado, luz diurna") a partir de iluminación/sombras/elementos visibles.

4. **`DetectedObjectsWidget.tsx`** — bloqueado, placeholder (`// TODO: sin modelo real todavía`). Chips de texto con objetos detectados (ej. "farola", "acera", "buzón").

Todos los widgets (bloqueados o no) llevan un **ícono ⓘ** en la cabecera (junto al título, no apilado) que al hacer hover muestra un tooltip explicando de dónde sale esa predicción — patrón compartido `InfoTooltip.tsx`.

## 7. Animaciones (catálogo, para referencia del plan)

| Elemento | Animación |
|---|---|
| Botones primarios/secundarios | hover: `scale(1.03-1.05)` + brillo; active: `scale(.92-.94)`, `cubic-bezier(.34,1.56,.64,1)` |
| Pestañas (Imágenes/Enlace/Recientes) | hover: ícono rebota (`scale(1.18)`) + fondo sutil |
| Miniaturas de librería | hover: `scale(1.06)`; active: `scale(.95)` |
| Borde de la card al arrastrar un archivo encima | `stroke-dashoffset` animado (marching ants), sin color |
| Ícono de la card al arrastrar | rebote de escala en bucle mientras dura el arrastre |
| Candado de widget bloqueado | "respiración" (`opacity`/`scale` pulso, 2.6s) |
| Campos EXIF | fade+rise escalonado al aparecer |
| Widget "Hora estimada" al revelar resultado | giro de asentamiento del semicírculo completo (`-540deg → 0deg`, ~1.3s) |
| Notificación de carga | slide-up + fade-in al aparecer |

## 8. Archivos afectados (resumen para el plan)

**Nuevos:**
- `apps/web/lib/image-library.ts`, `apps/web/lib/image-validation.ts`, `apps/web/lib/fetch-image-url.ts`, `apps/web/lib/exif-read.ts`
- `apps/web/app/components/ModePicker.tsx`, `CropDialog.tsx`, `ModelLoadNotification.tsx`, `InfoTooltip.tsx`
- `apps/web/app/components/widgets/ExifMetadataWidget.tsx`, `EstimatedTimeWidget.tsx`, `WeatherEstimateWidget.tsx`, `DetectedObjectsWidget.tsx`
- `apps/web/app/api/library/route.ts` (GET listar / POST añadir), `apps/web/app/api/library/[id]/route.ts` (DELETE, PATCH para recorte), `apps/web/app/api/library/from-url/route.ts`, `apps/web/app/api/search/batch/route.ts`
- `apps/worker/src/jobs/analyze-image-batch.ts`
- Entrada `ANALYZE_IMAGE_BATCH_JOB_NAME` + payload type en `@netryx/shared-types`

**Modificados:**
- `apps/web/app/components/MapDropTarget.tsx` (rediseño completo del punto de entrada)
- `apps/web/app/components/UploadPopup.tsx` (selector de modo, botón recortar por fila)
- `apps/web/app/components/SearchDashboard.tsx` (dispara `/api/search/batch`, elimina el límite de un-solo-archivo)
- `apps/web/app/components/ResultsPanel.tsx` (se convierte en el widget "Geolocalización" del nuevo sistema modular)
- `apps/web/app/components/ModelLoadingNotice.tsx` (eliminado, reemplazado por `ModelLoadNotification.tsx`)
- `apps/web/app/stores/useSearchStore.ts` (+ `batchProgress`)
- `apps/web/app/api/models/[modelId]/estimate/route.ts` (usa `image-validation.ts` en vez de confiar en `file.type`)
- `apps/web/lib/query-image-store.ts` (extensión de archivo real, no derivada de MIME del cliente)
- `apps/web/package.json` (+ `sharp`)

## 9. Testing

Dado que `apps/web/vitest.config.ts` usa `environment: "node"` (sin infraestructura de renderizado de componentes), la cobertura de tests reales se limita a funciones puras: `image-library.ts` (límites de tamaño/cantidad, expulsión LRU), `image-validation.ts` (acepta formatos válidos, rechaza bytes corruptos/no-imagen), `fetch-image-url.ts` (rechaza IPs privadas, respeta límite de tamaño/timeout — con `fetch`/`dns.lookup` mockeados), y la lógica de `ModePicker`/widgets que no dependa de renderizado (si se extrae). Los componentes visuales nuevos no tienen test de renderizado, igual que el resto de componentes de la app hoy.
