//! Carga del registro de niveles (mini/vision/pro) compartido con Station —
//! mismo tipo (`lumi_index::niveles::Nivel`), mismos ficheros en disco. El
//! Indexer no corre el motor de inferencia, pero necesita saber qué modelos
//! de recuperación compone cada nivel para poder embeber la corpus contra
//! ellos: sin esto, "elige mini/vision/pro" no tendría con qué resolverse.

use std::path::Path;

use lumi_index::niveles::Nivel;

/// Lee todos los `.json` de `registros/niveles/`. Mismo patrón que
/// `models::cargar_registro`: un fichero malo se descarta y se registra, no
/// tumba el resto de la lista.
pub fn cargar_registro(dir: &Path) -> Vec<Nivel> {
    let Ok(entradas) = std::fs::read_dir(dir) else {
        log::warn!("no hay directorio de niveles en {}", dir.display());
        return Vec::new();
    };
    let mut fuera = Vec::new();
    let mut rutas: Vec<_> = entradas.flatten().map(|e| e.path()).collect();
    rutas.sort();
    for ruta in rutas {
        if ruta.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        match std::fs::read(&ruta).map_err(anyhow::Error::from).and_then(|b| {
            serde_json::from_slice::<Nivel>(&b).map_err(anyhow::Error::from)
        }) {
            Ok(n) if !n.id.is_empty() => fuera.push(n),
            Ok(n) => log::warn!("nivel descartado, id vacío: {}", n.id),
            Err(e) => log::warn!("nivel descartado, {}: {e}", ruta.display()),
        }
    }
    fuera
}

/// La unión de los modelos de recuperación de los niveles elegidos, sin
/// duplicados. Ids que no están en el registro (un nivel mal escrito, o
/// borrado) se ignoran: no hay nada que resolver para ellos.
pub fn modelos_de_niveles(registro: &[Nivel], elegidos: &[String]) -> Vec<String> {
    let mut vistos = std::collections::HashSet::new();
    let mut fuera = Vec::new();
    for id in elegidos {
        let Some(nivel) = registro.iter().find(|n| &n.id == id) else { continue };
        for m in &nivel.recuperacion {
            if vistos.insert(m.clone()) {
                fuera.push(m.clone());
            }
        }
    }
    fuera
}

#[cfg(test)]
mod tests {
    use super::*;

    fn registro() -> Vec<Nivel> {
        vec![
            Nivel {
                id: "mini".into(), nombre: "Lumi Mini".into(),
                recuperacion: vec!["cosplace".into()], geometricos: vec![], agentes: vec![], cae_a: None,
            },
            Nivel {
                id: "pro".into(), nombre: "Lumi Pro".into(),
                recuperacion: vec!["lumi-2".into(), "eigenplaces".into()], geometricos: vec![], agentes: vec![],
                cae_a: Some("mini".into()),
            },
        ]
    }

    #[test]
    fn une_los_modelos_de_los_niveles_elegidos_sin_repetir() {
        let ids = ["mini".to_string(), "pro".to_string()];
        let m = modelos_de_niveles(&registro(), &ids);
        assert_eq!(m, vec!["cosplace", "lumi-2", "eigenplaces"]);
    }

    #[test]
    fn un_nivel_que_no_existe_no_aporta_nada() {
        let ids = ["fantasma".to_string()];
        assert!(modelos_de_niveles(&registro(), &ids).is_empty());
    }
}
