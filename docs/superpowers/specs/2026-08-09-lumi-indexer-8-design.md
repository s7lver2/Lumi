# Subsistema 8 — Catálogo de índices

El 7 sabe construir un paquete `.lumidx` y sellarlo. A partir de ahí el paquete se queda en
un disco duro y no lo ve nadie: no hay forma de publicarlo, ni de encontrar el de otra
persona, ni de saber que el territorio que vas a comprar ya lo compró alguien el mes pasado.
El 8 es esa mitad — **publicar, encontrar, y no pagar dos veces por lo mismo**.

Maquetas: [`lumi-s8-mockups.html`](lumi-s8-mockups.html) (identidad, buscador, repositorios
remotos, perfil, índice remoto, publicar, territorio reclamado, modelo nuevo, resolución de
dependencias, dependencia rota).

**Orden vigente:** `1 → 2 → 6 → 4 → 7a → 7b → 8 → 5 → 3 → 9`.

---

## 1. Alcance

**Dentro del 8:**

- Identidad: entrar con GitHub o HuggingFace desde el Indexer, y una clave de firma propia.
- Publicar un índice sellado: cifrado, troceado por geografía, subido a un release.
- «Repositorios remotos»: tus publicaciones, agrupadas por repositorio, en solo lectura.
- Buscador de índices y de cuentas, y ficha de perfil a partir de lo publicado.
- Mapa de cobertura global en local, construido recorriendo repositorios por etiqueta.
- El reclamo de teselas, con su caducidad, y su efecto sobre Territorio y el presupuesto.
- **Dependencias**: lo que no indexas porque ya lo cubría otro se declara en tu ficha.
- La resolución de ese grafo al instalar, en Lumi Station.
- Capas de vectores por modelo: publicables por cualquiera, verificables por muestreo.

**Fuera del 8:**

- El árbol de colaboración dibujado, los perfiles con estadísticas ricas y la web de
  moderación. Son del subsistema 9. El 8 **produce el dato** (§8) y consume un único fichero
  firmado (§12); no depende de que la web exista.
- El motor de inferencia. El 8 mueve vectores, no los interpreta.
- Compartir índices entre usuarios de una misma Station, o permisos entre cuentas. El
  catálogo es público o no es.
- Publicar desde Lumi Station. Station **instala**; el Indexer **publica**. Son dos
  productos con dos usuarios distintos y no se cruzan.

## 2. Dónde encaja, y qué no toca

El 8 no cambia cómo se construye un índice. Toma un `.lumidx` **ya sellado** por el 7 —con su
`manifiesto.json`, su `indice.db`, su `cobertura.json`, sus `fragmentos/` y su
`SHA256SUMS`— y lo empaqueta para viajar. Sellar sigue siendo el acto irreversible que
congela el contenido; publicar es lo que ocurre después, y **solo sobre un índice sellado**:
publicar uno abierto no tiene sentido porque el contenido cambiaría bajo los pies del hash.

Lo único que el 8 mete hacia atrás, dentro del 7, es una consulta nueva en la clasificación
de territorio: el estado **`reclamada`** (§7). El resto del 7 no se entera.

## 3. Identidad

### Entrar

Se entra desde el Indexer, con **GitHub** o **HuggingFace**, mediante el **flujo de
dispositivo** (`device authorization grant`): la aplicación enseña un código y una URL, el
usuario lo autoriza en su navegador, y la aplicación sondea hasta recibir el testigo. Se
elige frente a OAuth con redirección por dos razones concretas: no hace falta incrustar un
navegador ni levantar un servidor local en un puerto arbitrario, y **no hay secreto de
cliente dentro del binario** —un binario de escritorio no puede guardar un secreto.

Permisos pedidos, y ninguno más: leer el perfil público, y crear releases en los
repositorios del usuario. Se enseñan literalmente en Ajustes, no como una promesa genérica.

**La identidad es opcional.** Sin ella la aplicación funciona entera menos publicar. El paso
del setup se puede saltar, y se puede conectar después desde Ajustes. Bloquear el arranque
por un login que quizá no se necesita hoy sería un mal cambio.

El testigo vive cifrado en el almacén que ya existe (`keys.rs`), junto a las claves de los
proveedores. No se escribe en claro en ningún sitio.

