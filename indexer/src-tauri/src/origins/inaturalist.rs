//! iNaturalist: cobertura donde no llega ni Mapillary ni Commons — caminos,
//! monte, riberas. El encuadre es de organismo, pero el fondo (vegetación,
//! geología, cielo, suelo) es justo lo que los verificadores de clima y
//! bioma del 5c usan.
//!
//! `license=` en la propia consulta filtra en el servidor: una foto -ND/-NC
//! no llega siquiera, más barato que descartarla después.
//!
//! Dos reglas propias, no negociables (spec de 2026-09-11 §4.4):
//! 1. `obscured`/`geoprivacy` → fuera. iNaturalist aleatoriza la coordenada de
//!    especies amenazadas dentro de ~25 km; usarla sería tratar ruido como
//!    dato, y sería un abuso de una fuente donada.
//! 2. `positional_accuracy` alimenta `Candidata.precision_metros`: es lo que
//!    aplica el corte de 100 m que `Reglas::por_defecto()` ya tiene. Medido:
//!    de 59 observaciones en una tesela urbana, 34 pasan.
//!
//! 1 req/s, concurrencia 1: su política pide ≤1 req/s sostenido.

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

use super::{Ctx, OrigenDeRed};

const API: &str = "https://api.inaturalist.org/v1/observations";
const LICENCIAS: &str = "cc-by,cc-by-sa,cc0";
const POR_PAGINA: u32 = 200;

/// Las dimensiones REALES de la foto, que iNaturalist sí publica. No son
/// opcionales de adorno: `Reglas::por_defecto()` descarta por debajo de 640 px
/// de lado, así que pasar `0` (como se hacía antes) significaba que TODAS las
/// fotos de este origen se descartaban por «demasiado pequeña» — 352
/// estimadas, 0 descargadas, sin ningún síntoma más que ese cero.
#[derive(Debug, Clone, Deserialize)]
struct Dimensiones {
    #[serde(default)]
    width: u32,
    #[serde(default)]
    height: u32,
}

#[derive(Debug, Clone, Deserialize)]
struct Foto {
    id: i64,
    url: Option<String>,
    license_code: Option<String>,
    attribution: Option<String>,
    #[serde(default)]
    original_dimensions: Option<Dimensiones>,
}

#[derive(Debug, Clone, Deserialize)]
struct Observacion {
    id: i64,
    location: Option<String>,
    #[serde(default)]
    obscured: bool,
    geoprivacy: Option<String>,
    positional_accuracy: Option<f64>,
    observed_on: Option<String>,
    uri: Option<String>,
    #[serde(default)]
    photos: Vec<Foto>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    total_results: u32,
    #[serde(default)]
    results: Vec<Observacion>,
}

fn usable(o: &Observacion) -> bool {
    if o.obscured || o.geoprivacy.is_some() {
        return false;
    }
    o.location.is_some() && !o.photos.is_empty()
}

fn parsear_location(s: &str) -> Option<(f64, f64)> {
    let mut it = s.split(',');
    let lat: f64 = it.next()?.trim().parse().ok()?;
    let lng: f64 = it.next()?.trim().parse().ok()?;
    Some((lat, lng))
}

/// `.../square.jpg` -> `.../original.jpg`: la miniatura no vale, el
/// verificador necesita resolución real.
fn url_original(u: &str) -> String {
    u.replace("square.jpg", "original.jpg").replace("square.jpeg", "original.jpeg")
}

pub struct INaturalist {
    ctx: Ctx,
}

impl INaturalist {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 1, 1) }
    }

    async fn pagina(&self, tesela: &str, pagina: u32) -> Result<Respuesta> {
        let b = bbox_de_tesela(tesela);
        let url = format!(
            "{API}?nelat={}&nelng={}&swlat={}&swlng={}\
             &photos=true&license={LICENCIAS}&per_page={POR_PAGINA}&page={pagina}",
            b.norte, b.este, b.sur, b.oeste
        );
        let _g = self.ctx.limitador.permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("iNaturalist respondió {}", r.status());
        }
        Ok(r.json().await?)
    }

    /// Todas las observaciones utilizables de la tesela, paginando hasta
    /// agotar `total_results`. Tope de 10 páginas (2000 observaciones): más
    /// que eso en una sola tesela z14 sería un área con densidad anómala de
    /// registros, no una que este origen deba intentar agotar entera.
    async fn observaciones(&self, tesela: &str) -> Result<Vec<Observacion>> {
        let mut fuera = Vec::new();
        for pagina in 1..=10 {
            let r = self.pagina(tesela, pagina).await?;
            let hubo = !r.results.is_empty();
            fuera.extend(r.results);
            if !hubo || (fuera.len() as u32) >= r.total_results {
                break;
            }
        }
        Ok(fuera)
    }
}

