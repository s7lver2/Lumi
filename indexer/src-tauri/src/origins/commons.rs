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

use super::{Ctx, OrigenDeRed};

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
    #[serde(rename = "extmetadata", default)]
    meta: std::collections::HashMap<String, Campo>,
}

#[derive(Debug, Deserialize)]
struct Categoria {
    #[allow(dead_code)]
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
             &prop=imageinfo%7Ccoordinates%7Ccategories&iiprop=url%7Cextmetadata&iiurlwidth=2048\
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
            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("commons {}: {e}", p.title);
                    continue;
                }
            };
            let campo = |k: &str| i.meta.get(k).and_then(|c| c.value.clone());
            // Las categorías viajan en el `id_origen` no: se guardan para que
            // la Task 12 pueda pasarles las reglas. Aquí se dejan en la URL de
            // atribución, que es donde el operador las puede ir a ver.
            let _ = &p.categories;
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
