//! Mapillary. El único origen con puntos exactos, y por dos vías distintas:
//!
//!   - En el NAVEGADOR, sus teselas vectoriales oficiales, que Mapbox GL pinta
//!     como una capa más. Gratis, ya cacheadas, sin pasar por el backend.
//!   - En el BACKEND, la Graph API por bbox. Una tesela z14 mide ~0,0005 grados
//!     cuadrados y el tope de área de la Graph API es 0,01: cabe veinte veces.
//!     Por eso aquí no hace falta decodificar teselas vectoriales en Rust.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const GRAPH: &str = "https://graph.mapillary.com/images";
const CAMPOS: &str =
    "id,compass_angle,thumb_2048_url,captured_at,creator,computed_geometry,geometry";

/// Tope de fotos por tesela.
///
/// ponytail: la Graph API pagina y esto se queda con la primera página. El
/// techo es que una tesela con más de 2000 fotos se indexa parcialmente; la
/// salida, seguir `paging.next`. No se hace porque 2000 fotos en 2,4 km² ya es
/// cobertura densa, y la segunda página rinde menos que bajar otra tesela.
const LIMITE: u32 = 2000;

#[derive(Debug, Deserialize)]
pub struct Geometria {
    pub coordinates: [f64; 2],
}

#[derive(Debug, Deserialize)]
pub struct Autor {
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Foto {
    pub id: String,
    pub compass_angle: Option<f32>,
    pub thumb_2048_url: Option<String>,
    pub captured_at: Option<i64>,
    pub creator: Option<Autor>,
    /// Posición refinada por SfM: más exacta que el GPS crudo de `geometry`,
    /// así que se prefiere cuando viene.
    pub computed_geometry: Option<Geometria>,
    pub geometry: Option<Geometria>,
}

#[derive(Debug, Deserialize)]
pub struct Respuesta {
    pub data: Vec<Foto>,
}

/// `(lat, lng)`. GeoJSON las da al revés, y confundirlas coloca A Coruña en
/// mitad del Atlántico sin que nada falle.
pub fn posicion(f: &Foto) -> Option<(f64, f64)> {
    let g = f.computed_geometry.as_ref().or(f.geometry.as_ref())?;
    Some((g.coordinates[1], g.coordinates[0]))
}

pub struct Mapillary {
    ctx: Ctx,
}

impl Mapillary {
    pub fn nuevo(token: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(token), stage, 8, 4) }
    }

    pub fn url_consulta(&self, tesela: &str) -> String {
        let b = bbox_de_tesela(tesela);
        format!(
            "{GRAPH}?fields={CAMPOS}&limit={LIMITE}&bbox={},{},{},{}",
            b.oeste, b.sur, b.este, b.norte
        )
    }

    async fn consultar(&self, tesela: &str) -> Result<Vec<Foto>> {
        let url = self.url_consulta(tesela);
        let _p = self.ctx.limitador.permiso().await;
        let token = self.ctx.clave.as_deref().unwrap_or_default();
        let r = self
            .ctx
            .cliente
            .get(&url)
            .header("Authorization", format!("OAuth {token}"))
            .send()
            .await?;
        if !r.status().is_success() {
            anyhow::bail!("Mapillary respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(r.json::<Respuesta>().await?.data)
    }
}

#[async_trait]
impl OrigenDeRed for Mapillary {
    fn id(&self) -> &'static str {
        "mapillary"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }
    fn puntos_exactos(&self) -> bool {
        true
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        Ok(Disponibilidad::Puntos { cuantos: self.consultar(tesela).await?.len() as u32 })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for f in self.consultar(tesela).await? {
            // Los dos casos de abajo son RESULTADOS, no averías: una foto sin
            // URL o sin posición no se puede usar, se salta y no se reintenta.
            let Some(url) = f.thumb_2048_url.clone() else { continue };
            let Some((lat, lng)) = posicion(&f) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("mly-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("mapillary {}: {e}", f.id);
                    continue;
                }
            };
            let autor = f.creator.as_ref().and_then(|c| c.username.clone());
            fuera.push(Captura {
                fuente: "mapillary",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: f.compass_angle,
                capturada_en: f.captured_at.map(marca_iso),
                atribucion: Atribucion {
                    autor: autor.unwrap_or_else(|| "Mapillary".into()),
                    url: format!("https://www.mapillary.com/app/?pKey={}", f.id),
                    licencia: "CC BY-SA 4.0".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

/// Milisegundos de época a ISO 8601 en UTC, sin arrastrar `chrono` por una
/// función. `capturada_en` es una cadena que solo se guarda y se enseña.
/// El calendario es el `civil_from_days` de Howard Hinnant.
pub fn marca_iso(ms: i64) -> String {
    let s = ms.div_euclid(1000);
    let (dias, resto) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        resto / 3600,
        (resto % 3600) / 60,
        resto % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_url_de_consulta_lleva_el_bbox_y_nunca_la_clave() {
        let m = Mapillary::nuevo("MLY|SECRETO".into(), std::path::PathBuf::from("/tmp"));
        let u = m.url_consulta("03113322013021");
        assert!(u.contains("graph.mapillary.com/images"), "{u}");
        assert!(u.contains("bbox="), "{u}");
        // Mapillary SÍ ofrece cabecera (`Authorization: OAuth`), así que aquí
        // la regla de «ningún secreto en una ruta» se cumple sin excepción.
        assert!(!u.contains("SECRETO"), "la clave no puede ir en la URL: {u}");
        assert!(!u.contains("access_token"), "{u}");
    }

    #[test]
    fn el_bbox_va_en_el_orden_que_pide_la_graph_api() {
        let m = Mapillary::nuevo("t".into(), std::path::PathBuf::from("/tmp"));
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        let u = m.url_consulta(&qk);
        let bbox = u.split("bbox=").nth(1).unwrap().split('&').next().unwrap();
        let n: Vec<f64> = bbox.split(',').map(|s| s.parse().unwrap()).collect();
        assert_eq!(n.len(), 4);
        assert!(n[0] < n[2], "oeste antes que este: {bbox}");
        assert!(n[1] < n[3], "sur antes que norte: {bbox}");
        // Y el área cabe de sobra en el tope de 0,01 de la Graph API.
        assert!((n[2] - n[0]) * (n[3] - n[1]) < 0.001, "{bbox}");
    }

    #[test]
    fn una_foto_sin_url_de_imagen_es_un_resultado_y_se_salta() {
        let json = r#"{"data":[
          {"id":"1","thumb_2048_url":"https://x/1.jpg","compass_angle":10.0,
           "geometry":{"type":"Point","coordinates":[-8.41,43.36]},
           "creator":{"username":"ana"},"captured_at":1714646400000},
          {"id":"2","compass_angle":20.0,
           "geometry":{"type":"Point","coordinates":[-8.42,43.37]}}
        ]}"#;
        let r: Respuesta = serde_json::from_str(json).unwrap();
        let utiles: Vec<_> = r.data.iter().filter(|f| f.thumb_2048_url.is_some()).collect();
        assert_eq!(utiles.len(), 1);
        assert_eq!(utiles[0].id, "1");
        assert_eq!(posicion(utiles[0]), Some((43.36, -8.41)), "lat primero, lng después");
    }

    #[test]
    fn la_marca_de_tiempo_sale_en_iso_utc() {
        // 1714646400000 ms = 2024-05-02T10:40:00Z
        assert_eq!(marca_iso(1_714_646_400_000), "2024-05-02T10:40:00Z");
        assert_eq!(marca_iso(0), "1970-01-01T00:00:00Z");
    }
}
