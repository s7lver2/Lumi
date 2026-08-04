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
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{MapConfig, MapConfigReq, MapTheme};

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

/// El catálogo cerrado, para pintar la rejilla de temas. Estático y sin
/// estado: no hace falta sesión para saber qué existe, pero se exige igual
/// por la misma regla que el resto de rutas del daemon.
pub async fn themes(headers: HeaderMap, State(app): State<App>) -> Result<Json<Vec<MapTheme>>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    Ok(Json(
        THEMES.iter().map(|t| MapTheme { id: t.id.into(), label: t.label.into(), needs_key: t.needs_key }).collect(),
    ))
}

/// Qué le contamos al cliente. La clave no está aquí ni por asomo.
pub async fn config(State(app): State<App>, headers: HeaderMap) -> Result<Json<MapConfig>, Fail> {
    require_session(&app, &bearer(&headers)).map_err(|c| (c, "sesión inválida".to_string()))?;
    let theme = current_theme(&app);
    let has_key = app.store.get_meta("map_key").is_some_and(|k| !k.is_empty());
    let reason = match theme {
        None => Some(
            "nadie ha elegido todavía un tema de mapa; pídeselo a tu administrador".into(),
        ),
        Some(t) if t.needs_key && !has_key => Some(
            "este tema es de Mapbox y no hay clave guardada; pídeselo a tu administrador".into(),
        ),
        _ => None,
    };
    Ok(Json(MapConfig {
        provider: theme.map(|t| t.provider.to_string()).unwrap_or_else(|| "none".into()),
        theme: theme.map(|t| t.id.to_string()),
        has_key,
        reason,
    }))
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
    let theme = current_theme(&app)
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "no hay tema de mapa elegido"))?;
    let key = app.store.get_meta("map_key").unwrap_or_default();
    let full = if theme.provider == "mapbox" {
        let url = resolve_mapbox(theme.style);
        if key.is_empty() { url } else { format!("{url}?access_token={key}") }
    } else {
        theme.style.to_string()
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
    let theme = current_theme(&app)
        .ok_or_else(|| err(StatusCode::SERVICE_UNAVAILABLE, "no hay tema de mapa elegido"))?;
    // El caché es por proveedor, no por tema: los temas de Mapbox comparten
    // tileset por defecto salvo que el estilo diga otra cosa (ver `style()`),
    // y los de OSM comparten siempre la misma fuente vectorial "planet".
    let cached = app.dir.join("tiles").join(theme.provider).join(z.to_string()).join(x.to_string());
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
        // El tileset real es el que `style()` dejó anotado al reescribir el
        // estilo. Sin uno guardado (estilo aún no pedido) se cae al
        // streets-v8 de siempre.
        "mapbox" => {
            let tileset = app
                .store
                .get_meta("map_mapbox_tileset")
                .unwrap_or_else(|| "mapbox.mapbox-streets-v8".into());
            format!("https://api.mapbox.com/v4/{tileset}/{z}/{x}/{y}.vector.pbf?access_token={key}")
        }
        "osm" => format!("https://tiles.openfreemap.org/data/planet/{z}/{x}/{y}.pbf"),
        _ => return Err(err(StatusCode::SERVICE_UNAVAILABLE, "no hay tema de mapa elegido")),
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
    let _ = app.store.conn().execute("DELETE FROM meta WHERE k = 'map_mapbox_tileset'", []);
    tracing::info!("tema de mapa: {}", theme.id);
    config(State(app), headers).await
}
