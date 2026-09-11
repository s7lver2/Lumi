//! Geograph: ~7 millones de fotos CC BY-SA de Reino Unido e Irlanda, una foto
//! por cuadrícula de 1 km, tomadas a propósito para documentar el territorio.
//! Es la mejor cobertura rural de las islas y no la cubre ningún otro origen
//! de este módulo.
//!
//! Sin clave (verificado el 2026-09-11: `key=` vacío en la query funciona).
//! Fuera de las islas, cero peticiones: el bbox de cobertura decide antes de
//! salir a la red, igual que `wms_orto::servicio_para`.
//!
//! El `thumb` de la API NO sirve, y la suposición contraria costó que este
//! origen no bajara nada: medido el 2026-09-11, `..._120x120.jpg` devuelve
//! imágenes de 120×68 y 95×120, no «~640 de lado largo» — muy por debajo del
//! `lado_minimo` de 640 de `Reglas`, así que todas se descartaban.
//!
//! La imagen de verdad se obtiene del MISMO nombre de fichero sustituyendo el
//! sufijo de tamaño (ver `url_original`), sin scrapear el HTML de `link`:
//! `_120x120.jpg` → `_original.jpg` da entre 1600 y 5600 px de lado. Como la
//! API no publica las dimensiones, el filtro de tamaño se aplica DESPUÉS de
//! bajar el fichero, leyéndolas del propio JPEG — es aceptable porque este
//! origen es gratis y no hay cuota que proteger; en uno de pago habría que
//! pagar por saberlo, y entonces sí valdría la pena otra estrategia.
//!
//! 2 req/s, concurrencia 1: proyecto voluntario, servidor pequeño.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{centro_y_radio_km, Ctx, OrigenDeRed};

const API: &str = "https://api.geograph.org.uk/syndicator.php";
/// `[[oeste, sur], [este, norte]]`: Reino Unido + Irlanda con margen.
const COBERTURA: [[f64; 2]; 2] = [[-11.0, 49.5], [2.0, 61.0]];

#[derive(Debug, Clone, Deserialize)]
struct Item {
    title: String,
    author: Option<String>,
    link: Option<String>,
    lat: f64,
    #[serde(rename = "long")]
    lng: f64,
    thumb: Option<String>,
    licence: Option<String>,
    #[serde(rename = "imageTaken")]
    image_taken: Option<String>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    #[serde(default)]
    items: Vec<Item>,
}

/// `https://s1.geograph.org.uk/geophotos/08/39/45/8394501_2dbaeb9d_120x120.jpg`
/// → `..._original.jpg`. Se sustituye el sufijo de tamaño, que es lo único
/// que separa la miniatura del original en la ruta del CDN. Si el nombre no
/// trae sufijo reconocible se devuelve tal cual: mejor bajar lo que haya que
/// inventarse una URL que dé 404.
fn url_original(thumb: &str) -> String {
    match thumb.rfind('_') {
        // El sufijo es la última pieza antes de la extensión, y siempre tiene
        // forma `<ancho>x<alto>`: comprobarlo evita destrozar un nombre que
        // simplemente lleve guiones bajos.
        Some(i) if thumb[i + 1..].split('.').next().is_some_and(|s| {
            s.split_once('x').is_some_and(|(a, b)| {
                !a.is_empty() && !b.is_empty() && a.chars().all(|c| c.is_ascii_digit())
                    && b.chars().all(|c| c.is_ascii_digit())
            })
        }) =>
        {
            let ext = thumb.rsplit_once('.').map(|(_, e)| e).unwrap_or("jpg");
            format!("{}_original.{ext}", &thumb[..i])
        }
        _ => thumb.to_string(),
    }
}

fn dentro_de_islas(lat: f64, lng: f64) -> bool {
    let [[oeste, sur], [este, norte]] = COBERTURA;
    lng >= oeste && lng <= este && lat >= sur && lat <= norte
}

pub struct Geograph {
    ctx: Ctx,
}

impl Geograph {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    async fn items(&self, tesela: &str) -> Result<Vec<Item>> {
        let b = bbox_de_tesela(tesela);
        let (lat, lng) = ((b.norte + b.sur) / 2.0, (b.oeste + b.este) / 2.0);
        if !dentro_de_islas(lat, lng) {
            return Ok(vec![]);
        }
        let (_, _, radio_km) = centro_y_radio_km(b);
        let url = format!("{API}?key=&format=JSON&q=&lat={lat}&lon={lng}&distance={radio_km}&perpage=100");
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Geograph respondió {}", r.status());
        }
        let cuerpo: Respuesta = r.json().await?;
        // `distance` es un radio: devuelve de más. Se recorta al bbox exacto.
        Ok(cuerpo
            .items
            .into_iter()
            .filter(|i| i.lat <= b.norte && i.lat >= b.sur && i.lng >= b.oeste && i.lng <= b.este)
            .collect())
    }
}

