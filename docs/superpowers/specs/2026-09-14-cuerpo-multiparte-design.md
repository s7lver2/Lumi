# Publicar un cuerpo más pesado que el tope del proveedor

> Estado: aprobado para plan · 2026-09-14 · subsistema 8 (Indexer, publicación)
> Precede: `03436a5` (detectar el desbordamiento antes de empaquetar), que deja escrito:
> *"Lo que NO arregla esto: que esa tesela se pueda publicar."*

## 0. El problema, medido

Caso real: la tesela `03133320022212` (centro de León) pesa **5,594 GB** con
2.910 imágenes — 2,8× el límite de GitHub de 2 GiB por asset de release.
`troceado::trocear` no puede partirla por geografía (media tesela no es una
unidad instalable, ver su propio comentario), así que hoy `publicar()` se
niega antes de empaquetar, con un mensaje claro pero sin salida: aligerarla
en revisión (perder material) es la única opción que existe.

## 1. Decisión

Partir el **fichero cifrado ya construido** en trozos de bytes cuando supera
el tope del proveedor, subir cada trozo como su propio asset de GitHub, y
concatenarlos en el lado que instala antes de descifrar. Ni `cifrado.rs` ni
el contenido lógico de una tesela (imágenes, filas, vectores) cambian: lo
único que se parte es el transporte de un blob que ya era una sola unidad
opaca.

Se descarta partir las IMÁGENES de la tesela en varios zips independientes
(la opción B discutida): exigiría repartir `filas/<quadkey>.jsonl` entre
partes y enseñar a `catalogo::reclamos`/territorio que una quadkey puede
vivir en N assets en vez de uno. La opción elegida no toca ninguno de los dos.

## 2. Formato

`Asset` (`crates/lumi-index/src/ficha.rs`) gana un campo:

```rust
pub struct Asset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
    pub quadkeys: Vec<String>,
    /// Cuando el cuerpo cifrado entero supera el tope del proveedor, se
    /// parte en estos ficheros físicos —EN ESTE ORDEN— que hay que
    /// descargar y concatenar antes de descifrar. Vacío en el caso normal
    /// (un asset = un fichero), que es como se publicó todo hasta ahora:
    /// una ficha vieja sin este campo deserializa con `partes: []` y se
    /// trata exactamente igual que hoy. Cuando NO está vacío, `nombre` es
    /// una etiqueta lógica (progreso, disco local) y `sha256`/`bytes`
    /// describen el blob YA REENSAMBLADO completo, no ningún fichero
    /// individual.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub partes: Vec<ParteAsset>,
}

pub struct ParteAsset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
}
```

Compatibilidad: `#[serde(default)]` + `skip_serializing_if` reproduce el JSON
de siempre byte a byte cuando no hace falta partir nada — ninguna ficha ya
publicada cambia de forma, y ninguna publicación nueva de un cuerpo pequeño
añade ni una clave al JSON. Solo aparece `partes` cuando de verdad hay más de
un fichero físico.

## 3. Publicar (`indexer/src-tauri/src/publicar.rs`)

El chequeo de identidad sobre el contenido SIN CIFRAR sigue exactamente
donde está — es lo que ya evita recifrar y resubir un trozo que no cambió, y
seguirá evitando repetir un split de varios GB para una tesela que no se ha
tocado. Lo nuevo empieza después de `cifrar_asset_async`:

- Si `sellado.len() <= TOPE_ASSET_BYTES`: exactamente el camino de hoy, un
  asset, `partes: vec![]`.
- Si no: partir `sellado` en trozos de `TOPE_ASSET_BYTES` bytes (el último,
  el resto), nombrados `{nombre}.part001`, `.part002`... Cada parte pasa por
  el mismo camino que hoy usa un asset entero: `sha256_hex`,
  `almacen.publicacion_apuntar`, `subir_asset`, `almacen.publicacion_marcar_subido`
  — sin escribir ninguna función nueva de subida, solo iterando.
- El `Asset` final lleva `sha256`/`bytes` del blob reensamblado (ya los
  teníamos, de antes de partir) y `partes` con el nombre/sha256/bytes de
  cada trozo subido.

