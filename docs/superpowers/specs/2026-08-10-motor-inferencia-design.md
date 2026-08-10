# Subsistema 5 — Motor de inferencia (5-0 y 5a)

Desde el subsistema 6, un análisis nace en `pendiente` y se queda ahí. La cola del 4 sabe
elegirlo y tiene un trabajador caliente esperando; el 7 sabe construir un corpus; el 8 sabe
publicarlo y encontrarlo. Falta la pieza que los une: **que una imagen entre por el cliente y
salga un punto en el mapa**.

Maquetas: [`lumi-s5-mockups.html`](lumi-s5-mockups.html) (un análisis con una hipótesis clara, con tres
que compiten y sin cobertura; instalar con su árbol de dependencias, instalando, firma inválida y
dependencia caída; lo que hay instalado).

**Orden vigente:** `1 → 2 → 6 → 4 → 7a → 7b → 8 → 5 → 3 → 9`.

---

## 1. Alcance, y por qué el 5 se parte en tres

El subsistema 5 estaba anotado como «Lumi Mini / Pro / Vision, ensemble de verificadores
geométricos». Al abrirlo, el owner confirmó que **los modelos no están elegidos todavía**: la
idea es un conjunto de preentrenados de terceros, pero eso no se ha abordado. Eso mezcla dos
naturalezas distintas en una sola spec — fontanería que se puede terminar y comprobar, e
investigación que necesita corpus y métrica antes de empezar — así que se parte:

| | Pieza | Estado |
|---|---|---|
| **5-0** | El corpus llega a Station: instalar un `.lumidx` en el servidor | **Esta spec** |
| **5a** | El motor: consulta → candidatos → hipótesis | **Esta spec** |
| **5b** | Los modelos reales y los verificadores geométricos | Su propio ciclo, cuando haya modelos |

**Dentro de esta spec:**

- Qdrant en el servidor, y el volcado de un índice instalado.
- Instalar un índice del catálogo desde el cliente: grafo, firmas, descarga, descifrado.
- El trabajador de geolocalización, que **solo embebe**.
- Recuperación de candidatos, agrupación geográfica y atribución, en el daemon.
- Varias hipótesis por análisis, con una principal.

**Fuera de esta spec:**

- **Los modelos.** El embebedor sigue siendo el de juguete de `lumi_embed.py`. Esto hay que
  decirlo sin rodeos: **al terminar el 5a las coordenadas serán malas**. Lo que este
  subsistema cierra es que el camino entero exista, sea reanudable y sea comprobable — no
  que acierte. Acertar es el 5b.
- Los verificadores geométricos, por lo mismo.
- Publicar desde Station. Station instala; el Indexer publica (regla del 8).
- Geocodificación inversa (el campo «Identificado» sigue vacío, ver `FUTURO.md`).
- El panel de administración como tal, que es el 3. Aquí solo se cuelga una pantalla.

## 2. Dónde encaja, y qué no toca

El 5 **no cambia cómo se construye ni cómo se publica un índice**. Toma un `.lumidx`
publicado —ficha en claro firmada, cuerpos y capas cifrados— y lo instala. El Indexer no se
entera de nada de esto.

Tampoco cambia la cola: el planificador del 4 sigue eligiendo igual, el trabajador sigue
siendo un proceso hijo con JSON por líneas, y `limits::effective` sigue siendo la única forma
legítima de leer los límites de un usuario.

Lo único que el 5 mete hacia atrás es **una variante nueva en el contrato del trabajador**
(§5) y **una tabla nueva** para las alternativas (§8).

## 3. El corpus llega a Station (5-0)

### Qdrant, y solo Qdrant

Station gana Qdrant. **No gana Redis**: la cola del 4 vive en SQLite y ahí se queda; Redis
era del Indexer, donde hace de timbre para el embebido. Esto salda parte de la deuda que
`ARCHITECTURE.md` §10 ya tenía anotada («el aprovisionamiento de los dos servicios nuevos en
el servidor»), y la salda a la mitad a propósito: traer Redis a Station sería instalar,
vigilar y explicar un servicio que nadie usaría.

