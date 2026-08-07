//! Google Street View. El único origen de calle que cuesta dinero, y el que
//! obliga a que exista toda la maquinaria de presupuesto.
//!
//! Dos endpoints, y la diferencia entre ellos es lo que hace que sondear salga
//! gratis: el de METADATOS no cobra y dice si hay panorámica en un punto; el
//! ESTÁTICO cobra 7,00 $/1000 y devuelve el píxel. Se sondea con el primero y
//! se descarga con el segundo, y en el libro de gasto solo entra el segundo.
//!
//! La clave va por parámetro de consulta porque Google no ofrece cabecera para
//! estos dos endpoints. No es un descuido: es lo único que admite. Por eso toda
//! URL pasa por `keys::redactar` antes de tocar un log.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::Punto;
use serde::Deserialize;

use super::calles::{extrapolar, muestra_para_sondeo, puntos_de_tesela};
use super::{Ctx, OrigenDeRed};

const METADATOS: &str = "https://maps.googleapis.com/maps/api/streetview/metadata";
const ESTATICO: &str = "https://maps.googleapis.com/maps/api/streetview";
/// Los cuatro rumbos de la v1: cubren los 360° sin solape con el campo de
/// visión por defecto de 90°.
const RUMBOS: [u32; 4] = [0, 90, 180, 270];
const TAMANO: &str = "640x640";

#[derive(Debug, Deserialize)]
struct Meta {
    status: String,
    pano_id: Option<String>,
    date: Option<String>,
}

pub struct Google {
    ctx: Ctx,
}

impl Google {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 10, 4) }
    }

    fn clave(&self) -> &str {
        self.ctx.clave.as_deref().unwrap_or_default()
    }

    /// GRATUITO. Nunca se apunta en el libro de gasto.
    async fn metadatos(&self, p: Punto) -> Option<Meta> {
        let url = format!("{METADATOS}?location={},{}&key={}", p.lat, p.lng, self.clave());
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await.ok()?;
        let m: Meta = r.json().await.ok()?;
        (m.status == "OK").then_some(m)
    }
}

#[async_trait]
impl OrigenDeRed for Google {
    fn id(&self) -> &'static str {
        "google"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::PorUnidad { usd_por_mil: 7.00 }
    }
    fn redistribucion(&self) -> Redistribucion {
        // Las condiciones de uso no permiten redistribuir estas imágenes. Ni
        // ellas ni sus vectores salen en un paquete publicado.
        Redistribucion::SoloLocal
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let puntos = puntos_de_tesela(&self.ctx, tesela).await?;
        if puntos.is_empty() {
            return Ok(Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 });
        }
        let muestra = muestra_para_sondeo(&puntos);
        let mut con_pano = 0u32;
        for p in &muestra {
            if self.metadatos(*p).await.is_some() {
                con_pano += 1;
            }
        }
        // Cada punto con panorámica costará cuatro imágenes al descargar, y es
        // ese número —no el de puntos— el que va a la estimación en euros.
        let cubiertos = extrapolar(con_pano, muestra.len(), puntos.len());
        let estimadas = cubiertos * RUMBOS.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(estimadas), estimadas })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut panos = std::collections::HashSet::new();
        for p in puntos_de_tesela(&self.ctx, tesela).await? {
            let Some(meta) = self.metadatos(p).await else { continue };
            let pano = meta.pano_id.clone().unwrap_or_else(|| format!("{},{}", p.lat, p.lng));
            // Dos puntos a 20 m suelen caer en la MISMA panorámica. Sin esto se
            // pagarían cuatro imágenes por punto en vez de por panorámica: es
            // dinero tirado y material duplicado en el índice.
            if !panos.insert(pano.clone()) {
                continue;
            }
            for rumbo in RUMBOS {
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let url = format!(
                    "{ESTATICO}?size={TAMANO}&location={},{}&heading={rumbo}&key={}",
                    p.lat,
                    p.lng,
                    self.clave()
                );
                let nombre = format!("goo-{pano}-{rumbo}.jpg");
                let ruta = match self.ctx.bajar_imagen(&url, &nombre).await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("google {pano}/{rumbo}: {e}");
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "google",
                    id_origen: format!("{pano}:{rumbo}"),
                    ruta,
                    lat: p.lat,
                    lng: p.lng,
                    rumbo: Some(rumbo as f32),
                    capturada_en: meta.date.clone().map(|d| format!("{d}-01T00:00:00Z")),
                    atribucion: Atribucion {
                        autor: "Google".into(),
                        url: format!(
                            "https://www.google.com/maps/@?api=1&map_action=pano&pano={pano}"
                        ),
                        licencia: "Google Maps Platform ToS — no redistribuible".into(),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}
