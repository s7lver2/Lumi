//! El cenital: teselas raster de Mapbox Satellite.
//!
//! No tiene sonda porque no la necesita: la cobertura es global, y decir «hay
//! satélite en todas partes» no informa de nada. Por eso tampoco se pinta en el
//! mapa de disponibilidad.
//!
//! Se baja a z17 con `@2x`, que da ~0,6 m/px: suficiente para emparejar una
//! azotea o el trazado de una calle, y 64 peticiones por tesela z14 en vez de
//! las 256 que costaría z18.
//!
//! La clave es la MISMA que la del mapa: es la misma cuenta y la misma cuota.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use lumi_index::tiles::{bbox_de_tesela, Z};

use super::{Ctx, OrigenDeRed};

/// El único sitio de todo el 7b donde aparece otro zoom, y no sale de aquí.
pub const Z_RASTER: u8 = 17;
/// 4^(Z_RASTER - Z).
pub const POR_TESELA: u32 = 64;

/// Las teselas z17 contenidas en una z14, como `(z, x, y)`.
pub fn subteselas(qk: &str) -> Vec<(u8, u32, u32)> {
    let (mut x, mut y) = (0u32, 0u32);
    for c in qk.chars() {
        let d = c as u32 - '0' as u32;
        x = (x << 1) | (d & 1);
        y = (y << 1) | ((d >> 1) & 1);
    }
    let salto = Z_RASTER - Z;
    let lado = 1u32 << salto;
    let (bx, by) = (x << salto, y << salto);
    let mut fuera = Vec::with_capacity((lado * lado) as usize);
    for dy in 0..lado {
        for dx in 0..lado {
            fuera.push((Z_RASTER, bx + dx, by + dy));
        }
    }
    fuera
}

/// El centro geográfico de una tesela `(z, x, y)`.
pub fn centro(z: u8, x: u32, y: u32) -> (f64, f64) {
    let escala = (1u32 << z) as f64;
    let lng = (x as f64 + 0.5) / escala * 360.0 - 180.0;
    let n = std::f64::consts::PI * (1.0 - 2.0 * (y as f64 + 0.5) / escala);
    (n.sinh().atan().to_degrees(), lng)
}

pub struct MapboxSatelite {
    ctx: Ctx,
}

impl MapboxSatelite {
    pub fn nuevo(clave: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(clave), stage, 16, 8) }
    }

    /// Mapbox solo acepta la clave por parámetro de consulta. Por eso todo lo
    /// que se registre pasa antes por `keys::redactar`.
    pub fn url_raster(&self, z: u8, x: u32, y: u32) -> String {
        format!(
            "https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token={}",
            self.ctx.clave.as_deref().unwrap_or_default()
        )
    }
}

#[async_trait]
impl OrigenDeRed for MapboxSatelite {
    fn id(&self) -> &'static str {
        "mapbox-satelite"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::PorUnidad { usd_por_mil: 0.75 }
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::SoloLocal
    }

    /// Sin sonda y sin red: la cobertura es global. Devolver `Siempre` es lo
    /// que permite estimar sus unidades sin pedir nada a nadie.
    async fn sondear(&self, _tesela: &str) -> Result<Disponibilidad> {
        Ok(Disponibilidad::Siempre { unidades: POR_TESELA })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let _ = bbox_de_tesela(tesela); // valida que el quadkey es legible
        let mut fuera = Vec::new();
        for (z, x, y) in subteselas(tesela) {
            if tope.gastar(&self.tarifa(), 1).is_err() {
                return Ok(fuera);
            }
            let url = self.url_raster(z, x, y);
            let ruta = match self.ctx.bajar_imagen(&url, &format!("mbx-{z}-{x}-{y}.jpg")).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("mapbox {z}/{x}/{y}: {e}");
                    continue;
                }
            };
            let (lat, lng) = centro(z, x, y);
            fuera.push(Captura {
                fuente: "mapbox-satelite",
                id_origen: format!("{z}/{x}/{y}"),
                ruta,
                lat,
                lng,
                // Una cenital no mira a ningún sitio: mira hacia abajo.
                rumbo: None,
                capturada_en: None,
                atribucion: Atribucion {
                    autor: "Mapbox / Maxar".into(),
                    url: "https://www.mapbox.com/about/maps/".into(),
                    licencia: "Mapbox ToS — no redistribuible".into(),
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
    fn una_tesela_z14_se_parte_en_sesenta_y_cuatro_de_z17() {
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        let hijas = subteselas(&qk);
        // 4^(17-14) = 64. Es el número que sale en la estimación: 98 teselas
        // z14 dan 6272 peticiones raster.
        assert_eq!(hijas.len(), POR_TESELA as usize);
        assert_eq!(hijas.len(), 64);
        assert!(hijas.iter().all(|(z, _, _)| *z == Z_RASTER));
        let unicas: std::collections::HashSet<_> = hijas.iter().collect();
        assert_eq!(unicas.len(), 64, "ninguna se repite");
    }

    #[test]
    fn el_centro_de_una_subtesela_cae_dentro_de_la_tesela_madre() {
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        for (z, x, y) in subteselas(&qk) {
            let (lat, lng) = centro(z, x, y);
            assert_eq!(lumi_index::tiles::quadkey(lat, lng), qk, "{z}/{x}/{y} se salió");
        }
    }

    #[test]
    fn la_clave_va_en_la_consulta_pero_no_llega_al_log() {
        let m = MapboxSatelite::nuevo("pk.SECRETO".into(), std::path::PathBuf::from("/tmp"));
        let u = m.url_raster(17, 1000, 2000);
        assert!(u.contains("pk.SECRETO"), "Mapbox solo acepta la clave por consulta");
        assert!(!crate::keys::redactar(&u).contains("pk.SECRETO"), "pero al log no llega");
    }
}