Una colección por `(modelo, versión)`, exactamente como en el Indexer. Es la misma razón: los
modelos van de 8448 a 12288 dimensiones y un vector de un modelo no significa nada en el
espacio de otro.

### Instalar es una tarea de fondo reanudable

Mismo patrón que descargar (7b) y publicar (8), porque es el mismo problema: gigabytes por una
red que se corta.

1. Traer `ficha.json` desde la URL. Va en claro y pesa kilobytes.
2. `lumi_index::grafo::resolver` → el árbol de dependencias con su peso sumado. Ya existe.
3. **Comprobar cada firma.** Si una no cuadra se aborta y se dice cuál. No hay «instalar
   igualmente»: ese diálogo es la puerta de entrada, misma postura que la huella del
   certificado en el 1.
4. Descargar los assets, descifrar (AES-256-GCM, la clave viaja en la ficha) y verificar el
   SHA-256 de cada uno antes de abrirlo.
5. Volcar: imágenes a `{DATA}/indices/<paquete>/imagenes/`, sus filas a SQLite, sus vectores
   a Qdrant.

Una dependencia caída **no aborta la instalación**: se instala lo que hay y se dice qué zona
falta. Eso ya se decidió en el 8 y aquí solo se respeta.

La reanudación se decide **por asset**, como en el 8: lo que ya está volcado no se vuelve a
descargar ni a descifrar.

### Se instala el índice entero

Sin pantalla de selección de área. El troceado por geografía del 8 sigue ganándose el sueldo
—es lo que permite reanudar por trozos— pero elegir *qué* trozos exigiría una pantalla de mapa
entera en Station, que hoy no tiene ninguna parecida a la de Territorio, para resolver un
problema de disco que nadie ha tenido todavía.

Lo que sí se enseña antes de empezar es **cuánto ocupa**: `InstallDialog` ya suma el peso del
grafo. Dieciocho gigabytes no entran por sorpresa.

### Quién puede instalar

Solo el owner y los administradores, desde el cliente. Instalar consume disco y ancho de banda
**del servidor**, así que es una decisión de administración y no de investigación. Va como una
capacidad más de la matriz del 2, con su `reason` legible cuando está denegada — la regla de
que un botón deshabilitado dice por qué se aplica también aquí.

Se cuelga de `InstallDialog`, que ya existe en `client/src/work/` desde el 8 y **hasta hoy no
lo importaba nadie** (anotado en `FUTURO.md`). Este subsistema le da la pantalla que le
faltaba.

## 4. El motor (5a)

### La regla que lo gobierna

**Python solo convierte píxeles en vectores. Todo lo que hay que poder comprobar vive en
Rust.**

Es lo que decide el reparto entero. Se consideró que el trabajador hiciera todo el trabajo
—era lo que `ARCHITECTURE.md` §10 prometía, «el 5 sustituye `_cargar` y `_resolver` sin tocar
el daemon»— y no se sostiene desde el momento en que cada hipótesis tiene que decir de qué
índice y de qué autor sale: eso está en SQLite, y el trabajador de Python no tiene SQLite.
Acabaría devolviendo identificadores crudos para que el daemon los tradujera igual, con la
lógica de agrupación viviendo en Python y sin tests del workspace.

### El camino de un análisis

1. La cola del 4 elige el trabajo y se lo da al trabajador caliente del dispositivo.
2. **Python embebe** la imagen de consulta y escribe el vector a un fichero temporal,
   contestando con su ruta. Es el contrato de `lumi_embed.py`, que ya funciona y que ya evita
   meter flotantes por la tubería.
3. **El daemon** consulta Qdrant: los **64 vecinos** más próximos en la colección del modelo.
   El número es una constante con nombre, no un ajuste: es bastante para que un grupo real se
   note sobre el ruido, y poco para que agrupar sea instantáneo. El 5b lo revisará con datos
   de verdad delante, que es cuando se puede.
4. Traduce cada candidato: el `id` del punto es la fila de SQLite, y de ahí salen coordenada,
   quadkey, fuente, índice y autor.
