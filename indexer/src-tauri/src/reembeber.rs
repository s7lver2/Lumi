//! Añadir una capa de modelo a un índice que ya está en disco.
//!
//! Recorre las imágenes de un índice, pide el vector del modelo que falta y
//! escribe un fragmento nuevo. **No toca la red, no toca el presupuesto y no
//! cuenta contra el reclamo de territorio**, porque no se está indexando nada
//! nuevo: las fotos ya son nuestras y ya están pagadas.
//!
//! Existe para que «tirar el corpus de juguete y reindexar» sea la primera y
//! la última vez que haga falta descargar de nuevo por un cambio de modelo.

use anyhow::Result;

use crate::store::Almacen;

/// Encola todas las imágenes del índice que aún no tengan vector de `modelo`.
///
/// Es una sola sentencia porque la cola ya sabe el resto: `pendientes_de` e
/// `indices_con_pendientes` buscan filas de `vectores` en estado `pendiente`,
/// así que insertarlas es literalmente todo el trabajo. De ahí hereda gratis
/// el progreso por SSE, la reanudación y el «Redis es el timbre, SQLite es la
/// verdad».
///
/// `INSERT OR IGNORE` y no `REPLACE`: si ya hay vector de ese modelo, esta
/// imagen no se rehace. Reembeber no es reintentar.
pub fn encolar(almacen: &Almacen, indice_id: i64, modelo: &str) -> Result<usize> {
    almacen.encolar_capa(indice_id, modelo)
}
