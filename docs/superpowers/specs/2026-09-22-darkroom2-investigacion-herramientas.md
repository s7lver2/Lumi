# Darkroom 2 — investigación de las herramientas (2026-09-22)

Volcado de la investigación de fondo encargada durante el brainstorming de Darkroom 2, antes
de escribir los specs de las herramientas del índice
(`2026-09-22-darkroom2-00-indice-design.md`). No es un spec: es la base factual (modelos,
licencias, datasets, servicios, riesgo legal) sobre la que se construyen los specs que sí se
lleguen a redactar.

> **Nota (2026-09-22): OSINT eliminado.** El sistema de OSINT quedó fuera de alcance de
> Darkroom 2 por decisión del dueño, y Car ID se limitó a **leer** la matrícula, sin resolverla
> a titular/anuncio/registro. La antigua sección 6 (OSINT) y las partes de investigación sobre
> matrícula → titular se han retirado de este documento por no describir nada que se vaya a
> construir. Lo que queda es la base factual de las herramientas vigentes: Verify Image, Car ID
> (reconocimiento + lectura de matrícula + mercado por modelo), Objetos, Especies e Interiores.

Licencias marcadas **(verify)** se tomaron de memoria del investigador, no de una página leída
en la sesión — hay que confirmarlas antes de fijarlas en cualquier spec. Las cifras de
precisión vienen de las fuentes citadas, no de pruebas propias.