5. **Agrupa por vecindad de quadkey**, no por un radio en metros elegido a dedo: el producto
   entero habla en teselas z14 desde el 7a, y dos fotos en teselas contiguas están en el mismo
   sitio por la definición del formato. Un umbral en metros sería un número nuevo que explicar
   y afinar.

   Vecindad significa **los ocho vecinos** de una tesela z14: dos candidatos caen en el mismo
   grupo si sus quadkeys son iguales o contiguos, y los grupos salen de la transitividad de esa
   relación — la misma unión de islas contiguas que ya hace el mapa de cobertura del perfil.
   Una tesela z14 ronda los 2,4 km de lado, así que un grupo es un barrio, no una ciudad.
6. Cada grupo da centroide —ponderado por similitud—, radio —la dispersión real de sus
   puntos, no una constante— y peso.

### La confianza es una comparación, no una similitud

La confianza que se devuelve es **cuánto domina el grupo principal sobre el segundo**, no la
similitud coseno del mejor candidato. Una similitud de 0,83 no significa nada para un
investigador y no es comparable entre modelos; «el doble de votos que la siguiente hipótesis»
sí lo es, y sigue significando lo mismo cuando el 5b cambie el embebedor.

### Varias hipótesis, con una principal

Cuando los candidatos no se ponen de acuerdo, el motor **no elige por su cuenta ni se niega a
contestar**: devuelve el grupo dominante como respuesta y los demás como alternativas, con su
peso y su atribución. Que haya alternativas es en sí la señal de que el motor duda, sin
números que interpretar.

La principal conserva `lat`/`lng`, así que todo lo ya construido —centrar en el mapa, copiar
coordenadas, las cuatro columnas `result_*` de `analyses`— sigue funcionando sin migración.
Las alternativas son información añadida.

### Contra qué se busca

Contra **todo lo instalado** para ese modelo, y cada hipótesis viaja con el índice y el autor
que la respaldan. No hay pantalla de selección de corpus: el investigador no tiene por qué
saber qué hay instalado en el servidor.

La atribución no es un adorno. El 8 existe en buena parte para conservar con qué material se
construyó cada cosa, y si esa cadena muere en el servidor, el 8 se queda a medias.

## 5. El contrato con Python

Gana una variante y un campo. Nada se migra.

```rust
/// El trabajador solo embebe: escribe el vector a un fichero y contesta su ruta.
/// Los flotantes NO salen por stdout, misma razón que en el Indexer.
Msg::Vectores { id: i64, dims: u32, fichero: String }

/// `alternativas` va con `#[serde(default)]`: un trabajador que no las mande
/// sigue siendo válido.
Msg::Resultado { id, lat, lng, radio_m, confianza, alternativas: Vec<Hipotesis> }

