# Versiones de un índice: borrar, recuperar y reindexar sin romper lo publicado

Un índice sellado hoy es irreversible a propósito — `sellar_indice()` no tiene camino de
vuelta a `abierto`, y así se queda. Esa garantía es correcta: es lo que hace que instalar
un `.lumidx` sea seguro (el hash y la firma no se mueven bajo los pies de nadie). Pero
tiene un coste que hoy no tiene salida: un índice grande ocupa disco para siempre, y si el
indexado de una zona salió mediocre —pocas imágenes en algunas teselas, un origen que
luego resultó tener mala cobertura— la única forma de mejorarlo es empezar un índice
nuevo desde cero, sin ninguna relación con el anterior.

Esta spec resuelve dos problemas juntos porque el segundo necesita al primero por debajo:

1. **Liberar espacio localmente** sin perder la capacidad de recuperarlo — borrar
   imágenes+vectores de una tesela y poder volver a bajarlos más tarde.
2. **Versionar un índice ya sellado y publicado** — reindexar contenido de las mismas
   teselas, con una restricción dura: nunca añadir una tesela que la v1 no tuviera ya.

## Fuera de alcance (anotado en FUTURO.md al cerrar)

- Agrupar v1/v2/v3 bajo una sola tarjeta en el catálogo con selector de versión. Por
  ahora cada versión publicada es una tarjeta suelta, con su número de versión visible.
- Re-descarga por imagen individual. La unidad de borrado/recuperación es la tesela
  entera, reutilizando la maquinaria de `descargas` que ya existe.
- Arreglar el reparto de presupuesto por tesela (teselas de borde casi vacías pese a
  tener más imágenes disponibles) — es una spec aparte, ya en la lista.

## 1. Esquema: `indices` gana genealogía

Dos columnas nuevas en `indices` (`indexer/src-tauri/src/store.rs`):

```sql
ALTER TABLE indices ADD COLUMN viene_de INTEGER REFERENCES indices(id);
ALTER TABLE indices ADD COLUMN numero_version INTEGER NOT NULL DEFAULT 1;
```

`viene_de` es `NULL` para cualquier índice creado como siempre (una v1). Crear una
versión nueva de un índice sellado inserta una fila **nueva** en `indices`, nunca reabre
la fila original — la garantía "sellado es sellado para siempre" no se toca. La fila
nueva nace con `estado = 'abierto'`, `viene_de = id_del_padre`,
`numero_version = padre.numero_version + 1`.