### Firmar

La cuenta dice **dónde** vive un paquete; no dice **quién** lo produjo. Un paquete movido de
GitHub a HuggingFace, o un repositorio transferido, perderían su autoría. Por eso la firma no
se apoya en la cuenta:

Al conectar la identidad por primera vez, el Indexer genera un **par de claves Ed25519**. La
privada se guarda cifrada en `keys.rs`; la pública se publica dentro de cada ficha. Cada
publicación —cuerpo, capa o ficha— va firmada con ella.

**El respaldo se enseña una sola vez**, como doce palabras, en el mismo momento de generarla,
con una casilla explícita de «la he guardado». No hay recuperación: perder el respaldo es
perder la identidad de lo publicado.

**Rotar no invalida lo firmado.** Al rotar, la clave vieja queda archivada en el almacén y
sigue publicada en las fichas antiguas, que se siguen pudiendo comprobar. Solo lo nuevo usa
la clave nueva. Una firma no caduca porque su autor cambie de llave.

### Qué significa una firma, y qué no

Una firma prueba que **quien tiene la clave produjo ese fichero**. No prueba que el contenido
sea bueno. Para eso está la comprobación por muestreo de §10, que es lo único que mira dentro.

## 4. Los tres artefactos de una publicación

Publicar un índice produce **tres tipos de asset** en un release, no uno:

| Asset | Cifrado | Peso típico | Qué es |
|---|---|---|---|
| `ficha.json` | **no** | decenas de KB | Metadatos: quién, clave pública, modelos, quadkeys de cada trozo, fuentes por quadkey, dependencias, hashes, vigencia, firma |
| `cuerpo-<quadkey>.enc` | sí | ~1,8 GiB | Imágenes, filas de `indice.db` y cobertura de un grupo de quadkeys. **Agnóstico al modelo**; no caduca nunca |
| `capa-<modelo>-<version>-<quadkey>.enc` | sí | MB | Los `fragmentos/` de un modelo para ese grupo. **Aditiva** |

**La ficha en claro es la pieza que hace posible todo lo demás.** El buscador, el mapa de
cobertura, el reclamo y la estimación de dependencias se resuelven leyendo solo fichas —
kilobytes— sin descargar un gigabyte. Cualquier diseño que exigiera abrir el paquete para
saber qué hay dentro convertiría el descubrimiento en algo impracticable.

### Por qué cuerpo y capa van separados

Un vector **es** el modelo: un embedding de `lumi-2 2.1` no es interpretable por `lumi-2 2.2`,
y por eso Qdrant tiene una colección por `(modelo, versión)`. No hay conversión posible entre
espacios vectoriales distintos.

Lo que sí se puede evitar es **volver a comprarle píxeles al proveedor**, que es la parte cara
e irrepetible. Como el `.lumidx` ya guarda los vectores en
`fragmentos/<quadkey>/<modelo>-<version>.{b1,i8}`, la separación ya existe en disco: basta
respetarla al publicar. Un modelo nuevo se resuelve publicando una **capa** sobre un cuerpo
que no se toca. Ver §10.

### El troceado es por geografía

GitHub limita cada asset de release a **2 GiB**, y un índice con imágenes lo pasa enseguida.
Se trocea, pero no a ciegas: **un asset por grupo de quadkeys z14**, con un tope de ~1,8 GiB
por trozo.

Cortar por bytes obligaría a descargar el paquete entero y recomponerlo para instalar
cualquier cosa. Cortando por geografía cada trozo es autocontenido, la ficha declara qué
quadkeys lleva cada uno, y sale gratis la **instalación parcial**: bajarse solo las zonas que
interesan. La misma partición la reutilizan las capas, así que no hay dos esquemas que
mantener.

### La ficha se sube la última

El orden de subida es: cuerpos → capas → ficha. **Mientras falte un asset, la ficha no se
publica**, y sin ficha el paquete no aparece en ninguna búsqueda ni reclama ninguna tesela.
Consecuencia deliberada: una subida cortada a mitad es invisible para el resto del mundo, y
nadie se encuentra nunca un índice a medias. El release queda marcado como incompleto en
«Repositorios remotos», con un «continuar» que retoma por el asset que faltaba y **no resube
lo que ya está**.

