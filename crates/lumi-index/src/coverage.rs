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
    /// Los orígenes cuyo material viaja DE VERDAD en este fragmento. Un paquete
    /// no lleva lo no redistribuible, así que heredarlo no cubre esos orígenes
    /// y quien lo instale sigue teniendo que bajarlos.
    ///
    /// `default` porque los paquetes sellados antes del 7b no la traen: para
    /// ellos la lista queda vacía y todos sus orígenes salen como nuevos, que
    /// es la respuesta conservadora y correcta.
    #[serde(default)]
    pub fuentes: Vec<String>,
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
///
/// ponytail: la tarea 2 no lo pedía serializable (sus tests solo comparan en
/// memoria), pero la tarea 15 lo devuelve tal cual por un comando Tauri, y sin
/// `Serialize` eso no compila. Añadirlo aquí en vez de duplicar el tipo del
/// lado de la aplicación.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "estado", rename_all = "lowercase")]
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

/// Igual que `clasificar`, pero respondiendo la pregunta que el 7b necesita:
/// «¿esta tesela, en ESTE origen?». Devuelve un mapa por tesela, en el mismo
/// orden de `pedidas`.
///
/// Un paquete solo cubre los orígenes que declara en `fuentes`, porque es lo
/// único que llevaba dentro. La cobertura no redistribuible del publicador no
/// se hereda, y eso no es un fallo: es lo que su licencia permite.
pub fn clasificar_por_origen(
    pedidas: &[String],
    fuentes: &[String],
    locales: &[Cobertura],
    catalogo: &[Cobertura],
) -> Vec<(String, std::collections::BTreeMap<String, Estado>)> {
    pedidas
        .iter()
        .map(|qk| {
            let mut por_fuente = std::collections::BTreeMap::new();
            for f in fuentes {
                let estado = buscar_local_con(qk, f, locales)
                    .or_else(|| buscar_catalogo_con(qk, f, catalogo))
                    .unwrap_or(Estado::Nuevo);
                por_fuente.insert(f.clone(), estado);
            }
            (qk.clone(), por_fuente)
        })
        .collect()
}

fn buscar_local_con(qk: &str, fuente: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk && t.fuentes.iter().any(|f| f == fuente)) {
            return Some(Estado::Local { indice: c.indice.clone(), sha256: t.sha256.clone() });
        }
    }
    None
}

fn buscar_catalogo_con(qk: &str, fuente: &str, cobs: &[Cobertura]) -> Option<Estado> {
    for c in cobs {
        if let Some(t) = c.teselas.iter().find(|t| t.quadkey == qk && t.fuentes.iter().any(|f| f == fuente)) {
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

/// Un `Reparto` por origen. Es lo que alimenta la estimación: `nuevas` es lo
/// único que cuesta cuota y GPU.
pub fn repartir_por_origen(
    clasificadas: &[(String, std::collections::BTreeMap<String, Estado>)],
) -> std::collections::BTreeMap<String, Reparto> {
    let mut fuera: std::collections::BTreeMap<String, Reparto> = Default::default();
    for (_, por_fuente) in clasificadas {
        for (f, e) in por_fuente {
            let r = fuera
                .entry(f.clone())
                .or_insert(Reparto { locales: 0, catalogo: 0, nuevas: 0, bytes_a_descargar: 0 });
            match e {
                Estado::Local { .. } => r.locales += 1,
                Estado::Catalogo { bytes, .. } => {
                    r.catalogo += 1;
                    r.bytes_a_descargar += bytes;
                }
                Estado::Nuevo => r.nuevas += 1,
            }
        }
    }
    fuera
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
                    fuentes: vec![],
                })
                .collect(),
        }
    }

    fn cob_con_fuentes(indice: &str, autor: &str, qks: &[(&str, &[&str])]) -> Cobertura {
        Cobertura {
            version: 1,
            indice: indice.into(),
            sellado_en: "2026-08-07T09:00:00Z".into(),
            atribucion: Atribucion {
                autor: autor.into(),
                url: format!("https://github.com/{autor}"),
                licencia: "CC BY-SA 4.0".into(),
            },
            teselas: qks
                .iter()
                .map(|(q, fs)| TeselaCubierta {
                    quadkey: (*q).into(),
                    sha256: format!("hash-de-{q}"),
                    bytes: 1024,
                    imagenes: 10,
                    fuentes: fs.iter().map(|f| (*f).to_string()).collect(),
                })
                .collect(),
        }
    }

    #[test]
    fn una_tesela_publicada_sin_google_sigue_siendo_nueva_en_google() {
        // Marta publicó A y B, pero su paquete solo pudo llevar Mapillary:
        // su cobertura de Google no era redistribuible y no viajó.
        let catalogo = vec![cob_con_fuentes(
            "marta/lumi-costa",
            "marta",
            &[("A", &["mapillary"]), ("B", &["mapillary", "commons"])],
        )];
        let fuentes = vec!["mapillary".to_string(), "google".to_string(), "commons".to_string()];

        let r = clasificar_por_origen(&["A".into(), "B".into()], &fuentes, &[], &catalogo);
        assert_eq!(r.len(), 2, "una entrada por tesela pedida, en el mismo orden");
        assert_eq!(r[0].0, "A");

        let a = &r[0].1;
        assert!(matches!(a["mapillary"], Estado::Catalogo { .. }), "A en mapillary ya está");
        assert!(matches!(a["google"], Estado::Nuevo), "A en google NO se hereda");
        assert!(matches!(a["commons"], Estado::Nuevo), "A tampoco trae commons");

        let b = &r[1].1;
        assert!(matches!(b["commons"], Estado::Catalogo { .. }), "B sí trae commons");
        assert!(matches!(b["google"], Estado::Nuevo));

        // El reparto se cuenta por origen, y es lo que la estimación necesita:
        // solo lo `Nuevo` cuesta cuota.
        let rep = repartir_por_origen(&r);
        assert_eq!(rep["mapillary"].nuevas, 0);
        assert_eq!(rep["google"].nuevas, 2, "las dos teselas hay que bajarlas de google");
        assert_eq!(rep["commons"].nuevas, 1);
        assert_eq!(rep["mapillary"].catalogo, 2);
    }

    #[test]
    fn lo_local_sigue_ganando_al_catalogo_tambien_por_origen() {
        let locales = vec![cob_con_fuentes("mio", "yo", &[("A", &["mapillary"])])];
        let catalogo = vec![cob_con_fuentes("otro/x", "otro", &[("A", &["mapillary"])])];
        let r = clasificar_por_origen(&["A".into()], &["mapillary".into()], &locales, &catalogo);
        assert!(matches!(r[0].1["mapillary"], Estado::Local { .. }));
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
