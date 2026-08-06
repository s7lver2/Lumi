//! El manifiesto del paquete y las DOS procedencias.
//!
//! Son dos preguntas distintas y por eso son dos tablas. La de las imágenes
//! dice de dónde salió el píxel; la del trabajo dice quién pagó por indexarlo.
//! Suman distinto, y que sumen distinto es información: una tesela la indexó
//! exactamente uno, pero dos orígenes de imagen pueden cubrir la misma.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

/// Cómo mira el mundo una imagen. Cerrado, tres valores: determina contra qué
/// verifica bien. Una cenital y una foto de turista no se parecen aunque miren
/// el mismo sitio.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tipo {
    Calle,
    Cenital,
    Suelta,
}

impl Tipo {
    pub const TODOS: [Tipo; 3] = [Tipo::Calle, Tipo::Cenital, Tipo::Suelta];
}

/// Lo mínimo de una imagen que hace falta para contar procedencia.
#[derive(Debug, Clone, PartialEq)]
pub struct FilaImagen {
    pub tipo: Tipo,
    /// `mapillary`, `carpeta:vuelo-dron`, `desconocida`… `desconocida` es un
    /// valor de primera clase y sale en los porcentajes como cualquier otro.
    pub fuente: String,
    pub quadkey: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PctTipo {
    pub tipo: Tipo,
    pub imagenes: u32,
    pub imagenes_pct: f64,
    pub teselas: u32,
    pub territorio_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PctFuente {
    pub fuente: String,
    pub imagenes: u32,
    pub imagenes_pct: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PorcentajesImagenes {
    pub por_tipo: Vec<PctTipo>,
    pub por_fuente: Vec<PctFuente>,
    pub imagenes_total: u32,
    pub teselas_total: u32,
    /// La suma de `territorio_pct`. Se GUARDA en vez de calcularse al pintar
    /// porque es el número que hay que enseñar tal cual: pasa de 100 y decirlo
    /// es la mitad del sentido de tener esta columna.
    pub territorio_suma: f64,
}

fn pct(parte: u32, total: u32) -> f64 {
    if total == 0 {
        return 0.0;
    }
    (parte as f64) * 100.0 / (total as f64)
}

pub fn porcentajes(filas: &[FilaImagen]) -> PorcentajesImagenes {
    let total = filas.len() as u32;
    let teselas_total = filas.iter().map(|f| f.quadkey.as_str()).collect::<BTreeSet<_>>().len() as u32;

    let mut por_tipo = Vec::new();
    for tipo in Tipo::TODOS {
        let del_tipo: Vec<&FilaImagen> = filas.iter().filter(|f| f.tipo == tipo).collect();
        if del_tipo.is_empty() {
            continue;
        }
        let teselas =
            del_tipo.iter().map(|f| f.quadkey.as_str()).collect::<BTreeSet<_>>().len() as u32;
        por_tipo.push(PctTipo {
            tipo,
            imagenes: del_tipo.len() as u32,
            imagenes_pct: pct(del_tipo.len() as u32, total),
            teselas,
            territorio_pct: pct(teselas, teselas_total),
        });
    }
    let territorio_suma = por_tipo.iter().map(|t| t.territorio_pct).sum();

    let mut cuenta: BTreeMap<&str, u32> = BTreeMap::new();
    for f in filas {
        *cuenta.entry(f.fuente.as_str()).or_default() += 1;
    }
    let por_fuente = cuenta
        .into_iter()
        .map(|(fuente, imagenes)| PctFuente {
            fuente: fuente.to_string(),
            imagenes,
            imagenes_pct: pct(imagenes, total),
        })
        .collect();

    PorcentajesImagenes {
        por_tipo,
        por_fuente,
        imagenes_total: total,
        teselas_total,
        territorio_suma,
    }
}

/// Quién pagó la descarga y la GPU de una tesela.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum TrabajoDe {
    /// Indexada en este equipo, para este índice.
    Aqui,
    /// Heredada de otro índice de este equipo.
    Local(String),
    /// Heredada de un índice publicado por un tercero.
    Catalogo(String),
}

impl TrabajoDe {
    fn etiqueta(&self) -> String {
        match self {
            TrabajoDe::Aqui => "indexado aquí".into(),
            TrabajoDe::Local(i) => format!("de «{i}»"),
            TrabajoDe::Catalogo(i) => i.clone(),
        }
    }
}

/// Devuelve `(etiqueta, teselas, porcentaje)` ordenado de más a menos.
/// **Suma 100 %**: una tesela la indexó exactamente uno, así que aquí no hay
/// solape posible y no hace falta advertir de nada.
pub fn porcentajes_trabajo(teselas: &[(String, TrabajoDe)]) -> Vec<(String, u32, f64)> {
    let total = teselas.len() as u32;
    let mut cuenta: BTreeMap<String, u32> = BTreeMap::new();
    for (_, t) in teselas {
        *cuenta.entry(t.etiqueta()).or_default() += 1;
    }
    let mut v: Vec<(String, u32, f64)> =
        cuenta.into_iter().map(|(k, n)| (k, n, pct(n, total))).collect();
    v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
    v
}

/// El `manifiesto.json` del paquete.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Manifiesto {
    pub version: u32,
    pub nombre: String,
    pub slug: String,
    pub sellado_en: String,
    pub version_indexer: String,
    /// Modelos cuyos vectores lleva el paquete, como `("lumi-2", "1.0", 12288)`.
    pub modelos: Vec<(String, String, u32)>,
    pub imagenes: PorcentajesImagenes,
    pub trabajo: Vec<(String, u32, f64)>,
    /// Atribución de terceros, obligatoria y no editable: viaja con los
    /// fragmentos heredados y quitarla rompería SHA256SUMS.
    pub atribuciones: Vec<crate::coverage::Atribucion>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fila(tipo: Tipo, fuente: &str, qk: &str) -> FilaImagen {
        FilaImagen { tipo, fuente: fuente.into(), quadkey: qk.into() }
    }

    #[test]
    fn por_imagenes_suma_cien_y_por_territorio_puede_pasarse() {
        // Cuatro imágenes de calle en dos teselas, una cenital que cubre las
        // DOS mismas teselas más una tercera. Por imágenes la calle domina;
        // por territorio la cenital cubre más. Ese es exactamente el caso que
        // justifica enseñar los dos números.
        let filas = vec![
            fila(Tipo::Calle, "mapillary", "A"),
            fila(Tipo::Calle, "mapillary", "A"),
            fila(Tipo::Calle, "mapillary", "B"),
            fila(Tipo::Calle, "desconocida", "B"),
            fila(Tipo::Cenital, "carpeta:dron", "A"),
            fila(Tipo::Cenital, "carpeta:dron", "B"),
            fila(Tipo::Cenital, "carpeta:dron", "C"),
        ];
        let p = porcentajes(&filas);

        // Por imágenes: 4 de 7 y 3 de 7.
        let calle = p.por_tipo.iter().find(|t| t.tipo == Tipo::Calle).unwrap();
        let cenital = p.por_tipo.iter().find(|t| t.tipo == Tipo::Cenital).unwrap();
        assert!((calle.imagenes_pct - 57.14).abs() < 0.01, "{}", calle.imagenes_pct);
        assert!((cenital.imagenes_pct - 42.86).abs() < 0.01, "{}", cenital.imagenes_pct);
        let suma: f64 = p.por_tipo.iter().map(|t| t.imagenes_pct).sum();
        assert!((suma - 100.0).abs() < 0.01, "por imágenes suma 100: {suma}");

        // Por territorio: calle cubre A y B de tres teselas; cenital las tres.
        assert!((calle.territorio_pct - 66.67).abs() < 0.01, "{}", calle.territorio_pct);
        assert!((cenital.territorio_pct - 100.0).abs() < 0.01, "{}", cenital.territorio_pct);
        assert!(p.territorio_suma > 100.0, "debe pasarse de 100: {}", p.territorio_suma);
        assert!((p.territorio_suma - 166.67).abs() < 0.01, "{}", p.territorio_suma);

        // `desconocida` es una fuente como las demás y aparece en la lista.
        let desc = p.por_fuente.iter().find(|f| f.fuente == "desconocida").unwrap();
        assert_eq!(desc.imagenes, 1);

        // El trabajo suma 100 porque una tesela la indexó exactamente uno.
        let trabajo = porcentajes_trabajo(&[
            ("A".into(), TrabajoDe::Aqui),
            ("B".into(), TrabajoDe::Catalogo("marta/lumi-costa".into())),
            ("C".into(), TrabajoDe::Catalogo("marta/lumi-costa".into())),
            ("D".into(), TrabajoDe::Local("madrid-centro".into())),
        ]);
        let suma_t: f64 = trabajo.iter().map(|(_, _, pct)| pct).sum();
        assert!((suma_t - 100.0).abs() < 0.01, "el trabajo suma 100: {suma_t}");
        let marta = trabajo.iter().find(|(o, _, _)| o == "marta/lumi-costa").unwrap();
        assert_eq!(marta.1, 2);
        assert!((marta.2 - 50.0).abs() < 0.01);
    }
}
