//! De un `.lumidx` abierto a las tres bases de Station.
//!
//! El `id` de `reference_images` es el mismo en SQLite y en Qdrant. Es lo que
//! permite que una búsqueda vectorial devuelva algo con autor, y lo que hace
//! que desinstalar sea borrar por id sin tocar lo de nadie más.
//!
//! ponytail: sin llamante hasta la Tarea 5 (`indices::instalar`).
#![allow(dead_code)]

use anyhow::{Context, Result};
use lumi_index::ficha::Ficha;
use std::path::Path;

pub async fn paquete(app: &crate::App, ficha: &Ficha, raiz: &Path) -> Result<usize> {
    // Las filas del índice publicado. `indice.db` es SQLite y viaja dentro del
    // paquete: leerlo es más barato y más fiable que reconstruirlo del EXIF.
    let filas: Vec<(String, f64, f64, String, String)> = {
        let db = rusqlite::Connection::open(raiz.join("indice.db"))
            .context("abrir el indice.db del paquete")?;
        let mut q = db.prepare(
            "SELECT ruta, lat, lng, quadkey, fuente FROM imagenes
              WHERE lat IS NOT NULL AND lng IS NOT NULL",
        )?;
        let filas = q
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        filas
    };

    // Las filas primero: si el proceso muere entre esto y Qdrant, la
    // reanudación vuelve a subir los vectores de este asset y no pasa nada.
    // Al revés —vectores sin fila— dejaría puntos que no se pueden atribuir.
    let mut ids = Vec::with_capacity(filas.len());
    {
        let c = app.store.conn();
        for (ruta, lat, lng, quadkey, fuente) in &filas {
            let abs = raiz.join("imagenes").join(ruta);
            c.execute(
                "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &ficha.paquete,
                    abs.to_string_lossy(),
                    lat,
                    lng,
                    quadkey,
                    fuente
                ],
            )?;
            ids.push(c.last_insert_rowid());
        }
    }

    // Los vectores, del fragmento de cada tesela. Una capa por modelo; se toma
    // la primera de la ficha, que es la del autor del cuerpo.
    let Some(capa) = ficha.capas.first() else { return Ok(ids.len()) };
    let coleccion = crate::qdrant::coleccion_de(&capa.modelo, &capa.version);
    let cliente = crate::qdrant::Cliente::nuevo();
    cliente.asegurar_coleccion(&coleccion, capa.dims).await?;

    let vectores = lumi_index::vectors::leer_fragmentos(
        &raiz.join("fragmentos"),
        &capa.modelo,
        &capa.version,
        capa.dims,
    )?;
    // ponytail: se asume que el orden de los vectores del fragmento es el de
    // las filas de `indice.db`, que es como los escribe el sellado del 7a. Si
    // alguna vez dejan de ir a la par, el paquete trae el orden explícito y
    // habría que leerlo — no adivinarlo aquí.
    let n = ids.len().min(vectores.len());
    cliente.subir(&coleccion, &ids[..n], &vectores[..n]).await?;

    Ok(n)
}
