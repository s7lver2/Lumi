//! El servidor es el único que habla con el proveedor de mapas.
//!
//! Dos motivos, y el primero manda: la clave es una credencial del owner, y si
//! viaja al equipo de cada investigador cualquiera la extrae del tráfico y
//! gasta la cuota ajena. El segundo es que el proveedor ve una IP en vez de
//! una por investigador, así que no puede correlacionar quién mira qué zona.
//!
//! El estilo TAMBIÉN pasa por aquí: un estilo de Mapbox trae dentro las URLs
//! de sus fuentes, y esas URLs llevan la clave. Servirlo crudo filtraría la
//! clave igual que no hacer nada.
//!
//! El estilo ya NO es una URL que se pega a mano. Un enlace mal copiado de
//! Mapbox Studio (la página de vista previa en vez del estilo, o el esquema
//! `mapbox://` sin traducir) fue la causa de tres averías distintas del mapa
//! antes de este cambio. El catálogo de abajo es cerrado: cada tema es una
//! URL que ya se sabe que funciona, y elegir uno es un clic, no un pegado.

use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::{Path, Query, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MapConfig, MapConfigReq, MapTheme};

/// `None` en `style()` pide el tema activo; un id explícito pide una vista
/// previa de otro tema del catálogo sin tocar cuál está activo.
#[derive(serde::Deserialize)]
pub struct ThemeQuery { theme: Option<String> }
/// `tile()`/`glyphs()`/`sprite()` siempre reciben el id explícito que el
/// propio `style()` dejó escrito en las URLs que genera — nunca adivinan.
/// `src` solo lo usa `tile()`: qué fuente del estilo pidió esta tesela, para
/// distinguir entre varias con tilesets y formatos distintos dentro del
/// mismo tema (ver `Upstreams::tilesets`).
#[derive(serde::Deserialize)]
pub struct ThemeIdQuery { theme: String, src: Option<String> }

struct Theme {
    id: &'static str,
    label: &'static str,
    provider: &'static str,
    style: &'static str,
    needs_key: bool,
}

const THEMES: &[Theme] = &[
    Theme {
        id: "osm-liberty", label: "OpenStreetMap · Liberty", provider: "osm",
        style: "https://tiles.openfreemap.org/styles/liberty", needs_key: false,
    },
    Theme {
        id: "osm-bright", label: "OpenStreetMap · Bright", provider: "osm",
        style: "https://tiles.openfreemap.org/styles/bright", needs_key: false,
    },
    Theme {
        id: "osm-positron", label: "OpenStreetMap · Positron", provider: "osm",
        style: "https://tiles.openfreemap.org/styles/positron", needs_key: false,
    },
    Theme {
        id: "mapbox-streets", label: "Mapbox · Calles", provider: "mapbox",
        style: "mapbox://styles/mapbox/streets-v12", needs_key: true,
    },
    Theme {
        id: "mapbox-dark", label: "Mapbox · Oscuro", provider: "mapbox",
        style: "mapbox://styles/mapbox/dark-v11", needs_key: true,
    },
    Theme {
        id: "mapbox-satellite", label: "Mapbox · Satélite", provider: "mapbox",
        style: "mapbox://styles/mapbox/satellite-streets-v12", needs_key: true,
    },
];

fn theme_by_id(id: &str) -> Option<&'static Theme> {
    THEMES.iter().find(|t| t.id == id)
}

fn current_theme(app: &App) -> Option<&'static Theme> {
    theme_by_id(&app.store.get_meta("map_theme")?)
}

/// `Some(id)` es una vista previa explícita de ESE tema; `None` es el tema
/// activo del servidor. Nunca se adivina uno a partir del otro.
fn pick_theme(id: Option<&str>, app: &App) -> Result<&'static Theme, Fail> {
    match id {
        Some(id) => theme_by_id(id)
            .ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese tema no existe en el catálogo")),
        None => current_theme(app)
            .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "no hay tema de mapa elegido")),
    }
}

type Fail = (StatusCode, String);

fn err(c: StatusCode, m: &str) -> Fail {
    (c, m.to_string())
}

/// El botón "Copy Style URL" de Mapbox Studio da `mapbox://styles/usuario/id`,
/// que es el formato que su documentación pide pegar en sus propios SDKs — no
/// una dirección real, sino su esquema interno. `reqwest` no sabe resolverlo
/// ("builder error for url") porque no es HTTP. Los temas de Mapbox del
/// catálogo usan ese mismo formato, así que se traduce aquí en vez de guardar
/// cada URL dos veces.
///
/// Dentro de un estilo aparecen otras dos variantes del mismo esquema, las de
/// las tipografías y los iconos, y se traducen igual.
fn resolve_mapbox(url: &str) -> String {
    if let Some(rest) = url.strip_prefix("mapbox://styles/") {
        return format!("https://api.mapbox.com/styles/v1/{rest}");
    }
    if let Some(rest) = url.strip_prefix("mapbox://fonts/") {
        return format!("https://api.mapbox.com/fonts/v1/{rest}");
    }
    // `mapbox://sprites/usuario/estilo` es el estilo más `/sprite`; el cliente
    // le pega después `.json`, `.png` o `@2x`.
    if let Some(rest) = url.strip_prefix("mapbox://sprites/") {
        return format!("https://api.mapbox.com/styles/v1/{rest}/sprite");
    }
    url.to_string()
}

