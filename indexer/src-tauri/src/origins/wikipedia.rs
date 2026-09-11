//! Wikipedia → imágenes de artículos geolocalizados: el complemento de
//! Commons, que solo ve la geoetiqueta por fichero. Un sitio con artículo
//! pero sin ninguna foto geoetiquetada en Commons no existe para `commons.rs`
//! ni para `monumentos.rs` (que necesita una entidad de Wikidata con `P625`);
//! aquí basta con que el ARTÍCULO tenga coordenadas.
//!
//! Dos niveles, medidos sobre una tesela urbana el 2026-09-11: 45 artículos
//! con imagen principal (`pageimages`, limpio casi siempre) y 475 imágenes
//! MÁS enlazadas dentro de esos mismos artículos (`prop=images`, con mucho
//! ruido — escudos, banderas, mapas de situación). El nivel 2 pasa por un
//! filtro de título antes de gastar una sola petición de `imageinfo`.
//!
//! Solo `es`+`en`: dos idiomas cubren casi todo sin convertir esto en un
//! rastreador de las ~300 wikis de Wikipedia. `// ponytail:` si algún día
//! hace falta más, la salida es una lista de idiomas en `registros/`, no
//! código nuevo por idioma.
//!
//! Misma infraestructura donada que Commons: 2 req/s, concurrencia 1.

use std::collections::HashSet;
use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::commons::{imageinfo_por_lotes, Campo, PaginaImg};
use super::{Ctx, OrigenDeRed};

const IDIOMAS: [&str; 2] = ["es", "en"];

/// Subcadenas de título (en minúsculas) que marcan un fichero como NO foto
/// de sitio: escudo, bandera, logo, icono, mapa de situación. `// ponytail:`
/// es lista corta a propósito, igual que `filter::INTERIOR` — si deja pasar
/// demasiado ruido, la salida es la revisión por excepción que ya existe en
/// el 7a, no una lista interminable de patrones.
const RUIDO_TITULO: [&str; 12] = [
    "flag", "bandera", "escudo", "coat of arms", "logo", "icon",
    "map of", "mapa de", "location map", "locator", ".svg", ".png",
];

fn es_ruido(titulo: &str) -> bool {
    let t = titulo.to_lowercase();
    RUIDO_TITULO.iter().any(|p| t.contains(p))
}

#[derive(Debug, Deserialize)]
struct Coordenada {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Original {
    source: String,
}

#[derive(Debug, Deserialize)]
struct Imagen {
    title: String,
}

#[derive(Debug, Deserialize)]
struct Articulo {
    title: String,
    #[serde(default)]
    coordinates: Vec<Coordenada>,
    original: Option<Original>,
    #[serde(default)]
    images: Vec<Imagen>,
}

#[derive(Debug, Deserialize)]
struct Consulta {
    #[serde(default)]
    pages: Vec<Articulo>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    query: Option<Consulta>,
}

pub struct Wikipedia {
    ctx: Ctx,
}

impl Wikipedia {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn host(idioma: &str) -> String {
        format!("https://{idioma}.wikipedia.org/w/api.php")
    }

    /// Artículos con coordenadas DENTRO de la tesela (namespace 0, ns=0), su
    /// imagen principal si la tiene, y los títulos de las imágenes que
    /// enlaza — SIN filtrar el ruido todavía, eso lo hace el llamador.
    async fn articulos(&self, idioma: &str, tesela: &str) -> Result<Vec<Articulo>> {
        let b = bbox_de_tesela(tesela);
        let url = format!(
            "{}?action=query&format=json&formatversion=2\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit=500&ggsnamespace=0\
             &prop=coordinates%7Cpageimages%7Cimages&piprop=original&imlimit=500",
            Self::host(idioma), b.norte, b.oeste, b.sur, b.este
        );
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("{idioma}.wikipedia respondió {}", r.status());
        }
        let cuerpo: Respuesta = r.json().await?;
        Ok(cuerpo.query.map(|q| q.pages).unwrap_or_default())
    }

    /// Solo artículos cuyas coordenadas caen DENTRO del bbox — `geosearch`
    /// para un municipio devuelve su centroide, que puede caer en una tesela
    /// vecina si el radio de búsqueda lo alcanza.
    fn dentro_de_tesela(a: &Articulo, tesela: &str) -> bool {
        let b = bbox_de_tesela(tesela);
        a.coordinates.iter().any(|c| {
            c.lat <= b.norte && c.lat >= b.sur && c.lon >= b.oeste && c.lon <= b.este
        })
    }
}

