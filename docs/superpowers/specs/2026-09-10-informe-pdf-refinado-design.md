# Informe PDF de Lumi — rediseño refinado

Fecha: 2026-09-10
Estado: diseño aprobado, pendiente de plan de implementación
Sustituye a: `2026-09-10-informe-tema-oscuro-design.md` (commit `737b1b9`)

## Por qué

El informe forense en PDF (`crates/lumid/templates/informe.tex.tera`, compilado con
`tectonic` desde `routes/export.rs`) es el único artefacto de Lumi que sale del producto y
llega a un tercero. Hoy no está a la altura del resto: usa `lmodern` (la serif de Computer
Modern), gasta una página entera por imagen aunque esa imagen tenga dos líneas de datos,
tiene un gráfico de barras de `pgfplots` que informa poco, y su acento es `#378add` — un
token que en `DESIGN.md` significa «dibujo en el mapa / en curso», nunca color de marca.

El informe no se diseña para imprimirse: se manda por correo y se lee en pantalla. Ese es
el cambio de premisa del que sale todo lo demás.

## Alcance

Un solo entregable: la plantilla LaTeX, los datos que `export.rs` le pasa, las fuentes
empaquetadas, y un interruptor nuevo en el panel de exportar. No se toca ni el motor de
inferencia, ni el árbitro, ni los agentes, ni el formato `.lumidx`.

---

## 1. Dos temas con dos oficios distintos

Hoy `tema` es `"claro"` | `"oscuro"` y los dos intentan ser el mismo documento. A partir de
aquí tienen trabajos diferentes y se rediseñan **los dos**:

| | `oscuro` (por defecto) | `claro` |
|---|---|---|
| Para qué | pantalla, correo | imprimir |
| Página | vertical 17 × 24 cm | A4 (210 × 297 mm) |
| Superficies | cajas `surface` sin borde | ninguna: filete + versalita |
| Iconos | sí, 10 pt, en `subtle` | no |
| Ámbar | sí, donde hay algo que mirar | no: peso y filete negro |
| Gráficos de portada | tira apilada + franja de confianza | ninguno, una tabla |
| Disposición de ficha | compacta o banda | compacta, siempre |

**A4 y 17 × 24 cm tienen la misma proporción** (0,707 y 0,708). Eso no es una coincidencia
aprovechada a posteriori: es la razón por la que los dos temas pueden compartir la
estructura entera de la maqueta y separarse solo en el tratamiento. Cambian los márgenes y
lo que se dibuja; no cambia dónde va cada cosa.

Se descartó congelar el tema claro tal cual (queda un diseño vivo y otro que envejece sin
que nadie haya decidido matarlo) y se descartó borrarlo (un PDF de fondo negro es hostil a
la impresora, y alguna vez alguien va a imprimir esto).

---

## 2. Formato y ritmo: flujo continuo

Se acaba el `\clearpage` incondicional antes de cada imagen. Cada imagen es un **bloque que
ocupa lo que necesita**; se salta de página solo cuando el bloque no cabe entero en lo que
queda. Dos imágenes flacas comparten página; una con hipótesis, veredicto y mapa de
profundidad se lleva la suya.

En LaTeX esto es un `\needspace`-equivalente: se mide el bloque y se decide. `ponytail`: se
implementa con `\begin{minipage}` + `\nopagebreak` y un `\vspace` de separación, no con el
paquete `needspace` — evita una dependencia del bundle de tectonic por un salto de página.
Si el bloque es más alto que una página entera (imagen con OCR y profundidad a la vez), se
parte donde caiga; partir es mejor que desbordar el margen.

Consecuencia aceptada: **el documento deja de tener paginación citable por imagen.** Se
compensa con el número de orden visible en la cabecera de cada bloque (`07 — IMG_4471.jpg`,
en mono): se cita «la imagen 7», no «la página 7». El tema claro, que sí es para papel,
mantiene además pie con `página / total`.

---

## 3. Tipografía

`tectonic` corre XeTeX por debajo, así que `fontspec` funciona y se pueden cargar ficheros
de fuente por ruta. Esto es lo que más cambia el resultado y es lo más barato de hacer.

- **Inter** — 400, 500, 600. Interfaz y prosa. La misma fuente que ve el investigador en la
  app.