## 5. El cifrado, y contra qué protege

Todo menos la ficha va cifrado con **AES-256-GCM**, y **la clave viaja dentro de la ficha**.

Es decir: cualquiera con Lumi lo abre. Esto no es control de acceso y no se debe presentar
como tal. Es **ofuscación frente al alojamiento**: para GitHub, para un rastreador y para un
robot que indexe assets públicos, el fichero es un blob opaco en vez de un corpus de imágenes
geolocalizadas servido en bandeja. Contra una persona que quiera abrirlo, no protege nada, y
la interfaz lo dice con esas palabras.

`SHA256SUMS` sigue haciendo lo que ya hacía dentro del paquete; la firma de §3 se añade
encima, sobre los hashes de todos los assets.

Se descartó cifrado con control de acceso real (solo descifra quien el autor autorice):
convierte el catálogo abierto en una red de intercambio con permisos, que es otro producto.
Puede añadirse después como una marca por paquete sin romper nada de esto.

## 6. Descubrimiento: etiqueta, no registro

**No hay registro central.** Un repositorio que contiene índices de Lumi lleva una etiqueta
conocida —`lumi-index` como topic de GitHub, su equivalente como tag en HuggingFace— y el
descubrimiento consiste en recorrer los repositorios que la llevan, con el testigo que la
identidad ya proporciona.

Se consideró un repositorio-registro donde publicar añadiese una entrada, y se descartó: es
un cuello de botella y un mantenedor, y la etiqueta resuelve lo mismo sin que nadie tenga que
aprobar nada.

### El mapa de cobertura local

El Indexer mantiene una copia local en SQLite construida a partir de las fichas: por cada
`(quadkey, fuente)` publicado, qué paquete lo cubre, de quién, con qué hash y hasta cuándo es
vigente su ficha. Es lo que hace que el buscador responda al instante y que Territorio pueda
pintar reclamos sin pedir nada a la red.

Se refresca al abrir Territorio, al abrir Índices, y a petición explícita. Nunca al mover el
mapa — misma regla que la capa de disponibilidad del 7b, y por la misma razón.

**Este mapa siempre va con retraso, y el diseño lo asume.** No hay nada que arbitre: dos
personas pueden dibujar el mismo cuadrado el mismo día sin verse. «Reclamada» no es una
verdad, es lo último que se sabía. De ahí la caducidad de §7.

## 7. El reclamo

### Es duro, y es por fuente

Una tesela cubierta por un paquete publicado **no se descarga**. Sale del plan antes de
estimar, así que el coste en euros que el operador ve ya lleva el descuento. No hay «indexar
de todas formas».

La unidad de reclamo es **`(quadkey, fuente)`**, no la tesela entera. Puedes reclamar el
Mapillary de una zona y dejar libre su Commons. Cuadra con que la cobertura del 7a ya se
clasifica por origen, y evita que un paquete de una sola fuente cierre un territorio entero.

Un repositorio **privado** publica igual, pero **no reclama nada y no aparece en búsquedas**:
nadie puede leer su ficha, así que no puede bloquear territorio ajeno.

### Caduca solo

Al refrescar fichas, el Indexer comprueba que los assets siguen existiendo con una petición
de cabecera, sin descargar. **Si un asset responde 404, su reclamo se cae** y las teselas
vuelven a `nueva`. Cubre el caso frecuente —repositorio borrado, pasado a privado, asset
retirado— sin intervención humana y sin depender de la web.

Además, cada ficha declara una **vigencia de 90 días** desde su publicación. Si nadie la
refresca antes de que expire, el reclamo caduca también. Esto limpia los paquetes abandonados
que siguen existiendo pero que ya no mantiene nadie. Refrescarla es volver a firmar y resubir
la ficha —decenas de KB—, no el paquete: el Indexer lo ofrece en un clic cuando quedan menos
de 15 días.

## 8. Dependencias: quien indexa no descarga

Ésta es la pieza que más se malinterpreta, así que va explícita.

**Al indexar, no se descarga nada de nadie.** Ni del proveedor —ese es el ahorro— ni del otro
usuario. Las teselas reclamadas simplemente **no entran en tu índice**. Tu paquete tiene un
hueco ahí, y tu ficha declara quién lo cubre:

