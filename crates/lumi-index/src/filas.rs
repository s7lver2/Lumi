//! Las filas de imagen que viajan DENTRO del paquete, una lista por quadkey.
//!
//! Existen porque un vector sin esto no sirve de nada: `lumid` necesita
//! `lat`/`lng` para poner el punto en el mapa y `fuente` para poder atribuir
//! el candidato, y ninguna de las dos cosas está en la ficha (que es en claro
//! y de kilobytes a propósito) ni se puede deducir de la imagen. Antes se
//! esperaba encontrarlas en un `indice.db` dentro del paquete que el sellado
//! nunca escribió, así que instalar un índice fallaba siempre.
//!
//! Un fichero por quadkey, y no uno global, por el contrato de orden: el
//! fragmento (`fragmentos/<quadkey>/<modelo>-<version>.i8`) ata cada vector a
//! su imagen por POSICIÓN dentro del fichero de ESE quadkey. Teniendo las
//! filas partidas igual, la fila N de un quadkey es el vector N del mismo
//! quadkey y no hay que suponer nada sobre en qué orden concatenar teselas
//! distintas — que era justo la aproximación que este formato tenía antes.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// Una imagen del paquete. `ruta` es el nombre de fichero dentro de
/// `imagenes/`, no una ruta de la máquina que sellò: la carpeta local del
/// autor no es asunto de quien instala.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FilaImagen {
    pub ruta: String,
    pub lat: f64,
    pub lng: f64,
    pub fuente: String,
}

/// La carpeta donde viven, dentro de la raíz del paquete.
pub const DIR: &str = "filas";

fn ruta_de(raiz: &Path, quadkey: &str) -> std::path::PathBuf {
    raiz.join(DIR).join(format!("{quadkey}.jsonl"))
}

/// JSONL y no un JSON con un array: una tesela real trae miles de filas, y así
/// se escribe y se lee de una pasada sin cargar el documento entero.
pub fn escribir(raiz: &Path, quadkey: &str, filas: &[FilaImagen]) -> Result<()> {
    let destino = ruta_de(raiz, quadkey);
    if let Some(p) = destino.parent() {
        std::fs::create_dir_all(p).with_context(|| format!("crear {}", p.display()))?;
    }
    let mut texto = String::new();
    for f in filas {
        texto.push_str(&serde_json::to_string(f)?);
        texto.push('\n');
    }
    std::fs::write(&destino, texto).with_context(|| format!("escribir {}", destino.display()))
}

/// Las filas de un quadkey, en el orden en que se escribieron. Una línea que
/// no se puede leer se salta — pero eso DESALINEARÍA las posiciones frente al
/// fragmento, así que se cuenta y quien llama decide: ver `leer_estricto`.
pub fn leer(raiz: &Path, quadkey: &str) -> Result<Vec<FilaImagen>> {
    let (filas, malas) = leer_estricto(raiz, quadkey)?;
    if malas > 0 {
        return Err(anyhow::anyhow!(
            "{} tiene {malas} línea(s) ilegibles: las posiciones ya no cuadrarían con el \
             fragmento y cada imagen quedaría pegada a las coordenadas de otra",
            ruta_de(raiz, quadkey).display()
        ));
    }
    Ok(filas)
}

/// Como `leer`, pero devuelve cuántas líneas no se pudieron interpretar en vez
/// de fallar. Separado para que el error de arriba pueda decir cuántas son.
pub fn leer_estricto(raiz: &Path, quadkey: &str) -> Result<(Vec<FilaImagen>, usize)> {
    let destino = ruta_de(raiz, quadkey);
    let texto = std::fs::read_to_string(&destino)
        .with_context(|| format!("leer {}", destino.display()))?;
    let mut filas = Vec::new();
    let mut malas = 0usize;
    for linea in texto.lines().filter(|l| !l.trim().is_empty()) {
        match serde_json::from_str::<FilaImagen>(linea) {
            Ok(f) => filas.push(f),
            Err(_) => malas += 1,
        }
    }
    Ok((filas, malas))
}

/// Las teselas para las que el paquete abierto en `raiz` trae filas. Vacío si
/// no trae la carpeta — que es lo que hay que distinguir de "la trae vacía".
pub fn quadkeys(raiz: &Path) -> Vec<String> {
    let Ok(it) = std::fs::read_dir(raiz.join(DIR)) else {
        return Vec::new();
    };
    let mut fuera: Vec<String> = it
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e == "jsonl"))
        .filter_map(|p| p.file_stem().and_then(|s| s.to_str()).map(str::to_string))
        .collect();
    fuera.sort();
    fuera
}

/// `true` si el paquete abierto en `raiz` trae filas para este quadkey.
pub fn hay(raiz: &Path, quadkey: &str) -> bool {
    ruta_de(raiz, quadkey).is_file()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn una(ruta: &str, lat: f64) -> FilaImagen {
        FilaImagen { ruta: ruta.into(), lat, lng: -5.5, fuente: "mapillary".into() }
    }

    #[test]
    fn van_y_vuelven_en_el_mismo_orden() {
        let d = tempfile::tempdir().unwrap();
        let filas = vec![una("a.jpg", 1.0), una("b.jpg", 2.0), una("c.jpg", 3.0)];
        escribir(d.path(), "0313", &filas).unwrap();
        assert!(hay(d.path(), "0313"));
        // El orden es el contrato entero: si esto se permutara, cada vector
        // quedaría pegado a las coordenadas de otra imagen.
        assert_eq!(leer(d.path(), "0313").unwrap(), filas);
    }

    #[test]
    fn una_linea_rota_no_se_traga_en_silencio() {
        let d = tempfile::tempdir().unwrap();
        escribir(d.path(), "0313", &[una("a.jpg", 1.0)]).unwrap();
        let p = d.path().join(DIR).join("0313.jsonl");
        let mut texto = std::fs::read_to_string(&p).unwrap();
        texto.push_str("{esto no es json}\n");
        std::fs::write(&p, texto).unwrap();
        assert!(leer(d.path(), "0313").is_err());
    }

    #[test]
    fn se_listan_las_teselas_con_filas() {
        let d = tempfile::tempdir().unwrap();
        escribir(d.path(), "0313", &[una("a.jpg", 1.0)]).unwrap();
        escribir(d.path(), "0311", &[una("b.jpg", 2.0)]).unwrap();
        assert_eq!(quadkeys(d.path()), vec!["0311".to_string(), "0313".to_string()]);
    }

    #[test]
    fn sin_carpeta_no_hay_teselas() {
        assert!(quadkeys(tempfile::tempdir().unwrap().path()).is_empty());
    }

    #[test]
    fn sin_fichero_no_hay_filas() {
        let d = tempfile::tempdir().unwrap();
        assert!(!hay(d.path(), "0313"));
        assert!(leer(d.path(), "0313").is_err());
    }
}
