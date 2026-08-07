//! Los tipos del contrato de un origen de red. Puros: aquí no hay red.
//!
//! El trait que de verdad habla con internet vive en la aplicación
//! (`indexer/src-tauri/src/origins/`), porque es `async` y arrastraría
//! dependencias que este crate no quiere: los subsistemas 8 y 5 dependen de
//! `lumi-index` para LEER paquetes, no para descargarlos.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::coverage::Atribucion;
use crate::tiles::quadkey;

/// Lo que cuesta una unidad servida. «Unidad» significa cosas distintas según
/// el origen —una imagen en Google, una tesela raster en Mapbox— y por eso el
/// tipo no la nombra: cada adaptador sabe qué está contando.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Tarifa {
    Gratis,
    PorUnidad { usd_por_mil: f64 },
}

/// Cambio fijo. ponytail: el techo es que se desactualiza; la salida, pedirlo a
/// un servicio. No se hace porque una herramienta forense que consulta un tipo
/// de cambio en cada estimación es una dependencia de red más por un número que
/// solo sirve para orientar al operador antes de confirmar.
pub const USD_EUR: f64 = 0.93;

impl Tarifa {
    pub fn coste_usd(&self, unidades: u32) -> f64 {
        match self {
            Tarifa::Gratis => 0.0,
            Tarifa::PorUnidad { usd_por_mil } => usd_por_mil * unidades as f64 / 1000.0,
        }
    }
    pub fn coste_eur(&self, unidades: u32) -> f64 {
        self.coste_usd(unidades) * USD_EUR
    }
    pub fn es_gratis(&self) -> bool {
        matches!(self, Tarifa::Gratis)
    }
}

/// Si las imágenes de este origen pueden salir en un paquete publicado.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Redistribucion {
    /// Licencia conocida y compatible para todo el origen.
    Libre { licencia: String },
    /// Las condiciones del proveedor no permiten redistribuir: Google, Mapbox.
    SoloLocal,
    /// Cada foto trae la suya y hay que mirarla una a una: Flickr.
    PorImagen,
}

