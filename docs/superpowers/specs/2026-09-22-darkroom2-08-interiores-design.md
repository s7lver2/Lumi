# Darkroom 2 · 8 — Interiores

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Depende del spec 3
(infraestructura de herramientas) y del spec 5 (Indexer: galerías) para su segunda vía.

## Resumen

Interiores tiene dos vías independientes, decididas en el brainstorming (opción A: las dos):

1. **Pistas por lectura visual**: sin ninguna galería, un VLM local lee lo que delata país o
   región dentro de una foto de interior — tipo de enchufe, interruptores, radiadores,
   ventanas, texto y marcas de electrodomésticos, rasgos de arquitectura interior. Funciona
   siempre, da una pista de región con su motivo.
2. **Búsqueda en galería**: la foto se compara contra una galería de interiores construida por
   el Indexer (spec 5), filtrada por la zona que ya hayan acotado las pistas si las hay, con
   verificación geométrica sobre los candidatos igual que hace hoy la geolocalización de calle.

Se registra como `interiores`, admite fuentes de tipo `imagen`.

---

## 1. Vía 1 — Pistas por lectura visual

### 1.1 Qué lee el VLM

Un VLM local (el mismo servicio compartido del spec 3, o un modelo de visión dedicado si el
papel `interiores_pistas` así lo declara en el nivel) recibe la imagen con una instrucción
estructurada — no texto libre — que le pide identificar, con su nivel de certeza cada uno,
estos rasgos:

- Tipo de enchufe/toma de corriente visible (tipos A-N según la clasificación IEC, si es
  identificable).
- Tipo de interruptor de luz (báscula, pulsador, palanca) y su posición típica en la pared.
- Sistema de calefacción visible (radiador de agua, suelo radiante aparente, ninguno visible).
- Tipo de ventana y persiana/contraventana (persiana enrollable exterior, contraventana
  interior de madera, mosquitera, doble acristalamiento aparente).
- Texto legible en electrodomésticos, interruptores, cuadros eléctricos o cualquier rótulo
  (marca, idioma del texto, alfabeto).
- Rasgos de construcción (altura de techo, molduras, tipo de suelo, grosor de muros aparente
  en el marco de una ventana o puerta).

### 1.2 De la lectura a la pista

Cada rasgo identificado se cruza contra una tabla de correspondencias
`registros/geo/interiores-rasgos.json` (mismo patrón de datos-no-código que
`registros/geo/lado.json`), con entradas del tipo:

```json
{ "rasgo": "enchufe_tipo_f", "regiones": ["Europa continental", "Rusia", "partes de África"], "peso": 0.6 }
{ "rasgo": "enchufe_tipo_g", "regiones": ["Reino Unido", "Irlanda", "Malta", "Chipre", "Hong Kong", "Singapur"], "peso": 0.75 }
{ "rasgo": "persiana_enrollable_exterior", "regiones": ["España", "Francia", "Italia", "sur de Europa"], "peso": 0.3 }
```

El `peso` es cuánto acota ese rasgo por sí solo (un enchufe tipo G es mucho más discriminante
que una persiana enrollable, que también existe fuera del sur de Europa). La combinación de
varios rasgos con regiones que se solapan sube la confianza de la pista resultante; rasgos que
apuntan a regiones disjuntas se muestran igual, pero como pistas separadas y de menor
confianza cada una, nunca fusionadas en una afirmación única y falsamente segura.

Esta tabla es responsabilidad del propio Lumi (dato empaquetado, revisable), no del VLM: el
modelo solo identifica *qué ve*, la tabla decide *qué significa*. Esto mantiene al LLM lejos
de "inventar" geografía y acota su superficie de error a "leyó mal el enchufe", que es
verificable a simple vista por el investigador.

### 1.3 Resultado de la vía 1

Un resultado (o varios, uno por grupo de rasgos coherente) con `resultado.pista_region = true`,
`payload: { rasgos: [{tipo, valor, certeza}], regiones_candidatas: [...] }`, sin coordenadas.
El motivo de la pista lista los rasgos que la sostienen: `"Enchufe tipo F + interruptor de
báscula → Europa continental"`.

---

## 2. Vía 2 — Búsqueda en galería

### 2.1 La galería (spec 5, Indexer)

Igual que Car ID, Interiores depende de que el Indexer sepa construir una **galería de
interiores** (spec 5, no este documento). Orígenes decididos para esa galería:
Wikimedia Commons, carpeta local aportada por el operador, y portales inmobiliarios y de
alojamiento (Idealista, Fotocasa, Airbnb, Booking) **mediante scrapers de terceros**, con el
mismo aviso legal que Car ID: la investigación (`investigacion-herramientas-darkroom.md` §5)
documenta que estos portales prohíben el scraping en sus términos y que la sentencia *Ryanair*
hace esas cláusulas exigibles — la responsabilidad de habilitar ese origen y asumir el riesgo
es del operador que instala el Indexer, no de Lumi como producto. La galería solo se consulta
si el operador la ha construido; sin ella, la herramienta sigue funcionando con la vía 1 sola
(`sin_servicio`-equivalente: aquí es "galería no instalada", que la matriz de capacidades
refleja igual).

### 2.2 Filtrado por zona

