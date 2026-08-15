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
