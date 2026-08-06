//! Quién cubre qué territorio, y la regla de no indexar nunca lo mismo dos
//! veces.
//!
//! `cobertura.json` es lo ÚNICO del subsistema 8 que el 7a construye, y no es
//! trabajo adelantado: el 8 lo va a necesitar exactamente así. El 7a lo escribe
//! al sellar y lo lee al planificar, y el mismo camino de código sirve para los
//! paquetes locales y para los publicados.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Atribucion {
    pub autor: String,
    pub url: String,
    pub licencia: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TeselaCubierta {
    pub quadkey: String,
    /// Hash del fragmento. Es lo que hace que la autoría sea COMPROBABLE y no
    /// una declaración de buena fe: quitar la atribución rompería SHA256SUMS.
    pub sha256: String,
    pub bytes: u64,
    pub imagenes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cobertura {
    pub version: u32,
    /// Identificador legible del índice: `madrid-centro` o `marta/lumi-costa`.
    pub indice: String,
    pub sellado_en: String,
    pub atribucion: Atribucion,
    pub teselas: Vec<TeselaCubierta>,
}

/// En qué situación está una tesela que el operador quiere indexar.
#[derive(Debug, Clone, PartialEq)]
pub enum Estado {
    /// Ya en un índice de este equipo. Ni descarga ni GPU: se referencia el
    /// mismo fragmento.
    Local { indice: String, sha256: String },
    /// La cubre un índice publicado. Se descarga su fragmento, con su
    /// atribución pegada.
    Catalogo { indice: String, sha256: String, bytes: u64, atribucion: Atribucion },
    /// No existe en ningún sitio conocido. Es lo único que cuesta cuota y GPU.
    Nuevo,
}

/// Clasifica cada tesela pedida. Devuelve una entrada por tesela y EN EL MISMO
/// ORDEN, para que quien llame pueda cruzarlas con su propia lista sin
/// reordenar.
///
/// Lo local gana sobre el catálogo cuando los dos la tienen: ya está en disco,
/// bajarla otra vez sería exactamente el trabajo que esta función existe para
/// evitar.
pub fn clasificar(
    pedidas: &[String],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Vec<(String, Estado)> {
    pedidas
        .iter()
        .map(|qk| {
            let estado = buscar_local(qk, locales)
                .or_else(|| buscar_catalogo(qk, catalogo))
                .unwrap_or(Estado::Nuevo);
            (qk.clone(), estado)
        })
        .collect()
}

fn buscar_local(qk: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk) {
            return Some(Estado::Local { indice: c.indice.clone(), sha256: t.sha256.clone() });
        }
    }
    None
}

fn buscar_catalogo(qk: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk) {
            return Some(Estado::Catalogo {
                indice: c.indice.clone(),
                sha256: t.sha256.clone(),
                bytes: t.bytes,
                atribucion: c.atribucion.clone(),
            });
        }
    }
    None
}

/// Cuántas teselas de cada clase, que es lo que la interfaz enseña y lo que
/// decide si el botón de indexar existe siquiera.
pub struct Reparto {
    pub locales: usize,
    pub catalogo: usize,
    pub nuevas: usize,
    pub bytes_a_descargar: u64,
}

pub fn repartir(clasificadas: &[(String, Estado)]) -> Reparto {
    let mut r = Reparto { locales: 0, catalogo: 0, nuevas: 0, bytes_a_descargar: 0 };
    for (_, e) in clasificadas {
        match e {
            Estado::Local { .. } => r.locales += 1,
            Estado::Catalogo { bytes, .. } => {
                r.catalogo += 1;
                r.bytes_a_descargar += bytes;
            }
            Estado::Nuevo => r.nuevas += 1,
        }
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cob(indice: &str, autor: &str, qks: &[&str]) -> Cobertura {
        Cobertura {
            version: 1,
            indice: indice.into(),
            sellado_en: "2026-07-28T11:04:00Z".into(),
            atribucion: Atribucion {
                autor: autor.into(),
                url: format!("https://github.com/{autor}"),
                licencia: "CC BY-SA 4.0".into(),
            },
            teselas: qks
                .iter()
                .map(|q| TeselaCubierta {
                    quadkey: (*q).into(),
                    sha256: format!("hash-de-{q}"),
                    bytes: 1024,
                    imagenes: 10,
                })
                .collect(),
        }
    }

    #[test]
    fn lo_cubierto_no_se_reindexa_y_lo_local_gana_al_catalogo() {
        let locales = vec![cob("madrid-centro", "yo", &["A", "B"])];
        let catalogo = vec![cob("marta/lumi-costa", "marta", &["B", "C"])];

        let r = clasificar(&["A".into(), "B".into(), "C".into(), "D".into()], &locales, &catalogo);
        assert_eq!(r.len(), 4, "una entrada por tesela pedida, en el mismo orden");
        assert_eq!(r[0].0, "A");
        assert!(matches!(r[0].1, Estado::Local { .. }));
        // B está en los dos. Gana lo local: ya lo tienes, no hay nada que bajar.
        assert!(matches!(r[1].1, Estado::Local { .. }), "lo local gana: {:?}", r[1].1);
        match &r[2].1 {
            Estado::Catalogo { indice, sha256, .. } => {
                assert_eq!(indice, "marta/lumi-costa");
                assert_eq!(sha256, "hash-de-C");
            }
            otro => panic!("C debería venir del catálogo, y vino {otro:?}"),
        }
        assert!(matches!(r[3].1, Estado::Nuevo), "D no existe en ningún sitio");

        // Un área enteramente cubierta no deja NADA que indexar. Es la
        // condición que apaga el indexado entero, así que se comprueba sola.
        let todo = clasificar(&["A".into(), "C".into()], &locales, &catalogo);
        assert_eq!(todo.iter().filter(|(_, e)| matches!(e, Estado::Nuevo)).count(), 0);

        // Y una parcialmente cubierta devuelve exactamente el complemento.
        let nuevas: Vec<_> = r
            .iter()
            .filter(|(_, e)| matches!(e, Estado::Nuevo))
            .map(|(q, _)| q.clone())
            .collect();
        assert_eq!(nuevas, vec!["D".to_string()]);
    }
}