Si la vía 1 produjo una o más pistas de región (aunque estén `sin_revisar`, se usan como
**filtro de búsqueda**, no como verdad confirmada — distinto del uso de una pista para
reponderar hipótesis, que sí exige confirmación explícita, spec 3 §4.3), la búsqueda en
galería se acota a esas regiones si la galería tiene metadato de región por tesela/entrada. Si
no hay ninguna pista o la galería no tiene ese metadato, se busca en toda la galería instalada.

### 2.3 Recuperación y verificación

Mismo patrón que la geolocalización de calle de hoy: se embebe la imagen consultada con un
backbone general (SigLIP 2 o DINOv3, Apache/licencia comercial a confirmar, según lo que ya
elija el spec 5 para consistencia entre galerías), se busca en la colección Qdrant de la
galería de interiores por vecino más cercano, y los candidatos pasan por **verificación
geométrica** con los mismos verificadores que ya usa Lumi (RoMa, LightGlue+ALIKED —
`registros/verificadores/`), reutilizados tal cual: un salón de un catálogo de mobiliario
genérico se parece a mil otros por color y estilo, y solo la correspondencia geométrica de
puntos reales (marco de ventana, moldura, enchufe en la misma posición relativa) distingue una
coincidencia real de una casualidad de decoración.

### 2.4 Resultado de la vía 2

Un resultado por candidato de galería, con `resultado.coordenadas = true` (la entrada de
galería trae su dirección aproximada o exacta según la procedencia declarada en el manifiesto
del paquete — spec 5), `puntuacion` = inliers de la verificación geométrica normalizados
(mismo criterio que ya usa `arbitro` para las hipótesis de calle), y `payload: { imagen_galeria,
procedencia, direccion_aproximada }`. La foto de referencia de la galería se muestra en la
vista partida (spec 2 §3.4), igual que un candidato de calle hoy.

---

## 3. Cómo se combinan las dos vías en la interfaz

Un único análisis de Interiores produce, en el cajón de la fuente, dos secciones dentro de la
misma fuente (no dos fuentes distintas): «Pistas de la imagen» (vía 1, siempre presente) y
«Coincidencias en galería» (vía 2, solo si hay galería instalada — si no la hay, la sección
dice «Sin galería de interiores instalada · pide al administrador que construya una desde el
Indexer», siguiendo el patrón de motivo explícito). Confirmar un candidato de galería es
exactamente confirmar un resultado con coordenadas (spec 2 §3.9); confirmar una pista de
lectura visual sigue la regla general de pistas (spec 3 §4.3, re-pondera al confirmar).

---

## 4. Registro en `fuentes.rs`

```rust
Herramienta {
    id: "interiores",
    nombre: "Interiores",
    tipos: &["imagen"],
    resultado: TipoResultado { coordenadas: true, pista_region: true, fuente_derivada: false },
    requisitos: RequisitosHerramienta {
        nivel_minimo: "pro", // el VLM de lectura de rasgos necesita más que el papel mínimo de Mini
        papel: Some("interiores_pistas"),
        externos_opcionales: &[],
        admite_auditor: true,
    },
},
```

La búsqueda en galería (vía 2) no es un `papel` de modelo por nivel de la forma habitual: es
condicional a que exista una galería instalada, que se resuelve consultando el catálogo de
paquetes instalados (mismo mecanismo que ya usa Lumi para saber qué índices de calle están
instalados, `crates/lumid/src/indices/`), no a través de `modelos_del_papel`. La matriz de
capacidades (spec 3 §1.2) refleja esto como un estado adicional dentro de la misma
herramienta: la vía 1 puede estar `disponible` mientras la vía 2 está `no_instalado` con el
motivo "sin galería de interiores".

---

## 5. El auditor en Interiores

Para la vía 1: contrasta rasgos entre sí (por ejemplo, un enchufe tipo G y un texto en
alemán son regiones incompatibles) y marca `NoConcluyente` si los rasgos identificados se
contradicen fuerte, en vez de dejar que la tabla de pesos produzca una pista con más confianza
de la que los datos sostienen. Para la vía 2: igual que en Geolocalización, valora si la
coincidencia geométrica es consistente con un mismo espacio real y no solo con muebles de
catálogo repetidos.

---

## 6. Lo que este spec no hace

- No construye la galería en sí (spec 5).
- No identifica la dirección exacta cuando el origen de la galería solo tiene una zona
  aproximada (Airbnb/Booking difuminan la ubicación a propósito, según la investigación) — el
  resultado muestra la precisión real de la procedencia, nunca inventa un punto exacto donde
  la fuente original no lo da.
- No cruza con catastro ni con ningún registro de propiedad para confirmar un titular: eso,
  como la matrícula → titular de Car ID, quedaría como paso manual del investigador fuera de
  Lumi si algún día hiciera falta — este spec no lo automatiza.

## Verificación

Test de la tabla de correspondencias rasgo→región (dos rasgos con regiones disjuntas producen
dos pistas separadas, no una fusionada) y de que sin galería instalada la vía 2 reporta el
estado correcto sin intentar consultar Qdrant. Cierre manual: una foto de interior con un
enchufe reconocible produce una pista con motivo legible; si hay una galería de prueba
instalada con al menos una imagen de referencia idéntica, la vía 2 la encuentra con
verificación geométrica positiva.
