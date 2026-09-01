//! Dónde vive todo, y cómo se muda. La carpeta de datos por defecto vive en
//! el home del operador, pero las imágenes crecen y el disco del sistema no
//! siempre tiene sitio. El fichero-puntero que dice "búscalo en otro lado"
//! vive SIEMPRE en el home — nunca dentro de la propia carpeta de datos,
//! porque si viviera ahí se perdería justo al moverla.
//!
//! La migración copia primero, verifica tamaño a tamaño, y solo entonces
//! borra el origen y escribe el puntero nuevo: si algo falla a mitad (disco
//! lleno, permiso denegado), el origen sigue intacto y no se pierde nada.
//! No hay comprobación previa de espacio libre — sería una mejora razonable,
//! pero fallar a mitad con el origen todavía ahí ya es seguro sin ella.

use std::io;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::store::Almacen;

fn base_home() -> PathBuf {
    let base = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base)
}

fn ruta_puntero() -> PathBuf {
    base_home().join(".lumi-indexer-ubicacion")
}

pub fn directorio_por_defecto() -> PathBuf {
    base_home().join(".lumi-indexer")
}

/// `LUMI_INDEXER_DATA` (pruebas) manda siempre; si no, el puntero, si existe;
/// si no, el sitio de siempre.
pub fn leer_ubicacion() -> PathBuf {
    if let Ok(d) = std::env::var("LUMI_INDEXER_DATA") {
        return PathBuf::from(d);
    }
    if let Ok(texto) = std::fs::read_to_string(ruta_puntero()) {
        let p = texto.trim();
        if !p.is_empty() {
            return PathBuf::from(p);
        }
    }
    directorio_por_defecto()
}

fn guardar_ubicacion(nueva: &Path) -> io::Result<()> {
    std::fs::write(ruta_puntero(), nueva.display().to_string())
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ProgresoMigracion {
    pub trabajando: bool,
    pub bytes_copiados: u64,
    pub bytes_total: u64,
    pub archivo_actual: String,
    pub terminado: bool,
    pub error: Option<String>,
}

pub struct Migracion {
    progreso: Mutex<ProgresoMigracion>,
}

impl Migracion {
    pub fn progreso(&self) -> ProgresoMigracion {
        self.progreso.lock().unwrap().clone()
    }

    /// `almacen` es el `Almacen` compartido de toda la app (mismo `Arc` que
    /// `Estado.almacen`): hace falta para soltar el handle SQLite del origen
    /// antes de borrarlo (#55) y para dejarlo sirviendo ya desde el destino
    /// sin reiniciar (#56 — ver `Almacen::reabrir_en`).
    pub fn arrancar(origen: PathBuf, destino: PathBuf, almacen: Arc<Almacen>) -> Arc<Self> {
        let m = Arc::new(Self {
            progreso: Mutex::new(ProgresoMigracion { trabajando: true, ..Default::default() }),
        });
        let m2 = m.clone();
        std::thread::spawn(move || {
            m2.progreso.lock().unwrap().bytes_total = tamano_total(&origen).unwrap_or(0);
            // Fusiona el WAL antes de copiar a mano: si no, la copia de
            // indexer.db/-wal/-shm podría capturar una escritura a medias.
            almacen.checkpoint();
            match copiar_arbol(&origen, &destino, &m2) {
                Ok(()) => match almacen.reabrir_en(&destino) {
                    Ok(()) => match std::fs::remove_dir_all(&origen) {
                        Ok(()) => match guardar_ubicacion(&destino) {
                            Ok(()) => {
                                let mut p = m2.progreso.lock().unwrap();
                                p.trabajando = false;
                                p.terminado = true;
                            }
                            Err(e) => fallar(&m2, format!(
                                "se copió y se borró el origen, pero no se pudo guardar la nueva ubicación: {e}"
                            )),
                        },
                        // El origen sigue ahí pero ya no tiene ningún handle nuestro
                        // encima (el Almacen ya sirve desde el destino) — no vale la
                        // pena bloquear al usuario por esto, los datos ya están a salvo
                        // en el destino y el puntero ya apunta ahí.
                        Err(e) => {
                            eprintln!(
                                "migración: no se pudo borrar el origen ({}): {e} — se deja como \
                                 residuo, los datos ya viven en el destino",
                                origen.display()
                            );
                            match guardar_ubicacion(&destino) {
                                Ok(()) => {
                                    let mut p = m2.progreso.lock().unwrap();
                                    p.trabajando = false;
                                    p.terminado = true;
                                    p.error = Some(format!(
                                        "todo migrado y en uso desde el destino; no se pudo borrar el \
                                         origen ({}) — bórralo a mano cuando quieras",
                                        origen.display()
                                    ));
                                }
                                Err(e) => fallar(&m2, format!(
                                    "se copió todo pero no se pudo guardar la nueva ubicación: {e}"
                                )),
                            }
                        }
                    },
                    Err(e) => fallar(&m2, format!(
                        "se copió todo, pero no se pudo reabrir el almacén en el destino: {e}"
                    )),
                },
                Err(e) => fallar(&m2, e.to_string()),
            }
        });
        m
    }
}

fn fallar(m: &Migracion, mensaje: String) {
    let mut p = m.progreso.lock().unwrap();
    p.trabajando = false;
    p.error = Some(mensaje);
}

fn tamano_total(dir: &Path) -> io::Result<u64> {
    let mut total = 0u64;
    for entrada in std::fs::read_dir(dir)? {
        let entrada = entrada?;
        let ruta = entrada.path();
        total += if ruta.is_dir() { tamano_total(&ruta)? } else { entrada.metadata()?.len() };
    }
    Ok(total)
}

fn copiar_arbol(origen: &Path, destino: &Path, m: &Migracion) -> io::Result<()> {
    std::fs::create_dir_all(destino)?;
    for entrada in std::fs::read_dir(origen)? {
        let entrada = entrada?;
        let ruta_origen = entrada.path();
        let ruta_destino = destino.join(entrada.file_name());
        if ruta_origen.is_dir() {
            copiar_arbol(&ruta_origen, &ruta_destino, m)?;
            continue;
        }
        m.progreso.lock().unwrap().archivo_actual = entrada.file_name().to_string_lossy().to_string();
        let origen_len = entrada.metadata()?.len();
        let copiados = std::fs::copy(&ruta_origen, &ruta_destino)?;
        if copiados != origen_len {
            return Err(io::Error::other(format!(
                "copia incompleta de {}: {copiados} de {origen_len} bytes",
                ruta_origen.display()
            )));
        }
        m.progreso.lock().unwrap().bytes_copiados += copiados;
    }
    Ok(())
}
