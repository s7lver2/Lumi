# Paginar de verdad, y gastar donde el sondeo ya sabe que hay más

Tres de los cuatro orígenes de red gratuitos se conforman con una sola página de
resultados y nunca piden la siguiente, aunque el proveedor tenga muchas más fotos —
Mapillary lo admite en su propio comentario ("la Graph API pagina y esto se queda con la
primera página... no se hace"). Esto es una decisión de diseño tomada en su momento, no
un descuido, pero es exactamente la que produce el síntoma: teselas —sobre todo las que
caen tarde en el orden de descarga— con muy pocas imágenes cuando el proveedor tenía
muchas más.

Dos causas independientes, dos arreglos independientes:

1. **Falta de paginación** en Mapillary, Flickr y KartaView — cada uno se queda con la
   primera respuesta de la API.
2. **Orden de gasto arbitrario** en `download.rs` — las teselas se procesan en el orden
   en que llegan (alfabético de quadkey), sin relación con cuánto hay realmente
   disponible en cada una; si el presupuesto (tiempo, reintentos, o dinero en los
   orígenes de pago) se agota a mitad de camino, lo que queda sin nutrir es aleatorio.

## Fuera de alcance

- Commons ya pagina correctamente (sigue el `continue` de MediaWiki) — no se toca.
- Los orígenes de pago (Mapbox, Google) no cambian de mecanismo: Mapbox es una
  cuadrícula geométrica fija (no tiene "más páginas" que pedir) y Google itera sobre
  puntos de calle, no sobre páginas de una respuesta.
- Reclasificar teselas de borde en `territory.rs`/`tiles.rs` (cobertura parcial de
  polígono) — no es la causa del síntoma descrito, según la investigación.

## 1. Mapillary (`indexer/src-tauri/src/origins/mapillary.rs`)

`consultar_interno` hace una sola petición con `limit=2000` y se queda con `r.json::<Respuesta>().await?.data`, ignorando que la Graph API de Meta pagina de verdad y trae un
campo `paging.next` cuando hay más.

- `Respuesta` gana un campo:
  ```rust
  #[derive(Debug, Deserialize)]
  pub struct Respuesta {
      pub data: Vec<Foto>,
      pub paging: Option<Paging>,
  }

  #[derive(Debug, Deserialize)]
  pub struct Paging {
      pub next: Option<String>,
  }
  ```
- La rama de éxito de `consultar_interno` (la que hoy hace `Ok(r.json::<Respuesta>().await?.data)` al final, tras la comprobación de 500) pasa a acumular páginas en un bucle:
  sigue `paging.next` mientras exista y el total acumulado no llegue a `LIMITE` (sin
  subir la constante — 2000 sigue siendo el techo, ahora alcanzado de verdad en vez de
  solo pedido). El límite de páginas es el propio `LIMITE`, no un contador de vueltas
  aparte: cuando `acumulado.len() >= LIMITE as usize` se para y se trunca exactamente
  igual que ya hace `consultar_ligero`.
- El camino de `consultar_ligero` (activado solo tras un 500, para áreas demasiado
  densas para responder de una vez) no cambia: ya alcanza su propio techo por
  subdivisión geográfica en vez de por páginas, y mezclar las dos estrategias en el
  mismo camino no aporta nada que el camino de éxito no vaya a cubrir ya.
- `TIEMPO_MAXIMO_TOTAL` (90 s) sigue envolviendo `consultar_interno` entero: si seguir
  páginas hace que una tesela muy densa tarde más de eso, se abandona igual que hoy —
  no se toca esa red de seguridad.

## 2. Flickr (`indexer/src-tauri/src/origins/flickr.rs`)

`fotos()` pide una sola página (`per_page=250`, sin parámetro `page`) y no lee
`photos.pages` de la respuesta, que Flickr sí devuelve.

- `PaginaFlickr` gana los dos campos que ya vienen en la respuesta y hoy se ignoran:
  ```rust
  #[derive(Debug, Deserialize)]
  struct PaginaFlickr {
      #[serde(default)]
      photo: Vec<FotoFlickr>,
      #[serde(default)]
      page: u32,
      #[serde(default)]
      pages: u32,
  }
  ```
- `url()` gana un parámetro `page: u32` (por defecto 1 para la primera llamada).
- `fotos()` pasa a `fotos_de_pagina(tesela, pagina)`, y una función nueva `fotos()` (el
  nombre público que ya consumen `sondear`/`descargar`) hace el bucle: pide la página 1,
  mira `pages` en la respuesta, y si `pages > 1` sigue pidiendo `2..=pages` acumulando,
  hasta un tope total nuevo:
  ```rust
  /// Tope total tras paginar, no por página — Flickr ya limita `per_page` a 250 por
  /// petición; esto es cuántas páginas se siguen antes de parar. Cuatro páginas es
  /// generoso para una tesela de 2,4 km² sin encadenar peticiones sin fin en una
  /// zona anormalmente fotografiada.
  const LIMITE_TOTAL: u32 = POR_PAGINA * 4; // 1000
  ```
  Para en lo que llegue antes: agotar `pages` o llegar a `LIMITE_TOTAL`.

## 3. KartaView (`indexer/src-tauri/src/origins/kartaview.rs`)

`cerca_de(p)` pide `nearby-photos` sin ningún parámetro de paginación — la API de
OpenStreetCam acepta `page` e `ipp` (ítems por página) en el mismo cuerpo y hoy ninguno
de los dos se manda, así que siempre se recibe la página por defecto de la API.

- El cuerpo de la petición gana ambos parámetros, con un tamaño de página explícito:
  ```rust
  const IPP: u32 = 100;
  ```
  `cerca_de` pasa a `cerca_de_pagina(p, pagina)`, y una `cerca_de(p)` nueva pagina en
  bucle: pide `page=1, 2, ...` mientras la página devuelta traiga exactamente `IPP`
  elementos (indicio de que puede haber más) y el total acumulado no llegue a:
  ```rust
  /// Por PUNTO de muestreo, no por tesela — cada punto es un radio de 20 m, así que
  /// más de esto en un solo punto ya es sospechoso de estar re-pidiendo lo mismo por
  /// un fallo de paginación, no cobertura real.
  const LIMITE_POR_PUNTO: u32 = 500;
  ```
  Para en lo que llegue antes: una página con menos de `IPP` elementos (no hay más), o
  `LIMITE_POR_PUNTO`.
- `sondear` sigue llamando a `cerca_de` sin cambios de firma — se beneficia gratis de la
  paginación real, así que el nivel `mucho`/`poco`/`nada` que calcula pasa a ser preciso
  también.

## 4. Orden de gasto por lo que el sondeo ya sabe (`indexer/src-tauri/src/download.rs`)

`un_origen` calcula `pendientes` (`Almacen::descargas_pendientes`, que hoy conserva el
orden de entrada — alfabético de quadkey, heredado de `tiles.rs`) y las recorre en ese
mismo orden con `for qk in pendientes`. Pasa a ordenarlas por lo que el sondeo de esa
fuente ya estimó, descendente:

```rust
let mut pendientes = self.almacen.descargas_pendientes(self.indice_id, o.id(), teselas)
    .unwrap_or_default();
// Las que el sondeo ya marcó con más fotos van primero: si el presupuesto se agota a
// mitad de la lista, lo que se queda sin nutrir es lo que ya se sabía pobre, no lo que
// resultó estar bien surtido por azar del orden alfabético de quadkey.
pendientes.sort_by_key(|qk| {
    std::cmp::Reverse(
        self.almacen
            .sondeo_leer(o.id(), qk, crate::probe::CADUCIDAD_DIAS)
            .ok()
            .flatten()
            .map(|(_, estimadas)| estimadas)
            .unwrap_or(0),
    )
});
```

`crate::probe::CADUCIDAD_DIAS` (30 días) es la misma constante que ya usa `probe.rs` para
decidir si un sondeo sigue siendo válido o hay que rehacerlo — evita inventar un segundo
criterio de caducidad. Una tesela sin sondeo previo (o con uno caducado) ordena como `0`
— al final, no al principio: es la respuesta segura ante la duda, igual que el resto del
sistema no premia lo desconocido sobre lo medido.

## Qué no cambia

- El corte por presupuesto (`tope.gastar`) sigue siendo por unidad, dentro de cada
  origen — esta spec no toca cuánto cuesta cada foto, solo cuántas se llegan a pedir y
  en qué orden se gasta lo que hay.
- Los formatos de `Captura`, `Disponibilidad` y el resto del contrato de
  `OrigenDeRed` no cambian — cada arreglo es interno a cómo cada origen construye su
  lista antes de devolverla.

## Alternativas consideradas

- **Subir los topes fijos (`LIMITE`, `POR_PAGINA`) en vez de paginar**: descartado — el
  síntoma no es que el tope por página sea bajo, es que nunca se pide una segunda
  página aunque el proveedor la ofrezca. Subir el número no cambia nada si sigue siendo
  una sola petición.
- **Repartir el presupuesto en rondas** (una tanda pequeña por tesela antes de pasar a
  la siguiente, en vez de agotar tesela por tesela): descartada frente a ordenar por
  sondeo — exige tocar la forma del bucle de descarga por dentro de cada origen, no solo
  el orden de la cola, y el sondeo ya da la señal de qué priorizar sin ese coste.
