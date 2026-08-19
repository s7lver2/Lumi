//! De un `.lumidx` abierto a las tres bases de Station.
//!
//! El `id` de `reference_images` es el mismo en SQLite y en Qdrant. Es lo que
//! permite que una búsqueda vectorial devuelva algo con autor, y lo que hace
//! que desinstalar sea borrar por id sin tocar lo de nadie más.

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
        // Una sola transacción para todo el paquete: antes cada INSERT era
        // su propio commit/fsync, y mientras duraba (miles de filas en un
        // índice grande) el mutex único de `Store::conn()` dejaba a TODO
        // el daemon con la base de datos bloqueada — mismo síntoma que el
        // freeze de hoy, aquí disparado por instalar un índice.
        let mut c = app.store.conn();
        let tx = c.transaction()?;
        for (ruta, lat, lng, quadkey, fuente) in &filas {
            let abs = raiz.join("imagenes").join(ruta);
            tx.execute(
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
            ids.push(tx.last_insert_rowid());
        }
        tx.commit()?;
    }

    // Una colección por capa. Antes se tomaba `capas.first()` y las demás se
    // perdían en silencio, que con un solo modelo no se notaba y con ocho
    // habría dejado siete niveles imposibles sin decir por qué.
    let cliente = crate::qdrant::Cliente::nuevo();
    let mut subidos = 0usize;
    for capa in &ficha.capas {
        let coleccion = crate::qdrant::coleccion_de(&capa.modelo, &capa.version);
        cliente.asegurar_coleccion(&coleccion, capa.dims).await?;

        let vectores = lumi_index::vectors::leer_fragmentos(
            &raiz.join("fragmentos"),
            &capa.modelo,
            &capa.version,
            capa.dims,
        )?;
        // ponytail: se asume que el orden de los vectores del fragmento es el
        // de las filas de `indice.db`, que es como los escribe el sellado del
        // 7a. Si alguna vez dejan de ir a la par, el paquete trae el orden
        // explícito y habría que leerlo — no adivinarlo aquí.
        let n = ids.len().min(vectores.len());
        cliente.subir(&coleccion, &ids[..n], &vectores[..n]).await?;
        subidos = subidos.max(n);
    }

    Ok(subidos)
}