- **JetBrains Mono** — 400, 500. Todo dato de máquina: coordenadas, `sha256`, timestamps,
  rutas, porcentajes, contadores. La regla de `DESIGN.md` es dura y aquí se aplica entera.
  Se elige por la distinción `0/O` y `1/l`, que en un hash de 64 caracteres no es un
  detalle estético.

Ambas son OFL: se pueden empaquetar y redistribuir. Van en `.otf` (XeTeX no lee los
`.woff2` que `client/dist` ya tiene) bajo un directorio de assets del servidor, y
`generar_pdf` las copia al directorio del job junto al `.tex`, igual que ya hace con las
miniaturas. Peso aproximado: 1,5 MB.

Se descartó añadir una serif editorial para la prosa larga: introduce una voz tipográfica
que no existe en ninguna otra parte de Lumi, y la prosa larga de este documento son cuatro
frases.

**Degradación:** si las fuentes no están en disco, la plantilla cae a `lmodern` y el
informe se genera igual, más feo. Un informe que no compila es peor que uno con la fuente
equivocada.

---

## 4. Color

Fuera `#378add` y `#85b7eb`. La paleta del informe es la de `DESIGN.md` sin el token
`draw`:

```
bg       #0e0f11    fondo
surface  #15171a    cajas (sin borde)
border   #26282c    filetes
fg       #e8e8e6    texto principal
muted    #9a9a95    texto secundario
subtle   #6a6c70    etiquetas, iconos, terciario
warning  #ef9f27    atención
```

**El color solo aparece cuando algo va mal.** El peso, el tamaño y la mono hacen el trabajo
que en la app hace el acento. El ámbar entra únicamente en «sin resolver», «se abstuvo» y
«error». Consecuencia buscada: un caso que fue bien sale en blanco y negro absoluto, y el
primer punto ámbar del documento es lo primero que ve el ojo. El color no adorna, señala.

No hay verde, como en el resto del producto: lo resuelto va en blanco.

En el tema claro no hay ámbar en absoluto — un naranja al 30 % en una láser doméstica sale
marrón sucio. «Sin resolver» se marca con negrita y un filete negro en vez de gris.

---

## 5. Portada

**Oscuro.** Destello de cuatro puntas (el mismo TikZ que ya está, reutilizado), versalita
`INFORME FORENSE`, nombre del caso grande, y tres bloques:

1. **Cuatro cifras en fila** — imágenes, con hipótesis, con agente, sin resolver. La cuarta
   en ámbar. `sin resolver` nunca se funde dentro de otro total: un informe de evidencia no
   puede esconder qué no se resolvió dentro de una cifra de éxito.
2. **Tira apilada** — una barra horizontal de 5 pt partida en resuelto (blanco) y sin
   resolver (ámbar). Un solo gráfico, una sola lectura.
3. **Franja de confianza** — un punto por imagen sobre un eje 0–100, con marcas en 0, 50 y
   100. Enseña la forma del caso de un vistazo: si hay tres puntos amontonados cerca del
   cero, se ven. Los puntos de imágenes sin resolver van en ámbar.

Debajo, el descargo de responsabilidad de siempre y la fecha de generación en mono.

**Claro.** Sin ningún gráfico. Destello, título, y una tabla de dos columnas (etiqueta a la
izquierda, valor en mono a la derecha) con: caso creado, imágenes incluidas, con hipótesis,
con veredicto de agente, **sin resolver** (en negrita), confianza media. Regla negra arriba,
regla gris abajo.

**Se elimina el gráfico de barras `pgfplots` de análisis por modelo** en los dos temas. Es
lo más «LaTeX» que hay en el documento y no responde a ninguna pregunta que un lector del
informe se haga. `Estadisticas::por_modelo` deja de usarse en la plantilla; el campo se
mantiene en la struct por ahora, sin consumidor.

---

## 6. Ficha por imagen

Cabecera común a las dos disposiciones: `07 — IMG_4471.jpg` en mono, `subtle`, con filete
debajo.

### 6a. Compacta (`disposicion: "compacta"`, por defecto)

Miniatura a la izquierda (130 pt, cuadrada, `keepaspectratio`), y a su derecha la confianza
como número grande en mono con una barra de progreso de 2 pt debajo, y bajo ella la
coordenada y el radio en mono.

Debajo, los bloques de datos. En el tema **oscuro** cada bloque es una caja de fondo
`surface` (`#15171a`), sin borde, radio 6 pt, con una cabecera de icono 10 pt en `subtle` +
etiqueta en versalitas:

- **EXIF** — icono de reloj
- **Integridad** — icono de candado, con el `sha256` del original en mono
- **Hipótesis de geolocalización** — icono de chincheta; contiene el localizador (§7) a la
  izquierda y las alternativas y el respaldo geométrico a la derecha
- **Agente** — icono de bocadillo; el veredicto, y debajo los rasgos gráficos (recuadros
  OCR, mapa de profundidad) cuando los hay

EXIF e Integridad van a dos columnas cuando los dos existen; los otros dos a ancho
completo. **No es una rejilla de tarjetas idénticas** — los bloques tienen tamaños y
contenidos distintos, que es justo lo que `DESIGN.md` prohíbe cuando son todos iguales.

Las cajas **no tienen borde ni color de fondo**: son una superficie neutra del sistema. Eso
respeta la prohibición de «iconos dentro de cajitas de color» — el icono va junto a su
etiqueta, en gris, no dentro de un cuadrito teñido.

En el tema **claro** los mismos bloques, en el mismo orden, sin caja y sin icono: filete
gris de 1 px, versalita, contenido. Y sin la barra de progreso de la confianza (es tinta
sólida): solo el número.

### 6b. Banda (`disposicion: "banda"`, solo tema oscuro)

Miniatura a ancho completo, 150 pt de alto, con la confianza superpuesta abajo a la
izquierda y la coordenada abajo a la derecha, y la barra de confianza pegada al borde
inferior de la foto. Debajo, los bloques de datos a dos columnas.

**Cae a compacta para esa imagen concreta si no hay miniatura** (fichero ilegible en
disco). No hay banda que dibujar. Es la única excepción y es forzosa.

La disposición es **del informe entero, no por imagen**: un documento donde unas fichas son
de un tipo y otras de otro se lee como un error de maquetación. Se descartó
explícitamente elegirla automáticamente según cuánto dato tenga la imagen.

### 6c. Sin resolver

Cuando `mostrar_aviso_sin_resuelto`, los bloques de resultado se sustituyen por un aviso
con el motivo real citado (nunca un texto inventado): en ámbar en el tema oscuro, en
negrita con filete negro en el claro. Lo que ya hace hoy, con el tratamiento nuevo.

---

## 7. El localizador

Un informe de geolocalización que no enseña un mapa es raro, y hoy no lo enseña.

`registros/geo/paises.json` (Natural Earth *Admin 0 – Countries* 1:110m, dominio público)
trae los contornos de todos los países como anillos de `(lng, lat)`, y `lumi_index::geo` ya
los carga — `Datos::paises: Option<Paises>`, `Pais::anillos`, `Paises::iso_de(lat, lng)`.
El daemon los tiene vivos en `app.queue.geo`.

Se dibuja en TikZ, por imagen, dentro del bloque de hipótesis:

- Contorno del país que contiene la coordenada, a línea de pelo (`#3a3d42` en oscuro,
  negro 0,7 pt en claro), en proyección equirectangular simple recortada al *bounding box*
  del país.
- Círculo del radio de incertidumbre **a escala real** sobre esa proyección (ámbar al 50 %
  de opacidad en oscuro; negro punteado en claro).
- Punto de la hipótesis principal (ámbar relleno en oscuro; negro en claro).

Tamaño: unos 86 × 62 pt. **Es un localizador, no un mapa de calle**: a escala 1:110m dice
«norte de España» y nada más. Eso es deliberado y es lo honesto — la hipótesis viene con un
radio de kilómetros, y un mapa de calle con un radio de 8 km encima sugiere una precisión
que el dato no tiene. La coordenada exacta va al lado, en mono.

**Degradación obligatoria:** `paises.json` es opcional (lo baja el propietario a mano, por
licencia y peso), así que la mayoría de servidores no lo tienen. Sin el fichero, o si la
coordenada no cae dentro de ningún país (mar), **el localizador no se dibuja y no deja
hueco**: quedan la coordenada y el radio, como hoy. Nunca un recuadro gris que diga «mapa
no disponible».

Se descartó un mapa real con teselas: exige salir a la red al exportar (un servidor forense
que llama a casa justo cuando generas la prueba es un problema, no una feature) o montar
una caché de teselas offline, que es un subsistema entero.

---

## 8. Cambios en el código

### `crates/lumi-proto/src/api.rs`

