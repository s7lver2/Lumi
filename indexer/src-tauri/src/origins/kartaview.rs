//! KartaView.
//!
//! El spec §4 dejaba abierta la posibilidad de usar su capa de cobertura «si
//! hay un endpoint de teselas estable». No lo hay documentado: lo único firme
//! es `nearby-photos`, que es por punto. Así que KartaView cae al lenguaje de
//! MUESTREO igual que Google, y en el mapa se pinta como sombreado de tesela.
//!
//! El host es `api.openstreetcam.org`, el dominio antiguo que sigue sirviendo:
//! `kartaview.org` devuelve el armazón de su aplicación para rutas arbitrarias
//! en vez de redirigir al nodo de almacenamiento, así que no vale para bajar.

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

const HOST: &str = "https://api.openstreetcam.org";
const RADIO_M: u32 = 20;

#[derive(Debug, Deserialize)]
struct FotoKv {
    id: String,
    heading: Option<String>,
    /// Ruta relativa al host, que redirige al nodo real de almacenamiento.
    name: String,
    date_added: Option<String>,
    username: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RespuestaKv {
    #[serde(rename = "currentPageItems", default)]
    items: Vec<FotoKv>,
}

pub struct KartaView {
    ctx: Ctx,
}

impl KartaView {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 4, 2) }
    }

    async fn cerca_de(&self, p: Punto) -> Result<Vec<FotoKv>> {
        let _g = self.ctx.limitador.permiso().await;
        let cuerpo = format!("lat={}&lng={}&radius={RADIO_M}", p.lat, p.lng);
        let r = self
            .ctx
            .cliente
            .post(format!("{HOST}/1.0/list/nearby-photos/"))
            .header("Content-Type", "application/x-www-form-urlencoded")
            .body(cuerpo)
            .send()
            .await?;
        if !r.status().is_success() {
            anyhow::bail!("KartaView respondió {}", r.status());
        }
        Ok(r.json::<RespuestaKv>().await?.items)
    }
}

#[async_trait]
impl OrigenDeRed for KartaView {
    fn id(&self) -> &'static str {
        "kartaview"
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

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let puntos = puntos_de_tesela(&self.ctx, tesela).await?;
        if puntos.is_empty() {
            return Ok(Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 });
        }
        let muestra = muestra_para_sondeo(&puntos);
        let mut encontradas = 0u32;
        for p in &muestra {
            encontradas += self.cerca_de(*p).await.unwrap_or_default().len() as u32;
        }
        let estimadas = extrapolar(encontradas, muestra.len(), puntos.len());
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(estimadas), estimadas })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut vistas = std::collections::HashSet::new();
        for p in puntos_de_tesela(&self.ctx, tesela).await? {
            for f in self.cerca_de(p).await.unwrap_or_default() {
                // Dos puntos a 20 m devuelven la misma foto. Sin esto, la misma
                // imagen entraría dos veces en el índice.
                if !vistas.insert(f.id.clone()) {
                    continue;
                }
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let url = format!("{HOST}/{}", f.name);
                let ruta = match self.ctx.bajar_imagen(&url, &format!("kv-{}.jpg", f.id)).await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("kartaview {}: {e}", f.id);
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "kartaview",
                    id_origen: f.id.clone(),
                    ruta,
                    lat: p.lat,
                    lng: p.lng,
                    rumbo: f.heading.as_deref().and_then(|h| h.parse().ok()),
                    capturada_en: f.date_added.clone().map(|d| d.replace(' ', "T") + "Z"),
                    atribucion: Atribucion {
                        autor: f.username.clone().unwrap_or_else(|| "KartaView".into()),
                        url: format!("https://kartaview.org/details/{}", f.id),
                        licencia: "CC BY-SA 4.0".into(),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}