/// Lo que `rewrite()` encontró dentro del estilo y `style()` tiene que
/// recordar: sin esto, las rutas de teselas, tipografías e iconos no sabrían a
/// qué dirección del proveedor van.
#[derive(Default)]
struct Upstreams {
    /// (nombre de la fuente, id del tileset, es raster). Un estilo puede
    /// combinar una fuente vectorial y otra raster bajo nombres distintos —
    /// `satellite-streets-v12` trae `composite` (vectorial, calles) y
    /// `mapbox-satellite` (raster, imagen) a la vez — y cada una necesita su
    /// propio tileset y su propio formato de tesela; asumir uno solo por
    /// tema rompía justo esa combinación.
    tilesets: Vec<(String, String, bool)>,
    /// Un `url` que SÍ es una dirección real (no `mapbox://`): un TileJSON que
    /// hay que resolver para saber la plantilla real de teselas. El nombre del
    /// dataset de OpenFreeMap cambia con el tiempo (`.../planet/<fecha>_pt/...`)
    /// — no es válido guardarlo a fuego una sola vez en el código.
    tile_manifest: Option<String>,
    glyphs: Option<String>,
    sprite: Option<String>,
}

/// Añade la clave a una URL del proveedor. Se hace aquí y no al guardar para
/// que la clave no acabe escrita en `meta` dos veces ni en un log.
fn with_key(url: &str, key: &str) -> String {
    if key.is_empty() || !url.starts_with("https://api.mapbox.com") {
        return url.to_string();
    }
    let sep = if url.contains('?') { '&' } else { '?' };
    format!("{url}{sep}access_token={key}")
}

/// Cliente HTTP hacia el proveedor. Se construye por llamada: son peticiones
/// esporádicas y un cliente en el estado sería una pieza más que mantener.
/// ponytail: el techo es un mapa muy usado; ahí conviene un cliente compartido
/// en `App`, que es un campo más y ningún cambio de diseño.
fn outbound() -> Result<reqwest::Client, Fail> {
    reqwest::Client::builder()
        .user_agent("lumi-station")
        .build()
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))
}

/// El catálogo cerrado, para pintar la rejilla de temas. Estático y sin
/// estado: no hace falta sesión para saber qué existe, pero se exige igual
/// por la misma regla que el resto de rutas del daemon.
pub async fn themes(headers: HeaderMap, State(app): State<App>) -> Result<Json<Vec<MapTheme>>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    Ok(Json(
        THEMES.iter().map(|t| MapTheme { id: t.id.into(), label: t.label.into(), needs_key: t.needs_key }).collect(),
    ))
}

/// El motor de dibujo elegido. `maplibre` mientras nadie diga lo contrario:
/// es el único de los dos que no obliga a repartir la clave.
fn current_engine(app: &App) -> String {
    match app.store.get_meta("map_engine").as_deref() {
        Some("mapbox") => "mapbox".into(),
        _ => "maplibre".into(),
    }
}

/// Qué le contamos al cliente.
///
/// Con el motor `maplibre` la clave no está aquí ni por asomo. Con `mapbox`
/// sí: su SDK firma las peticiones en el navegador, así que no hay forma de
/// usarlo sin repartirla. El administrador lo eligió sabiéndolo (ver el aviso
/// de `MapRow`), y esta ruta exige sesión como todas — la clave no queda
/// expuesta a cualquiera, solo a quien ya está dentro.
pub async fn config(State(app): State<App>, headers: HeaderMap) -> Result<Json<MapConfig>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let theme = current_theme(&app);
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let has_key = !key.is_empty();
    let engine = current_engine(&app);
    let directo = engine == "mapbox";
    let reason = match theme {
        None => Some(
            "nadie ha elegido todavía un tema de mapa; pídeselo a tu administrador".into(),
        ),
        Some(t) if t.needs_key && !has_key => Some(
            "este tema es de Mapbox y no hay clave guardada; pídeselo a tu administrador".into(),
        ),
        // El SDK de Mapbox exige una clave suya incluso para dibujar un estilo
        // ajeno, así que con un tema de OpenStreetMap no hay nada que hacer.
        Some(t) if directo && t.provider != "mapbox" => Some(
            "el motor de Mapbox solo dibuja sus propios temas; elige uno de Mapbox o vuelve a MapLibre".into(),
        ),
        _ => None,
    };
    // Solo lo estrictamente necesario para ese modo, y solo si ese modo está
    // activo: nada de mandar la clave «por si acaso».
    let sirve = directo && reason.is_none();
    Ok(Json(MapConfig {
        provider: theme.map(|t| t.provider.to_string()).unwrap_or_else(|| "none".into()),
        theme: theme.map(|t| t.id.to_string()),
        has_key,
        reason,
        engine,
        key: sirve.then(|| key.clone()),
        style: sirve.then(|| theme.map(|t| t.style.to_string())).flatten(),
    }))
}

