//! Los tres resolutores que convierten una coordenada en algo con lo que un
//! agente pueda comparar: país, lado de la calzada y grupo climático.
//!
//! Son OFFLINE a propósito. Un filtro geográfico que dependiera de una API
//! externa convertiría cada análisis en una petición de red que se puede caer,
//! se puede cobrar y deja rastro de qué está investigando el usuario.
//!
//! Los datos NO se publican con el repositorio: `paises.json` y `koppen.bin`
//! los pone el propietario siguiendo `registros/geo/LEEME.md`. Sin ellos, cada
//! resolutor devuelve `None` y el agente que dependa de él se abstiene. Es la
//! misma postura que el `sha256` vacío del registro de modelos: mejor no saber
//! que fingir que se sabe.

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
        // Sobre la arista: se cuenta como dentro, sin ambigüedad.
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

/// Los países que circulan por la izquierda. Todo lo demás circula por la
/// derecha: son unos setenta y cinco frente a ciento veinte, y listar el lado
/// minoritario es la mitad de fichero y la mitad de sitios donde equivocarse.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct TablaLado {
    pub izquierda: Vec<String>,
}

impl TablaLado {
    pub fn lado_de(&self, iso: &str) -> &'static str {
        if self.izquierda.iter().any(|c| c == iso) {
            "izquierda"
        } else {
            "derecha"
        }
    }
}

/// Rejilla equirrectangular de grupos de Köppen, un byte por celda, en orden
/// de filas de norte a sur y de oeste a este. El byte es la LETRA del grupo
/// (`A`..`E`) en ASCII, y `0` significa «sin dato» —océano, o una celda que el
/// dataset no cubre—. Solo se guarda el grupo: el subtipo no acota geografía
/// mejor que la letra y multiplicaría el fichero por nada.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Koppen {
    pub ancho: usize,
    pub alto: usize,
    pub celdas: Vec<u8>,
}

impl Koppen {
    pub fn grupo_de(&self, lat: f64, lng: f64) -> Option<String> {
        if self.ancho == 0 || self.alto == 0 {
            return None;
        }
        let col = (((lng + 180.0) / 360.0) * self.ancho as f64).floor() as isize;
        let fila = (((90.0 - lat) / 180.0) * self.alto as f64).floor() as isize;
        let col = col.clamp(0, self.ancho as isize - 1) as usize;
        let fila = fila.clamp(0, self.alto as isize - 1) as usize;
        match self.celdas.get(fila * self.ancho + col).copied().unwrap_or(0) {
            0 => None,
            b => Some((b as char).to_string()),
        }
    }
}

/// Lo que se sabe de una coordenada. Todo opcional: no saber es un estado
/// legítimo y frecuente —un candidato en alta mar, un servidor sin los
/// datasets puestos— y el que no sabe no castiga a nadie.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Atributos {
    pub pais: Option<String>,
    pub lado: Option<String>,
    pub koppen: Option<String>,
}

