# Subsistema 7b — Lumi Indexer: orígenes de red

El 7a sabe dibujar un área, descomponerla en teselas z14 y decir cuáles no ha indexado nadie.
Lo que no sabe es **conseguir imágenes** para ellas: sus dos únicos orígenes son una carpeta
del operador y un paquete legacy de la v1. El 7b es esa mitad — para una tesela que nadie
cubre, salir a la red y traerse fotos de ese territorio.

Maquetas: [`lumi-s7b-mockups.html`](lumi-s7b-mockups.html) (disponibilidad, estimación, tope,
descarga, revisión, sellado, claves).

**Orden vigente:** `1 → 2 → 6 → 4 → 7a → 7b → 8 → 5 → 3 → 9`.

---

## 1. Alcance

**Dentro del 7b:**

- Seis adaptadores de red detrás de un contrato común: Mapillary, KartaView, Google Street
  View, Mapbox Satellite, Wikimedia Commons y Flickr.
- La capa de disponibilidad sobre el mapa de territorio, con su caché de sondeos.
- Estimación de coste, confirmación explícita, tope mensual y libro de gasto.
- Descarga reanudable por tesela × origen, con captura de atribución.
- Filtro por reglas y revisión por excepción de las imágenes sueltas.
- Redistribución: qué imágenes pueden salir en un paquete publicado y cuáles no.

**Fuera del 7b:**

- El motor de embebido y la cola. El 7b no los toca: entrega ficheros y filas, y la cola del
  7a los recoge sola.
- Publicar o instalar paquetes. Eso es el subsistema 8.
- Identidad y firma del publicador. También del 8 (ver §11).
- Ortofotos públicas nacionales (PNOA, NAIP). Consideradas y descartadas, ver §12.

## 2. Dónde encaja, y qué no toca

El 7b produce **exactamente lo mismo** que produce hoy el origen «carpeta local»: ficheros de
imagen en disco y filas en SQLite con su `tipo`, su `fuente`, su `quadkey`, sus coordenadas y
su atribución. La cola del 7a las recoge sin enterarse de que vinieron de la red.

Lo único nuevo en el ciclo de vida de una imagen es un estado **`por revisar`** entre
descargar y embeber, donde vive la revisión de §8.

La consecuencia buena de esto es que la capa entera se puede probar sin GPU: dado un
polígono, deja imágenes y filas.

## 3. El contrato de un origen de red

La v1 razonaba **punto a punto** (`checkCoverage(points)`, una petición HTTP por punto). Aquí
no sirve: el 7a piensa entero en teselas z14 —la clasificación local/catálogo/nuevo, los
fragmentos, los porcentajes de territorio—, y un resultado por punto no se cachea, no se
pinta y no se estima.

El contrato del 7b es **por tesela**:

```rust
pub trait OrigenDeRed {
    fn id(&self) -> &'static str;              // "mapillary", "google", "commons"…
    fn tipo(&self) -> Tipo;                    // Calle | Cenital | Suelta
    fn tarifa(&self) -> Tarifa;                // Gratis, o precio por unidad
    fn redistribucion(&self) -> Redistribucion;

    /// Qué hay aquí, sin bajar un solo píxel. Se cachea.
    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad>;

    /// Baja lo que haya, contra un presupuesto que no puede sobrepasar.
    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>>;
}
```

`Disponibilidad` distingue las dos formas de saber:

```rust
pub enum Disponibilidad {
    /// Puntos exactos, del propio proveedor. Solo Mapillary y KartaView.
    Puntos { cuantos: u32 },
    /// Estimación por muestreo. Es lo único que se puede decir del resto.
    Muestreo { nivel: Nivel, estimadas: u32 },  // Nivel: Mucho | Poco | Nada
    /// Cobertura global sin sonda: Mapbox cenital.
    Siempre { unidades: u32 },
}
```

Y `Captura` es lo que vuelve de `descargar`. Lleva la atribución **dentro**, no al lado, para
que no exista un camino de código por el que una imagen llegue al índice sin ella:

```rust
pub struct Captura {
    pub fuente: &'static str,
    pub id_origen: String,      // el identificador del proveedor: panoId, id de foto…
    pub ruta: PathBuf,          // ya en el directorio de paso, verificada como imagen
    pub lat: f64,
    pub lng: f64,
    pub rumbo: Option<f32>,
    pub capturada_en: Option<String>,
    pub atribucion: Atribucion, // autor, url, licencia — del 7a, sin cambios
    pub unidades: u32,          // lo que esta captura consumió del presupuesto
}
```

El muestreo de puntos a lo largo de las calles sigue existiendo, pero deja de ser un concepto
compartido: pasa a ser asunto interno de los tres adaptadores de calle, un ayudante
`muestrear_calles(tesela)` que ellos llaman. Los de cenital y foto suelta no muestrean nada.

`sondear` alimenta a la vez **los puntitos del mapa** y **la estimación de coste**. Es la
misma llamada, y por eso confirmar el gasto antes de bajar sale casi gratis.

## 4. Los seis adaptadores

| `fuente` | tipo | cómo se sondea | coste | ¿viajan las imágenes? |
|---|---|---|---|---|
| `mapillary` | Calle | teselas vectoriales oficiales, capa `image` a z14 | gratis | **sí** — CC BY-SA, con autor |
| `kartaview` | Calle | su capa de cobertura | gratis | **sí** — licencia abierta, con autor |
| `google` | Calle | muestreo contra el endpoint de metadatos (gratuito) | **7,00 $/1000 imágenes** | **no** |
| `mapbox-satelite` | Cenital | sin sonda: cobertura global | **0,75 $/1000 teselas** | **no** |
| `commons` | Suelta | API GeoData por el bbox de la tesela | gratis | **sí** — libre, con autor y licencia |
| `flickr` | Suelta | búsqueda por bbox filtrada a licencias CC | gratis | **según la foto** |

Dos consecuencias que gobiernan el resto del documento:

**La asimetría del sondeo es real y se ve** (§5). Mapillary y KartaView devuelven puntos
exactos y gratis; el resto se sondea por muestreo y solo puede decir «hay / poco / no hay».

**La última columna parte el paquete en dos** (§9). Un índice que mezcle Mapillary y Google
tiene material que se puede publicar y material que no.

### KartaView y su capa de cobertura

Mapillary documenta sus teselas vectoriales; la capa de cobertura de KartaView está peor
documentada. Si al implementarla no hay un endpoint de teselas estable, KartaView **cae al
lenguaje de muestreo** con el resto: mismo contrato, otra variante de `Disponibilidad`. Es un
cambio de una línea en su adaptador y no toca nada más — que es exactamente para lo que el
contrato distingue las dos formas de saber.

## 5. La disponibilidad en el mapa

Un interruptor por proveedor sobre el mapa de territorio, **apagados por defecto**.

**Regla dura: nunca se sondea al mover el mapa.** Solo se sondean las teselas del polígono
dibujado, y solo cuando el operador lo pide. Sin esto, pasear por una ciudad con Google
encendido quema cuota sin que nadie haya decidido nada.

Dos lenguajes visuales, porque el sondeo es asimétrico:

- **Mapillary y KartaView** → puntos exactos, dibujados por Mapbox GL directamente desde sus
  teselas vectoriales. Ni pasan por el backend ni se cachean: son teselas, ya vienen
  cacheadas por el navegador.
- **Google, Commons y Flickr** → sombreado de la tesela entera en tres niveles. Esto **sí**
  se cachea.
- **Mapbox cenital no se pinta.** «Hay satélite en todas partes» no es información.

### La caché de sondeos

```sql
CREATE TABLE sondeos (
  fuente      TEXT NOT NULL,
  quadkey     TEXT NOT NULL,
  nivel       TEXT NOT NULL,   -- mucho | poco | nada
  estimadas   INTEGER NOT NULL,
  sondeado_en TEXT NOT NULL,
  PRIMARY KEY (fuente, quadkey)
);
```

Caducidad de **30 días**: la cobertura cambia despacio y volver a sondear cada vez es tirar
cuota. Un sondeo caducado se vuelve a pedir; uno vigente se reutiliza sin tocar la red.

### El color, y por qué aquí sí

El 7a evita deliberadamente usar color para codificar categorías: la rampa es neutra y el
naranja significa «no sé». Cinco proveedores distinguibles a la vez **obligan** a meter cinco
colores.