pub struct Hipotesis {
    pub lat: f64,
    pub lng: f64,
    pub radio_m: f64,
    /// Cuánto pesa este grupo frente al resto. No es una probabilidad.
    pub peso: f64,
    pub indice: String,
    pub autor: String,
}
```

`Msg::Resultado` **se queda** aunque el embebedor ya no lo produzca. Un motor que sepa
contestar por su cuenta sigue siendo legal, `lumi_worker.py` sigue siendo una referencia
válida sin tocar una línea, y sus tests siguen valiendo. Quitarlo no ahorraría nada y cerraría
una puerta gratis.

`workers/lumi_geo.py` es el trabajador nuevo. Sale de `lumi_embed.py`, que ya hace exactamente
lo que hace falta, y el 5b sustituye su `_cargar` y su `_vector` — igual de acotado que la
promesa original, solo que en otro fichero.

## 6. Interfaz

**Instalar.** `InstallDialog` gana su punto de entrada en la zona de administración del
cliente: pegar la URL de una ficha o elegir de lo que el catálogo ya conoce, ver el árbol de
dependencias con su peso, y confirmar. Durante la instalación, progreso por SSE como el resto
del producto.

**Índices instalados.** Una lista: qué hay, de quién, cuántas teselas, cuánto ocupa, y
desinstalar. Sin esto, el disco del servidor se llena sin que nadie sepa de qué.

**El resultado.** `ResultsDrawer` ya lista los intentos con su modelo y su estado. Gana, bajo
la hipótesis principal, las alternativas con su peso y su procedencia. En el mapa, la
principal se pinta como hoy; las alternativas, más tenues. Nada de un color nuevo por
hipótesis: la jerarquía se dice con opacidad, que es lo que el resto del producto ya hace.

## 7. Seguridad

- **Ninguna firma se salta.** Ni al instalar el índice raíz ni al resolver una dependencia.
- La clave de cifrado del `.lumidx` viaja en la ficha, así que el cifrado es **ofuscación
  frente al alojamiento y no control de acceso** — igual que en el 8, y por las mismas razones.
  Instalar no es un permiso, es una descarga.
- Instalar es una capacidad de administración: quien no la tiene ve el botón deshabilitado
  **con el motivo**, no escondido.
- Las imágenes instaladas quedan en claro en disco, como las de los proyectos. El día que se
  cifren en reposo hay que revisar esto y la regla de mandar rutas y no bytes al trabajador,
  las dos a la vez (ya anotado en `FUTURO.md`).

## 8. Datos y ficheros

En SQLite del daemon:

- `installed_indices` — paquete, autor, url, sha256 de la ficha, teselas, bytes, instalado_en.
- `reference_images` — id, índice, ruta, lat, lng, quadkey, fuente. Es la tabla que traduce un
  punto de Qdrant en algo con procedencia.
- `analysis_hypotheses` — análisis, orden, lat, lng, radio, peso, índice, autor. Las
  alternativas. La principal **no** se duplica aquí: sigue en las columnas `result_*` de
  `analyses`, que ya existen y que el cliente ya lee.

En disco: `{DATA}/indices/<paquete>/imagenes/`.

En Qdrant: una colección por `(modelo, versión)`.

## 9. Alternativas consideradas

- **Instalar solo los vectores** (74 MiB en vez de 18 GB). Descartado: sin píxeles no se puede
  enseñar la foto que casó —que es la evidencia, no un adorno— y el 5b se quedaría bloqueado
  con todo reinstalado por delante.
- **Imágenes bajo demanda desde el release.** Descartado: una investigación que depende de que
  una URL de GitHub siga viva es frágil justo cuando más importa.
- **Negarse cuando los candidatos no se ponen de acuerdo.** Se consideró en serio, por la
  misma línea que el resto del producto (no hay «instalar igualmente», no hay «confiar de
  todas formas»). Descartado a favor de las hipótesis múltiples: negarse esconde información
  que el investigador puede usar, y varias hipótesis con su peso son más honestas que un
  silencio.
- **Hipótesis todas iguales, sin principal.** Más honesto todavía, pero obliga a migrar
  `result_lat`/`result_lng` y a decidir qué significa «centrar en el mapa». No compensa.
- **Que el investigador elija los índices por caso.** Aplazado: exige saber qué hay instalado
  y añade una pantalla antes de poder analizar. Si aparece la necesidad de «para este caso solo
  material verificado», se replantea.
- **El trabajador lo hace todo** (§4). Descartado por la atribución.

## 10. Pruebas

Agrupar candidatos, calcular el centroide y el radio de un grupo, y derivar la confianza de la
comparación entre los dos primeros son **funciones puras sobre una lista de candidatos**. Van a
`lumi-index` con `cargo test`, como `coverage.rs` y `troceado.rs`: son exactamente el tipo de
lógica no trivial que la convención del proyecto sí quiere probada.

Lo que toca red, disco o Qdrant no se prueba con tests: se ejecuta.

## 11. Consecuencias fuera del 5

- `ARCHITECTURE.md` §10 dice que «el 5 sustituye `_cargar` y `_resolver` sin tocar el daemon».
  **Deja de ser cierto** y hay que corregirlo, no dejarlo contradictorio.
- `ARCHITECTURE.md` §5: el 5 pasa a estar parcialmente terminado, con el 5b anotado aparte.
- `FUTURO.md`: el hueco «sin punto de entrada a instalar dentro de Lumi Station» queda cerrado
  por §3, y hay que quitarlo.
- `CLAUDE.md`: Station gana Qdrant, y la tabla de tres bases de datos ya no vale solo para el
  Indexer.
- `PRODUCT.md`: conviene decir en alguna parte que un análisis puede devolver más de una
  respuesta, porque cambia qué es el producto.