impl Atributos {
    /// El nombre viene del campo `restriccion` de un agente, que es un dato de
    /// un fichero JSON: una restricción que no existe devuelve `None` en vez
    /// de paniquear.
    pub fn de(&self, restriccion: &str) -> Option<&str> {
        match restriccion {
            "pais" => self.pais.as_deref(),
            "lado_conduccion" => self.lado.as_deref(),
            "clima_koppen" => self.koppen.as_deref(),
            _ => None,
        }
    }
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

/// Los tres datasets cargados una vez al arrancar el daemon. Cada uno por su
/// lado: que falte la rejilla de Köppen no impide resolver el país.
#[derive(Debug, Clone, Default)]
pub struct Datos {
    pub paises: Option<Paises>,
    pub lado: Option<TablaLado>,
    pub koppen: Option<Koppen>,
}

impl Datos {
    pub fn cargar(dir: &Path) -> Datos {
        let paises = std::fs::read(dir.join("paises.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<Paises>(&b).ok());
        let lado = std::fs::read(dir.join("lado.json"))
            .ok()
            .and_then(|b| serde_json::from_slice::<TablaLado>(&b).ok());
        let koppen = std::fs::read(dir.join("koppen.bin")).ok().and_then(|b| {
            // 0,5° es la resolución del dataset de Beck et al. y da un fichero
            // de 259 200 bytes. Cualquier otro tamaño es un fichero que no es
            // lo que dice ser, y se descarta entero en vez de leerse torcido.
            if b.len() == 720 * 360 {
                Some(Koppen { ancho: 720, alto: 360, celdas: b })
            } else {
                log::warn!("koppen.bin mide {} bytes y deberían ser 259200", b.len());
                None
            }
        });
        if paises.is_none() {
            log::warn!("sin paises.json: los agentes que acotan por país se abstendrán");
        }
        Datos { paises, lado, koppen }
    }

    pub fn atributos(&self, lat: f64, lng: f64) -> Atributos {
        let pais = self.paises.as_ref().and_then(|p| p.iso_de(lat, lng));
        let lado = match (&self.lado, &pais) {
            (Some(t), Some(iso)) => Some(t.lado_de(iso).to_string()),
            _ => None,
        };
        Atributos { pais, lado, koppen: self.koppen.as_ref().and_then(|k| k.grupo_de(lat, lng)) }
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
        // Un punto en el meridiano del vértice: el trazado de rayos es
        // sensible justo ahí, y una coordenada de un caso real puede caer
        // encima de una frontera.
        assert_eq!(cuadrado().iso_de(0.0, -5.0).as_deref(), Some("XXX"));
    }

    #[test]
    fn el_lado_sale_de_la_tabla_y_lo_no_listado_es_derecha() {
        let t = TablaLado { izquierda: vec!["JPN".into(), "GBR".into()] };
        assert_eq!(t.lado_de("JPN"), "izquierda");
        assert_eq!(t.lado_de("ESP"), "derecha");
    }

    /// Rejilla de 4×2 celdas: 90° de ancho y 90° de alto por celda.
    fn rejilla() -> Koppen {
        Koppen { ancho: 4, alto: 2, celdas: vec![b'E', b'D', b'C', b'B', b'A', b'A', b'C', b'D'] }
    }

    #[test]
    fn koppen_lee_la_celda_que_toca() {
        // Fila de arriba (norte), primera columna (oeste del todo).
        assert_eq!(rejilla().grupo_de(80.0, -179.0).as_deref(), Some("E"));
        // Fila de abajo (sur), primera columna.
        assert_eq!(rejilla().grupo_de(-80.0, -179.0).as_deref(), Some("A"));
        // Fila de arriba, última columna (este del todo).
        assert_eq!(rejilla().grupo_de(80.0, 179.0).as_deref(), Some("B"));
    }

    #[test]
    fn koppen_en_una_celda_sin_dato_no_devuelve_nada() {
        let k = Koppen { ancho: 1, alto: 1, celdas: vec![0] };
        assert!(k.grupo_de(0.0, 0.0).is_none());
    }

    #[test]
    fn sin_datos_en_disco_no_se_sabe_nada_y_no_se_rompe() {
        // El caso de un servidor recién instalado: `registros/geo/` sin los
        // ficheros grandes. Cero paniqueos, cero atributos.
        let d = Datos::cargar(std::path::Path::new("/no/existe/de/ninguna/manera"));
        let a = d.atributos(43.36, -8.41);
        assert!(a.pais.is_none() && a.koppen.is_none() && a.lado.is_none());
    }

    #[test]
    fn el_atributo_se_pide_por_el_nombre_de_la_restriccion() {
        let a = Atributos {
            pais: Some("JPN".into()),
            lado: Some("izquierda".into()),
            koppen: Some("C".into()),
        };
        assert_eq!(a.de("pais"), Some("JPN"));
        assert_eq!(a.de("lado_conduccion"), Some("izquierda"));
        assert_eq!(a.de("clima_koppen"), Some("C"));
        assert_eq!(a.de("inventada"), None);
    }
}