**Lo que Raven dice de sí mismo** ([graylark.com/raven](https://graylark.com/raven)): Find
Region, Find Street, Find Property (beta, "ciudad soportada"), Identify Car (funciona con
vistas "parciales, obstruidas o de interior"), Verify Image (beta: "probabilidad de generación,
señales de manipulación facial y confianza por herramienta") y Cases. Excluye acceso a datos
privados, rastreo de dispositivos y acceso a mensajes. Ninguna fuente de datos se nombra
públicamente. (Raven también ofrece Live Intelligence sobre personas; Darkroom 2 no lo copia.)

---

## 1. Verify Image

**Lo que logran los detectores abiertos.** Un benchmark de 2026 probó 16 detectores con pesos
públicos ([arXiv 2602.07814](https://arxiv.org/html/2602.07814v1)):
- Community-Forensics quedó primero, 75–78 % de precisión media. DRCT (variantes CLIP) ~72 %,
  SAFE ~69 %, PatchCraft ~67 %, CNNSpot ~37 %.
- Los generadores modernos ganan a la mayoría de detectores: Flux Dev ~21 %, Midjourney v7
  ~24 %, Imagen 4 ~19 %, Firefly v4 ~18 %. Alrededor del 22 % de los generadores probados
  vencen a la mayoría de detectores.
- El ranking de detectores es inestable entre datasets (Spearman 0,01–0,87). Los datos de
  entrenamiento explican el 20–60 % de la varianza, más que la arquitectura.

**Candidatos:**

| Modelo | Qué es | Licencia | Tamaño |
|---|---|---|---|
| Community Forensics ([github](https://github.com/JeongsooP/Community-Forensics), [HF](https://huggingface.co/datasets/OwensLab/CommunityForensics)) | ViT-S entrenado con 2,7M imágenes de 4.803 generadores (CVPR 2025) | Dataset CC-BY-4.0 "solo investigación"; licencia de pesos **(verify)** | ViT-S, <1 GB |
| B-Free ([grip-unina](https://github.com/grip-unina/B-Free)) | Entrenamiento sin sesgo, bien calibrado en 27 generadores (FLUX, SD3.5) | **Solo uso informativo/sin ánimo de lucro**, no comercial | ViT |
| DRCT ([github](https://github.com/beibuwandeluori/DRCT)) | Reconstrucción por difusión + contrastivo, backbone CLIP | **(verify)** | ~1-2 GB |
| UnivFD | CLIP ViT-L/14 congelado + cabeza lineal; el patrón base a replicar | **(verify)** | ~2 GB |
| SIDA ([github](https://github.com/hzlsaber/SIDA)) | MLLM: detecta, da máscara de manipulación y explica en texto | **(verify)** | 7B+, ~16GB+ |
| DeepfakeBench ([github](https://github.com/SCLBD/DeepfakeBench)) | Zoo de detectores de face-swap/deepfake con pesos | Mixta por modelo **(verify)** | pequeños |

**Procedencia y marcas de agua** (lo único realmente fiable para atribuir un generador):
- **C2PA:** `c2pa-rs` (SDK Rust) y `c2patool` (CLI oficiales, [c2pa-rs](https://github.com/contentauth/c2pa-rs)), integrables directamente en `lumid`. Las imágenes de OpenAI llevan C2PA con identificador `gpt-image` ([OpenAI](https://developers.openai.com/api/docs/guides/content-provenance)). Se pierde al recomprimir y en la mayoría de redes sociales.
- **SynthID:** sin detector local. El portal de Google está en lista de espera y su API de detección es preview empresarial limitada a socios ([InfoQ](https://www.infoq.com/news/2026/05/google-synthid-content-detection/)). La API de verificación de OpenAI (jul-2026) solo cubre sus propias imágenes ([OpenAI](https://openai.com/index/advancing-content-provenance/)). Ambos serían servicios externos.
- **Decodificadores de marca de agua locales:** Adobe TrustMark (MIT, Python/ONNX/Rust, [github](https://github.com/adobe/trustmark)). Video Seal / Watermark Anything de Meta (MIT). Stable Signature de Meta: **(verify, probablemente no comercial)**.

**Forense clásico:** ELA, ruido/PRNU, tablas de cuantización JPEG y doble compresión, EXIF
(software, miniatura, modelo de cámara vs. resolución). Barato, en CPU, explicable — mejor
como señal de apoyo que como veredicto.

**Cómo funciona la atribución por generador, y por qué caduca.** El método habitual es una
cabeza multiclase sobre un backbone congelado (CLIP/DINO/SigLIP), entrenada con muestras de
cada generador, con un umbral de rechazo "desconocido". Caduca en meses: imágenes de
generadores de 2024 promediaban ~38 % de detección frente a 79 % de los de 2020, y salen
generadores nuevos cada trimestre. Recomendación de la investigación: tratar la procedencia
(C2PA, marcas de agua) como atribución dura, y la clasificación por generador como señal
débil con fecha de "entrenado hasta" y un cajón "desconocido".

---

## 2. Car ID, matrículas y anuncios

**Datasets de marca/modelo/año:** Stanford Cars (196 clases) y CompCars: solo investigación no
comercial ([LanceDB](https://docs.lancedb.com/datasets/stanford-cars)). VMMRdb (~9.170 clases,
[CVPRW 2017](https://openaccess.thecvf.com/content_cvpr_2017_workshops/w9/papers/Tafazzoli_A_Large_and_CVPR_2017_paper.pdf)):
licencia **(verify)**. MPF-Cars: 335k imágenes, 2.019 modelos. BRCars: 300k imágenes de 427
modelos de anuncios brasileños, **incluye interiores** ([arXiv 2604.05271](https://arxiv.org/pdf/2604.05271)).
Ningún modelo con pesos de licencia claramente comercial destaca.

**Ruta práctica, sin entrenar:**
- Zero-shot con SigLIP 2 (Apache-2.0, [HF](https://huggingface.co/google/siglip2-base-patch16-224)) y prompts de texto.
- Galería por recuperación: embeber referencias, exterior e interior (salpicadero, volante e infoentretenimiento distinguen mucho por generación); consultar por vecino más cercano.
- Referencias de interior: kits de prensa de fabricantes y fotos de anuncios (mismo problema de términos de uso que abajo). BRCars es casi el único dataset con interiores.
- Un VLM local (clase Qwen-VL) como segunda señal para leer insignias y acabados.

**Lectura de matrícula (ALPR), totalmente local:**
- **fast-alpr** (MIT) combina el detector de matrículas **open-image-models** (YOLOv9-t, ONNX) con los modelos de OCR de **fast-plate-ocr** (MIT): el modelo "global" CCT cubre 65+ países con predicción de región, y un MobileViTV2 europeo cubre 40+ países. OCR por debajo del milisegundo, basta CPU ([fast-alpr](https://github.com/ankandrew/fast-alpr), [fast-plate-ocr](https://github.com/ankandrew/fast-plate-ocr)). Licencia de los pesos no separada del código MIT **(verify)**.
- **PaddleOCR** (Apache-2.0) como reserva.
- Formato español: `NNNN LLL` sin vocales desde 2000, más formatos provinciales antiguos (`M-1234-AB`). Validar con regex tras el OCR.

**Mercado por modelo (externo, habilitado por el admin).** Car ID valora el *modelo*, no busca
un coche concreto: **modelo + color + zona → anuncios recientes** vía SERP/scraper es realista y
es lo único que el spec 6 usa. El acceso a portales (AutoScout24 solo tiene API de concesionario;
mobile.de, coches.net, Wallapop, Milanuncios no exponen API de búsqueda pública) pasa por
scrapers de terceros, y la sentencia del TJUE *Ryanair v PR Aviation* (C-30/14) hace exigibles
sus cláusulas anti-scraping ([Pinsent Masons](https://www.pinsentmasons.com/out-law/news/website-operators-can-prohibit-screen-scraping-of-unprotected-data-via-terms-and-conditions-says-eu-court-in-ryanair-case));
el riesgo de habilitar ese origen es del operador, como en Interiores.

**Matrícula → titular/anuncio: fuera de alcance.** Car ID lee la matrícula y muestra el texto y
el país de su formato, pero no la resuelve (spec 6 §9). La investigación previa sobre el informe
de vehículo de la DGT y el criterio de la AEPD sobre la matrícula como dato personal queda
retirada de este documento junto con OSINT: describía una capacidad que Darkroom 2 no construye.

---

## 3. Identify Object / muebles

- **Reconocimiento local:** SigLIP 2 (Apache-2.0) o DINOv3 para embeddings (DINOv3 tiene
  licencia comercial propia que conviene revisar, [Meta](https://ai.meta.com/resources/models-and-libraries/dinov3-license/)).
  Añadir un detector open-vocabulary para recortar objetos primero, y un VLM local para
  describirlos.
- **Búsqueda inversa de producto (externa):**
  - **Bing Visual Search** se retiró junto con toda la familia de Bing Search API el
    2025-08-11. El sustituto, "Grounding with Bing" en Azure AI Foundry, no es un reemplazo
    directo ([Firecrawl](https://www.firecrawl.dev/blog/bing-search-api-alternatives)).
  - **Google Lens** no tiene API oficial. SerpApi expone `engine=google_lens` con resultados
    `products`, `exact_matches` y `visual_matches`, con precio y stock ([SerpApi](https://serpapi.com/google-lens-api)).
    SearchAPI.io y Bright Data ofrecen algo similar. Son scrapers de Google (el riesgo de
    términos de uso es del proveedor), pero sigue siendo mandar la imagen del caso fuera:
    registrarlo.
  - **Yandex** no tiene API de imagen oficial; solo a través de proveedores de SERP **(verify)**.
- **Galería local desde catálogos:** IKEA y similares no tienen API de catálogo pública
  **(verify)**. Raspar catálogos tiene el mismo problema de términos de uso; los feeds de
  afiliados/producto de minoristas son la vía legalmente más limpia. La retrieval con
  SigLIP/DINO funciona bien si el producto está en el catálogo, y no sirve de nada si no lo
  está. Lens externo es la única opción de cobertura amplia.

---

## 4. Fauna / flora

| Modelo | Notas | Licencia | Tamaño |
|---|---|---|---|
| **BioCLIP 2** ([HF](https://huggingface.co/imageomics/bioclip-2)) | Entrenado con TreeOfLife-200M (NeurIPS'25), zero-shot en casi todo el árbol de la vida, también hábitat y rasgos | **MIT** | ViT-L, ~2 GB |
| **SpeciesNet** ([google/cameratrapai](https://github.com/google/cameratrapai)) | EfficientNetV2-M, 65M imágenes de cámaras trampa, 2.000+ etiquetas, **geofencing** por país/región/coordenadas | **Apache-2.0** | pequeño |
| **MegaDetector v6** ([github](https://github.com/microsoft/megadetector)) | Detecta animal, persona o vehículo; para recortar | Código MIT; pesos **según variante: MIT, Apache o AGPL** — usar `MDV6-mit-*` | pequeño |
| **iNaturalist** ([model-files](https://github.com/inaturalist/model-files)) | Solo el modelo "small" (~500 taxones) y el geomodel son públicos | por repositorio **(verify)** | pequeño |

**Priores geográficos.** El geomodel de iNaturalist (basado en rejilla; la variante SINR se
revirtió en la 2.24, [blog iNat](https://www.inaturalist.org/blog/117465)) y el geofencing de
SpeciesNet responden *P(especie | ubicación)*. Para geolocalizar, se invierte:
*P(ubicación | especie)*. Multiplicar el posterior de especie por mapas de área de
distribución (geomodel de iNat, densidad de ocurrencias de GBIF, rangos de la UICN — sus
términos son restrictivos **(verify)**) da un prior de región. Fuerte en endémicas, débil en
mascotas, palomas y otras especies cosmopolitas.

---

## 5. Interiores / Find Property

**Cómo lo hace Raven probablemente:** "ciudad soportada" sugiere fuertemente un corpus por
ciudad de fotos de anuncios inmobiliarios (interior y exterior) con dirección, buscado por
recuperación de imagen. Es una inferencia; Graylark no lo dice.

**Fuentes de datos y sus problemas:**
- Los términos de Idealista prohíben expresamente spiders, scrapers y "monitorización" sin
  permiso escrito, y no tiene API pública de datos ([Idealista T&C](https://www.idealista.com/ayuda/articulos/legal-statement/?lang=en)).
  Fotocasa, Zillow, Airbnb y Booking son similares **(verify cada uno)**.
- La sentencia *Ryanair* hace exigibles esas cláusulas. Las fotos tienen copyright y los
  anuncios contienen datos personales (RGPD).
- Airbnb y Booking además difuminan la ubicación exacta a propósito.
- Las opciones legalmente limpias son un acuerdo de datos o alianza con un portal, o corpus
  que el propio investigador recoja caso por caso.

**Datasets:** INDOOR-3.6M / INDOOR-15K (imágenes de interior georreferenciadas, 213 países,
[OpenReview](https://openreview.net/forum?id=BQfAqi3Xq3), licencia y origen desconocidos
**(verify)**); ZInD (Zillow Indoor, planos y panorámicas, [github](https://github.com/zillow/zind),
licencia no comercial **(verify)**); NavVis indoor y NYC-Indoor-VPR (orientados a robótica, sin
direcciones).

**Modelos:** MegaLoc (pesos MIT, [HF](https://huggingface.co/gberton/MegaLoc)), un recuperador
de reconocimiento de lugar general que también cubre interiores; descriptores globales
DINOv3/SigLIP 2 con re-ranking por coincidencia de rasgos locales (estilo LightGlue/MASt3R, que
son el mismo tipo de verificación geométrica que ya usan los verificadores 5b de Lumi);
clasificación de tipo de estancia zero-shot con SigLIP ("cocina", "baño").

**Construible de forma realista:** el mismo pipeline que la recuperación de calle (embeber →
Qdrant → re-ranking geométrico) contra una galería que aporta el operador — feeds licenciados,
o páginas que un investigador capturó para el caso. Lumi debería traer el mecanismo, no un
corpus raspado.

---

## Transversal: infraestructura compartida

1. **Un solo patrón de galería por embeddings encaja directamente en Qdrant.** Una colección
   por `(modelo, versión)`, como hoy, con un payload que dice qué es cada entrada
   (car_ext, car_int, product, property, species_ref) y su procedencia. Backbones: SigLIP 2
   (Apache) como base general, MegaLoc para lugares, BioCLIP 2 para fauna/flora. El worker
   solo embebe (mismo contrato JSON-lines de hoy), y `lumid` busca y registra de dónde salió
   cada resultado. Car ID, Objetos, Interiores y las galerías de referencia de fauna
   reutilizan esto, con un indicador en cada galería de si son datos con licencia o
   construidos con archivos propios del operador.
2. **Un componente compartido de "búsqueda externa"**, para anuncios de Car ID, productos de
   Lens y SERP. Un trait de Rust, como `origins/` en el Indexer: switch de activación por
   servicio, clave API, límite de tasa y una entrada de auditoría (quién, qué caso, qué se mandó
   exactamente — el hash o la imagen enviada, no solo la consulta). Un servicio deshabilitado
   muestra su motivo en la matriz de capacidades.
3. **Un solo servicio local de VLM/LLM caliente** (un modelo Qwen-clase) para descripciones,
   lectura de insignias/acabados y explicaciones estilo SIDA. Evita cargar cinco modelos
   distintos a la vez.
4. **Metadato de frescura en cada cabeza de clasificación** (atribución de imagen por IA, años
   de coche) guardado en `registros/` con fecha de "entrenado hasta" visible en la interfaz.
   Importa más en Verify Image, donde los resultados caducan en meses.
5. **Riesgos legales, de mayor a menor:** scraping masivo de anuncios/portales (Interiores,
   anuncios de coches). Menor riesgo: detectores locales, C2PA y la lectura local de matrícula
   (que no se resuelve a nadie). Las licencias no comerciales (B-Free, Stanford Cars, CompCars,
   posiblemente los pesos de Community Forensics) importan si Lumi se llegara a vender en vez de
   autoalojarse por el propio dueño.
