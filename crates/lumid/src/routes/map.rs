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

use crate::routes::auth::{bearer, require_admin, require_session};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MapConfig, MapConfigReq};

const OSM_STYLE: &str = "https://tiles.openfreemap.org/styles/liberty";

type Fail = (StatusCode, String);

fn err(c: StatusCode, m: &str) -> Fail {
    (c, m.to_string())
}

fn provider(app: &App) -> String {
    app.store.get_meta("map_provider").unwrap_or_else(|| "none".into())
}

fn style_url(app: &App) -> String {
    app.store.get_meta("map_style").unwrap_or_else(|| match provider(app).as_str() {
        "osm" => OSM_STYLE.to_string(),
        _ => String::new(),
    })
}

/// El botón "Copy Style URL" de Mapbox Studio da `mapbox://styles/usuario/id`,
/// que es el formato que su documentación pide pegar en sus propios SDKs — no
/// una dirección real, sino su esquema interno. `reqwest` no sabe resolverlo
/// ("builder error for url") porque no es HTTP. Es exactamente lo que se
/// espera que un administrador pegue aquí, así que se traduce en vez de
/// exigirle que sepa la equivalencia en `https://api.mapbox.com/styles/v1/`.
fn resolve_mapbox(url: &str) -> String {
    match url.strip_prefix("mapbox://styles/") {
        Some(rest) => format!("https://api.mapbox.com/styles/v1/{rest}"),
        None => url.to_string(),
    }
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

/// Qué le contamos al cliente. La clave no está aquí ni por asomo.
pub async fn config(State(app): State<App>, headers: HeaderMap) -> Result<Json<MapConfig>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let p = provider(&app);
    let has_key = app.store.get_meta("map_key").is_some_and(|k| !k.is_empty());
    let reason = match p.as_str() {
        "none" | "" => Some(
            "nadie ha configurado todavía el proveedor de mapas; pídeselo a tu administrador".into(),
        ),
        "mapbox" if !has_key => Some(
            "el proveedor es Mapbox pero no hay clave guardada; pídeselo a tu administrador".into(),
        ),
        _ => None,
    };
    Ok(Json(MapConfig { provider: p, style_url: style_url(&app), has_key, reason }))
}

/// Reescribe cada fuente del estilo para que apunte a NUESTRA ruta de teselas.
///
/// Devuelve `Err` si el JSON no tiene la forma esperada. Es deliberado: fallar
/// ruidosamente es la única alternativa aceptable a servir el estilo crudo.
///
/// El segundo elemento del resultado es el tileset de Mapbox que haya
/// encontrado (si alguno), para que `style()` lo recuerde y `tile()` sepa
/// contra qué tileset pedir cada pieza — un estilo hecho en Mapbox Studio casi
/// nunca trae `tiles` a secas, trae `"url": "mapbox://…"` señalando un
/// TileJSON compuesto, y ESE identificador es justo lo que la API de teselas
/// v4 de Mapbox acepta tal cual, sin tener que resolver el TileJSON aparte.
fn rewrite(mut style: serde_json::Value) -> Result<(serde_json::Value, Option<String>), String> {
    let sources = style
        .get_mut("sources")
        .and_then(|s| s.as_object_mut())
        .ok_or("el estilo no trae un objeto `sources`")?;
    let mut tocadas = 0;
    let mut tileset = None;
    for (name, src) in sources.iter_mut() {
        let Some(obj) = src.as_object_mut() else { continue };
        if let Some(u) = obj.get("url").and_then(|v| v.as_str()).map(str::to_string) {
            let Some(id) = u.strip_prefix("mapbox://") else {
                return Err(format!(
                    "la fuente `{name}` usa `url` pero no es un tileset de Mapbox ({u}); este proxy no sabe resolver TileJSON de otros proveedores"
                ));
            };
            tileset = Some(id.to_string());
            obj.remove("url");
            obj.insert("tiles".into(), serde_json::json!(["/v1/map/tiles/{z}/{x}/{y}"]));
            tocadas += 1;
            continue;
        }
        if let Some(tiles) = obj.get_mut("tiles").and_then(|t| t.as_array_mut()) {
            for t in tiles.iter_mut() {
                *t = serde_json::Value::String("/v1/map/tiles/{z}/{x}/{y}".into());
            }
            tocadas += 1;
        }
    }
    if tocadas == 0 {
        return Err("el estilo no tiene ninguna fuente de teselas que reescribir".into());
    }
    // `sprite` y `glyphs` apuntan al proveedor y también llevarían la clave.
    // Se quitan: MapLibre dibuja sin iconos ni etiquetas antes que filtrarla.
    if let Some(o) = style.as_object_mut() {
        o.remove("sprite");
        o.remove("glyphs");
    }
    Ok((style, tileset))
}

