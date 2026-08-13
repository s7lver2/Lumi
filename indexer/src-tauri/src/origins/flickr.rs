//! Flickr, filtrado a Creative Commons.
//!
//! Es el único origen cuya redistribución va POR IMAGEN: cada foto trae su
//! licencia y hay que arrastrarla y respetarla una a una. Se piden solo los
//! códigos CC que permiten derivados y uso comercial; ND y NC ni se solicitan,
//! y aun así se vuelven a comprobar al sellar — la respuesta de un proveedor no
//! es una garantía.
//!
//! Flickr solo acepta la clave por parámetro de consulta: no ofrece cabecera.
//! Por eso toda URL pasa por `keys::redactar` antes de tocar un log.

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

const API: &str = "https://api.flickr.com/services/rest/";
/// 4 = CC BY, 5 = CC BY-SA, 7 = dominio público, 9 = CC0, 10 = dominio público
/// de EEUU. Se dejan fuera 1, 2, 3 y 6 a propósito: son las NC y las ND.
const LICENCIAS: &str = "4,5,7,9,10";
const POR_PAGINA: u32 = 250;
/// Tope total tras paginar, no por página — Flickr ya limita `per_page` a 250
/// por petición; esto es cuántas páginas se siguen antes de parar. Cuatro
/// páginas es generoso para una tesela de 2,4 km² sin encadenar peticiones
/// sin fin en una zona anormalmente fotografiada.
const LIMITE_TOTAL: u32 = POR_PAGINA * 4;

/// La escala 1..16 de Flickr, en metros aproximados. Solo importan los
/// tramos alrededor del umbral de 100 m del filtro, así que no hace falta
/// una tabla exacta: 16 es calle, 11 ciudad, y por debajo ya no localiza.
/// `None` para 0, que en Flickr significa «no lo dijo».
fn metros_de_accuracy(a: u32) -> Option<f64> {
    match a {
        0 => None,
        16 => Some(30.0),
        14..=15 => Some(80.0),
        12..=13 => Some(300.0),
        _ => Some(5000.0),
    }
}

/// Los metadatos que Flickr ya devuelve, en la forma que el filtro entiende.
fn candidata_de(ancho: u32, alto: u32, tags: &str, licencia: Option<&str>, accuracy: u32) -> Candidata {
    Candidata {
        ancho,
        alto,
        precision_metros: metros_de_accuracy(accuracy),
        // Flickr da las etiquetas separadas por espacio, no una lista.
        categorias: tags.split_whitespace().map(str::to_string).collect(),
        licencia: licencia.map(str::to_string),
        tipo: Tipo::Suelta,
    }
}

pub fn nombre_licencia(id: &str) -> &'static str {
    match id {
        "4" => "CC BY 2.0",
        "5" => "CC BY-SA 2.0",
        "7" => "Dominio público",
        "9" => "CC0 1.0",
        "10" => "Dominio público (EEUU)",
        _ => "desconocida",
    }
}

#[derive(Debug, Deserialize)]
struct FotoFlickr {
    id: String,
    ownername: Option<String>,
    license: Option<String>,
    latitude: Option<String>,
    longitude: Option<String>,
    datetaken: Option<String>,
    url_l: Option<String>,
    #[serde(default)]
    tags: String,
    #[serde(default)]
    width_l: u32,
    #[serde(default)]
    height_l: u32,
    /// 1..16 según Flickr: 16 es nivel de calle, 1 es nivel de país. Se
    /// traduce a metros porque el filtro razona en metros, no en la escala
    /// de un proveedor concreto.
    #[serde(default)]
    accuracy: u32,
}

#[derive(Debug, Deserialize)]
struct PaginaFlickr {
    #[serde(default)]
    photo: Vec<FotoFlickr>,
    #[serde(default)]
    pages: u32,
}

#[derive(Debug, Deserialize)]
struct RespuestaFlickr {
    photos: Option<PaginaFlickr>,
}

pub struct Flickr {
    ctx: Ctx,
}

impl Flickr {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 4, 2) }
    }

    fn url(&self, tesela: &str, pagina: u32) -> String {
        let b = bbox_de_tesela(tesela);
        format!(
            "{API}?method=flickr.photos.search&format=json&nojsoncallback=1\
             &bbox={},{},{},{}&license={LICENCIAS}&per_page={POR_PAGINA}&page={pagina}\
             &extras=geo,license,owner_name,date_taken,tags,url_l&api_key={}",
            b.oeste,
            b.sur,
            b.este,
            b.norte,
            self.ctx.clave.as_deref().unwrap_or_default()
        )
    }

    async fn pagina(&self, tesela: &str, pagina: u32) -> Result<PaginaFlickr> {
        let url = self.url(tesela, pagina);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Flickr respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(r.json::<RespuestaFlickr>().await?.photos.unwrap_or(PaginaFlickr { photo: Vec::new(), pages: 1 }))
    }

    /// Pide la página 1, y si Flickr declara más (`pages > 1`) sigue pidiendo
    /// hasta agotarlas o llegar a `LIMITE_TOTAL`, lo que llegue antes. Antes
    /// se pedía una sola página aunque `pages` dijera que había más.
    async fn fotos(&self, tesela: &str) -> Result<Vec<FotoFlickr>> {
        let primera = self.pagina(tesela, 1).await?;
        let total_paginas = primera.pages.max(1);
        let mut fuera = primera.photo;
        let mut n = 2;
        while n <= total_paginas && fuera.len() < LIMITE_TOTAL as usize {
            fuera.extend(self.pagina(tesela, n).await?.photo);
            n += 1;
        }
        fuera.truncate(LIMITE_TOTAL as usize);
        Ok(fuera)
    }
}

#[async_trait]
impl OrigenDeRed for Flickr {
    fn id(&self) -> &'static str {
        "flickr"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::PorImagen
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.fotos(tesela).await?.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for f in self.fotos(tesela).await? {
            // Sin URL grande o sin coordenadas no hay nada que indexar: es un
            // resultado, se salta y no se reintenta.
            let Some(url) = f.url_l.clone() else { continue };
            let (Some(lat), Some(lng)) = (
                f.latitude.as_deref().and_then(|s| s.parse::<f64>().ok()),
                f.longitude.as_deref().and_then(|s| s.parse::<f64>().ok()),
            ) else {
                continue;
            };
            // Flickr devuelve 0,0 cuando la foto no está geoetiquetada de
            // verdad. Sin esto, media isla del Golfo de Guinea sería Lugo.
            if lat == 0.0 && lng == 0.0 {
                continue;
            }
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            // Igual que en Commons: se decide con lo que el proveedor ya dijo,
            // antes de gastar el ancho de banda.
            let cand = candidata_de(
                f.width_l,
                f.height_l,
                &f.tags,
                f.license.as_deref().map(nombre_licencia),
                f.accuracy,
            );
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("flickr {}: descartada, {motivo}", f.id);
                continue;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("flk-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("flickr {}: {e}", f.id);
                    continue;
                }
            };
            fuera.push(Captura {
                fuente: "flickr",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: None,
                capturada_en: f.datetaken.clone().map(|d| d.replace(' ', "T") + "Z"),
                atribucion: Atribucion {
                    autor: f.ownername.clone().unwrap_or_else(|| "Flickr".into()),
                    url: format!("https://www.flickr.com/photo.gne?id={}", f.id),
                    licencia: nombre_licencia(f.license.as_deref().unwrap_or("")).to_string(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}
