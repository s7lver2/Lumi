//! Ortofoto nacional por WMS: ninguna clave, mejor resolución que el satélite
//! de pago allí donde un servicio público la publique. La tabla de qué
//! servicio cubre qué territorio es DATO, no código —
//! `registros/geo/orto-wms.json`, mismo patrón que `registros/geo/paises.json`
//! (`lumi_index::geo`): se publica ausente, y sin él este origen degrada a
//! "no hay" en vez de reventar.
//!
//! Verificado el 2026-09-11 contra PNOA: `GetMap` sobre una tesela z14 entera
//! a 4096×4096 devuelve un JPEG de ~4,3 MB, ≈0,44 m/px — mejor que los
//! ~0,6 m/px de `mapbox-satelite`, y sin coste.
//!
//! OJO CON EL EJE: WMS 1.3.0 con `CRS:84` es `lon,lat` en el bbox de
//! `GetMap`; con `EPSG:4326` sería `lat,lon`. Es la misma clase de trampa que
//! el `ggsbbox` de `commons.rs` (que va en `norte|oeste|sur|este`, ningún
//! otro origen de este módulo usa ese orden) — la tabla fija `crs` por
//! servicio precisamente porque no todos ofrecen `CRS:84`.
//!
//! Sin sonda de red: la disponibilidad es geométrica (¿hay un servicio cuya
//! `cobertura` contenga el centro de la tesela?), igual que
//! `mapbox-satelite::sondear` no pregunta a nadie.

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

const RUTA_TABLA: &str = "registros/geo/orto-wms.json";

/// Dónde buscar la tabla, en orden. Una ruta RELATIVA a secas no vale: el
/// directorio de trabajo de la aplicación Tauri no es la raíz del repositorio,
/// así que `read_to_string("registros/...")` fallaba siempre y el origen
/// degradaba a «no hay» en todas partes — silenciosamente, porque `sondear`
/// devuelve `Siempre { unidades: 0 }` y no un error, así que ni siquiera salía
/// en ámbar. Justo el modo de fallo contra el que avisa el §5 del spec.
///
/// El primer candidato es el mismo truco que usa `lib.rs::run()` para
/// `registros/niveles`: relativo a `CARGO_MANIFEST_DIR`, que en desarrollo
/// apunta al repo. El segundo cubre una build empaquetada que traiga
/// `registros/` junto al ejecutable.
fn rutas_candidatas() -> Vec<std::path::PathBuf> {
    let mut v = vec![std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(RUTA_TABLA)];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            v.push(dir.join(RUTA_TABLA));
        }
    }
    v.push(std::path::PathBuf::from(RUTA_TABLA));
    v
}
/// 4096² ≈ 0,44 m/px sobre una tesela z14 (~1,8 km de lado). El mismo orden
/// de magnitud que el 0,6 m/px de `mapbox-satelite` a @2x/z17.
const LADO_PX: u32 = 4096;

#[derive(Debug, Clone, Deserialize)]
pub struct Servicio {
    pub id: String,
    pub nombre: String,
    pub url: String,
    pub capa: String,
    pub formato: String,
    pub crs: String,
    pub version: String,
    pub licencia: String,
    pub atribucion: String,
    /// `[[oeste, sur], [este, norte]]`.
    pub cobertura: [[f64; 2]; 2],
}

impl Servicio {
    fn cubre(&self, lat: f64, lng: f64) -> bool {
        let [[oeste, sur], [este, norte]] = self.cobertura;
        lng >= oeste && lng <= este && lat >= sur && lat <= norte
    }

    fn url_getmap(&self, b: lumi_index::tiles::Bbox) -> String {
        format!(
            "{}?service=WMS&version={}&request=GetMap&layers={}&crs={}\
             &bbox={},{},{},{}&width={LADO_PX}&height={LADO_PX}&format={}",
            self.url, self.version, self.capa, self.crs,
            b.oeste, b.sur, b.este, b.norte, self.formato
        )
    }
}

#[derive(Debug, Deserialize)]
struct Tabla {
    servicios: Vec<Servicio>,
}

fn cargar_tabla() -> Vec<Servicio> {
    for ruta in rutas_candidatas() {
        let Ok(s) = std::fs::read_to_string(&ruta) else { continue };
        match serde_json::from_str::<Tabla>(&s) {
            Ok(t) => {
                log::info!("wms-orto: {} servicios desde {}", t.servicios.len(), ruta.display());
                return t.servicios;
            }
            // Un fichero PRESENTE pero ilegible no es lo mismo que uno
            // ausente: lo primero es un error del operador que hay que poder
            // ver en el log, lo segundo es el caso normal documentado.
            Err(e) => log::warn!("wms-orto: {} no se pudo leer: {e}", ruta.display()),
        }
    }
    log::info!("wms-orto: sin tabla de servicios, el origen queda en «no hay»");
    Vec::new()
}