Esto responde directamente a por qué no se reabre el mismo índice: hoy `exige_abierto()`
es la puerta de entrada de toda escritura (ingesta, descarga, sellado), y depende de que
`estado` sea una vía de un solo sentido. Añadir una segunda vía ("sellado, pero
reabrible bajo condiciones") multiplicaría los estados posibles por dos en todos los
guards existentes. Una fila nueva no toca ni uno.

## 2. Nacer con todo heredado, sin duplicar disco

Crear la versión nueva clona en la fila nueva:

- Todas las filas de `lotes`, `imagenes`, `vectores` y `teselas` del padre, con el
  `indice_id` reapuntado a la fila nueva (mismo contenido lógico, otra clave foránea).
- Los ficheros de imagen se **hardlinkean** (`std::fs::hard_link`, mismo filesystem —
  `ruta` de un índice y el nuevo viven bajo el mismo `DATA` raíz) en el directorio de la
  versión nueva, no se copian. Un hardlink no cuesta espacio extra hasta que una de las
  dos entradas de directorio se borra o se sobreescribe; la otra sigue intacta. Esto es
  lo que permite que "hereda todo, tocas lo que quieras" no duplique gigabytes de fotos
  solo por crear una versión.

Si el hardlink falla (por ejemplo, `DATA` en un filesystem distinto al de la instalación
por defecto — no debería pasar en el caso normal, pero un owner pudo mover cosas), se
cae a una copia real (`std::fs::copy`) con un aviso en el log: más lento y más disco,
pero nunca un fallo silencioso a mitad de clonado.

## 3. Borrar: por tesela entera

Un comando nuevo, `liberar_tesela(indice_id, quadkey)`, solo válido sobre un índice
`abierto`:

1. Borra los ficheros de imagen de esa quadkey en el directorio de **este** índice
   (borra la entrada de directorio del hardlink; si era la única referencia, libera el
   inodo — si el padre todavía la tiene, su copia sigue intacta).
2. Borra las filas de `vectores` e `imagenes` de esa quadkey para este `indice_id`.
3. Resetea la fila de `descargas`/`teselas` de esa quadkey a pendiente para este índice.

El paso 3 es la razón de que esto sea gratis: la maquinaria de descarga por tesela que
ya existe (`origins::OrigenDeRed::descargar`, disparada por `descargas_pendientes`) no
distingue "nunca se bajó" de "se bajó y se liberó" — simplemente ve una tesela pendiente
y la trae, exactamente igual que la primera vez. No hace falta ninguna re-descarga por
imagen ni preservar `id_origen` de lo borrado.

## 4. El techo, no el suelo

Cuando `indices.viene_de` no es `NULL`, cualquier operación que reclame o descargue una
quadkey nueva (`territory::clasificar_area`, el flujo de reclamo, la cola de descarga)
comprueba esa quadkey contra las filas de `teselas` que ya existen para este `indice_id`.
No hace falta ninguna tabla nueva para guardar "el techo": la clonación de la sección 2
inserta esas filas una sola vez al crear la versión, y `liberar_tesela` (sección 3) solo
resetea el estado dentro de una fila existente — nunca borra ni añade filas de `teselas`.
El conjunto de quadkeys de un índice versionado es, por construcción, exactamente el que
tenía al nacer. Si la quadkey pedida no tiene fila en `teselas` para este `indice_id`, se
rechaza con el mismo criterio de "capacidad recortada, con motivo visible" que ya usa el
resto del sistema — nunca un fallo mudo.

Esto se comprueba dos veces, no una: al reclamar (para no dejar avanzar un trabajo que
va a fallar al final) y otra vez en `package::comprobar()` al sellar (defensa en
profundidad — mismo principio que ya aplica esa función comparando imágenes contra
vectores antes de escribir un byte).

## 5. Publicación: release propio, identidad de paquete intacta

`Ficha.paquete` (`crates/lumi-index/src/ficha.rs`) no cambia entre versiones: es la
identidad que usan las dependencias de otros paquetes (`Dependencia.paquete`), y romperla
rompería a cualquiera que dependa de este índice por nombre. `Ficha` gana un campo:

```rust
pub numero_version: u32,   // 1 si no se especifica — compatible con fichas ya publicadas
```

Lo que sí cambia es el *tag* de GitHub. Hoy `etiqueta_de(paquete)` (`publicar.rs`) es la
única función que decide el tag, y siempre da el mismo resultado para el mismo nombre —
por eso publicar una v2 con el mismo `paquete` reventaría con el choque de assets que ya
existe en el código (`subir_asset` reintenta 3 veces y aborta). La función pasa a tener en
cuenta la versión:

```rust
fn etiqueta_de(paquete: &str, numero_version: u32) -> String {
    let cruda: String = paquete
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '.' || c == '-' { c.to_ascii_lowercase() } else { '-' })
        .collect();
    let recortada = cruda.trim_matches('-');
    let base = if recortada.is_empty() { "indice".to_string() } else { recortada.to_string() };
    if numero_version <= 1 { base } else { format!("{base}-v{numero_version}") }
}
```

(El cuerpo de slugificado es el mismo que ya existe hoy en `etiqueta_de` — la función
gana el parámetro `numero_version` y la rama final, nada del slugificado cambia.)

La v1 de cualquier índice sigue publicándose exactamente en el tag de siempre — nadie que
ya haya resuelto esa URL ve nada distinto. Las versiones 2 en adelante van a su propio
release (`paquete-v2`, `paquete-v3`, ...), así que nunca se sobrescribe un asset que
alguien ya pudo haber instalado apuntando al release anterior.

## 6. Interfaz

- En la vista de un índice sellado: botón "Crear versión nueva" (solo si `estado ==
  'sellado'`) que ejecuta la clonación de la sección 2 y navega a la versión recién
  creada, ya abierta.
- En la vista de una versión abierta con `viene_de` no nulo: el mapa de teselas se ve
  igual que siempre, pero las teselas fuera del conjunto heredado no se pueden
  seleccionar para reclamar — mismo patrón visual que ya usa `territory` para "ya
  cubierta por otro", no un color nuevo.
- Botón "liberar" por tesela, visible solo mientras el índice esté `abierto` — mismo
  sitio donde hoy se ve el estado de cada tesela (`local`/`catálogo`/`nueva`).
- La ficha de un índice publicado enseña su `numero_version` junto al resto de metadatos
  (autor, teselas, tamaño) — texto plano, mono, como cualquier otro dato producido por
  máquina.

## 7. Qué no protege esto

Igual que con el resto del sistema de firmas: el hardlink es una optimización de disco,
no una barrera de seguridad. Nada en este diseño cambia la superficie de confianza — la
firma y el hash de cada versión publicada se verifican exactamente igual que hoy, sean
v1 o v27.

## 8. Alternativas consideradas

- **Reabrir el mismo índice sellado** en vez de una fila nueva: descartado — duplica los
  estados posibles de todo el sistema de guards (`exige_abierto` y quien lo llama) y dos
  personas no podrían distinguir "qué versión exacta instalé" si el `id` no cambia nunca.
- **Copiar ficheros en vez de hardlink**: descartado como comportamiento por defecto —
  duplicaría gigabytes de fotos por cada versión sin tocar nada; se mantiene como
  fallback solo si el hardlink falla de verdad.
- **Re-descarga por imagen individual**: descartado — ninguno de los seis adaptadores de
  origen expone hoy "bájame esta imagen por su id", solo "bájame esta tesela"; construirlo
  para ganar precisión que nadie pidió no se justifica.
- **Mismo release de GitHub para todas las versiones, sobrescribiendo assets**:
  descartado — cualquiera que ya haya resuelto la URL de v1 se encontraría su contenido
  cambiado bajo los pies la próxima vez que la abriera.