/// Reescribe cada fuente del estilo para que apunte a NUESTRA ruta de teselas.
///
/// Devuelve `Err` si el JSON no tiene la forma esperada. Es deliberado: fallar
/// ruidosamente es la única alternativa aceptable a servir el estilo crudo.
///
/// El segundo elemento del resultado son las direcciones del proveedor que hay
/// que recordar. La del tileset de Mapbox es para que `tile()` sepa contra qué
/// tileset pedir cada pieza — un estilo hecho en Mapbox Studio casi nunca trae
/// `tiles` a secas, trae `"url": "mapbox://…"` señalando un TileJSON
/// compuesto, y ESE identificador es justo lo que la API de teselas v4 de
/// Mapbox acepta tal cual, sin tener que resolver el TileJSON aparte.
fn rewrite(mut style: serde_json::Value, theme_id: &str) -> Result<(serde_json::Value, Upstreams), String> {
    let sources = style
        .get_mut("sources")
        .and_then(|s| s.as_object_mut())
        .ok_or("el estilo no trae un objeto `sources`")?;
    let mut tocadas = 0;
    let mut up = Upstreams::default();
    for (name, src) in sources.iter_mut() {
        let Some(obj) = src.as_object_mut() else { continue };
        // `src` va en la propia URL, no solo `theme`: dos fuentes del mismo
        // estilo pueden necesitar tilesets y formatos distintos (ver
        // `Upstreams::tilesets`), y `tile()` necesita saber cuál pidió esta
        // tesela para no mezclarlas.
        let tiles_url = format!("/v1/map/tiles/{{z}}/{{x}}/{{y}}?theme={theme_id}&src={name}");
        if let Some(u) = obj.get("url").and_then(|v| v.as_str()).map(str::to_string) {
            // `mapbox://mapbox.foo,mapbox.bar` es un identificador de tileset,
            // no una URL real: hay que recordarlo para que `tile()` sepa contra
            // cuál pedir. Otros proveedores (OpenFreeMap) usan aquí un TileJSON
            // real que hay que resolver aparte — su plantilla de teselas no es
            // fija, cambia con cada actualización del dataset.
            if let Some(id) = u.strip_prefix("mapbox://") {
                let es_raster = obj.get("type").and_then(|v| v.as_str()) == Some("raster");
                up.tilesets.push((name.clone(), id.to_string(), es_raster));
            } else if u.starts_with("http://") || u.starts_with("https://") {
                up.tile_manifest = Some(u);
            } else {
                return Err(format!(
                    "la fuente `{name}` usa `url` con un esquema que no reconozco ({u})"
                ));
            }
            obj.remove("url");
            obj.insert("tiles".into(), serde_json::json!([tiles_url]));
            tocadas += 1;
            continue;
        }
        if let Some(tiles) = obj.get_mut("tiles").and_then(|t| t.as_array_mut()) {
            for t in tiles.iter_mut() {
                *t = serde_json::Value::String(tiles_url.clone());
            }
            tocadas += 1;
        }
    }
    if tocadas == 0 {
        return Err("el estilo no tiene ninguna fuente de teselas que reescribir".into());
    }
    // `sprite` y `glyphs` apuntan al proveedor y también llevarían la clave,
    // así que tampoco pueden servirse tal cual. Antes se quitaban, y MapLibre
    // no dibuja un estilo sin tipografías: en cuanto una capa de símbolos pide
    // texto, aborta con "glyphsUrl is not set" y no se pinta NADA, ni siquiera
    // las capas que no llevan letras. Se reescriben igual que las teselas: el
    // cliente pide nuestras rutas y el servidor pone la clave.
    let o = style.as_object_mut().ok_or("el estilo no es un objeto")?;
    up.glyphs = o.get("glyphs").and_then(|v| v.as_str()).map(resolve_mapbox);
    up.sprite = o.get("sprite").and_then(|v| v.as_str()).map(resolve_mapbox);
    match up.glyphs {
        // El `{fontstack}` y el `{range}` los rellena MapLibre antes de pedir.
        Some(_) => { o.insert("glyphs".into(), serde_json::json!(format!("/v1/map/glyphs/{{fontstack}}/{{range}}?theme={theme_id}"))); }
        // Sin tipografías no hay estilo que dibujar; mejor decirlo aquí que
        // dejar que MapLibre lo descubra con el lienzo ya montado.
        None => return Err("el estilo no declara `glyphs`".into()),
    }
    // Los iconos sí son prescindibles: sin ellos se pierden los pictogramas,
    // no el mapa. `base` es solo una raíz a la que el cliente le pega `.json`,
    // `.png` o `@2x`, que es como MapLibre construye estas peticiones.
    match up.sprite {
        // MapLibre construye `sprite.json`/`sprite@2x.png` concatenando el
        // sufijo directamente sobre esta cadena tal cual, sin volver a
        // analizarla como URL — iba un `?theme=` colgando aquí y el sufijo se
        // le pegaba DETRÁS de la query string en vez de delante, así que
        // `sprite()` recibía un tema con basura y un `file` que no coincidía
        // con ningún sufijo válido. El tema va en el PATH para que quede
        // intacto pase lo que pase detrás.
        Some(_) => { o.insert("sprite".into(), serde_json::json!(format!("/v1/map/sprite/{theme_id}/base"))); }
        None => { o.remove("sprite"); }
    }
    Ok((style, up))
}