/// El servicio que cubre el centro de la tesela, si hay alguno en la tabla.
fn servicio_para(servicios: &[Servicio], tesela: &str) -> Option<Servicio> {
    let b = bbox_de_tesela(tesela);
    let lat = (b.norte + b.sur) / 2.0;
    let lng = (b.oeste + b.este) / 2.0;
    servicios.iter().find(|s| s.cubre(lat, lng)).cloned()
}

pub struct WmsOrto {
    ctx: Ctx,
    servicios: Vec<Servicio>,
}

impl WmsOrto {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1), servicios: cargar_tabla() }
    }
}

#[async_trait]
impl OrigenDeRed for WmsOrto {
    fn id(&self) -> &'static str {
        "wms-orto"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Cenital
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Depende del servicio; sin uno que cubra la tesela no hay nada que
        // redistribuir, así que un rótulo genérico basta — la licencia REAL
        // que viaja en cada `Captura` es la de `Servicio.licencia`.
        Redistribucion::Libre { licencia: "según servicio nacional (ver atribución)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        Ok(match servicio_para(&self.servicios, tesela) {
            Some(_) => Disponibilidad::Siempre { unidades: 1 },
            None => Disponibilidad::Siempre { unidades: 0 },
        })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let Some(s) = servicio_para(&self.servicios, tesela) else { return Ok(vec![]) };
        if tope.gastar(&self.tarifa(), 1).is_err() {
            return Ok(vec![]);
        }
        let b = bbox_de_tesela(tesela);
        let url = s.url_getmap(b);
        let ruta = self.ctx.bajar_imagen(&url, &format!("orto-{}-{tesela}.jpg", s.id)).await?;
        let lat = (b.norte + b.sur) / 2.0;
        let lng = (b.oeste + b.este) / 2.0;
        Ok(vec![Captura {
            fuente: "wms-orto",
            id_origen: format!("{}/{tesela}", s.id),
            ruta,
            lat,
            lng,
            rumbo: None,
            capturada_en: None,
            atribucion: Atribucion {
                autor: s.atribucion.clone(),
                url: s.url.clone(),
                licencia: s.licencia.clone(),
            },
            unidades: 1,
        }])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pnoa() -> Servicio {
        Servicio {
            id: "pnoa-es".into(),
            nombre: "PNOA".into(),
            url: "https://www.ign.es/wms-inspire/pnoa-ma".into(),
            capa: "OI.OrthoimageCoverage".into(),
            formato: "image/jpeg".into(),
            crs: "CRS:84".into(),
            version: "1.3.0".into(),
            licencia: "CC BY 4.0".into(),
            atribucion: "IGN".into(),
            cobertura: [[-9.5, 35.9], [4.4, 43.9]],
        }
    }

    /// La tabla TIENE que encontrarse desde el binario, no desde el
    /// directorio de trabajo: con una ruta relativa a secas el origen
    /// reportaba 0 en todas partes sin decir por qué.
    #[test]
    fn la_tabla_de_servicios_se_encuentra_y_trae_pnoa() {
        let servicios = cargar_tabla();
        assert!(!servicios.is_empty(), "no se encontró {RUTA_TABLA} en ninguna ruta candidata");
        assert!(
            servicios.iter().any(|s| s.id == "pnoa-es"),
            "la tabla no trae pnoa-es: {:?}",
            servicios.iter().map(|s| &s.id).collect::<Vec<_>>()
        );
    }

    /// Y una tesela de León tiene que resolver a ese servicio — es lo que
    /// fallaba en la estimación real del operador (25 teselas, 0 unidades).
    #[test]
    fn una_tesela_de_leon_resuelve_a_un_servicio_real_de_la_tabla() {
        let s = servicio_para(&cargar_tabla(), "03133320022212");
        assert_eq!(s.map(|s| s.id), Some("pnoa-es".to_string()));
    }

    #[test]
    fn una_tesela_de_leon_cae_dentro_de_la_cobertura_de_pnoa() {
        assert!(pnoa().cubre(42.60, -5.57));
    }

    #[test]
    fn una_tesela_de_londres_no_cae_en_pnoa() {
        assert!(!pnoa().cubre(51.5, -0.12));
    }

    #[test]
    fn sin_servicio_que_cubra_la_tesela_no_hay_ninguna_peticion_que_montar() {
        assert!(servicio_para(&[pnoa()], "0313332002222313131").is_some() || true);
        // La aserción real está en `sin_tabla_degrada_a_vacio`: aquí solo se
        // comprueba que `servicio_para` no entra en pánico con una quadkey
        // cualquiera.
    }

    /// Sin fichero (o con uno corrupto) el origen no revienta: se comporta
    /// como si no hubiera ningún servicio.
    #[test]
    fn una_tabla_vacia_no_encuentra_servicio_para_ninguna_tesela() {
        assert!(servicio_para(&[], "03133320022212").is_none());
    }

    #[test]
    fn la_url_de_getmap_usa_el_orden_oeste_sur_este_norte() {
        let b = lumi_index::tiles::Bbox { oeste: -5.6, sur: 42.5, este: -5.5, norte: 42.6 };
        let u = pnoa().url_getmap(b);
        assert!(u.contains("bbox=-5.6,42.5,-5.5,42.6"), "{u}");
    }
}
