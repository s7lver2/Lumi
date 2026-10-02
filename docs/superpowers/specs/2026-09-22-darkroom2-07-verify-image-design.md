# Darkroom 2 · 7 — Verify Image

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 3
(infraestructura de herramientas: registro, matriz de capacidades, gestor de VRAM, auditor con
calibración, pistas de región).

## Resumen

Verify Image analiza una fuente de imagen y da un veredicto sobre si es una imagen generada o
manipulada por IA, al estilo del banner de Raven («Likely AI-generated · Closest match: Wan
61%»), con la salvedad honesta que exige la investigación (`2026-09-22-darkroom2-investigacion-herramientas.md`
§1): los mejores detectores abiertos rondan el 75-78% de precisión media, y generadores
modernos (Flux, Midjourney v7, Imagen 4) los engañan hasta el 80% de las veces. El único dato
que **demuestra** en vez de sugerir es la procedencia (C2PA, marcas de agua).

Se registra en `fuentes.rs` como `verify_image`, admite fuentes de tipo `imagen`, y no produce
coordenadas ni pistas de región: su resultado es en sí mismo lo que el investigador necesita
ver.

---

## 1. Las tres capas

Un análisis de Verify Image produce siempre las tres, en este orden de fiabilidad:

### 1.1 Procedencia (la única capa que puede afirmar, no sugerir)