/// Dónde vive en disco cada pieza cacheada de un tema: la misma carpeta que ya
/// usa `tile()`, así que "vaciar el caché del mapa" sigue siendo "borrar
/// `{DATA}/tiles`" — una sola regla, no una por tipo de recurso.
fn cache_dir(app: &App, theme_id: &str) -> std::path::PathBuf {
    app.dir.join("tiles").join(theme_id)
}

pub async fn style(
    State(app): State<App>, Query(q): Query<ThemeQuery>, headers: HeaderMap,
) -> Result<Json<serde_json::Value>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let theme = pick_theme(q.theme.as_deref(), &app)?;
    // El estilo ya reescrito apunta solo a rutas nuestras — nada de lo que
    // guarda en disco depende de la clave del proveedor, así que cachearlo no
    // envejece cuando la clave rota. Evita la ida y vuelta entera al
    // proveedor (y a resolver el TileJSON) en cada visita a la pantalla.
    let style_cache = cache_dir(&app, theme.id).join("style.json");
    if let Ok(bytes) = std::fs::read(&style_cache) {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&bytes) {
            return Ok(Json(v));
        }
    }
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let full = with_key(&resolve_mapbox(theme.style), &key);
    let raw: serde_json::Value = outbound()?
        .get(&full)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("tema {}: el proveedor de mapas no respondió: {e}", theme.id);
            err(StatusCode::BAD_GATEWAY, &format!("el proveedor de mapas no respondió: {e}"))
        })?
        .json()
        .await
        .map_err(|e| {
            tracing::warn!("tema {}: el estilo del proveedor no es JSON: {e}", theme.id);
            err(StatusCode::BAD_GATEWAY, &format!("el estilo del proveedor no es JSON: {e}"))
        })?;
    let (fixed, up) = rewrite(raw, theme.id).map_err(|e| {
        tracing::warn!("tema {}: no se pudo reescribir el estilo: {e}", theme.id);
        err(
            StatusCode::BAD_GATEWAY,
            &format!("no se pudo reescribir el estilo y servirlo crudo filtraría la clave: {e}"),
        )
    })?;
    // Se recuerda por tema Y por fuente, no en una sola clave global: dos
    // temas de Mapbox pueden resolver a tilesets distintos, y dentro de un
    // mismo tema dos fuentes pueden ser una vectorial y otra raster (ver
    // `Upstreams::tilesets`). Una vista previa tampoco puede pisar lo que el
    // mapa activo ya tenía descubierto. Lo mismo vale para tipografías e
    // iconos, cuyas rutas solo aparecen dentro del estilo.
    for (fuente, id, es_raster) in &up.tilesets {
        let valor = format!("{}:{id}", if *es_raster { "raster" } else { "vector" });
        let _ = app.store.set_meta(&format!("map_tileset_{}_{fuente}", theme.id), &valor);
    }
    if let Some(manifest_url) = up.tile_manifest {
        // El TileJSON del proveedor trae la plantilla real de teselas — para
        // OpenFreeMap incluye un segmento de fecha que cambia con cada
        // actualización del dataset (`.../planet/20260802_080001_pt/...`).
        // Con el caché de `style.json` de más abajo esto solo se resuelve una
        // vez por tema (hasta que se borre `{DATA}/tiles`), igual que las
        // teselas ya cacheadas nunca caducan por su cuenta — el mismo
        // compromiso de siempre, no uno nuevo.
        match outbound()?.get(&manifest_url).send().await {
            Ok(res) => match res.json::<serde_json::Value>().await {
                Ok(tilejson) => match tilejson["tiles"][0].as_str() {
                    Some(tpl) => { let _ = app.store.set_meta(&format!("map_tile_tpl_{}", theme.id), tpl); }
                    None => tracing::warn!("tema {}: el TileJSON de {manifest_url} no trae `tiles`", theme.id),
                },
                Err(e) => tracing::warn!("tema {}: el TileJSON de {manifest_url} no es JSON: {e}", theme.id),
            },
            Err(e) => tracing::warn!("tema {}: no se pudo resolver el TileJSON de {manifest_url}: {e}", theme.id),
        }
    }
    if let Some(g) = up.glyphs {
        let _ = app.store.set_meta(&format!("map_glyphs_{}", theme.id), &g);
    }
    if let Some(s) = up.sprite {
        let _ = app.store.set_meta(&format!("map_sprite_{}", theme.id), &s);
    }
    if let Some(parent) = style_cache.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(&style_cache, serde_json::to_vec(&fixed).unwrap_or_default());
    Ok(Json(fixed))
}