Decisión: una paleta de cinco tonos que vive **solo en esta capa**, con su leyenda, y que no
se filtra a ninguna otra pantalla. En la tabla de estimación, en la de sellado y en ajustes
los mismos cinco tonos aparecen como un punto de 9 px junto al nombre — como índice de color
hacia la leyenda del mapa, nunca como el portador del significado, que siempre es el texto.

## 6. Estimar, confirmar, gastar

Para cada tesela que el 7a marcó `Nuevo`, y por cada origen activo, el sondeo ya dice cuántas
unidades de pago hacen falta. De ahí sale la pantalla de confirmación: desglose por origen,
unidades, precio unitario y total. **Lo gratuito también se lista**: hace falta para entender
de dónde va a salir cada imagen.

Dos puertas, y son de naturaleza distinta:

1. **La confirmación** es informada. Ves el número en euros antes de que se gaste nada.
2. **El tope mensual** es una barrera. Si `gastado_este_mes + previsto > tope`, el trabajo se
   rechaza **entero y ruidosamente**. Nunca a medias: media descarga es un índice con
   agujeros que nadie sabe dónde están. Misma regla que la v1.

Las dos pantallas ofrecen **«Solo los gratuitos»**, que reduce el trabajo a los cuatro
orígenes sin coste. Es la salida cuando el número no convence, y evita que la única
alternativa sea no indexar.

### El libro de gasto

```sql
CREATE TABLE gasto (
  dia      TEXT NOT NULL,      -- YYYY-MM-DD
  fuente   TEXT NOT NULL,
  unidades INTEGER NOT NULL,
  coste    REAL NOT NULL,
  PRIMARY KEY (dia, fuente)
);
```

Una fila por día y origen, siempre `UPSERT` sumando. **Solo cuenta lo que el proveedor sirvió
de verdad**: una petición que falla y no devuelve imagen no se cobra ni se apunta. Los
sondeos contra el endpoint de metadatos de Google son gratuitos y nunca se cuentan.

### El presupuesto es un contador vivo

`Presupuesto` no es una cifra que se mira al empezar: es un contador que se le pasa a
`descargar` y que este decrementa por unidad servida. Un origen que se desmadre se queda sin
saldo a mitad, en vez de descubrirlo al final. Cuando llega a cero, `descargar` termina
limpiamente devolviendo lo que llevaba.

## 7. La descarga

Todo lo que llega de fuera pasa por un **directorio de paso**, con las reglas que ya fijó el
7a: tope de tamaño **antes** de descomprimir, lista blanca de nombres que rechaza `..` en
cualquier posición, y cada fichero tiene que decodificar de verdad como imagen. Cualquier
fallo descarta el lote entero sin escribir nada.

### La unidad de trabajo

Es **tesela × origen**, y se anota en SQLite al completarse:

```sql
CREATE TABLE descargas (
  indice_id  INTEGER NOT NULL,
  fuente     TEXT NOT NULL,
  quadkey    TEXT NOT NULL,
  estado     TEXT NOT NULL,   -- en_curso | hecho | error
  imagenes   INTEGER NOT NULL DEFAULT 0,
  unidades   INTEGER NOT NULL DEFAULT 0,
  reintentos INTEGER NOT NULL DEFAULT 0,
  motivo     TEXT,
  PRIMARY KEY (indice_id, fuente, quadkey)
);
```

Esto es lo que hace que una descarga interrumpida se retome por tesela y —lo importante— **no
vuelva a pagar por una tesela ya pagada**.

### Las dos clases de fallo

Se mantienen tal cual del 7a, y no se tratan igual:

- «esta imagen no se puede bajar o no decodifica» es un **resultado**: se anota el motivo, se
  salta, y no se reintenta nunca.
- que se caiga el proceso o la red es una **avería**: la pareja tesela × origen vuelve una
  vez, con `reintentos` como contador que impide el bucle.

### La atribución se captura ahora

Por imagen, en el momento de la descarga, junto al identificador de origen y la licencia.
Después es irrecuperable, y sin ella un índice no se puede publicar. Era el agujero de la v1:
`DatasetManifestImage` no tenía ni proveedor ni atribución, y por eso `desconocida` es un
valor de primera clase en el 7a.

