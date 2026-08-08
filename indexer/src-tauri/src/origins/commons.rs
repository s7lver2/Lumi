//! Wikimedia Commons. Todo lo de aquí es de licencia libre por definición, así
//! que sus imágenes viajan dentro del paquete con su autor y su licencia.
//!
//! Es infraestructura donada: 2 peticiones por segundo y una a la vez, con el
//! `User-Agent` identificable que `Ctx` ya pone, que es lo que su política pide.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use lumi_index::filter::{Candidata, Reglas, Veredicto};

use super::{Ctx, OrigenDeRed};

/// Los metadatos que Commons ya devuelve, en la forma que el filtro entiende.
/// Aparte para poder probar la decisión sin levantar la red.
fn candidata_de(ancho: u32, alto: u32, categorias: &[String], licencia: Option<&str>) -> Candidata {
    Candidata {
        ancho,
        alto,
        // Commons no publica precisión de la geoetiqueta. `None` es «no lo
        // dijo», que no descarta.
        precision_metros: None,
        categorias: categorias.to_vec(),
        licencia: licencia.map(str::to_string),
        tipo: Tipo::Suelta,
    }
}

const API: &str = "https://commons.wikimedia.org/w/api.php";
const LIMITE: u32 = 500;

#[derive(Debug, Deserialize)]
struct Coordenada {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Campo {
    value: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InfoImagen {
    #[serde(rename = "thumburl")]
    thumb: Option<String>,
    url: Option<String>,
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
    #[serde(rename = "extmetadata", default)]
    meta: std::collections::HashMap<String, Campo>,
}

#[derive(Debug, Deserialize)]
struct Categoria {
    title: String,
}

#[derive(Debug, Deserialize)]
struct Pagina {
    pageid: i64,
    title: String,
    #[serde(default)]
    coordinates: Vec<Coordenada>,
    #[serde(default)]
    imageinfo: Vec<InfoImagen>,
    #[serde(default)]
    categories: Vec<Categoria>,
}

#[derive(Debug, Deserialize)]
struct Consulta {
    #[serde(default)]
    pages: std::collections::HashMap<String, Pagina>,
}

#[derive(Debug, Deserialize)]
struct RespuestaCommons {
    query: Option<Consulta>,
}

pub struct Commons {
    ctx: Ctx,
}

impl Commons {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn url(&self, tesela: &str) -> String {
        let b = bbox_de_tesela(tesela);
        // El bbox de GeoData va `norte|oeste|sur|este`, que NO es el orden de
        // ninguna otra API de este módulo. Escrito para que nadie lo "corrija".
        format!(
            "{API}?action=query&format=json&formatversion=1\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit={LIMITE}&ggsnamespace=6\
             &prop=imageinfo%7Ccoordinates%7Ccategories&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048\
             &cllimit=20",
            b.norte, b.oeste, b.sur, b.este
        )
    }

    async fn paginas(&self, tesela: &str) -> Result<Vec<Pagina>> {
        let url = self.url(tesela);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Commons respondió {}", r.status());
        }
        Ok(r.json::<RespuestaCommons>()
            .await?
            .query
            .map(|q| q.pages.into_values().collect())
            .unwrap_or_default())
    }
}

#[async_trait]
impl OrigenDeRed for Commons {
    fn id(&self) -> &'static str {
        "commons"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.paginas(tesela).await?.len() as u32;
        // Aunque la cuenta parezca exacta se declara como muestreo: la consulta
        // está topada a 500 y la respuesta no dice si había más.
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for p in self.paginas(tesela).await? {
            let (Some(c), Some(i)) = (p.coordinates.first(), p.imageinfo.first()) else { continue };
            // Se prefiere la miniatura de 2048: el original de Commons llega a
            // decenas de megapíxeles y el verificador no los usa.
            let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            // Antes de bajar un solo byte: las reglas baratas deciden con lo
            // que el proveedor ya nos ha contado. Filtrar después de la
            // descarga no ahorraría ni ancho de banda ni cuota, que es justo
            // para lo que existe este módulo.
            let cats: Vec<String> = p.categories.iter().map(|c| c.title.clone()).collect();
            let licencia = i.meta.get("LicenseShortName").and_then(|c| c.value.clone());
            let cand = candidata_de(i.width, i.height, &cats, licencia.as_deref());
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("commons {}: descartada, {motivo}", p.title);
                continue;
            }

            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("commons {}: {e}", p.title);
                    continue;
                }
            };
            let campo = |k: &str| i.meta.get(k).and_then(|c| c.value.clone());
            fuera.push(Captura {
                fuente: "commons",
                id_origen: p.pageid.to_string(),
                ruta,
                lat: c.lat,
                lng: c.lon,
                rumbo: None,
                capturada_en: campo("DateTimeOriginal"),
                atribucion: Atribucion {
                    autor: campo("Artist").unwrap_or_else(|| "Wikimedia Commons".into()),
                    url: format!("https://commons.wikimedia.org/?curid={}", p.pageid),
                    licencia: campo("LicenseShortName").unwrap_or_else(|| "libre (Commons)".into()),
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

    /// Una foto de interior con categoría explícita no llega a descargarse.
    /// El test mira la decisión, no la red: `candidata_de` es lo que el
    /// adaptador consulta antes de gastar un byte.
    #[test]
    fn una_foto_de_interior_no_pasa_las_reglas() {
        let c = candidata_de(
            4000,
            3000,
            &["Category:Interior of buildings in Lugo".to_string()],
            Some("CC BY-SA 4.0"),
        );
        assert!(matches!(Reglas::por_defecto().evaluar(&c), Veredicto::Fuera(_)));
    }

    #[test]
    fn una_fachada_normal_si_pasa() {
        let c = candidata_de(2048, 1536, &["Category:Streets in Lugo".to_string()], Some("CC BY-SA 4.0"));
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    /// Commons no declara precisión de geoetiqueta, y `None` NO es motivo de
    /// descarte: es «no lo dijo», no «lo dijo mal».
    #[test]
    fn sin_precision_declarada_no_se_descarta() {
        let c = candidata_de(2048, 1536, &[], None);
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }
}