/// Proxy con caché en disco. El caché no caduca: los mapas base cambian de año
/// en año y una tesela vieja cuesta mucho menos que pedirla en cada sesión.
/// Vaciarlo es borrar `{DATA}/tiles`.
pub async fn tile(
    State(app): State<App>,
    Path((z, x, y)): Path<(u32, u32, u32)>,
    Query(q): Query<ThemeIdQuery>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let theme = theme_by_id(&q.theme)
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese tema no existe en el catálogo"))?;
    // "composite" es el nombre de la fuente principal en casi todos los
    // estilos de Mapbox Studio — el valor por defecto de siempre para
    // peticiones que vengan sin `src` explícito (estilos ya cacheados antes
    // de que este parámetro existiera).
    let fuente = q.src.as_deref().unwrap_or("composite");
    // El caché es por tema Y por fuente, no solo por tema: dos fuentes del
    // mismo tema (una vectorial, otra raster — ver `style()`) pueden pedir la
    // MISMA coordenada z/x/y con contenido distinto, y compartir carpeta
    // serviría la tesela de una bajo el nombre de la otra.
    let cached = app.dir.join("tiles").join(theme.id).join(fuente).join(z.to_string()).join(x.to_string());
    let file = cached.join(y.to_string());
    let ctype = |b: &[u8]| {
        // Vectoriales son protobuf comprimido; las rasterizadas, PNG.
        if b.starts_with(&[0x89, b'P', b'N', b'G']) { "image/png" } else { "application/x-protobuf" }
    };
    if let Ok(b) = std::fs::read(&file) {
        let t = ctype(&b).to_string();
        return Ok((
            [
                (axum::http::header::CONTENT_TYPE, t),
                (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
            ],
            b,
        ));
    }

    let key = app.store.get_meta("map_key").unwrap_or_default();
    let upstream = match theme.provider {
        // El tileset real es el que `style()` dejó anotado, por ESTE tema Y
        // ESTA fuente, al reescribir el estilo. Sin uno guardado (estilo aún
        // no pedido) se cae al streets-v8 vectorial de siempre.
        "mapbox" => {
            let guardado = app.store.get_meta(&format!("map_tileset_{}_{fuente}", theme.id));
            let (tileset, es_raster) = match guardado.as_deref().and_then(|v| v.split_once(':')) {
                Some(("raster", id)) => (id.to_string(), true),
                Some((_, id)) => (id.to_string(), false),
                None => ("mapbox.mapbox-streets-v8".to_string(), false),
            };
            if es_raster {
                // `mapbox.satellite` (imagen) no tiene forma vectorial: pedir
                // `.vector.pbf` aquí es justo el 502 que se veía antes.
                format!("https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.png?access_token={key}")
            } else {
                format!("https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.vector.pbf?access_token={key}")
            }
        }
        // OpenFreeMap (y cualquier otro proveedor con `url` en vez de
        // `tiles`) resuelve su plantilla real en `style()`, porque incluye un
        // segmento que cambia con el dataset — no hay un formato fijo que
        // guardar aquí a fuego.
        _ => {
            let tpl = app
                .store
                .get_meta(&format!("map_tile_tpl_{}", theme.id))
                .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "todavía no se ha pedido el estilo, así que no se sabe de dónde salen las teselas"))?;
            tpl.replace("{z}", &z.to_string()).replace("{x}", &x.to_string()).replace("{y}", &y.to_string())
        }
    };
    let res = outbound()?
        .get(&upstream)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("tema {}: tesela {z}/{x}/{y}: el proveedor no respondió: {e}", theme.id);
            err(StatusCode::BAD_GATEWAY, &format!("el proveedor no respondió: {e}"))
        })?;
    if !res.status().is_success() {
        let code = res.status();
        let cuerpo = res.text().await.unwrap_or_default();
        // El motivo crudo del proveedor, no un código a secas: una clave
        // caducada tiene que poder diagnosticarse desde la interfaz.
        tracing::warn!("tema {}: tesela {z}/{x}/{y}: el proveedor devolvió {code}: {cuerpo}", theme.id);
        return Err(err(StatusCode::BAD_GATEWAY, &format!("el proveedor devolvió {code}: {cuerpo}")));
    }
    let bytes = res
        .bytes()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?
        .to_vec();
    let _ = std::fs::create_dir_all(&cached);
    let _ = std::fs::write(&file, &bytes);
    let t = ctype(&bytes).to_string();
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, t),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
        ],
        bytes,
    ))
}