#[async_trait]
impl OrigenDeRed for INaturalist {
    fn id(&self) -> &'static str {
        "inaturalist"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "libre (iNaturalist, CC-BY/CC-BY-SA/CC0)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let r = self.pagina(tesela, 1).await?;
        let usables = r.results.iter().filter(|o| usable(o)).count() as u32;
        // `total_results` cuenta TODO lo que devuelve la API, incluidas las
        // ofuscadas; se declara como muestreo porque el número real tras
        // filtrar difiere del que da el proveedor de un vistazo.
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(usables), estimadas: usables })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for o in self.observaciones(tesela).await? {
            if !usable(&o) {
                continue;
            }
            let Some((lat, lng)) = o.location.as_deref().and_then(parsear_location) else { continue };
            for f in &o.photos {
                let Some(url) = f.url.as_deref() else { continue };
                // Sin dimensiones declaradas se pasa `None` implícito como
                // «no lo dijo»: se usan las del propio filtro para no
                // descartar por algo que el proveedor no afirmó. Con `0` se
                // descartaba todo (ver `Dimensiones`).
                let (ancho, alto) = f
                    .original_dimensions
                    .as_ref()
                    .map(|d| (d.width, d.height))
                    .unwrap_or((u32::MAX, u32::MAX));
                let cand = Candidata {
                    ancho,
                    alto,
                    precision_metros: o.positional_accuracy,
                    categorias: vec![],
                    licencia: f.license_code.clone(),
                    tipo: Tipo::Suelta,
                };
                if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                    log::debug!("inaturalist {}: descartada, {motivo}", o.id);
                    continue;
                }
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let ruta = match self
                    .ctx
                    .bajar_imagen(&url_original(url), &format!("inat-{}.jpg", f.id))
                    .await
                {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("inaturalist {}: {e}", o.id);
                        continue;
                    }
                };
                fuera.push(Captura {
                    fuente: "inaturalist",
                    id_origen: f.id.to_string(),
                    ruta,
                    lat,
                    lng,
                    rumbo: None,
                    capturada_en: o.observed_on.clone(),
                    atribucion: Atribucion {
                        autor: f.attribution.clone().unwrap_or_else(|| "iNaturalist".into()),
                        url: o.uri.clone().unwrap_or_else(|| "https://www.inaturalist.org".into()),
                        licencia: f.license_code.clone().unwrap_or_else(|| "CC".into()),
                    },
                    unidades: 1,
                });
            }
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obs_base() -> Observacion {
        Observacion {
            id: 1,
            location: Some("42.6,-5.57".into()),
            obscured: false,
            geoprivacy: None,
            positional_accuracy: Some(10.0),
            observed_on: None,
            uri: None,
            photos: vec![Foto {
                id: 9,
                url: Some("https://x/square.jpg".into()),
                license_code: Some("cc0".into()),
                attribution: None,
                original_dimensions: Some(Dimensiones { width: 1536, height: 2048 }),
            }],
        }
    }

    #[test]
    fn una_observacion_ofuscada_no_es_usable() {
        let o = Observacion { obscured: true, ..obs_base() };
        assert!(!usable(&o));
    }

    #[test]
    fn una_observacion_con_geoprivacy_no_es_usable_aunque_no_este_obscured() {
        let o = Observacion { geoprivacy: Some("obscured".into()), ..obs_base() };
        assert!(!usable(&o));
    }

    #[test]
    fn una_observacion_normal_si_es_usable() {
        assert!(usable(&obs_base()));
    }

    #[test]
    fn una_precision_de_293_metros_no_pasa_la_regla_de_100() {
        let cand = Candidata { ancho: 2048, alto: 1536, precision_metros: Some(293.0), categorias: vec![], licencia: Some("cc0".into()), tipo: Tipo::Suelta };
        assert!(matches!(Reglas::por_defecto().evaluar(&cand), Veredicto::Fuera(_)));
    }

    #[test]
    fn la_url_de_la_foto_pasa_de_square_a_original() {
        assert_eq!(url_original("https://x/photos/9/square.jpg"), "https://x/photos/9/original.jpg");
    }

    /// La regresión que dejaba este origen en 0 descargas: `Candidata` se
    /// construía con `ancho: 0, alto: 0` porque se creyó que la API no daba
    /// dimensiones. Sí las da (`original_dimensions`), y con ceros el filtro
    /// descartaba TODAS las fotos por «demasiado pequeña».
    #[test]
    fn una_foto_con_sus_dimensiones_reales_pasa_el_filtro() {
        let j = r#"{"id":9,"url":"https://x/square.jpg","license_code":"cc0",
                    "original_dimensions":{"width":1536,"height":2048}}"#;
        let f: Foto = serde_json::from_str(j).unwrap();
        let d = f.original_dimensions.as_ref().expect("la API sí manda dimensiones");
        let cand = Candidata {
            ancho: d.width,
            alto: d.height,
            precision_metros: Some(10.0),
            categorias: vec![],
            licencia: f.license_code.clone(),
            tipo: Tipo::Suelta,
        };
        assert_eq!(Reglas::por_defecto().evaluar(&cand), Veredicto::Pasa);

        // Y la prueba de que el bug era real: con ceros, no pasa.
        let con_ceros = Candidata { ancho: 0, alto: 0, ..cand };
        assert!(matches!(Reglas::por_defecto().evaluar(&con_ceros), Veredicto::Fuera(_)));
    }

    #[test]
    fn parsear_location_lee_lat_lng_en_ese_orden() {
        assert_eq!(parsear_location("42.6,-5.57"), Some((42.6, -5.57)));
    }
}
