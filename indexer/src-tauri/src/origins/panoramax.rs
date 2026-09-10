//! Panoramax. Street-level, con rumbo, sin clave — un clon casi exacto de
//! `mapillary.rs` contra una API distinta (STAC en vez de la Graph API).
//!
//! Cobertura real en España pero fina: no sustituye a Mapillary, es un cuarto
//! origen que suma. Y trae un dato que ningún otro da: la precisión horizontal
//! declarada por foto, que sí llega a activar `Reglas::precision_maxima_m`.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::{bbox_de_tesela, Bbox};
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const BUSQUEDA: &str = "https://api.panoramax.xyz/api/search";

/// Verificado en vivo el 2026-09-10 contra `api.panoramax.xyz`: pidiendo
/// `limit=10000` sobre un área muchísimo mayor que una tesela z14 (todo un
/// barrio de París), la API responde con las 10.000 features en unos
/// segundos, sin límite superior documentado. Una tesela real es órdenes de
/// magnitud más pequeña, así que este techo no se alcanza en la práctica —
/// se deja igual de generoso que `mapillary::LIMITE` por si algún día lo hace.
const LIMITE: u32 = 2000;

/// Tope de páginas si la API alguna vez empieza a devolver un enlace
/// `rel: "next"` en el nivel superior de la respuesta (`Respuesta::siguiente`).
///
/// **No confirmado en vivo**: en las pruebas contra `api.panoramax.xyz`
/// (León y un barrio denso de París, con `limit` desde 1 hasta 10.000) ese
/// enlace superior SIEMPRE vino vacío (`"links":[]`), incluso cuando pedir
/// `limit=1` claramente dejaba fuera fotos que un `limit` mayor sí traía —
/// es decir, esta API no expone hoy un mecanismo de "página siguiente" para
/// `/api/search`, pese a que la especificación STAC que dice implementar sí
/// lo contempla. Seguir el link es entonces código defensivo para si la API
/// lo añade más adelante, no el mecanismo real de "hecho" de esta tarea —
/// ese lo cubre `LIMITE`, pedido de una sola vez.
const TOPE_PAGINAS: u32 = 20;

#[derive(Debug, Deserialize)]
struct Geometria {
    /// GeoJSON: `[lng, lat]`, al revés que casi todo lo demás.
    coordinates: [f64; 2],
}

#[derive(Debug, Deserialize)]
struct Activo {
    href: String,
}

#[derive(Debug, Default, Deserialize)]
struct Activos {
    sd: Option<Activo>,
    hd: Option<Activo>,
}

/// `quality:horizontal_accuracy` se observó siempre como número JSON puro
/// (`5.0`) en las respuestas reales, pero el spec pide tolerancia por si
/// alguna instancia lo publica como cadena — se acepta cualquiera de los dos
/// en vez de asumir que la muestra vista es representativa de todo el mundo
/// federado de Panoramax (STAC permite instancias de terceros).
fn de_precision_tolerante<'de, D>(d: D) -> Result<Option<f64>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let v: Option<serde_json::Value> = Option::deserialize(d)?;
    Ok(v.and_then(|v| match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse().ok(),
        _ => None,
    }))
}

#[derive(Debug, Deserialize)]
struct Propiedades {
    #[serde(rename = "view:azimuth")]
    azimuth: Option<f64>,
    datetime: Option<String>,
    license: Option<String>,
    #[serde(rename = "geovisio:producer")]
    productor: Option<String>,
    #[serde(rename = "quality:horizontal_accuracy", default, deserialize_with = "de_precision_tolerante")]
    precision_metros: Option<f64>,
}

#[derive(Debug, Deserialize)]
struct Feature {
    id: String,
    geometry: Geometria,
    properties: Propiedades,
    #[serde(default)]
    assets: Activos,
}

