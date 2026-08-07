//! La revisión por excepción.
//!
//! Las reglas baratas (`lumi_index::filter`) ya corrieron en la descarga. Esto
//! es la otra mitad: TODO llega aceptado por defecto y el operador clica lo
//! malo. Aprobar tres mil fotos de una en una no lo hace nadie dos veces.
//!
//! Solo pasan por aquí las SUELTAS. Una panorámica de calle o una tesela
//! cenital son capturas sistemáticas: no hay nada que juzgar en ellas, y
//! revisar cuatro rumbos por cada punto de cada calle es exactamente el muro
//! que esto intenta evitar.

use anyhow::Result;
use serde::Serialize;

use crate::store::{Almacen, Cuentas};

#[derive(Debug, Clone, Serialize)]
pub struct Ficha {
    pub id: i64,
    pub ruta: String,
    pub fuente: String,
    pub licencia: Option<String>,
}

pub fn pendientes(almacen: &Almacen, indice_id: i64, limite: u32) -> Result<Vec<Ficha>> {
    Ok(almacen
        .revision_pendientes(indice_id, limite)?
        .into_iter()
        .map(|(id, ruta, fuente, licencia)| Ficha { id, ruta, fuente, licencia })
        .collect())
}

/// Descartar MARCA, no borra: en una rejilla de miles, un clic accidental no
/// puede ser irreversible. Una imagen sin vector sigue siendo material
/// recuperable si el operador cambia de opinión.
///
/// `indice_id` va aparte y no se deduce de los ids: una imagen sabe a qué
/// índice pertenece, pero una lista vacía no sabría a cuál devolver las cuentas.
pub fn rechazar(almacen: &Almacen, indice_id: i64, ids: &[i64]) -> Result<Cuentas> {
    almacen.revision_marcar(ids, "rechazada")?;
    almacen.revision_cuentas(indice_id)
}

/// Cierra la revisión. No resucita lo ya rechazado.
pub fn aceptar_resto(almacen: &Almacen, indice_id: i64) -> Result<Cuentas> {
    almacen.revision_aceptar_resto(indice_id)?;
    almacen.revision_cuentas(indice_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn con_dos_sueltas() -> (tempfile::TempDir, Almacen, i64) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        let i = a.crear_indice("x", "x").unwrap();
        let l = a.crear_lote(i, "red", "commons", Some("suelta"), "commons", None, None, false).unwrap();
        for n in ["a", "b", "c"] {
            a.insertar_imagen_pendiente_de_revision(i, l, n).unwrap();
        }
        (d, a, i)
    }

    #[test]
    fn todo_entra_aceptado_y_solo_sale_lo_que_se_clica() {
        let (_d, a, i) = con_dos_sueltas();
        let p = a.revision_pendientes(i, 100).unwrap();
        assert_eq!(p.len(), 3, "las tres esperan revisión");

        // Rechazar una la saca; las otras dos siguen esperando.
        a.revision_marcar(&[p[0].0], "rechazada").unwrap();
        let c = a.revision_cuentas(i).unwrap();
        assert_eq!(c.rechazadas, 1);
        assert_eq!(c.pendientes, 2);
        assert_eq!(c.aceptadas, 0);

        // Y aceptar el resto cierra la revisión de una vez: es lo que hace que
        // tres mil fotos sean tratables.
        a.revision_aceptar_resto(i).unwrap();
        let c = a.revision_cuentas(i).unwrap();
        assert_eq!(c.pendientes, 0);
        assert_eq!(c.aceptadas, 2);
        assert_eq!(c.rechazadas, 1, "aceptar el resto NO resucita lo rechazado");
    }

    #[test]
    fn una_rechazada_no_se_borra_y_no_se_embebe() {
        let (_d, a, i) = con_dos_sueltas();
        let p = a.revision_pendientes(i, 100).unwrap();
        a.revision_marcar(&[p[0].0], "rechazada").unwrap();
        a.revision_aceptar_resto(i).unwrap();

        // El fichero sigue estando —descartar marca, no borra— pero la imagen
        // ya no entra en el índice, igual que una saltada.
        assert_eq!(a.total_imagenes(i).unwrap(), 2, "la rechazada no cuenta");
        let sigue: i64 = a.contar_filas_imagenes(i).unwrap();
        assert_eq!(sigue, 3, "pero la fila sigue ahí por si cambias de opinión");
    }
}