Cada origen tiene su límite de peticiones por segundo y su concurrencia, con valores
conservadores por defecto (§10).

## 8. El filtro y la revisión

### Primero las reglas

Baratas, y no abren ninguna imagen: precisión de la geoetiqueta, tamaño y proporción mínimos,
categorías y etiquetas del propio proveedor, fecha, y licencia cuando el proveedor la da por
foto. Lo descartado se anota con su motivo y **no se reintenta**: es un resultado, no una
avería.

### Después, la revisión por excepción

Lo que sobrevive va a una rejilla, y el detalle que decide si esto escala es que **se rechaza
por excepción, no se aprueba una a una**. Todo entra aceptado por defecto y el operador clica
lo malo; hay selección por rango con Mayúsculas. Aprobar tres mil fotos de una en una no lo
hace nadie dos veces.

**Descartar no borra el fichero: lo marca.** Una imagen sin vector sigue siendo material
recuperable si el operador cambia de opinión, y en una rejilla de miles un clic accidental no
puede ser irreversible.

### Solo se revisan las sueltas

Las panorámicas de calle y las teselas cenitales son capturas sistemáticas, no material
curable: revisar a mano cuatro rumbos por cada punto de cada calle es exactamente el muro que
la revisión por excepción intenta evitar, y no hay nada que juzgar en ellas. Para ellas el
filtro por reglas es el único paso.

## 9. Licencias, y qué viaja dentro del paquete

```rust
pub enum Redistribucion {
    Libre { licencia: String },   // mapillary, kartaview, commons
    SoloLocal,                    // google, mapbox-satelite
    PorImagen,                    // flickr: cada foto trae la suya
}
```

Lo tentador es publicar el vector de una imagen no redistribuible aunque no viaje su píxel.
**No sirve:** el motor verifica geométricamente contra la imagen de referencia, así que un
vector sin su imagen le da al receptor un candidato que no puede verificar nunca. Es peso y
ruido a cambio de nada.

**Decisión: lo no redistribuible no se publica, ni su imagen ni su vector.** El índice local
lo guarda todo y lo usa todo; publicar es un filtro sobre la copia que sale, no un borrado.
El manifiesto lo dice con números en vez de con una nota —«esta tesela se indexó con 340
imágenes, de las que viajan 210»— reutilizando la maquinaria de porcentajes del 7a.

### La consecuencia sobre la regla de no indexar dos veces

Quien instale el paquete **no hereda la cobertura de Google ni la cenital**, así que para él
esas teselas siguen sin indexar **en esos orígenes**. Es correcto, no es un fallo, y obliga a
un cambio concreto: la clasificación del 7a razona por tesela, y a partir del 7b tiene que
razonar **por tesela y por origen**.

En términos del 7a: `cobertura.json` gana, por tesela, la lista de `fuente` que ese fragmento
cubre; y `Estado::Local` / `Estado::Catalogo` pasan a ser respuestas a la pregunta «¿esta
tesela, en este origen?». `Estado::Nuevo` sigue siendo lo único que cuesta cuota y GPU.

## 10. Claves y cuotas

Las claves van cifradas con la clave maestra local, en una tabla `claves(proveedor, cifrada)`
— es generalizar lo que el 7a ya hace con la de Mapbox, no maquinaria nueva. La de Mapbox se
comparte entre el mapa y el origen cenital: es la misma cuenta.

**Un origen sin clave configurada no aparece como disponible.** Ni en la capa del mapa ni en
la estimación. Mejor ausente que presente y reventando cuando el gasto ya está confirmado.

### Dónde va la clave, y una precisión que no es un descuido

«Ningún secreto en una ruta» es una regla sobre **nuestras** URLs y sigue vigente. Mapillary
acepta `Authorization: OAuth <token>` y ahí se usa.

Flickr y Google Static **solo** aceptan la clave por parámetro de consulta: no ofrecen
cabecera. No es una excepción que se concede por comodidad, es lo único que el proveedor
admite. Va escrito aquí para que dentro de seis meses nadie lo lea como un olvido. Mitigación:
es la clave del propio operador, en su propia máquina, viajando por TLS a su propio
proveedor, y nunca aparece en un log —los adaptadores redactan el parámetro al registrar una
URL.