**Reutilizar un split anterior sin tocar red.** Si la tesela no cambió desde
la última publicación (el chequeo de identidad de siempre acierta), hoy se
reutilizan `sha256`/`bytes` de una fila de `publicaciones`. Para reconstruir
también `partes` sin volver a nada, `publicaciones` gana una columna
`partes_json TEXT` (migración idempotente `ALTER TABLE`, mismo patrón que
`identidad` ya usa), rellenada solo cuando el trozo se dividió. El camino de
reutilización lee esa columna y, si no es nula, reconstruye `Vec<ParteAsset>`
desde ahí en vez de volver a subir nada — es la diferencia entre "una tesela
de 5 GB sin cambios tarda segundos en volver a publicarse" y "tarda lo mismo
que la primera vez, cada vez".

El aviso de `no_caben` en `previsualizar()`/`PublishDialog` deja de ser un
bloqueo: una zona que no cabe en un asset ahora se anuncia como "se subirá en
N ficheros" (informativo), no como un botón deshabilitado. El `bail!` que hoy
corta `publicar()` antes de empaquetar se retira — publicar ya no falla por
esto.

## 4. Instalar (`crates/lumid/src/indices/`)

`instalar_uno` sigue iterando `ficha.cuerpos.iter().chain(...)` — un
`Asset` lógico por elemento, igual que hoy; el contador de progreso
(`assets_de`, `avanzar`) no cambia de unidad: una tesela partida en 3 sigue
contando como 1 al terminar, no como 3.

`paquete::traer_y_abrir` se divide en dos fases reutilizando su cola tal
cual (líneas 108-163 sin tocar):

1. **Reunir el blob cifrado.** Si `partes` está vacío: el camino de hoy
   (bajar la URL, verificar `sha256_esperado`). Si no: bajar cada parte EN
   ORDEN a un fichero temporal común (append), verificando el `sha256` de
   CADA PARTE por separado contra el suyo antes de escribirla — así un
   fallo de red a mitad señala qué parte falló, no el blob entero. El
   progreso de bytes (`asset_bytes_total`/`asset_bytes_hechos` en `EnCurso`)
   se acumula a través de las partes, para que la barra avance de forma
   continua en vez de reiniciarse en cada frontera.
2. **Descifrar y desplegar.** Exactamente el código que ya existe, sin
   cambios: el blob reensamblado se lee entero, se descifra con
   `lumi_index::cifrado::descifrar` (un solo golpe de AES-GCM, como
   siempre) y se descomprime.

Si el proceso muere a mitad de bajar las partes, al reiniciar se vuelve a
empezar la tesela entera desde la primera parte — igual que hoy pasa con un
asset de una sola pieza que se corta a mitad (`hechos_de`/`marcar_hecho`
siguen operando por nombre lógico, sin resumir a nivel de parte). No es una
regresión: es el mismo comportamiento que ya existe para un asset normal.

## 5. Qué NO cambia

- `cifrado.rs`: cero cambios. Sigue siendo un `cifrar`/`descifrar` sobre un
  blob completo.
- `filas/`, `fragmentos/`, el manifiesto, `troceado::trocear`: cero cambios.
  Una tesela sigue siendo una unidad lógica única; solo su transporte se
  parte cuando no cabe.
- El límite de 2 GiB de GitHub sigue siendo el límite — este spec no lo
  esquiva, hace que el formato lo respete sin perder datos.
- Ninguna ficha ya publicada deja de instalar: `partes: []` es indistinguible
  del JSON de hoy.

## 6. Criterio de aceptación

Publicar de verdad la tesela `03133320022212` (5,594 GB) contra un
repositorio de prueba: debe subir en varios assets, la ficha resultante debe
llevar `partes` con las 2-3 entradas esperadas, y `lumid` debe instalarla —
bajando todas las partes, reensamblando, descifrando y viendo las 2.910
imágenes en disco con sus filas correctas. Publicarla una segunda vez sin
cambios debe tardar segundos, no repetir la subida.