/// Descarga del proveedor y devuelve, con el tipo y el caché ya puestos. Las
/// tipografías y los iconos son los mismos para todos y no cambian nunca; se
/// cachean en disco (no solo en el webview) por la misma razón que las
/// teselas — la primera visita a la pantalla ya tarda bastante pidiendo seis
/// estilos y sus tipografías/iconos a la vez, y no hace falta repetirlo.
async fn passthrough(url: &str, ctype: &str, cache_path: &std::path::Path) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    if let Ok(b) = std::fs::read(cache_path) {
        return Ok((
            [
                (axum::http::header::CONTENT_TYPE, ctype.to_string()),
                (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
            ],
            b,
        ));
    }
    let res = outbound()?
        .get(url)
        .send()
        .await
        .map_err(|e| {
            tracing::warn!("passthrough {url}: el proveedor no respondió: {e}");
            err(StatusCode::BAD_GATEWAY, &format!("el proveedor no respondió: {e}"))
        })?;
    if !res.status().is_success() {
        let code = res.status();
        let cuerpo = res.text().await.unwrap_or_default();
        tracing::warn!("passthrough {url}: el proveedor devolvió {code}: {cuerpo}");
        return Err(err(StatusCode::BAD_GATEWAY, &format!("el proveedor devolvió {code}: {cuerpo}")));
    }
    let bytes = res.bytes().await.map_err(|e| err(StatusCode::BAD_GATEWAY, &e.to_string()))?.to_vec();
    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(cache_path, &bytes);
    Ok((
        [
            (axum::http::header::CONTENT_TYPE, ctype.to_string()),
            (axum::http::header::CACHE_CONTROL, "private, max-age=31536000".into()),
        ],
        bytes,
    ))
}

/// Nada de lo que llegue por la URL puede escaparse del hueco que le toca
/// dentro de la dirección del proveedor. Con `..` o una barra, un cliente
/// pediría otra ruta de la API de Mapbox — con NUESTRA clave puesta.
fn safe_segment(s: &str) -> Result<(), Fail> {
    if s.is_empty() || s.contains('/') || s.contains('\\') || s.contains("..") || s.contains('?') {
        return Err(err(StatusCode::BAD_REQUEST, "segmento no válido"));
    }
    Ok(())
}

/// Tipografías. La plantilla la dejó anotada `style()`; aquí solo se rellenan
/// sus dos huecos y se pone la clave.
pub async fn glyphs(
    State(app): State<App>,
    Path((fontstack, range)): Path<(String, String)>,
    Query(q): Query<ThemeIdQuery>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    safe_segment(&fontstack)?;
    safe_segment(&range)?;
    theme_by_id(&q.theme).ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese tema no existe en el catálogo"))?;
    let tpl = app.store.get_meta(&format!("map_glyphs_{}", q.theme)).ok_or_else(|| {
        err(StatusCode::SERVICE_UNAVAILABLE, "todavía no se ha pedido el estilo, así que no se sabe de dónde salen las tipografías")
    })?;
    let key = app.store.get_meta("map_key").unwrap_or_default();
    // Los nombres de fuente llevan espacios ("Noto Sans Regular") y el
    // proveedor los quiere codificados; las comas que separan la pila, no.
    let url = tpl
        .replace("{fontstack}", &fontstack.replace(' ', "%20"))
        .replace("{range}", &range);
    // `safe_segment` ya garantizó que ninguno de los dos trae `/`, `..` ni
    // espacios raros de ruta — sirven tal cual como nombre de fichero.
    let cache = cache_dir(&app, &q.theme).join("glyphs").join(format!("{fontstack}-{range}.pbf"));
    passthrough(&with_key(&url, &key), "application/x-protobuf", &cache).await
}

/// Iconos. MapLibre pide `base.json`, `base.png` y sus variantes `@2x` a
/// partir de la raíz que dejamos en el estilo, así que lo único variable es el
/// sufijo — y se acepta solo de esa lista, no lo que llegue.
pub async fn sprite(
    State(app): State<App>,
    Path((theme_id, file)): Path<(String, String)>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let sufijo = file
        .strip_prefix("base")
        .filter(|s| matches!(*s, ".json" | ".png" | "@2x.json" | "@2x.png"))
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese icono no existe"))?;
    theme_by_id(&theme_id).ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese tema no existe en el catálogo"))?;
    let base = app
        .store
        .get_meta(&format!("map_sprite_{theme_id}"))
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "este tema no trae iconos"))?;
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let ctype = if sufijo.ends_with(".png") { "image/png" } else { "application/json" };
    let cache = cache_dir(&app, &theme_id).join("sprite").join(format!("base{sufijo}"));
    passthrough(&with_key(&format!("{base}{sufijo}"), &key), ctype, &cache).await
}

