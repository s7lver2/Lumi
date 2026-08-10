//! Lanzar procesos hijo sin que Windows abra una ventana de consola.
//!
//! Una aplicación de ventanas en Windows no tiene consola, así que el sistema
//! le crea una a cada proceso hijo: una ventana negra que aparece y desaparece.
//! En `dev` no se nota, porque la terminal desde la que se arrancó se la traga;
//! en release se ve. Y como `nvidia-smi` se sondea cada 2,5 s para la píldora
//! de rendimiento, lo que se veía no era un parpadeo puntual sino una terminal
//! abriéndose y cerrándose sin parar.
//!
//! Todo el que lance un hijo pasa por aquí, y por eso son constructores en vez
//! de un método que se pueda olvidar en la cadena. Fuera de Windows no hacen
//! nada más que `Command::new`.

use std::ffi::OsStr;

/// `CREATE_NO_WINDOW`, de la API de Windows. Se escribe a mano en vez de traer
/// `windows-sys` entero por una constante.
#[cfg(windows)]
const SIN_CONSOLA: u32 = 0x0800_0000;

/// Para lo que se lanza y se espera en el sitio (`output`, `status`). Va desde
/// `spawn_blocking`, nunca desde un comando async.
pub fn cmd(programa: impl AsRef<OsStr>) -> std::process::Command {
    #[allow(unused_mut)]
    let mut c = std::process::Command::new(programa);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(SIN_CONSOLA);
    }
    c
}

/// Para lo que vive dentro del runtime: servicios, el trabajador de embebido.
pub fn cmd_async(programa: impl AsRef<OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut c = tokio::process::Command::new(programa);
    #[cfg(windows)]
    c.creation_flags(SIN_CONSOLA);
    c
}
