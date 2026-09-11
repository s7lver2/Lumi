//! OpenAerialMap: aérea libre de alta resolución donde la haya. Cobertura
//! testimonial en Europa (0 resultados medidos en una tesela urbana de León
//! el 2026-09-11), pero donde existe es la única aérea abierta a esa
//! resolución — verificado en Dar es Salaam: `gsd` de 2,1 cm.
//!
//! Se elige la imagen de MENOR `gsd` (mayor resolución) que cubra la tesela:
//! una tesela no necesita veinte ortofotos del mismo sitio, necesita la mejor.
//!
//! El `license` de nivel superior de la API viene `null`; la licencia real
//! vive en `properties`. Sin licencia legible, NO se descarga — un origen
//! abierto sin licencia declarada no es publicable, y anunciar
//! `Redistribucion::Libre` sin verificarlo por imagen mentiría.
//!
//! Última fase a propósito: es el único de los orígenes de este spec que
//! puede quedarse sin implementar sin que el resultado se resienta.
//!
//! 4 req/s, concurrencia 2: API sobre S3, aguanta más que las de MediaWiki.

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

const API: &str = "https://api.openaerialmap.org/meta";

#[derive(Debug, Clone, Deserialize)]
struct Propiedades {
    license: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct Resultado {
    uuid: String,
    gsd: Option<f64>,
    #[serde(default)]
    properties: Option<Propiedades>,
    /// La URL de la imagen no es un campo fijo documentado de forma estable
    /// en `/meta`; se resuelve por convención `.../<uuid>.tif` cuando el
    /// campo no está presente. Se acepta explícito si la API lo trae.
    #[serde(default)]
    tms: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Meta {
    found: u32,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    meta: Meta,
    #[serde(default)]
    results: Vec<Resultado>,
}

pub struct OpenAerialMap {
    ctx: Ctx,
}

impl OpenAerialMap {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 4, 2) }
    }

    async fn buscar(&self, tesela: &str) -> Result<Respuesta> {
        let b = bbox_de_tesela(tesela);
        let url = format!("{API}?bbox={},{},{},{}&limit=20", b.oeste, b.sur, b.este, b.norte);
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("OpenAerialMap respondió {}", r.status());
        }
        Ok(r.json().await?)
    }

    /// La de menor `gsd` (mayor resolución) con licencia legible.
    fn mejor(resultados: &[Resultado]) -> Option<&Resultado> {
        resultados
            .iter()
            .filter(|r| r.properties.as_ref().and_then(|p| p.license.as_deref()).is_some())
            .min_by(|a, b| a.gsd.unwrap_or(f64::MAX).total_cmp(&b.gsd.unwrap_or(f64::MAX)))
    }
}

#[async_trait]
impl OrigenDeRed for OpenAerialMap {
    fn id(&self) -> &'static str {
        "openaerialmap"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "según imagen (ver atribución)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let r = self.buscar(tesela).await?;
        Ok(Disponibilidad::Siempre { unidades: if Self::mejor(&r.results).is_some() { 1 } else { 0 } })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let r = self.buscar(tesela).await?;
        let Some(mejor) = Self::mejor(&r.results) else { return Ok(vec![]) };
        let Some(url) = &mejor.tms else {
            log::debug!("openaerialmap {}: sin URL de imagen resoluble, se omite", mejor.uuid);
            return Ok(vec![]);
        };
        if tope.gastar(&self.tarifa(), 1).is_err() {
            return Ok(vec![]);
        }
        let ruta = self.ctx.bajar_imagen(url, &format!("oam-{}.jpg", mejor.uuid)).await?;
        let b = bbox_de_tesela(tesela);
        let lat = (b.norte + b.sur) / 2.0;
        let lng = (b.oeste + b.este) / 2.0;
        let licencia = mejor
            .properties
            .as_ref()
            .and_then(|p| p.license.clone())
            .unwrap_or_else(|| "desconocida".into());
        Ok(vec![Captura {
            fuente: "openaerialmap",
            id_origen: mejor.uuid.clone(),
            ruta,
            lat,
            lng,
            rumbo: None,
            capturada_en: None,
            atribucion: Atribucion {
                autor: "OpenAerialMap contributor".into(),
                url: format!("https://map.openaerialmap.org/#/{},{}/12/{}", lng, lat, mejor.uuid),
                licencia,
            },
            unidades: 1,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn con_licencia(uuid: &str, gsd: f64) -> Resultado {
        Resultado {
            uuid: uuid.into(),
            gsd: Some(gsd),
            properties: Some(Propiedades { license: Some("CC-BY-4.0".into()) }),
            tms: Some(format!("https://x/{uuid}.tif")),
        }
    }

    fn sin_licencia(uuid: &str) -> Resultado {
        Resultado { uuid: uuid.into(), gsd: Some(0.01), properties: Some(Propiedades { license: None }), tms: None }
    }

    #[test]
    fn se_elige_la_de_menor_gsd() {
        let r = vec![con_licencia("a", 0.1), con_licencia("b", 0.02)];
        assert_eq!(OpenAerialMap::mejor(&r).unwrap().uuid, "b");
    }

    #[test]
    fn una_imagen_sin_licencia_legible_no_se_elige_aunque_tenga_mejor_resolucion() {
        let r = vec![sin_licencia("mejor-pero-sin-licencia"), con_licencia("peor-pero-con-licencia", 0.5)];
        assert_eq!(OpenAerialMap::mejor(&r).unwrap().uuid, "peor-pero-con-licencia");
    }

    #[test]
    fn sin_ningun_resultado_con_licencia_no_hay_mejor() {
        let r = vec![sin_licencia("x")];
        assert!(OpenAerialMap::mejor(&r).is_none());
    }
}