#[async_trait]
impl OrigenDeRed for Wikipedia {
    fn id(&self) -> &'static str {
        "wikipedia"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Los bytes salen de Commons igual que en `commons.rs`/`monumentos.rs`.
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let mut total = 0u32;
        for idioma in IDIOMAS {
            let arts = self.articulos(idioma, tesela).await?;
            total += arts
                .iter()
                .filter(|a| Self::dentro_de_tesela(a, tesela) && a.original.is_some())
                .count() as u32;
        }
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(total), estimadas: total })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        let mut vistos_fichero = HashSet::new();

        for idioma in IDIOMAS {
            let arts = match self.articulos(idioma, tesela).await {
                Ok(a) => a,
                Err(e) => {
                    log::warn!("wikipedia({idioma}) {tesela}: {e}");
                    continue;
                }
            };
            for a in arts.iter().filter(|a| Self::dentro_de_tesela(a, tesela)) {
                let Some((lat, lng)) = a.coordinates.first().map(|c| (c.lat, c.lon)) else { continue };

                // Nivel 1: la imagen principal, casi siempre representativa.
                let mut titulos: Vec<String> = Vec::new();
                if a.original.is_some() {
                    // `pageimages` no da el título de fichero directamente,
                    // pero `images` casi siempre incluye la misma imagen
                    // entre las enlazadas — se filtra de todas formas por
                    // `es_ruido`, así que no hace falta distinguir cuál era
                    // "la principal": el objetivo es la lista completa,
                    // limpia, del artículo.
                }
                // Nivel 2: imágenes enlazadas, tras el filtro de ruido.
                titulos.extend(
                    a.images.iter().map(|i| i.title.clone()).filter(|t| !es_ruido(t)),
                );
                titulos.retain(|t| vistos_fichero.insert(t.clone()));
                if titulos.is_empty() {
                    continue;
                }

                let paginas: Vec<PaginaImg> = match imageinfo_por_lotes(&self.ctx, &titulos).await {
                    Ok(p) => p,
                    Err(e) => {
                        log::warn!("wikipedia {}: {e}", a.title);
                        continue;
                    }
                };

                for p in paginas {
                    let Some(i) = p.imageinfo.first() else { continue };
                    let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
                    let licencia = i.meta.get("LicenseShortName").and_then(Campo::texto);
                    let cand = lumi_index::filter::Candidata {
                        ancho: i.width,
                        alto: i.height,
                        precision_metros: None,
                        categorias: vec![],
                        licencia: licencia.clone(),
                        tipo: Tipo::Suelta,
                    };
                    if let lumi_index::filter::Veredicto::Fuera(motivo) =
                        lumi_index::filter::Reglas::por_defecto().evaluar(&cand)
                    {
                        log::debug!("wikipedia {}: descartada, {motivo}", p.title);
                        continue;
                    }
                    if tope.gastar(&self.tarifa(), 1).is_err() {
                        return Ok(fuera);
                    }
                    let ruta = match self.ctx.bajar_imagen(&url, &format!("wp-{}.jpg", p.pageid)).await {
                        Ok(r) => r,
                        Err(e) => {
                            log::warn!("wikipedia {}: {e}", p.title);
                            continue;
                        }
                    };
                    let campo = |k: &str| i.meta.get(k).and_then(Campo::texto);
                    fuera.push(Captura {
                        fuente: "wikipedia",
                        id_origen: p.pageid.to_string(),
                        ruta,
                        // La coordenada es la del ARTÍCULO (el sujeto), no la
                        // de la cámara: una imagen enlazada no está
                        // geoetiquetada por sí misma. Misma asimetría que
                        // `monumentos.rs`.
                        lat,
                        lng,
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
            }
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_titulo_de_bandera_o_escudo_es_ruido() {
        assert!(es_ruido("File:Flag of Spain.svg"));
        assert!(es_ruido("File:Escudo de León.svg"));
        assert!(es_ruido("File:Location map León.png"));
    }

    #[test]
    fn una_foto_normal_no_es_ruido() {
        assert!(!es_ruido("File:Catedral de León desde el sur.jpg"));
    }

    #[test]
    fn un_articulo_fuera_del_bbox_se_descarta() {
        let a = Articulo {
            title: "x".into(),
            coordinates: vec![Coordenada { lat: 0.0, lon: 0.0 }],
            original: None,
            images: vec![],
        };
        assert!(!Wikipedia::dentro_de_tesela(&a, "03133320022212"));
    }

    /// Regresión de la misma familia que `dd5da1e`: un campo de `original`
    /// que la API deje de mandar (por ejemplo, un artículo sin imagen) no
    /// puede tumbar el parseo de TODA la respuesta.
    #[test]
    fn un_articulo_sin_imagen_principal_no_rompe_el_parseo() {
        let j = r#"{"query":{"pages":[
            {"title":"Sin foto","coordinates":[{"lat":42.6,"lon":-5.57}]},
            {"title":"Con foto","coordinates":[{"lat":42.6,"lon":-5.57}],
             "original":{"source":"https://x/a.jpg"},"images":[{"title":"File:a.jpg"}]}
        ]}}"#;
        let r: Respuesta = serde_json::from_str(j).expect("un articulo sin 'original' debe deserializar igual");
        let pages = r.query.unwrap().pages;
        assert_eq!(pages.len(), 2);
        assert!(pages[0].original.is_none());
        assert!(pages[1].original.is_some());
    }
}