`ExportInformeReq` gana un campo, con el mismo patrón tolerante que `tema` — un valor
desconocido cae al default en vez de ser un error, para que un cliente viejo siga generando
informes:

```rust
/// `"compacta"` (miniatura al lado, por defecto) o `"banda"` (foto a ancho
/// completo). Solo la usa el tema oscuro: el claro es siempre compacto.
/// Cualquier otro valor se trata como `"compacta"`.
#[serde(default = "disposicion_compacta")]
pub disposicion: String,
```

Actualizar también `impl Default`.

### `crates/lumid/src/routes/export.rs`

- `Contexto` gana `disposicion: String`, normalizada igual que `tema` (`"banda"` solo si el
  tema es oscuro; en claro se fuerza `"compacta"`).
- `ImagenCtx` gana los datos numéricos que el localizador necesita y que hoy solo existen
  como texto ya formateado: `lat: Option<f64>`, `lng: Option<f64>`,
  `radio_km: Option<f64>`. `coord_txt` y `radio_txt` se mantienen — son lo que se imprime.
- `ImagenCtx` gana `mapa: Option<MapaCtx>`, con el contorno **ya proyectado a coordenadas
  de dibujo** (`Vec<Vec<(f64, f64)>>` en el espacio 0–1) más la posición del punto y el
  radio en esas mismas unidades. La proyección se hace en Rust, no en la plantilla, por el
  mismo criterio que ya se aplicó a `CajaCtx`: Tera no tiene que saber de convenciones de
  coordenadas.
- `resumen_oscuro` debe devolver lat/lng/radio numéricos además de los textos.
- Copiar los `.otf` de las fuentes al directorio del job, junto a las miniaturas.
- El acceso a `app.queue.geo` es un `Mutex`: leerlo una sola vez por informe y clonar lo
  que haga falta, no bloquear por imagen.

### `crates/lumid/templates/informe.tex.tera`

Reescritura. Estructura nueva: preámbulo con `fontspec` y la rama de tema, portada, bucle
de imágenes con las dos disposiciones, notas, firma. La rama de tema deja de estar solo en
los `\definecolor` — ahora los dos temas dibujan cosas distintas — pero sigue concentrada:
un bloque de macros por tema al principio (`\lumibloque`, `\lumietiqueta`, `\lumifilete`) y
un cuerpo compartido que las llama. Es lo que evita que la plantilla se convierta en dos
plantillas pegadas.

### `client/src/work/ExportDrawer.tsx`

Un `Interruptor` más: **«Foto a ancho completo»**, apagado por defecto, que manda
`disposicion`. Cuando el tema es claro, se deshabilita con su motivo real visible («solo
disponible en el tema oscuro») — nunca se esconde, siguiendo la regla de la matriz de
capacidades.

### Assets

Inter (400/500/600) y JetBrains Mono (400/500) en `.otf`, con sus ficheros de licencia OFL
al lado. La atribución de Natural Earth ya existe en la sección de modelos de la web.

---

## 9. Fuera de alcance

- Mapa con teselas reales, y cualquier acceso a red durante la exportación.
- Caché de teselas offline.
- Elegir la disposición por imagen, o automáticamente según el contenido.
- Traducir el informe a otro idioma.
- Guionado en español (`babel`/`spanish.ldf`): sigue fuera por la misma razón que
  documenta la cabecera actual de la plantilla — añade una dependencia externa al bundle de
  tectonic por un matiz de justificación.
- Previsualización en vivo del informe en el cliente (`PdfPreviewPopup` sigue como está).
- Reponer `Estadisticas::por_modelo` con otro gráfico: el campo se queda sin consumidor, no
  se rediseña.

---

## 10. Verificación

No hay test suite para esto y no se pide una. Lo que sí tiene que comprobarse a mano antes
de dar por hecho el trabajo:

1. Un caso con imágenes de contenido muy desigual (una con todo, una con solo EXIF, una sin
   miniatura, una sin resolver) genera un PDF donde el flujo continuo no deja huecos ni
   desborda márgenes, en los dos temas y en las dos disposiciones.
2. El informe compila **sin** `paises.json` instalado, y no deja hueco donde iría el
   localizador.
3. El informe compila **sin** las fuentes `.otf` en disco, cayendo a `lmodern`.
4. Un cliente que no manda `disposicion` sigue generando el informe.
5. El tema claro no imprime ni un solo píxel ámbar.