```json
"dependencias": [
  { "quadkeys": ["0313103312", "…"],
    "paquete":  "sevilla-casco-antiguo",
    "autor":    "mmartin",
    "url":      "https://github.com/mmartin/lumi-andalucia/releases/…",
    "sha256":   "3b71…c904" }
]
```

**El ancho de banda lo paga quien instala**, en Lumi Station: descargar un índice es
descargar el **grafo** —el paquete y sus dependencias, y las dependencias de éstas—, con el
peso total sumado antes de empezar.

Y ese grafo **es** el árbol de «hecho con la colaboración de» que el producto quiere enseñar.
No se construye aparte: sale de encadenar fichas. Por eso el dato pertenece al 8 aunque el
dibujo pertenezca al 9 — sin esto, publicar no generaría nunca la información que el árbol
necesita.

### Una dependencia se puede morir

Un paquete del que dependes puede desaparecer. La tesela se libera (§7), pero tu paquete ya
publicado se queda con un hueco que nadie rellena. Son dos personas con dos problemas
distintos y se resuelven por separado:

- **Quien instala** recibe el aviso en Station: *«esta zona la aportaba un paquete que ya no
  existe — 32 teselas sin cobertura»*, y se instala el resto. El índice sirve, incompleto y
  honesto, con el hueco marcado en el mapa.
- **Quien publicó** recibe el aviso en su Indexer, porque ya está refrescando fichas para el
  mapa de cobertura y enterarse sale gratis. Esas teselas están libres otra vez, así que
  puede indexarlas y publicar una versión que ya no dependa de nadie.

Un índice sin dependencias es **autónomo**. No es mejor ni peor: significa que nadie había
cubierto ese territorio antes.

## 9. Instalar, en Lumi Station

Station resuelve el grafo, comprueba **cada firma al abrir cada paquete** y verifica los
hashes como ya hace hoy al abrir un `.lumidx`. Si una firma no cuadra, ese paquete no se
instala y se dice cuál — no hay «abrir de todas formas», igual que no lo hay con el
fingerprint del servidor.

La resolución es transitiva y se corta por ciclos: un paquete ya presente en el grafo no se
vuelve a visitar.

## 10. Capas de modelo

Cualquiera puede publicar una capa de vectores para cualquier cuerpo. Como quien no es el
autor **no tiene permiso de escritura en ese release**, una capa ajena se publica **en un
repositorio propio**, y su ficha apunta al cuerpo original por hash. Al instalar, Station une
las piezas: cuerpo de uno, vectores de otro, cada uno con su firma.

**Antes de fiarse de una capa ajena se comprueba por muestreo**: se cogen 50 imágenes al azar
del cuerpo, se embeben en local con el modelo correspondiente y se comparan con lo que dice
la capa. El modelo es determinista — o casan o no casan. Esto convierte «me fío de esta
persona» en «he comprobado una muestra», que es una afirmación mucho más fuerte, y es lo
único de todo el subsistema que mira dentro del contenido en vez del envoltorio.

Un vector envenenado en una herramienta forense sitúa una foto en el lugar equivocado con
confianza alta. Es el peor fallo posible del producto, y por eso la comprobación no es
opcional ni configurable.

Si no existe capa para el modelo que usas, Station ofrece **embeberlo en local** en vez de
rechazar el paquete: GPU sobre material que ya tienes, sin volver a comprar nada.

**Conflicto entre dos capas** del mismo `(cuerpo, modelo, versión)`: conviven. Se listan
ambas con su autor, gana por defecto la que pase el muestreo, y si pasan las dos, la del
autor del cuerpo. No se borra ninguna: no hay autoridad que pueda decidir eso.

## 11. Material no redistribuible

La regla del 7b decía que lo no redistribuible no viaja *en absoluto*. **Se sustituye por
decisión del owner**, y queda registrada como tal: ese material **viaja, con advertencia y
descargo explícito**.

El diálogo de publicar enseña qué fuentes son y cuántas imágenes, dice que la responsabilidad
y cualquier reclamación de retirada son de quien publica —no de Lumi—, y obliga a marcar una
casilla. La ficha lleva la marca, para que quien instale sepa lo que se lleva y el buscador
pueda enseñarla.