impl Redistribucion {
    /// ¿Viaja esta imagen dentro del paquete?
    ///
    /// `SoloLocal` no se salva ni con una licencia buena en la propia foto: lo
    /// que prohíbe redistribuir es el contrato con el proveedor, no la licencia
    /// del píxel. Y sin licencia conocida tampoco viaja — la duda no publica.
    pub fn viaja(&self, licencia_de_la_foto: Option<&str>) -> bool {
        match self {
            Redistribucion::Libre { .. } => true,
            Redistribucion::SoloLocal => false,
            Redistribucion::PorImagen => match licencia_de_la_foto {
                None => false,
                Some(l) => {
                    let l = l.to_ascii_uppercase();
                    !l.contains("-ND") && !l.contains("-NC") && !l.contains("NODERIV")
                }
            },
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Nivel {
    Mucho,
    Poco,
    Nada,
}

impl Nivel {
    /// Los dos cortes que separan los tres niveles del sombreado. No pretenden
    /// ser exactos: el muestreo no sabe contar mejor que esto.
    pub fn de(estimadas: u32) -> Nivel {
        match estimadas {
            0 => Nivel::Nada,
            1..=49 => Nivel::Poco,
            _ => Nivel::Mucho,
        }
    }
}

/// Qué hay en una tesela, y con qué certeza se sabe. Las tres variantes existen
/// porque los proveedores no se pueden sondear igual, y esa asimetría llega
/// hasta el mapa: los `Puntos` se pintan como puntos y el `Muestreo` como
/// sombreado de la tesela entera.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "clase", rename_all = "lowercase")]
pub enum Disponibilidad {
    /// Cuenta exacta del propio proveedor.
    Puntos { cuantos: u32 },
    /// Estimación por muestreo: es lo único que se puede decir del resto.
    Muestreo { nivel: Nivel, estimadas: u32 },
    /// Cobertura global sin sonda: el cenital de Mapbox.
    Siempre { unidades: u32 },
}

impl Disponibilidad {
    pub fn unidades(&self) -> u32 {
        match self {
            Disponibilidad::Puntos { cuantos } => *cuantos,
            Disponibilidad::Muestreo { estimadas, .. } => *estimadas,
            Disponibilidad::Siempre { unidades } => *unidades,
        }
    }
    pub fn hay(&self) -> bool {
        self.unidades() > 0
    }
    pub fn nivel(&self) -> Nivel {
        match self {
            Disponibilidad::Muestreo { nivel, .. } => *nivel,
            otra => Nivel::de(otra.unidades()),
        }
    }
}

/// Una imagen recién bajada, ya en el directorio de paso y verificada.
///
/// La `Atribucion` va DENTRO y no es `Option`: no puede existir un camino de
/// código por el que una imagen llegue al índice sin ella. Era exactamente el
/// agujero de la v1, cuyo manifiesto exportaba `panoId` y coordenadas pero
/// dejaba fuera las columnas de proveedor y atribución.
#[derive(Debug, Clone, PartialEq)]
pub struct Captura {
    pub fuente: &'static str,
    /// El identificador del proveedor: `panoId`, id de foto, ruta de tesela.
    pub id_origen: String,
    pub ruta: PathBuf,
    pub lat: f64,
    pub lng: f64,
    pub rumbo: Option<f32>,
    pub capturada_en: Option<String>,
    pub atribucion: Atribucion,
    /// Lo que esta captura consumió del presupuesto. Casi siempre 1; una tesela
    /// cenital que se compone de varias sub-teselas cuenta las que gastó.
    pub unidades: u32,
}

impl Captura {
    pub fn quadkey(&self) -> String {
        quadkey(self.lat, self.lng)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn atrib() -> crate::coverage::Atribucion {
        crate::coverage::Atribucion {
            autor: "alguien".into(),
            url: "https://example.org/foto/1".into(),
            licencia: "CC BY-SA 4.0".into(),
        }
    }

    #[test]
    fn la_tarifa_cobra_por_unidad_servida_y_lo_gratis_es_cero() {
        assert_eq!(Tarifa::Gratis.coste_usd(9_240), 0.0);
        // 7,00 $/1000 · 9240 imágenes = 64,68 $
        let g = Tarifa::PorUnidad { usd_por_mil: 7.00 };
        assert!((g.coste_usd(9_240) - 64.68).abs() < 1e-9, "{}", g.coste_usd(9_240));
        // 0,75 $/1000 · 6272 teselas = 4,704 $
        let m = Tarifa::PorUnidad { usd_por_mil: 0.75 };
        assert!((m.coste_usd(6_272) - 4.704).abs() < 1e-9);
        assert_eq!(m.coste_usd(0), 0.0, "cero unidades servidas no cuesta nada");
    }

    #[test]
    fn solo_lo_libre_y_lo_permitido_por_imagen_viaja_en_el_paquete() {
        assert!(Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }.viaja(None));
        assert!(!Redistribucion::SoloLocal.viaja(None));
        assert!(!Redistribucion::SoloLocal.viaja(Some("CC BY 2.0")),
            "SoloLocal no se salva ni con una licencia buena en la propia foto");

        // PorImagen manda a la licencia de la foto. ND y NC no viajan.
        let p = Redistribucion::PorImagen;
        assert!(p.viaja(Some("CC BY 2.0")));
        assert!(p.viaja(Some("CC BY-SA 2.0")));
        assert!(p.viaja(Some("CC0 1.0")));
        assert!(!p.viaja(Some("CC BY-ND 2.0")), "ND prohíbe derivados");
        assert!(!p.viaja(Some("CC BY-NC 2.0")), "NC prohíbe uso comercial");
        assert!(!p.viaja(Some("CC BY-NC-ND 2.0")));
        assert!(!p.viaja(None), "sin licencia conocida no viaja: la duda no publica");
    }

    #[test]
    fn la_disponibilidad_cuenta_unidades_sea_del_tipo_que_sea() {
        assert_eq!(Disponibilidad::Puntos { cuantos: 412 }.unidades(), 412);
        assert_eq!(
            Disponibilidad::Muestreo { nivel: Nivel::Poco, estimadas: 30 }.unidades(),
            30
        );
        assert_eq!(Disponibilidad::Siempre { unidades: 64 }.unidades(), 64);
        // Nada es nada: una tesela sin material no se descarga ni se cobra.
        let nada = Disponibilidad::Muestreo { nivel: Nivel::Nada, estimadas: 0 };
        assert_eq!(nada.unidades(), 0);
        assert!(!nada.hay());
        assert!(Disponibilidad::Puntos { cuantos: 1 }.hay());
        assert!(!Disponibilidad::Puntos { cuantos: 0 }.hay());
    }

    #[test]
    fn una_captura_lleva_su_atribucion_dentro() {
        // El test existe para que el tipo NO pueda construirse sin atribución.
        // Si alguien la hace `Option`, esto deja de compilar y eso es el aviso.
        let c = Captura {
            fuente: "mapillary",
            id_origen: "1234567890".into(),
            ruta: std::path::PathBuf::from("/tmp/stage/1234567890.jpg"),
            lat: 43.3623,
            lng: -8.4115,
            rumbo: Some(182.5),
            capturada_en: Some("2024-05-02T10:12:00Z".into()),
            atribucion: atrib(),
            unidades: 1,
        };
        assert_eq!(c.atribucion.licencia, "CC BY-SA 4.0");
        assert_eq!(c.quadkey(), crate::tiles::quadkey(43.3623, -8.4115));
    }
}