#[async_trait]
impl OrigenDeRed for Geograph {
    fn id(&self) -> &'static str {
        "geograph"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Casi íntegramente CC BY-SA, pero se lee `licencia` por foto — no se
        // asume, ver `descargar`.
        Redistribucion::Libre { licencia: "libre (Geograph, mayormente CC BY-SA)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.items(tesela).await?.len() as u32;
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for it in self.items(tesela).await? {
            let Some(thumb) = &it.thumb else { continue };
            // Lo barato primero: la licencia se conoce SIN bajar nada, así que
            // una -ND/-NC se descarta antes de gastar una petición. El tamaño
            // no se puede juzgar aquí (la API no lo publica) y se comprueba
            // más abajo, con el fichero ya en disco.
            let cand_licencia = Candidata {
                ancho: u32::MAX,
                alto: u32::MAX,
                precision_metros: None,
                categorias: vec![],
                licencia: it.licence.clone(),
                tipo: Tipo::Suelta,
            };
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand_licencia) {
                log::debug!("geograph {}: descartada, {motivo}", it.title);
                continue;
            }
            if tope.gastar(&self.tarifa(), 1).is_err() {
                return Ok(fuera);
            }
            let nombre = format!(
                "geo-{}.jpg",
                it.link.as_deref().and_then(|l| l.rsplit('/').next()).unwrap_or(&it.title)
            );
            let ruta = match self.ctx.bajar_imagen(&url_original(thumb), &nombre).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("geograph {}: {e}", it.title);
                    continue;
                }
            };
            // Ahora sí se puede juzgar el tamaño: las dimensiones se leen del
            // fichero, que `bajar_imagen` ya ha verificado que decodifica.
            // Una foto que no llega al mínimo se borra en vez de dejarla
            // ocupando el directorio de paso sin que nada vaya a usarla.
            match image::image_dimensions(&ruta) {
                Ok((ancho, alto)) => {
                    let cand = Candidata { ancho, alto, ..cand_licencia };
                    if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                        log::debug!("geograph {}: descartada tras bajarla, {motivo}", it.title);
                        let _ = std::fs::remove_file(&ruta);
                        continue;
                    }
                }
                Err(e) => {
                    log::warn!("geograph {}: no se pudieron leer sus dimensiones: {e}", it.title);
                    let _ = std::fs::remove_file(&ruta);
                    continue;
                }
            }
            fuera.push(Captura {
                fuente: "geograph",
                id_origen: it.link.clone().unwrap_or_else(|| it.title.clone()),
                ruta,
                lat: it.lat,
                lng: it.lng,
                rumbo: None,
                capturada_en: it.image_taken.clone(),
                atribucion: Atribucion {
                    autor: it.author.clone().unwrap_or_else(|| "Geograph contributor".into()),
                    url: it.link.clone().unwrap_or_else(|| "https://www.geograph.org.uk".into()),
                    licencia: it.licence.clone().unwrap_or_else(|| "CC BY-SA 2.0".into()),
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

    /// El `thumb` de la API mide 120 px de lado: bajarlo era garantizar que
    /// `lado_minimo` (640) descartara todas las fotos de este origen. El
    /// original se pide sustituyendo el sufijo de tamaño.
    #[test]
    fn el_sufijo_de_tamano_se_sustituye_por_original() {
        assert_eq!(
            url_original("https://s1.geograph.org.uk/geophotos/08/39/45/8394501_2dbaeb9d_120x120.jpg"),
            "https://s1.geograph.org.uk/geophotos/08/39/45/8394501_2dbaeb9d_original.jpg"
        );
    }

    /// Un nombre sin sufijo de tamaño no se toca: inventarle uno daría un 404.
    #[test]
    fn un_nombre_sin_sufijo_de_tamano_se_deja_como_esta() {
        let u = "https://s1.geograph.org.uk/geophotos/08/39/45/8394501_2dbaeb9d.jpg";
        assert_eq!(url_original(u), u);
    }

    #[test]
    fn londres_esta_dentro_de_la_cobertura() {
        assert!(dentro_de_islas(51.5, -0.12));
    }

    #[test]
    fn leon_no_esta_dentro_de_la_cobertura() {
        assert!(!dentro_de_islas(42.6, -5.57));
    }

    /// Un item fuera de la tesela exacta (dentro del radio de búsqueda pero
    /// fuera del bbox) se filtra tras la respuesta.
    #[test]
    fn un_item_fuera_del_bbox_no_pasa_el_recorte() {
        let b = lumi_index::tiles::Bbox { oeste: -1.0, sur: 50.0, este: -0.5, norte: 50.5 };
        let dentro = |lat: f64, lng: f64| lat <= b.norte && lat >= b.sur && lng >= b.oeste && lng <= b.este;
        assert!(dentro(50.2, -0.7));
        assert!(!dentro(50.2, 2.0));
    }
}
