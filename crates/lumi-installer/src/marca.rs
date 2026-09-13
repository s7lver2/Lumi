//! Detección de "ya instalado" vía el registro de Windows — mismo lugar
//! que cualquier instalador de Windows usa
//! (`HKCU\...\Uninstall\<AppId>`), para que Panel de Control/Configuración
//! también vea el producto. Los GUID son los mismos que llevaban los
//! `.iss` de Inno de esta sesión, por continuidad si una máquina ya tenía
//! esa instalación.

use std::path::{Path, PathBuf};
use winreg::enums::HKEY_CURRENT_USER;
use winreg::RegKey;

const RUTA_UNINSTALL: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Marca {
    pub version: String,
    pub ruta: PathBuf,
}

fn app_id(producto: &str) -> &'static str {
    match producto {
        "cliente" => "{E3B0C442-98FC-4E1B-8C6F-LUMICLIENTE01}",
        "indexer" => "{F4C1D553-99FD-4F2C-9D7A-LUMIINDEXER01}",
        otro => panic!("producto desconocido: {otro}"),
    }
}

pub fn escribir(producto: &str, nombre: &str, version: &str, ruta: &Path) -> std::io::Result<()> {
    escribir_bajo(RUTA_UNINSTALL, producto, nombre, version, ruta)
}

pub fn leer(producto: &str) -> Option<Marca> {
    leer_bajo(RUTA_UNINSTALL, producto)
}

fn escribir_bajo(
    raiz: &str,
    producto: &str,
    nombre: &str,
    version: &str,
    ruta: &Path,
) -> std::io::Result<()> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let clave = format!("{raiz}\\{}", app_id(producto));
    let (key, _) = hkcu.create_subkey(&clave)?;
    key.set_value("DisplayName", &nombre)?;
    key.set_value("DisplayVersion", &version)?;
    key.set_value("InstallLocation", &ruta.to_string_lossy().to_string())?;
    Ok(())
}

fn leer_bajo(raiz: &str, producto: &str) -> Option<Marca> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let clave = format!("{raiz}\\{}", app_id(producto));
    let key = hkcu.open_subkey(&clave).ok()?;
    let version: String = key.get_value("DisplayVersion").ok()?;
    let ruta: String = key.get_value("InstallLocation").ok()?;
    Some(Marca { version, ruta: PathBuf::from(ruta) })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Clave de prueba aparte de la real (RUTA_UNINSTALL) para no tocar el
    // registro de verdad de la máquina que corre los tests.
    const RAIZ_PRUEBA: &str = "Software\\LumiInstallerTests";

    /// Una subclave PROPIA por test, no una compartida: `cargo test` corre los
    /// tests de un mismo módulo en hilos distintos por defecto, y los tres de
    /// aquí escriben bajo el mismo `app_id` (`cliente`/`indexer`) — con una
    /// única `RAIZ_PRUEBA` para todos, el `limpiar()` de un test podía borrar
    /// a mitad la clave que otro acababa de escribir, o dos escrituras
    /// concurrentes pisarse entre sí. El síntoma real, intermitente: el valor
    /// de OTRO test aparecía leído en `cliente_e_indexer_son_entradas_independientes`.
    /// Cada test aísla la suya con su propio nombre como sufijo, así que ya no
    /// hay clave compartida de la que depender ni orden que asumir.
    fn raiz_de(test: &str) -> String {
        format!("{RAIZ_PRUEBA}\\{test}")
    }

    fn limpiar(raiz: &str) {
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let _ = hkcu.delete_subkey_all(raiz);
    }

    #[test]
    fn escribe_y_relee_la_misma_marca() {
        let raiz = raiz_de("escribe_y_relee_la_misma_marca");
        limpiar(&raiz);
        escribir_bajo(&raiz, "cliente", "Lumi", "2.3.0", Path::new("C:\\Lumi\\Cliente"))
            .expect("escribir_bajo no deberia fallar");
        let leida = leer_bajo(&raiz, "cliente").expect("deberia haber marca");
        assert_eq!(leida.version, "2.3.0");
        assert_eq!(leida.ruta, PathBuf::from("C:\\Lumi\\Cliente"));
        limpiar(&raiz);
    }

    #[test]
    fn leer_sin_marca_previa_da_none() {
        let raiz = raiz_de("leer_sin_marca_previa_da_none");
        limpiar(&raiz);
        assert!(leer_bajo(&raiz, "indexer").is_none());
    }

    #[test]
    fn cliente_e_indexer_son_entradas_independientes() {
        let raiz = raiz_de("cliente_e_indexer_son_entradas_independientes");
        limpiar(&raiz);
        escribir_bajo(&raiz, "cliente", "Lumi", "1.0.0", Path::new("C:\\a")).unwrap();
        escribir_bajo(&raiz, "indexer", "Lumi Indexer", "1.0.0", Path::new("C:\\b")).unwrap();
        assert_eq!(leer_bajo(&raiz, "cliente").unwrap().ruta, PathBuf::from("C:\\a"));
        assert_eq!(leer_bajo(&raiz, "indexer").unwrap().ruta, PathBuf::from("C:\\b"));
        limpiar(&raiz);
    }
}
