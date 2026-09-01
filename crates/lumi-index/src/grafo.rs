//! Resolver las dependencias de un paquete antes de descargarlo.
//!
//! Lo que no indexas porque ya lo cubría otro se declara, y ese grafo ES el
//! árbol de «hecho con la colaboración de»: no se construye aparte.

use std::collections::HashSet;

use serde::Serialize;

use crate::ficha::Ficha;

#[derive(Debug, Clone, Serialize)]
pub struct Nodo {
    pub paquete: String,
    pub autor: String,
    pub url: String,
    pub sha256: String,
    pub bytes: u64,
    pub quadkeys: usize,
    pub profundidad: u32,
    /// Una dependencia que no se pudo resolver no aborta nada: se marca y se
    /// instala lo que hay. Un índice incompleto y honesto sirve.
    pub roto: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Grafo {
    pub nodos: Vec<Nodo>,
    pub bytes_total: u64,
    pub quadkeys_total: usize,
    pub rotas: Vec<String>,
}

/// Recorrido en anchura con memoria de lo ya visto. Sin ese corte, dos
/// paquetes que se citan entre sí cuelgan la instalación para siempre.
pub fn resolver(raiz: &Ficha, buscar: &dyn Fn(&str) -> Option<Ficha>) -> Grafo {
    let mut g = Grafo::default();
    let mut vistos: HashSet<String> = HashSet::new();
    let mut cola: Vec<(Ficha, u32)> = vec![(raiz.clone(), 0)];
    vistos.insert(raiz.paquete.clone());

    while !cola.is_empty() {
        let nivel = std::mem::take(&mut cola);
        for (f, profundidad) in nivel {
            let bytes: u64 = f.cuerpos.iter().map(|c| c.bytes).sum();
            g.bytes_total += bytes;
            g.quadkeys_total += f.fuentes_por_quadkey.len();
            g.nodos.push(Nodo {
                paquete: f.paquete.clone(),
                autor: f.autor.clone(),
                url: f.cuerpos.first().map(|c| c.nombre.clone()).unwrap_or_default(),
                sha256: f.cuerpos.first().map(|c| c.sha256.clone()).unwrap_or_default(),
                bytes,
                quadkeys: f.fuentes_por_quadkey.len(),
                profundidad,
                roto: false,
            });
            for d in &f.dependencias {
                if !vistos.insert(d.paquete.clone()) {
                    continue;
                }
                match buscar(&d.paquete) {
                    Some(hija) => cola.push((hija, profundidad + 1)),
                    None => g.rotas.push(d.paquete.clone()),
                }
            }
        }
    }
    g
}


#[cfg(test)]
mod tests {
    use super::*;
    use crate::ficha::{Dependencia, Ficha};

    fn ficha(paquete: &str, deps: &[&str]) -> Ficha {
        Ficha {
            version: 1, paquete: paquete.into(), nombre: paquete.into(),
            numero_version: 1, version_anterior: None,
            autor: "quien".into(), alojamiento: "github".into(),
            clave_publica: String::new(), publicada_en: String::new(),
            vigente_hasta: String::new(), cifrado: String::new(),
            no_redistribuible: vec![], fuentes_por_quadkey: vec![],
            cuerpos: vec![], capas: vec![],
            dependencias: deps.iter().map(|d| Dependencia {
                quadkeys: vec![format!("qk-{d}")], paquete: (*d).into(),
                autor: "otro".into(), url: format!("http://x/{d}"), sha256: "aa".into(),
            }).collect(),
            firma: String::new(),
        }
    }

    #[test]
    fn resuelve_en_cadena() {
        let a = ficha("a", &["b"]);
        let g = resolver(&a, &|p| match p {
            "b" => Some(ficha("b", &["c"])),
            "c" => Some(ficha("c", &[])),
            _ => None,
        });
        let nombres: Vec<&str> = g.nodos.iter().map(|n| n.paquete.as_str()).collect();
        assert_eq!(nombres, vec!["a", "b", "c"]);
    }

    // Sin corte, dos paquetes que se citan entre sí cuelgan la instalación.
    #[test]
    fn un_ciclo_no_cuelga() {
        let a = ficha("a", &["b"]);
        let g = resolver(&a, &|p| match p {
            "b" => Some(ficha("b", &["a"])),
            _ => None,
        });
        assert_eq!(g.nodos.len(), 2);
    }

    // Una dependencia muerta no aborta la instalación: se instala lo que hay
    // y se dice qué falta. El indice sirve, incompleto y honesto.
    #[test]
    fn una_dependencia_rota_se_marca_y_no_aborta() {
        let a = ficha("a", &["fantasma"]);
        let g = resolver(&a, &|_| None);
        assert_eq!(g.rotas, vec!["fantasma".to_string()]);
        assert_eq!(g.nodos.len(), 1);
    }

    #[test]
    fn un_paquete_sin_dependencias_es_autonomo() {
        let g = resolver(&ficha("solo", &[]), &|_| None);
        assert_eq!(g.nodos.len(), 1);
        assert!(g.rotas.is_empty());
    }
}
