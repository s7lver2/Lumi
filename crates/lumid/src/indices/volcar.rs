//! De un `.lumidx` abierto a las tres bases de Station.
//!
//! El `id` de `reference_images` es el mismo en SQLite y en Qdrant. Es lo que
//! permite que una búsqueda vectorial devuelva algo con autor, y lo que hace
//! que desinstalar sea borrar por id sin tocar lo de nadie más.

use anyhow::{anyhow, Result};
use lumi_index::ficha::Ficha;
use lumi_index::filas::FilaImagen;
use std::collections::HashMap;
use std::path::Path;

pub async fn paquete(app: &crate::App, ficha: &Ficha, raiz: &Path) -> Result<usize> {
    // Las filas del paquete, una lista por tesela. Antes esto leía un
    // `indice.db` dentro del paquete que el sellado del Indexer nunca escribió
    // —ni para un paquete local ni para uno publicado—, así que instalar un
    // índice fallaba siempre; y `Connection::open` lo creaba vacío de paso,
    // con lo que el error acababa siendo un "no such table: imagenes" que no
    // decía nada. Ahora las filas viajan dentro de cada cuerpo, partidas por
    // tesela igual que los fragmentos (ver `lumi_index::filas`).
    let teselas = lumi_index::filas::quadkeys(raiz);
    if teselas.is_empty() {
        return Err(anyhow!(
            "el paquete {} no trae la carpeta `{}`: sin lat/lng ni fuente por imagen los \
             vectores no se pueden situar en el mapa ni atribuir a nadie. La escribe el \
             sellado del Indexer y viaja dentro de cada cuerpo — un paquete publicado \
             antes de que eso existiera hay que volverlo a publicar",
            ficha.paquete,
            lumi_index::filas::DIR
        ));
    }

    let mut por_tesela: Vec<(String, Vec<FilaImagen>)> = Vec::new();
    for qk in teselas {
        let filas = lumi_index::filas::leer(raiz, &qk)?;
        if !filas.is_empty() {
            por_tesela.push((qk, filas));
        }
    }

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
    let entrada = por_tesela;
    let ids_por_tesela: HashMap<String, Vec<i64>> =
        tokio::task::spawn_blocking(move || -> Result<HashMap<String, Vec<i64>>> {
            // Aplanado con su tesela delante: el troceado de la transacción es
            // por número de filas, no por tesela, así que un bloque puede
            // partir una tesela por la mitad y cada fila tiene que saber a
            // cuál pertenece.
            let plano: Vec<(&str, &FilaImagen)> = entrada
                .iter()
                .flat_map(|(qk, fs)| fs.iter().map(move |f| (qk.as_str(), f)))
                .collect();
            let mut fuera: HashMap<String, Vec<i64>> = HashMap::new();
            for bloque in plano.chunks(FILAS_POR_BLOQUE) {
                let mut c = app_store.conn();
                let tx = c.transaction()?;
                for (qk, f) in bloque {
                    let abs = raiz_owned.join("imagenes").join(&f.ruta);
                    tx.execute(
                        "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            &paquete_nombre,
                            abs.to_string_lossy(),
                            f.lat,
                            f.lng,
                            qk,
                            &f.fuente
                        ],
                    )?;
                    // El orden dentro de cada tesela es el de su fichero de
                    // filas, que es el mismo con el que el sellado escribió el
                    // fragmento. De eso vive el emparejamiento de abajo.
                    fuera.entry((*qk).to_string()).or_default().push(tx.last_insert_rowid());
                }
                tx.commit()?;
            }
            Ok(fuera)
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

        let fragmentos = lumi_index::vectors::leer_fragmentos_por_quadkey(
            &raiz.join("fragmentos"),
            &capa.modelo,
            &capa.version,
            capa.dims,
        )?;

        let mut de_esta_capa = 0usize;
        for (qk, vectores) in fragmentos {
            let Some(ids) = ids_por_tesela.get(&qk) else {
                // Un fragmento cuya tesela no trajo filas. Subirlo dejaría
                // puntos que no se pueden atribuir a nada, que es justo lo que
                // el orden de este volcado existe para evitar.
                tracing::warn!(
                    "{}: hay fragmento de {qk} para {}-{} pero el paquete no trajo sus filas; \
                     esa tesela no se sube",
                    ficha.paquete,
                    capa.modelo,
                    capa.version
                );
                continue;
            };
            // Emparejar por posición con longitudes distintas le pegaría a
            // cada imagen las coordenadas de otra, en silencio y para siempre.
            // El sellado escribe el fragmento desde la misma lista que las
            // filas, así que esto no debería pasar nunca; si pasa, el paquete
            // está mal y decirlo es mejor que envenenar el índice.
            if ids.len() != vectores.len() {
                return Err(anyhow!(
                    "{}: la tesela {qk} trae {} filas y {} vectores de {}-{}",
                    ficha.paquete,
                    ids.len(),
                    vectores.len(),
                    capa.modelo,
                    capa.version
                ));
            }
            cliente.subir(&coleccion, ids, &vectores).await?;
            de_esta_capa += ids.len();
        }
        // El máximo y no la suma: cada capa cubre las MISMAS imágenes, así que
        // sumarlas contaría cada imagen una vez por modelo.
        subidos = subidos.max(de_esta_capa);
    }

    Ok(subidos)
}