Riesgo conocido y asumido: un asset retirado deja el reclamo huérfano. Está cubierto por la
caducidad de §7 y los dos avisos de §8; no hay nada más que se pueda hacer sin renunciar a la
decisión.

## 12. El contrato con la web (subsistema 9)

La web puede **quitar** reclamos, nunca añadirlos. Esa invariante es lo que impide que el
producto dependa de un servicio: nada de lo que un usuario necesita para trabajar pasa por
él.

El 8 consume **un único fichero firmado** por Lumi con la lista de desreclamos, y lo descarga
junto con las fichas. Si la web no existe o no responde, se usa la última lista conocida y
todo lo demás sigue funcionando: publicar, buscar, indexar, instalar.

Mientras el 9 no exista, el Indexer apunta a una instancia local. **Qué cuenta como «baja
calidad»** a efectos de desreclamo, y cómo se pide uno, son decisiones del 9; el 8 solo
necesita saber leer la lista. Lo único que el 8 aporta es el botón «Reportar» del popup de
tesela, que compone la petición.

## 13. Interfaz

Diez pantallas, ocho de ellas dentro de pantallas que ya existen. El detalle visual está en
las maquetas; aquí solo lo que es decisión y no dibujo.

1. **Setup · Identidad** — tras los servicios, antes de entrar. Saltable. Código de
   dispositivo en `font-mono` con copiar y abrir. Al volver: cuenta, y generación de clave con
   su respaldo.
2. **Ajustes · Identidad** — el único sitio donde se toca: cerrar sesión, cambiar de cuenta,
   permisos concedidos, huella pública, ver respaldo, rotar.
3. **Índices · buscador y repositorios remotos** — el buscador arriba, resolviendo primero
   contra el mapa local. Los repositorios remotos debajo de los índices locales, agrupados por
   repositorio, con estado por paquete (`publicado` · `subiendo n/m` · `incompleto` · `no
   disponible`).
4. **Perfil de una cuenta** — lo que se puede decir leyendo fichas. Sin publicaciones, lo
   dice y no finge que hay un error.
5. **Índice remoto en solo lectura** — **es `IndexDetail` con una marca de solo lectura**, el
   mismo mecanismo que ya usa un índice sellado. Añade: quién firmó, capas disponibles con su
   autor, dependencias y lista de assets. No hay pantalla paralela que mantener.
6. **Publicar** — tres pasos: repositorio (o crear uno con la etiqueta ya puesta) →
   previsualización del troceado con peso y zona de cada asset → descargo, si procede. La
   subida es un trabajo de fondo con el patrón `arrancar`/`progreso` que ya usan descarga,
   ingesta y sellado: reanudable, con su registro, y se puede cerrar el diálogo.
7. **Territorio · teselas reclamadas** — cuarto estado de tesela, con leyenda y un
   interruptor de capa. El panel de disponibilidad enseña quién aporta qué y el coste ya
   descontado. **No hay botón de instalar aquí**: lo reclamado será una dependencia.
8. **Modelo nuevo** — aviso de que hay un modelo, tabla de índices por modelo, y publicar la
   capa resultante, incluso sobre el cuerpo de otra persona.
9. **Station · resolución del grafo** — el árbol con su peso sumado, y el estado con una
   dependencia muerta.
10. **Indexer · dependencia rota** — el aviso al otro lado, con la oferta de rellenar.

### Movimiento

Se respeta `DESIGN.md`: solo `ease-out` exponencial, sin rebote, sin animar layout, con
`prefers-reduced-motion`. Tres keyframes nuevos a registrar allí:

- `jg-tile-sweep` — las teselas reclamadas aparecen desde el centro del grupo hacia fuera, con
  desfase por distancia, mientras el contador y el precio se interpolan. **Enseña de dónde
  sale el descuento** en lugar de decirlo.
- `jg-stroke-draw` — el trazo del check se dibuja cuando algo pasa a estar hecho: asset
  subido, firma verificada, modelo completo.
- `jg-strike` — el precio anterior se tacha dibujando la línea.