- **C2PA**: se lee con `c2pa-rs` ([github.com/contentauth/c2pa-rs](https://github.com/contentauth/c2pa-rs)),
  compilado directamente en `lumid` (no es un servicio externo: es una librería que abre el
  contenedor del fichero, sin red). Si el manifiesto está presente y su firma valida, se
  extrae el generador declarado (p. ej. `gpt-image`, que OpenAI incluye en sus imágenes) y la
  cadena de ediciones si las hay.
- **Marcas de agua locales**: TrustMark (Adobe, MIT, con implementación Rust/ONNX,
  [github.com/adobe/trustmark](https://github.com/adobe/trustmark)) se ejecuta como modelo
  local (papel `marca_agua` en el registro de niveles). Si decodifica una marca válida, se
  añade como segunda fuente de procedencia.
- **SynthID**: no tiene detector local disponible (la API de Google está en lista de espera
  para socios). Se deja como servicio externo opcional y deshabilitado por defecto
  (`externos::registro`, id `synthid_deteccion`), con su `descripcion_envio` dejando claro que
  la imagen se manda a Google. Si nunca se habilita, Verify Image sigue funcionando con las
  otras dos capas.
- **Ausencia de procedencia no es evidencia de nada**: se recomprime y se recorta con
  facilidad. La interfaz nunca dice «sin C2PA, por tanto es real»; simplemente no añade nada a
  esta capa.

### 1.2 Detectores (la capa de Raven, con caducidad explícita)

- Un ensemble de detectores locales, con licencias compatibles con el uso del dueño en su
  propio servidor (self-hosted, no redistribución): **UnivFD** (CLIP ViT-L/14 congelado +
  cabeza lineal, patrón base) y **DeepfakeBench** para el componente de cara/face-swap
  (per-modelo, licencia mixta a confirmar antes de instalar cada peso). Community-Forensics y
  DRCT quedan documentados como candidatos de mejor precisión pero con licencia de pesos
  pendiente de verificar («**(verify)**» en la investigación) — no se instalan hasta
  confirmarla, siguiendo la regla del spec 3 (§2.1, «ninguna licencia incierta se convierte en
  autorización»).
- Cada detector del ensemble vota `probable_generada` / `probable_real` con una puntuación
  [0,1]. El **generador más probable** ("Closest match: Wan") sale de una cabeza multiclase
  entrenada sobre los mismos backbones, **con pesos de terceros** (decisión ya tomada:
  spec/brainstorming, opción B). Se muestra en una barra por generador, igual que la 2ª
  captura de Raven (Wan, GPT, Qwen, DALL·E, Stable Diffusion, Seedream, Recraft, Midjourney,
  Imagen, Ideogram, y un cajón «Otro»).
- **Fecha de caducidad visible.** Cada manifiesto de detector en `registros/modelos/` lleva un
  campo `entrenado_hasta: "2026-04"` (fecha, no versión). La interfaz muestra siempre, junto al
  banner: «Detector entrenado hasta abril de 2026 · generadores más recientes pueden no
  detectarse». No es una nota a pie de página: va en el mismo bloque que el veredicto.
- **El banner es al estilo Raven** (decisión tomada en el brainstorming, opción B): título +
  probabilidad + generador más cercano + aviso de beta. No se suaviza a «indicios» ni se
  oculta tras un acordeón — coincide con lo que el dueño pidió ver.

### 1.3 Forense clásico (apoyo, siempre visible, nunca es el titular del banner)

- **ELA** (Error Level Analysis): recomprime a un nivel JPEG fijo y resta; zonas con residuo
  distinto delatan una edición local. Se calcula en CPU con `image`/`imageproc` (ya
  dependencias del workspace o próximas a añadir), sin modelo.
- **Ruido/PRNU simplificado**: filtro paso-alto sobre cada canal; una imagen generada por
  difusión tiende a un patrón de ruido más uniforme que una foto real de cámara.
- **Tablas de cuantización JPEG y doble compresión**: se leen del propio contenedor JPEG
  (ya se decodifica para EXIF hoy en `crates/lumid/src/exif.rs`); una segunda compresión con
  parámetros distintos dentro del mismo fichero es indicio de edición posterior a la captura
  original.
- **Coherencia EXIF**: el software declarado, la miniatura embebida (si difiere del cuerpo
  principal) y si la resolución es plausible para el modelo de cámara declarado.
- Estas cuatro señales se muestran como un panel de mapas de calor y una lista de
  observaciones en texto (`"El EXIF declara un iPhone 14 pero no hay miniatura embebida"`), sin
  puntuación agregada: son pistas para que el investigador mire, no un cuarto voto.

---

## 2. El resultado

Verify Image produce **un único resultado por fuente** (no una lista de candidatos, a
diferencia de Geolocalización): la imagen es real o generada, no hay "top 5 orígenes
posibles". Su forma en `resultados` (spec 2):

- `titulo`: `"Probable IA · Wan"` / `"Sin indicios de generación"` / `"No concluyente"`.
- `puntuacion`: la probabilidad agregada del ensemble de detectores (capa 1.2). `NULL` si la
  única señal es procedencia sin detectores (caso raro, pero posible si el admin deshabilitó
  el papel de detectores por VRAM).
- `payload` (JSON): `{ procedencia: {...} | null, generadores: [{nombre, pct}], entrenado_hasta,
  forense: {ela_url, ruido_url, observaciones: [...]} }`.
- **Sin coordenadas, sin pista de región** (`TipoResultado::NINGUNO` con la excepción de que sí
  admite auditor — ver §3).

La revisión (Sin revisar / Confirmado / Descartado, spec 2) se aplica igual que a cualquier
resultado: confirmar el veredicto de Verify Image dice "acepto esta conclusión para el
informe", descartar dice "no me fío de esto para este caso concreto" (por ejemplo, si el
investigador reconoce visualmente que es una foto real pese al banner).

---

## 3. El auditor en Verify Image

Es la herramienta donde el auditor (spec 3 §4) tiene menos que aportar, porque ya hay tres
capas explicando su propio razonamiento. Su papel aquí es concreto: **contrastar la capa 1.1
con la 1.2**. Si la procedencia dice `gpt-image` pero el detector de generador más cercano
apunta a `Wan` con alta confianza, es una contradicción que el investigador debe ver marcada,
no dos números sueltos que nadie cruza. El auditor recibe como contexto (spec 3, `contexto:
serde_json::Value`) exactamente `{ procedencia, generadores, forense_observaciones }` — nunca
la imagen en sí — y devuelve uno de los cuatro veredictos de `auditor::Veredicto`:

- `Probable`: las capas son coherentes entre sí (o solo hay una disponible y es clara).
- `NoConcluyente`: señales débiles o contradictorias entre capas.
- `ProbableFalsoPositivo`: usado cuando el detector marca alta probabilidad de IA pero la
  procedencia certifica que es una foto real (C2PA con `capture` en vez de `generation`), o
  cuando la observación forense es trivial (una miniatura ausente por sí sola no es gran cosa).
- `Abstencion`: si no hay calibración vigente para `verify_image` (regla general del spec 3),
  el auditor no participa y el banner se muestra sin su capa de contraste.

Esto no cambia el banner de la capa 1.2 (que sigue mostrándose al estilo Raven); añade una
línea aparte, con su propio color y texto, del mismo modo que el auditor se muestra en
cualquier otro resultado (spec 2 §3.3: «veredicto del auditor: punto de color, texto corto y
motivo»).

---

## 4. Calibración

Antes de que el auditor (o cualquier detector cuyo umbral de decisión el admin quiera ajustar)
esté `disponible`, hace falta una calibración (spec 3 §4.2). Para Verify Image, el conjunto
etiquetado mínimo recomendado:

- Al menos 50 imágenes reales (fotografías de cámara, con EXIF de captura genuino) y 50
  generadas, cubriendo al menos tres generadores distintos de la lista de la barra (Wan, GPT,
  Stable Diffusion son buen punto de partida por tener muestras públicas).
- Umbral de aceptación sugerido (documentado, no forzado por código): el ensemble de
  detectores no debe superar un 10% de falsos positivos sobre el conjunto de imágenes reales
  del propio operador — es más importante no acusar en falso una foto genuina de un caso real
  que cazar todos los generadores.
- La calibración se registra con `POST /v1/admin/calibraciones` (spec 3) con
  `herramienta: "verify_image"`, y queda vigente hasta que cambie el modelo o su versión
  (`registros/modelos/<detector>.json`), momento en que `calibracion_vigente` deja de
  encontrarla y el auditor vuelve a `Abstencion` automáticamente.

---

## 5. Worker y contrato

Un worker nuevo, `workers/lumi_verify_image.py`, siguiendo el contrato `TareaHerramienta` /
`MsgHerramienta` del spec 3 (Task 3 de su plan). Recibe la ruta de la imagen (`fuente.ruta`),
ejecuta:

1. Lectura de C2PA (llamada a `c2pa-rs` — puede hacerse en el propio `lumid` en Rust antes de
   lanzar el worker, ya que no necesita GPU; el worker solo recibe el resultado de procedencia
   ya extraído como parte de `options` en la tarea, para no duplicar la lectura del
   contenedor).
2. Inferencia del ensemble de detectores + cabeza de generador (GPU, un solo paso hacia
   adelante por imagen).
3. Cálculo de ELA/ruido/tablas JPEG (CPU, puede ir en el propio `lumid` como en el punto 1, o
   en el worker; se deja en el worker por simplicidad de un solo proceso que produce todo el
   `payload`).
4. Contesta un único `MsgHerramienta::Resultado` con `datos` igual al `payload` descrito en
   §2, y `puntuacion` con la probabilidad agregada.

No hay `PistaRegion`: Verify Image no delata ubicación (a diferencia de Interiores/Objetos/
Especies).

---

## 6. Registro en `fuentes.rs` (spec 3)

```rust
Herramienta {
    id: "verify_image",
    nombre: "Verify Image",
    tipos: &["imagen"],
    resultado: TipoResultado { coordenadas: false, pista_region: false, fuente_derivada: false },
    requisitos: RequisitosHerramienta {
        nivel_minimo: "mini",
        papel: Some("verify_image"),
        externos_opcionales: &["synthid_deteccion"],
        admite_auditor: true,
    },
},
```

`registros/niveles/mini.json` gana `"herramientas": { "verify_image": ["univfd", "deepfakebench-faceswap"] }`
(y las claves equivalentes en `pro.json`/`vision.json`, con más detectores en Vision, p. ej.
añadiendo Community-Forensics si su licencia se confirma antes de la implementación). Cada
detector nuevo entra en `registros/modelos/` con su `entrenado_hasta` y su `sha256` rellenos
(§1.2) antes de considerarse instalable, no antes.

---

## 7. Interfaz

Dentro del cajón de la fuente (spec 2 §3.3), en vez de una lista de resultados con rango, una
sola tarjeta de veredicto:

```
┌─────────────────────────────────────────────┐
│ ⚠ Probable IA · Wan                    BETA  │
│ 61% de similitud con Wan · detectado por 3   │
│ detectores de 4                              │
│ ──────────────────────────────────────────── │
│ Generadores                                  │
│ Wan          ████████████░░░░░░░░  61%       │
│ Otro         ███████░░░░░░░░░░░░░  36%       │
│ GPT          ░░░░░░░░░░░░░░░░░░░░   1%        │
│ …                                            │
│ ──────────────────────────────────────────── │
│ Procedencia: sin manifiesto C2PA ni marca    │
│ de agua detectada                            │
│ ──────────────────────────────────────────── │
│ Forense: EXIF sin cámara declarada           │
│ [ver mapa de ELA]  [ver mapa de ruido]       │
│ ──────────────────────────────────────────── │
│ ● Auditor: no concluyente · sin procedencia  │
│   que contrastar con el detector             │
│ ──────────────────────────────────────────── │
│ Detector entrenado hasta abril 2026          │
│ [Sin revisar | Confirmado | Descartado]      │
└─────────────────────────────────────────────┘
```

Cuando la procedencia **sí** encuentra un manifiesto, esa línea pasa a cabecera con icono de
verificación (`fg`, no `ok` — DESIGN.md reserva `ok` para la revisión humana, no para un dato
automático) y el texto exacto del generador declarado y su firmante.

---

## 8. Lo que este spec no hace

- No añade generación sintética propia ni entrena ninguna cabeza de clasificación (spec 3 §2.1
  y el índice general: Lumi no entrena modelos).
- No implementa la galería de generadores por vecinos más cercanos (documentada como
  aplazada en el índice de Darkroom 2 — sigue aplazada aquí también).
- No cubre vídeo. Solo imagen estática, como el resto de Darkroom 2.
- No decide automáticamente que una imagen es falsa para ningún efecto legal: es una señal
  para el investigador, con su fecha de caducidad y su nivel de confianza siempre visibles.

## Verificación

Tests en `crates/lumid` (o donde viva la lectura de C2PA/EXIF en Rust): parseo de un
manifiesto C2PA válido de muestra, detección de doble compresión JPEG con un fichero de
prueba generado a propósito con dos calidades distintas, y que `capacidad_de("verify_image",
...)` devuelve `NoInstalado` si falta el detector del papel del nivel. Cierre manual: correr
sobre una imagen real (una foto de cámara del propio equipo) y comprobar que el banner NO
marca falso positivo con el ensemble mínimo instalado, y sobre una imagen generada conocida,
que sí lo marca, con el aviso de caducidad visible en los dos casos.
