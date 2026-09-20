//! El resolutor que convierte una coordenada en el país donde cae — lo usa
//! `routes::export` para el país que sale en el informe PDF.
//!
//! Es OFFLINE a propósito. Un filtro geográfico que dependiera de una API
//! externa convertiría cada análisis en una petición de red que se puede caer,
//! se puede cobrar y deja rastro de qué está investigando el usuario.
//!
//! `paises.json` NO se publica con el repositorio: lo pone el propietario
//! siguiendo `registros/geo/LEEME.md`. Sin él, `Atributos.pais` es `None` --
//! la misma postura que el `sha256` vacío del registro de modelos: mejor no
//! saber que fingir que se sabe.

use std::path::Path;

use serde::{Deserialize, Serialize};

/// Un país con sus anillos exteriores. Los agujeros (enclaves) NO se modelan:
///
/// ponytail: un enclave mal atribuido mueve un candidato de país en un puñado
/// de casos y el coste de modelar agujeros es arrastrar polígonos con huecos
/// por todo el módulo. La salida, si algún día importa, es añadir
/// `agujeros: Vec<Vec<(f64, f64)>>` a `Pais` y restarlos en `iso_de`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Pais {
    pub iso: String,
    /// Cada anillo es una lista de `(lng, lat)` — el orden de GeoJSON, no el
    /// de una coordenada hablada. Se respeta para que convertir el dataset sea
    /// copiar y no reordenar.
    pub anillos: Vec<Vec<(f64, f64)>>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Paises {
    pub paises: Vec<Pais>,
}

impl Paises {
    pub fn iso_de(&self, lat: f64, lng: f64) -> Option<String> {
        self.paises
            .iter()
            .find(|p| p.anillos.iter().any(|a| dentro(a, lat, lng)))
            .map(|p| p.iso.clone())
    }
}

/// Trazado de rayos hacia el este. El `<=` de un extremo y el `<` del otro es
/// lo que evita contar dos veces un vértice; el caso del punto exactamente
/// sobre una arista se resuelve antes, a mano, porque una frontera es
/// justamente donde caen las coordenadas interesantes.
pub fn dentro(anillo: &[(f64, f64)], lat: f64, lng: f64) -> bool {
    if anillo.len() < 3 {
        return false;
    }
    let mut dentro = false;
    let mut j = anillo.len() - 1;
    for i in 0..anillo.len() {
        let (xi, yi) = anillo[i];
        let (xj, yj) = anillo[j];
        if sobre_arista(lng, lat, xi, yi, xj, yj) {
            return true;
        }
        if (yi > lat) != (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi {
            dentro = !dentro;
        }
        j = i;
    }
    dentro
}

fn sobre_arista(x: f64, y: f64, xi: f64, yi: f64, xj: f64, yj: f64) -> bool {
    let cruz = (x - xi) * (yj - yi) - (y - yi) * (xj - xi);
    if cruz.abs() > 1e-9 {
        return false;
    }
    x >= xi.min(xj) - 1e-9 && x <= xi.max(xj) + 1e-9 && y >= yi.min(yj) - 1e-9 && y <= yi.max(yj) + 1e-9
}

/// Lo que se sabe de una coordenada. `None` es un estado legítimo y
/// frecuente — un candidato en alta mar, un servidor sin `paises.json`
/// puesto.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Atributos {
    pub pais: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RecursoGeo {
    pub id: String,
    pub nombre: String,
    pub licencia: String,
    #[serde(default)]
    pub fichero_url: String,
    #[serde(default)]
    pub licencia_url: String,
    #[serde(default)]
    pub licencia_texto: String,
    #[serde(default)]
    pub puerta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct RegistroGeo {
    recursos: Vec<RecursoGeo>,
}

pub fn cargar_recursos(dir: &Path) -> Vec<RecursoGeo> {
    std::fs::read(dir.join("registro.json"))
        .ok()
        .and_then(|b| serde_json::from_slice::<RegistroGeo>(&b).ok())
        .map(|r| r.recursos)
        .unwrap_or_default()
}

/// El único dataset que se carga al arrancar el daemon.
#[derive(Debug, Clone, Default)]
pub struct Datos {
    pub paises: Option<Paises>,
}

impl Datos {
    pub fn cargar(dir: &Path) -> Datos {
        let paises = std::fs::read(dir.join("paises.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Paises>(&b).ok());
        if paises.is_none() {
            log::warn!("sin paises.json: el informe PDF no podrá dar el país de cada hipótesis");
        }
        Datos { paises }
    }

    pub fn atributos(&self, lat: f64, lng: f64) -> Atributos {
        Atributos { pais: self.paises.as_ref().and_then(|p| p.iso_de(lat, lng)) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un cuadrado de 10×10 grados centrado en el origen. No es ningún país
    /// real a propósito: lo que se prueba es el algoritmo, no el dataset.
    fn cuadrado() -> Paises {
        Paises {
            paises: vec![Pais {
                iso: "XXX".into(),
                anillos: vec![vec![(-5.0, -5.0), (5.0, -5.0), (5.0, 5.0), (-5.0, 5.0)]],
            }],
        }
    }

    #[test]
    fn un_punto_dentro_del_anillo_da_su_pais() {
        assert_eq!(cuadrado().iso_de(1.0, 1.0).as_deref(), Some("XXX"));
    }

    #[test]
    fn un_punto_fuera_no_da_ninguno() {
        assert!(cuadrado().iso_de(40.0, 40.0).is_none());
    }

    #[test]
    fn el_borde_cuenta_como_dentro() {
        assert_eq!(cuadrado().iso_de(0.0, -5.0).as_deref(), Some("XXX"));
    }

    #[test]
    fn sin_datos_en_disco_no_se_sabe_nada_y_no_se_rompe() {
        let d = Datos::cargar(std::path::Path::new("/no/existe/de/ninguna/manera"));
        let a = d.atributos(43.36, -8.41);
        assert!(a.pais.is_none());
    }
}