/// Provisional en su interfaz, no en su ruta: el subsistema 3 rehace la
/// pantalla y se queda esta API.
pub async fn patch_admin(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<MapConfigReq>,
) -> Result<Json<MapConfig>, Fail> {
    require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    let theme = theme_by_id(&req.theme)
        .ok_or_else(|| err(StatusCode::BAD_REQUEST, "ese tema no existe en el catálogo"))?;
    let fail = |e: anyhow::Error| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    app.store.set_meta("map_theme", theme.id).map_err(fail)?;
    // `None` no toca la clave: así se puede cambiar de tema sin volver a
    // teclearla, que es justo lo que no se puede hacer si se leyera del campo
    // enmascarado de la pantalla. Cambiar de tileset invalida el que estaba
    // anotado; `style()` vuelve a anotarlo en cuanto el cliente lo pida.
    if let Some(k) = req.key {
        app.store.set_meta("map_key", k.trim()).map_err(fail)?;
    }
    if let Some(e) = req.engine.as_deref() {
        // Lista cerrada: un valor cualquiera aquí acabaría en un cliente que
        // no sabría qué hacer con él.
        let e = match e {
            "mapbox" => "mapbox",
            "maplibre" => "maplibre",
            _ => return Err(err(StatusCode::BAD_REQUEST, "ese motor no existe")),
        };
        app.store.set_meta("map_engine", e).map_err(fail)?;
        tracing::info!("motor de mapa: {e}");
    }
    // Solo se invalida lo descubierto para ESTE tema: es lo que acaba de
    // cambiar (clave o motor), y las vistas previas de los demás temas no
    // tienen por qué perder lo que ya sabían. `map_tileset_<tema>_<fuente>`
    // es una clave por fuente (pueden ser varias, ver `style()`), así que se
    // borra por prefijo en vez de listar nombres de fuente que no se conocen
    // aquí.
    let _ = app.store.conn().execute(
        "DELETE FROM meta WHERE k LIKE ?1 OR k IN (?2, ?3, ?4)",
        rusqlite::params![
            format!("map_tileset_{}_%", theme.id),
            format!("map_tile_tpl_{}", theme.id),
            format!("map_glyphs_{}", theme.id),
            format!("map_sprite_{}", theme.id),
        ],
    );
    // El `style.json` cacheado se apoya en lo que se acaba de invalidar
    // arriba; dejarlo tal cual serviría un estilo que ya no coincide con lo
    // recién descubierto.
    let _ = std::fs::remove_file(cache_dir(&app, theme.id).join("style.json"));
    tracing::info!("tema de mapa: {}", theme.id);
    config(State(app), headers).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// El mapa real (`work/mapEngine.ts`) pide `/v1/map/style` SIN `?theme=`:
    /// si el extractor exigiera esa clave, el mapa de producción se rompería
    /// con esta misma reforma que solo debía tocar las vistas previas.
    #[tokio::test]
    async fn style_sin_query_no_exige_tema() {
        use axum::extract::{FromRequestParts, Query};
        let req = axum::http::Request::builder().uri("/v1/map/style").body(()).unwrap();
        let (mut parts, _) = req.into_parts();
        let Query(q) = Query::<ThemeQuery>::from_request_parts(&mut parts, &()).await
            .expect("sin query string, theme tiene que quedar en None, no fallar");
        assert!(q.theme.is_none());
    }

    /// La forma real de un estilo oficial de Mapbox (`dark-v11`), recortada a
    /// lo que este proxy toca. Sin esto, la única forma de saber si `rewrite()`
    /// deja un estilo dibujable es abrir la aplicación y mirar un rectángulo
    /// negro, que es exactamente lo que no se puede depurar.
    #[test]
    fn el_estilo_reescrito_no_deja_ni_una_url_del_proveedor() {
        let raw = serde_json::json!({
            "version": 8,
            "name": "Dark",
            "sprite": "mapbox://sprites/mapbox/dark-v11",
            "glyphs": "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
            "sources": {
                "composite": {
                    "url": "mapbox://mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2",
                    "type": "vector"
                }
            },
            "layers": [{ "id": "background", "type": "background" }]
        });

        let (fixed, up) = rewrite(raw, "mapbox-dark").expect("dark-v11 tiene que poder reescribirse");

        // Lo que el cliente recibe apunta SOLO a rutas nuestras. Un `mapbox://`
        // o un `api.mapbox.com` que se colara aquí sería la clave viajando.
        let texto = serde_json::to_string(&fixed).unwrap();
        assert!(!texto.contains("mapbox://"), "quedó un esquema del proveedor: {texto}");
        assert!(!texto.contains("api.mapbox.com"), "quedó una URL del proveedor: {texto}");

        // Y las tres piezas que MapLibre necesita para dibujar están puestas,
        // cada una con el tema explícito para que la respuesta no dependa de
        // cuál esté activo en el servidor cuando el cliente vuelva a pedirlas.
        assert_eq!(fixed["sources"]["composite"]["tiles"][0], "/v1/map/tiles/{z}/{x}/{y}?theme=mapbox-dark&src=composite");
        assert_eq!(fixed["glyphs"], "/v1/map/glyphs/{fontstack}/{range}?theme=mapbox-dark");
        assert_eq!(fixed["sprite"], "/v1/map/sprite/mapbox-dark/base");
        assert!(fixed["sources"]["composite"].get("url").is_none(), "la url del tileset sigue ahí");

        // Y lo que el daemon tiene que recordar para servir esas tres rutas.
        assert_eq!(
            up.tilesets,
            vec![("composite".to_string(), "mapbox.mapbox-streets-v8,mapbox.mapbox-terrain-v2".to_string(), false)],
        );
        assert_eq!(up.glyphs.as_deref(), Some("https://api.mapbox.com/fonts/v1/mapbox/{fontstack}/{range}.pbf"));
        assert_eq!(up.sprite.as_deref(), Some("https://api.mapbox.com/styles/v1/mapbox/dark-v11/sprite"));
    }

    /// La forma real del estilo `liberty` de OpenFreeMap: dos fuentes (una
    /// raster ya con `tiles`, otra vectorial con `url` apuntando a un TileJSON
    /// real, no a `mapbox://`). Antes de este arreglo la segunda fuente hacía
    /// fallar `rewrite()` entero — nadie había probado un tema que no fuera
    /// Mapbox hasta que esta vista previa existió.
    #[test]
    fn un_url_que_no_es_mapbox_se_marca_para_resolver_aparte() {
        let raw = serde_json::json!({
            "version": 8,
            "sources": {
                "ne2_shaded": {
                    "type": "raster", "tileSize": 256, "maxzoom": 6,
                    "tiles": ["https://tiles.openfreemap.org/natural_earth/ne2sr/{z}/{x}/{y}.png"]
                },
                "openmaptiles": { "type": "vector", "url": "https://tiles.openfreemap.org/planet" }
            },
            "sprite": "https://tiles.openfreemap.org/sprites/ofm_f384/ofm",
            "glyphs": "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
            "layers": [{ "id": "background", "type": "background" }]
        });

        let (fixed, up) = rewrite(raw, "osm-liberty").expect("el estilo de OpenFreeMap tiene que reescribirse");

        assert_eq!(fixed["sources"]["openmaptiles"]["tiles"][0], "/v1/map/tiles/{z}/{x}/{y}?theme=osm-liberty&src=openmaptiles");
        assert!(fixed["sources"]["openmaptiles"].get("url").is_none());
        assert_eq!(fixed["glyphs"], "/v1/map/glyphs/{fontstack}/{range}?theme=osm-liberty");
        assert_eq!(fixed["sprite"], "/v1/map/sprite/osm-liberty/base");

        // No es un tileset de Mapbox: no hay id que identificar, solo un
        // TileJSON real que `style()` tiene que ir a buscar aparte.
        assert!(up.tilesets.is_empty());
        assert_eq!(up.tile_manifest.as_deref(), Some("https://tiles.openfreemap.org/planet"));
    }

    /// `satellite-streets-v12` de verdad combina `composite` (vectorial,
    /// `mapbox.mapbox-streets-v8`) y `mapbox-satellite` (raster,
    /// `mapbox.satellite`) bajo el mismo estilo. Antes de este arreglo
    /// `up.tileset` era un único valor que la segunda fuente pisaba sobre la
    /// primera, y `tile()` pedía SIEMPRE `.vector.pbf` — un 502 garantizado
    /// para la mitad raster.
    #[test]
    fn dos_fuentes_del_mismo_tema_no_se_pisan() {
        let raw = serde_json::json!({
            "version": 8,
            "sprite": "mapbox://sprites/mapbox/satellite-streets-v12",
            "glyphs": "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
            "sources": {
                "mapbox-satellite": { "url": "mapbox://mapbox.satellite", "type": "raster", "tileSize": 256 },
                "composite": { "url": "mapbox://mapbox.mapbox-streets-v8", "type": "vector" }
            },
            "layers": [{ "id": "background", "type": "background" }]
        });

        let (fixed, up) = rewrite(raw, "mapbox-satellite").expect("satellite-streets-v12 tiene que reescribirse");

        // Cada fuente lleva SU nombre en la URL, no una genérica compartida.
        assert_eq!(fixed["sources"]["composite"]["tiles"][0], "/v1/map/tiles/{z}/{x}/{y}?theme=mapbox-satellite&src=composite");
        assert_eq!(fixed["sources"]["mapbox-satellite"]["tiles"][0], "/v1/map/tiles/{z}/{x}/{y}?theme=mapbox-satellite&src=mapbox-satellite");

        // Y las dos quedan recordadas por separado, con su tipo correcto —
        // ninguna se pisa a la otra.
        assert!(up.tilesets.contains(&("composite".to_string(), "mapbox.mapbox-streets-v8".to_string(), false)));
        assert!(up.tilesets.contains(&("mapbox-satellite".to_string(), "mapbox.satellite".to_string(), true)));
        assert_eq!(up.tilesets.len(), 2);
    }

    /// Un estilo sin tipografías se rechaza en el servidor. MapLibre no dibuja
    /// NADA sin ellas —ni las capas sin letras—, así que servirlo sería mandar
    /// al cliente un rectángulo negro sin motivo.
    #[test]
    fn un_estilo_sin_glyphs_no_pasa() {
        let raw = serde_json::json!({
            "version": 8,
            "sources": { "s": { "type": "vector", "tiles": ["https://ejemplo/{z}/{x}/{y}.pbf"] } },
            "layers": []
        });
        assert!(rewrite(raw, "osm-liberty").is_err());
    }
}