### Límites por defecto

| origen | req/s | concurrencia |
|---|---|---|
| `mapillary` | 8 | 4 |
| `kartaview` | 4 | 2 |
| `google` | 10 | 4 |
| `mapbox-satelite` | 16 | 8 |
| `commons` | 2 | 1 |
| `flickr` | 4 | 2 |

Conservadores a propósito: un `429` cuesta más tiempo que la petición que se ahorró. Commons
va especialmente bajo porque es infraestructura donada.

## 11. Seguridad

- Las claves cifradas con la clave maestra local, nunca en claro en disco y nunca dentro de
  un paquete.
- Los parámetros de consulta con clave se redactan antes de escribir cualquier URL al log.
- Todo lo que llega de la red pasa por el directorio de paso del 7a: tope de tamaño antes de
  descomprimir, lista blanca de nombres, y verificación de que decodifica como imagen.
- Un paquete descargado no es un paquete de confianza. Esa regla del 7a no cambia.
- **Identidad del publicador: sigue sin resolverse, y es del 8.** Hoy `atribucion.autor` es
  una cadena que nadie verifica, y firmar «de buena fe» no es firmar. Con la publicación en
  GitHub ya elegida, la credencial natural es un token de GitHub y no una sesión de Lumi
  Station, pero la decisión se toma en el 8. Se anota aquí porque es la primera vez que el
  Indexer necesita identidad para algo.

## 12. Alternativas consideradas

**Ortofotos públicas nacionales (PNOA, NAIP) en vez de Mapbox Satellite.** Gratis, 0,25-0,5
m/px, licencia abierta, y las imágenes sí viajarían dentro del paquete. Descartada porque no
es un proveedor sino un mosaico por país, cada uno con su servidor, su proyección y sus
rarezas: fuera del primero que se implementara, el Indexer se quedaría sin cenital. Sigue
siendo la mejor salida el día que la restricción de redistribución de Mapbox duela de verdad,
y va a `FUTURO.md`.

**Sentinel-2 para el cenital.** Gratis y abierto, pero 10 m/px no localiza una foto de calle.
Descartada sin más.

**Sondeo uniforme por muestreo para los seis orígenes**, para que se vean todos iguales.
Descartada: miles de peticiones antes de indexar nada, y tira a la basura una API de
Mapillary que da la respuesta exacta y gratis.

**Un clasificador de escena** que mire la foto y decida si es exterior a escala de calle.
Descartado a favor de reglas más revisión manual: otro modelo que instalar, versionar y
anotar en el manifiesto, GPU gastada en fotos que se van a tirar, y un clasificador que se
equivoca tira material bueno sin que nadie lo vea.

## 13. Pruebas

La capa entera es probable sin red, y ese es el motivo de que `OrigenDeRed` sea un trait: un
origen falso devuelve sondeos y capturas guionizados.

**Unitarias, puras:** el bbox de una tesela, el muestreo de calles, la aritmética del
presupuesto (`previsto`, `gastado + previsto > tope`), y las reglas del filtro.

**Contra SQLite:** el libro de gasto (upsert por día y origen, suma del mes), la caché de
sondeos con su caducidad, y la reanudación por tesela × origen — incluida la prueba que
importa: **una tesela ya `hecho` no se vuelve a descargar ni a cobrar**.

**Con orígenes falsos:** el planificador completo, el rechazo por tope (entero, nunca a
medias), el presupuesto agotándose a mitad, las dos clases de fallo, y el filtro de
redistribución al sellar.

**Contra los proveedores de verdad:** una sola prueba, activada por variable de entorno con
claves reales y **fuera de la integración continua**. Una prueba que necesita internet y
cuota no es una prueba que se corra en cada commit.

## 14. Consecuencias fuera del 7b

- **Sobre el 7a:** `cobertura.json` y la clasificación de territorio pasan a razonar por
  tesela **y origen** (§9). Es el único cambio del 7b sobre código ya terminado.
- **Sobre el 8:** el catálogo tiene que enseñar qué orígenes cubre cada índice publicado, no
  solo qué teselas. Y le llega sin resolver la identidad del publicador (§11).
- **A `FUTURO.md`:** ortofotos públicas nacionales, y el clasificador de escena.