pub async fn style(State(app): State<App>, headers: HeaderMap) -> Result<Json<serde_json::Value>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let url = style_url(&app);
    if url.is_empty() {
        return Err(err(StatusCode::SERVICE_UNAVAILABLE, "no hay proveedor de mapas configurado"));
    }
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let full = if provider(&app) == "mapbox" {
        let url = resolve_mapbox(&url);
        if key.is_empty() { url } else { format!("{url}?access_token={key}") }
    } else {
        url
    };
    let raw: serde_json::Value = outbound()?
        .get(&full)
        .send()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el proveedor de mapas no respondió: {e}")))?
        .json()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el estilo del proveedor no es JSON: {e}")))?;
    let (fixed, tileset) = rewrite(raw).map_err(|e| {
        err(
            StatusCode::BAD_GATEWAY,
            &format!("no se pudo reescribir el estilo y servirlo crudo filtraría la clave: {e}"),
        )
    })?;
    // Se recuerda para que `tile()` pida ESTE tileset y no el genérico por
    // defecto: un estilo compuesto (varios tilesets Mapbox separados por
    // comas) es indistinguible del sencillo si no se guarda cuál era.
    if let Some(t) = tileset {
        let _ = app.store.set_meta("map_mapbox_tileset", &t);
    }
    Ok(Json(fixed))
}

/// Proxy con caché en disco. El caché no caduca: los mapas base cambian de año
/// en año y una tesela vieja cuesta mucho menos que pedirla en cada sesión.
/// Vaciarlo es borrar `{DATA}/tiles`.
pub async fn tile(
    State(app): State<App>,
    Path((z, x, y)): Path<(u32, u32, u32)>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let p = provider(&app);
    let cached = app.dir.join("tiles").join(&p).join(z.to_string()).join(x.to_string());
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
    let upstream = match p.as_str() {
        // El tileset real es el que `style()` dejó anotado al reescribir el
        // estilo. Sin uno guardado (estilo aún no pedido, o de antes de este
        // cambio) se cae al streets-v8 de siempre.
        "mapbox" => {
            let tileset = app
                .store
                .get_meta("map_mapbox_tileset")
                .unwrap_or_else(|| "mapbox.mapbox-streets-v8".into());
            format!("https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.vector.pbf?access_token={key}")
        }
        "osm" => format!("https://tiles.openfreemap.org/data/planet/{z}/{x}/{y}.pbf"),
        _ => return Err(err(StatusCode::SERVICE_UNAVAILABLE, "no hay proveedor de mapas configurado")),
    };
    let res = outbound()?
        .get(&upstream)
        .send()
        .await
        .map_err(|e| err(StatusCode::BAD_GATEWAY, &format!("el proveedor no respondió: {e}")))?;
    if !res.status().is_success() {
        let code = res.status();
        let cuerpo = res.text().await.unwrap_or_default();
        // El motivo crudo del proveedor, no un código a secas: una clave
        // caducada tiene que poder diagnosticarse desde la interfaz.
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

/// Provisional en su interfaz, no en su ruta: el subsistema 3 rehace la
/// pantalla y se queda esta API.
pub async fn patch_admin(
    State(app): State<App>,
    headers: HeaderMap,
    Json(req): Json<MapConfigReq>,
) -> Result<Json<MapConfig>, Fail> {
    require_admin(&app, &bearer(&headers))
        .map_err(|c| (c, "hace falta ser administrador".to_string()))?;
    if !["mapbox", "osm", "none"].contains(&req.provider.as_str()) {
        return Err(err(StatusCode::BAD_REQUEST, "el proveedor tiene que ser mapbox, osm o none"));
    }
    let fail = |e: anyhow::Error| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string());
    app.store.set_meta("map_provider", &req.provider).map_err(fail)?;
    let style = req.style_url.unwrap_or_default();
    let style = if style.trim().is_empty() && req.provider == "osm" { OSM_STYLE.into() } else { style };
    // Se normaliza al guardar y no solo al leer: así lo que `/v1/map/config`
    // le enseña a cualquier pantalla de administración ya es la URL real, no
    // el `mapbox://` que se pegó.
    let style = if req.provider == "mapbox" { resolve_mapbox(style.trim()) } else { style.trim().to_string() };
    app.store.set_meta("map_style", &style).map_err(fail)?;
    // `None` no toca la clave: así se puede cambiar de estilo sin volver a
    // teclearla, que es justo lo que no se puede hacer si se leyera del campo
    // enmascarado de la pantalla.
    if let Some(k) = req.key {
        app.store.set_meta("map_key", k.trim()).map_err(fail)?;
    }
    tracing::info!("proveedor de mapas: {}", req.provider);
    config(State(app), headers).await
}
