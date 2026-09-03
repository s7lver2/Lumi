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
    //
    // Un índice real trae miles de filas. Meterlas TODAS en una única
    // transacción síncrona, dentro de esta misma tarea async, ocupaba un
    // hilo de tokio entero (`worker_threads = 2` en main.rs) sin ceder el
    // control ni una vez durante todo el volcado — y `Store::conn()` es un
    // único `std::sync::Mutex` que pide CUALQUIER ruta, empezando por el
    // login. En cuanto una segunda petición necesitaba ese mismo mutex,
    // bloqueaba el segundo hilo también: con los dos hilos atascados, el
    // daemon entero dejaba de responder — el freeze real reportado al
    // instalar un índice grande, con la CPU en reposo (el hilo bloqueado
    // en el mutex no gasta CPU, solo espera). Dos cambios: el volcado corre
    // en el pool de `spawn_blocking` (mismo patrón que descomprimir el zip,
    // ver `paquete::traer_y_abrir`) para no ocupar un hilo async, y la
    // transacción se trocea por bloques — el mutex se suelta y se retoma
    // entre bloques, así que login y el resto de la app pueden colarse
    // entre medias en vez de esperar al paquete entero de una sentada.
    const FILAS_POR_BLOQUE: usize = 2000;
    let app_store = app.store.clone();
    let paquete_nombre = ficha.paquete.clone();
    let raiz_owned = raiz.to_path_buf();
    let ids: Vec<i64> = tokio::task::spawn_blocking(move || -> Result<Vec<i64>> {
        let mut ids = Vec::with_capacity(filas.len());
        for bloque in filas.chunks(FILAS_POR_BLOQUE) {
            let mut c = app_store.conn();
            let tx = c.transaction()?;
            for (ruta, lat, lng, quadkey, fuente) in bloque {
                let abs = raiz_owned.join("imagenes").join(ruta);
                tx.execute(
                    "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![&paquete_nombre, abs.to_string_lossy(), lat, lng, quadkey, fuente],
                )?;
                ids.push(tx.last_insert_rowid());
            }
            tx.commit()?;
        }
        Ok(ids)
    })
    .await??;

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