El resto reutiliza `jg-fade-rise` y el gesto de apertura del candado, que publicar continúa
con la flecha de subida saliendo por el borde.

## 14. Datos y ficheros

**Nuevo en `crates/lumi-index`** (lógica pura, con tests):

- `ficha.rs` — estructura de la ficha, serialización, firma y comprobación.
- `troceado.rs` — repartir quadkeys en trozos bajo un tope de bytes.
- `grafo.rs` — resolución de dependencias, transitiva, con corte por ciclos.

**Nuevo en `indexer/src-tauri/src/`:**

- `identidad.rs` — flujo de dispositivo, testigo, clave Ed25519, respaldo y rotación.
- `publicar.rs` — cifrar, trocear, subir con reanudación, componer la ficha.
- `catalogo.rs` — recorrido por etiqueta, caché de fichas, mapa de cobertura, reclamos.

**Nuevas tablas SQLite en el Indexer:** `fichas_remotas`, `cobertura_remota`
(`quadkey, fuente, paquete, autor, sha256, vigencia`), `publicaciones` (estado de subida por
asset, para reanudar), `desreclamos`.

**En Lumi Station:** la resolución del grafo y el diálogo de instalación, consumiendo
`lumi-index::grafo`.

## 15. Seguridad

- El testigo de sesión y la clave privada viven cifrados en `keys.rs`. No se escriben en
  claro ni se registran en el log.
- La firma se comprueba **siempre** al abrir un paquete ajeno, y un fallo aborta esa
  instalación. No hay diálogo de «confiar igualmente» — misma postura que el fingerprint del
  subsistema 1.
- El cifrado de §5 **no es control de acceso** y la interfaz lo dice así. Ningún texto de la
  aplicación puede sugerir que un paquete publicado es privado.
- La comprobación por muestreo de §10 es obligatoria antes de usar una capa ajena.
- Un repositorio privado no reclama: el reclamo exige que la ficha sea legible por todos.

## 16. Alternativas consideradas

- **Registro central** para descubrir. Descartado: cuello de botella y mantenedor, cuando la
  etiqueta hace lo mismo (§6).
- **Firma apoyada solo en la cuenta** de GitHub. Descartada: ata la autoría al alojamiento
  (§3).
- **Cifrado con control de acceso**. Descartado: es otro producto (§5).
- **Troceado por bytes**. Descartado: impide instalar por zonas (§4).
- **Reclamo blando**, o con excepción justificada. Descartado por el owner en favor del duro,
  cuya fragilidad queda cubierta por la caducidad y el desreclamo.
- **Que quien indexa se descargue el paquete ajeno.** Descartado: es exactamente lo que el
  reclamo quiere evitar. El coste lo asume quien instala (§8).
- **No publicar material no redistribuible.** Sustituido por decisión del owner (§11).

## 17. Pruebas

En `lumi-index`, que es donde vive la lógica pura:

- Troceado: ningún trozo pasa del tope; todas las quadkeys aparecen exactamente una vez.
- Ficha: se firma y se comprueba; una ficha alterada en un byte falla.
- Grafo: resolución transitiva, corte por ciclos, suma de pesos, dependencia rota marcada sin
  abortar el resto.
- Reclamo: `(quadkey, fuente)` reclamada sale del plan; caducada, vuelve; repositorio privado
  no reclama.

No se añaden tests a la capa de red ni a la interfaz, según la convención del repositorio.

## 18. Consecuencias fuera del 8

Cosas que este subsistema cambia en documentos que ya existen, y que hay que actualizar al
aprobarlo:

- **`ARCHITECTURE.md` §5** — el 8 pasa de «sin spec» a «con spec», y su descripción crece con
  identidad, reclamo y dependencias.
- **`DESIGN.md` · Movimiento** — registrar `jg-tile-sweep`, `jg-stroke-draw` y `jg-strike`.
- **La regla «lo no redistribuible no viaja»**, escrita en el plan 7c y en la spec del 7b,
  queda sustituida por §11. Debe corregirse en ambos sitios, no dejarse contradictoria.
- **`FUTURO.md`** — anotar lo que el 8 deja fuera a propósito: el árbol dibujado, los perfiles
  ricos y el criterio de calidad para desreclamar, todos del 9.
