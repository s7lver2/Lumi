//! Red de seguridad antes de sustituir los archivos de un producto: el
//! camino principal es que la propia app se cierre sola antes de lanzar
//! `installer.exe --silencioso` (ver spec, Flujo B paso 2) — esto es lo que
//! confirma que de verdad ocurrió, con un margen, antes de tocar archivos.

use std::ffi::OsStr;
use std::time::{Duration, Instant};
use sysinfo::{Pid, ProcessesToUpdate, System};

/// Sondea cada 250ms hasta que el proceso `pid` deja de existir, o hasta
/// que pasa `timeout`. `true` = ya no existe (se cerró solo, o nunca
/// existió con ese PID). `false` = seguía vivo cuando se agotó el margen.
pub fn esperar_cierre(pid: u32, timeout: Duration) -> bool {
    let inicio = Instant::now();
    let mut sistema = System::new();
    loop {
        sistema.refresh_processes(ProcessesToUpdate::Some(&[Pid::from_u32(pid)]), true);
        if sistema.process(Pid::from_u32(pid)).is_none() {
            return true;
        }
        if inicio.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

/// La instalación interactiva no tiene un PID que esperar (a diferencia de
/// `--silencioso`, que lo recibe del proceso que lo lanzó): si el
/// investigador dejó `app.exe` abierto y le da a reinstalar, sobrescribir
/// el archivo fallaba con el error de disco crudo de Windows ("el proceso
/// no tiene acceso al archivo..."). Busca por NOMBRE de ejecutable, cierra
/// lo que encuentre, y espera a que de verdad suelte el archivo. `true` si
/// al final no queda nada corriendo con ese nombre (no había, o se cerró a
/// tiempo); `false` si seguía vivo cuando se agotó el margen.
pub fn cerrar_por_nombre(nombre_exe: &str, timeout: Duration) -> bool {
    let mut sistema = System::new_all();
    sistema.refresh_processes(ProcessesToUpdate::All, true);
    let encontrados: Vec<Pid> = sistema
        .processes_by_name(OsStr::new(nombre_exe))
        .map(|p| p.pid())
        .collect();
    if encontrados.is_empty() {
        return true;
    }
    for pid in &encontrados {
        if let Some(proceso) = sistema.process(*pid) {
            proceso.kill();
        }
    }

    let inicio = Instant::now();
    loop {
        sistema.refresh_processes(ProcessesToUpdate::Some(&encontrados), true);
        if encontrados.iter().all(|pid| sistema.process(*pid).is_none()) {
            return true;
        }
        if inicio.elapsed() >= timeout {
            return false;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pid_que_no_existe_devuelve_true_de_inmediato() {
        let inicio = Instant::now();
        assert!(esperar_cierre(999_999, Duration::from_secs(3)));
        // Si de verdad esperó los 3s completos, algo está mal detectando
        // que el PID no existe.
        assert!(inicio.elapsed() < Duration::from_secs(1));
    }

    // `cmd /C timeout /T 5` necesita una consola real (falla de inmediato bajo
    // stdin no interactivo, como en CI o en este harness) — se usa
    // `Start-Sleep` de PowerShell en su lugar, mismo propósito: un proceso
    // hijo que vive unos segundos si nadie lo mata antes.
    fn lanzar_proceso_de_prueba() -> std::process::Child {
        std::process::Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 5"])
            .spawn()
            .expect("no se pudo lanzar el proceso de prueba")
    }

    #[test]
    fn proceso_que_muere_durante_la_espera_se_detecta_antes_del_margen() {
        let mut hijo = lanzar_proceso_de_prueba();
        let pid = hijo.id();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(300));
            let _ = hijo.kill();
        });
        let inicio = Instant::now();
        assert!(esperar_cierre(pid, Duration::from_secs(4)));
        assert!(inicio.elapsed() < Duration::from_secs(4));
    }

    #[test]
    fn proceso_que_no_muere_agota_el_margen_y_devuelve_false() {
        let mut hijo = lanzar_proceso_de_prueba();
        let pid = hijo.id();
        assert!(!esperar_cierre(pid, Duration::from_millis(500)));
        let _ = hijo.kill();
    }
}
