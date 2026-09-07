//! Dónde viven `registros/` y `workers/`, en una instalación real o en
//! desarrollo -- una única regla, en vez de repetir tres candidatos sueltos
//! en cada sitio que necesita uno de estos dos directorios.

use std::path::{Path, PathBuf};

/// `relativo` es algo como `"registros/niveles"` o `"workers/lumi_geo.py"`.
///
/// Primero bajo `LUMI_DATA` (`/var/lib/lumi` en una instalación real):
/// `lumi install` copia ahí `registros/` y `workers/` en cada instalación, así
/// que eso es lo correcto una vez instalado, sin importar si el checkout que
/// lo compiló sigue existiendo o se movió -- systemd arranca con el
/// directorio de trabajo en `/`, así que una ruta relativa a secas nunca
/// encuentra nada ahí.
///
/// Si no está ahí (todavía no se ha reinstalado desde que existe esta copia,
/// o `LUMI_DATA` no está fijado), se prueba junto al checkout donde se
/// COMPILÓ este binario: `cargo build` en el propio servidor sigue
/// funcionando sin pasar por `lumi install` de nuevo.
///
/// Por último, relativo al directorio de trabajo -- `cargo run`/tests
/// lanzados desde la raíz del repositorio, que es como se desarrolla esto.
pub fn ruta(relativo: &str) -> PathBuf {
    if let Ok(data) = std::env::var("LUMI_DATA") {
        let candidato = Path::new(&data).join(relativo);
        if candidato.exists() {
            return candidato;
        }
    }
    let del_checkout = Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../..")).join(relativo);
    if del_checkout.exists() {
        return del_checkout;
    }
    PathBuf::from(relativo)
}

/// Dónde viven los pesos de modelos/verificadores/motores: `models_dir` en
/// `meta` manda si `lumi install` fijó un disco aparte, y si no, `runtime/pesos`
/// junto a los datos del daemon. Único sitio que decide esto -- antes lo
/// repetían por separado la descarga y el check de "instalado" de
/// `routes::models` (fallback `"runtime/pesos"`) y los lanzadores de
/// trabajador/verificador en `queue::mod` (fallback `dir.join("runtime")`,
/// SIN el `pesos` final): un modelo descargado y marcado "listo" en la
/// pantalla de Modelos no se encontraba nunca al lanzar un análisis real,
/// porque el trabajador miraba en `runtime/` y los pesos estaban en
/// `runtime/pesos/`.
pub fn pesos_dir(store: &crate::store::Store, dir: &Path) -> PathBuf {
    store.get_meta("models_dir").map(PathBuf::from).unwrap_or_else(|| dir.join("runtime").join("pesos"))
}