#[derive(Debug, Deserialize)]
struct Enlace {
    rel: String,
    href: String,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    #[serde(default)]
    features: Vec<Feature>,
    #[serde(default)]
    links: Vec<Enlace>,
}

pub struct Panoramax {
    ctx: Ctx,
}

impl Panoramax {
    pub fn nuevo(stage: PathBuf) -> Self {
        // Sin cifra de rate limit publicada: se trata como Commons por
        // prudencia (2 req/s, concurrencia 1), no porque Panoramax lo pida.
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn url_de_bbox(&self, b: Bbox) -> String {
        format!("{BUSQUEDA}?bbox={},{},{},{}&limit={LIMITE}", b.oeste, b.sur, b.este, b.norte)
    }

    /// Sigue `links[rel=next]` del nivel superior de la respuesta (no el de
    /// cada feature, que enlaza a la foto vecina dentro de su propia
    /// secuencia y no tiene nada que ver con paginar la búsqueda) hasta que
    /// deje de haberlo o hasta `TOPE_PAGINAS`. Ver el comentario de esa
    /// constante: en la práctica no se ha observado que la API lo ofrezca.
    async fn consultar(&self, tesela: &str) -> Result<Vec<Feature>> {
        let mut url = self.url_de_bbox(bbox_de_tesela(tesela));
        let mut fuera = Vec::new();
        for _ in 0..TOPE_PAGINAS {
            let _g = self.ctx.limitador.permiso().await;
            let r = self.ctx.cliente.get(&url).send().await?;
            if !r.status().is_success() {
                anyhow::bail!("Panoramax respondió {} a {}", r.status(), crate::keys::redactar(&url));
            }
            let cuerpo: Respuesta = r.json().await?;
            fuera.extend(cuerpo.features);
            match cuerpo.links.into_iter().find(|l| l.rel == "next") {
                Some(l) => url = l.href,
                None => break,
            }
            if fuera.len() >= LIMITE as usize {
                break;
            }
        }
        Ok(fuera)
    }
}

#[async_trait]
impl OrigenDeRed for Panoramax {
    fn id(&self) -> &'static str {
        "panoramax"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC-BY-SA-4.0".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.consultar(tesela).await?.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for f in self.consultar(tesela).await? {
            let Some(activo) = f.assets.sd.as_ref().or(f.assets.hd.as_ref()) else { continue };
            // No conocemos la resolución real de la imagen antes de bajarla
            // — a diferencia de Commons, Panoramax no la publica en
            // `properties`. `sd` es de ancho fijo 2048 px (documentado en el
            // propio asset); se asume 2048×2048 para que las reglas de
            // tamaño/proporción de `Reglas::evaluar` no puedan rechazar por
            // una suposición equivocada de forma, y sea solo la precisión
            // —el dato real que sí tenemos— la que decida.
            let cand = Candidata {
                ancho: 2048,
                alto: 2048,
                precision_metros: f.properties.precision_metros,
                categorias: vec![],
                licencia: f.properties.license.clone(),
                tipo: Tipo::Calle,
            };
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("panoramax {}: descartada, {motivo}", f.id);
                continue;
            }
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&activo.href, &format!("pan-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("panoramax {}: {e}", f.id);
                    continue;
                }
            };
            let [lng, lat] = f.geometry.coordinates;
            fuera.push(Captura {
                fuente: "panoramax",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: f.properties.azimuth.map(|a| a as f32),
                capturada_en: f.properties.datetime.clone(),
                atribucion: Atribucion {
                    autor: f.properties.productor.clone().unwrap_or_else(|| "Panoramax".into()),
                    url: format!("https://api.panoramax.xyz/api/pictures/{}", f.id),
                    licencia: f.properties.license.clone().unwrap_or_else(|| "CC-BY-SA-4.0".into()),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_url_lleva_el_bbox_en_el_orden_oeste_sur_este_norte() {
        let p = Panoramax::nuevo(std::path::PathBuf::from("/tmp"));
        let u = p.url_de_bbox(bbox_de_tesela("03113322013021"));
        assert!(u.contains("api.panoramax.xyz/api/search"), "{u}");
        let bbox = u.split("bbox=").nth(1).unwrap().split('&').next().unwrap();
        let n: Vec<f64> = bbox.split(',').map(|s| s.parse().unwrap()).collect();
        assert_eq!(n.len(), 4);
        assert!(n[0] < n[2], "oeste antes que este: {bbox}");
        assert!(n[1] < n[3], "sur antes que norte: {bbox}");
    }

    /// JSON real capturado el 2026-09-10 contra `api.panoramax.xyz` (recortado
    /// a los campos que el adaptador usa), incluida una imagen SIN azimuth —
    /// pasa con las 360° donde el rumbo no significa nada.
    const RESPUESTA_REAL: &str = r#"{
        "features": [
            {
                "id": "d0791774-01be-49b6-86bd-e51b22099ecc",
                "geometry": {"type": "Point", "coordinates": [-5.5655, 42.604062]},
                "assets": {
                    "hd": {"href": "https://panoramax.openstreetmap.fr/images/x/hd.jpg"},
                    "sd": {"href": "https://panoramax.openstreetmap.fr/derivates/x/sd.jpg"}
                },
                "properties": {
                    "license": "CC-BY-SA-4.0",
                    "datetime": "2025-03-25T11:00:00+00:00",
                    "geovisio:producer": "p4n-pics",
                    "view:azimuth": 0,
                    "quality:horizontal_accuracy": 5.0
                }
            },
            {
                "id": "a1ffc7a4-d23e-4f1a-85e9-f9b19c677709",
                "geometry": {"type": "Point", "coordinates": [-5.565317, 42.594556]},
                "assets": {
                    "hd": {"href": "https://panoramax.openstreetmap.fr/images/y/hd.jpg"}
                },
                "properties": {
                    "license": "CC-BY-SA-4.0",
                    "datetime": "2022-09-28T10:00:00+00:00",
                    "geovisio:producer": "p4n-pics"
                }
            }
        ],
        "links": []
    }"#;

    #[test]
    fn el_json_real_se_deserializa_y_el_rumbo_ausente_no_es_un_error() {
        let r: Respuesta = serde_json::from_str(RESPUESTA_REAL).unwrap();
        assert_eq!(r.features.len(), 2);
        assert_eq!(r.features[0].properties.azimuth, Some(0.0));
        assert_eq!(r.features[1].properties.azimuth, None, "una 360° puede no traer azimuth");
        assert_eq!(r.features[0].properties.precision_metros, Some(5.0));
        assert!(r.links.is_empty());
    }

    #[test]
    fn sin_sd_se_usa_hd_como_alternativa() {
        let r: Respuesta = serde_json::from_str(RESPUESTA_REAL).unwrap();
        let f = &r.features[1];
        let activo = f.assets.sd.as_ref().or(f.assets.hd.as_ref());
        assert_eq!(activo.unwrap().href, "https://panoramax.openstreetmap.fr/images/y/hd.jpg");
    }

    #[test]
    fn la_precision_tolera_venir_como_cadena() {
        let json = r#"{"license":null,"datetime":null,"geovisio:producer":null,
                        "view:azimuth":null,"quality:horizontal_accuracy":"12.5"}"#;
        let p: Propiedades = serde_json::from_str(json).unwrap();
        assert_eq!(p.precision_metros, Some(12.5));
    }

    #[test]
    fn la_coordenada_geojson_se_lee_lng_lat_y_no_al_reves() {
        let r: Respuesta = serde_json::from_str(RESPUESTA_REAL).unwrap();
        let [lng, lat] = r.features[0].geometry.coordinates;
        assert!((lng - (-5.5655)).abs() < 1e-6);
        assert!((lat - 42.604062).abs() < 1e-6);
    }
}
