//! Herramienta de un solo uso: sube a Qdrant los vectores que un paquete
//! legacy ya trajo pero que se perdieron por dos fallos ya corregidos en
//! `store::marcar_vector` y `qdrant::Cliente::subir` — no vuelve a importar
//! ni un fichero, solo rellena lo que faltaba para las filas que YA están en
//! `imagenes`.
//!
//! Uso: cargo run --example backfill_legacy -- <bundle.zip.enc> <indice_id>

use std::path::PathBuf;

use rusqlite::Connection;
use serde_json::json;

fn coleccion_de(modelo: &str, version: &str) -> String {
    let limpio = |s: &str| {
        s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>()
    };
    format!("lumi_img__{}_{}", limpio(modelo), limpio(version))
}

fn db_path() -> PathBuf {
    let base = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".into());
    PathBuf::from(base).join(".lumi-indexer").join("indexer.db")
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    let bundle = PathBuf::from(args.get(1).expect("uso: backfill_legacy <bundle.zip.enc> <indice_id>"));
    let indice_id: i64 = args.get(2).expect("falta indice_id").parse()?;

    println!("descifrando {}…", bundle.display());
    let cifrado = std::fs::read(&bundle)?;
    let zip_bytes = lumi_index::legacy::descifrar(&cifrado)?;
    let cursor = std::io::Cursor::new(&zip_bytes);
    let mut zip = zip::ZipArchive::new(cursor)?;

    println!("leyendo el manifiesto…");
    let mut manifiesto_bytes = Vec::new();
    std::io::Read::read_to_end(&mut zip.by_name("manifest.json")?, &mut manifiesto_bytes)?;
    let manifiesto = lumi_index::legacy::validar_manifiesto(&manifiesto_bytes)?;
    let modelo_id = manifiesto.model.id.clone();
    let version = manifiesto.model.version.clone();
    let dims = manifiesto.model.embedding_dim;
    println!("modelo del bundle: {modelo_id} {version} ({dims}-d)");

    let con = Connection::open(db_path())?;
    let mut encontradas = Vec::new();
    let mut sin_fila = 0u32;
    let mut sin_vector = 0u32;

    for area in &manifiesto.areas {
        for img in &area.images {
            let Some(v) = &img.embedding else { sin_vector += 1; continue };
            let nombre = format!("{}_{}.jpg", img.pano_id, img.heading);
            let patron = format!("%{nombre}");
            let id: Option<i64> = con
                .query_row(
                    "SELECT id FROM imagenes WHERE indice_id = ?1 AND ruta LIKE ?2",
                    rusqlite::params![indice_id, patron],
                    |r| r.get(0),
                )
                .ok();
            match id {
                Some(id) => encontradas.push((id, v.clone(), lumi_index::tiles::quadkey(img.lat, img.lng))),
                None => sin_fila += 1,
            }
        }
    }
    println!(
        "{} imágenes con fila y vector, {} sin fila en indice_id={indice_id}, {} sin vector en el manifiesto",
        encontradas.len(), sin_fila, sin_vector
    );
    if encontradas.is_empty() {
        println!("nada que subir.");
        return Ok(());
    }

    let http = reqwest::Client::new();
    let base = "http://127.0.0.1:6633";
    let coleccion = coleccion_de(&modelo_id, &version);

    let existe = http.get(format!("{base}/collections/{coleccion}")).send().await?.status().is_success();
    if !existe {
        println!("creando la colección {coleccion}…");
        let r = http
            .put(format!("{base}/collections/{coleccion}"))
            .json(&json!({
                "vectors": { "size": dims, "distance": "Cosine" },
                "quantization_config": { "binary": { "always_ram": true } }
            }))
            .send()
            .await?;
        anyhow::ensure!(r.status().is_success(), "Qdrant rechazó crear la colección: {}", r.text().await?);
    }

    // Mismo cálculo que `qdrant::Cliente::subir`, medido contra el fallo real
    // (21,6 bytes por float como JSON, no 4): margen grande a propósito.
    let por_lote = ((16usize << 20) / (dims as usize * 32)).max(1);
    let mut subidas = 0usize;
    for lote in encontradas.chunks(por_lote) {
        let puntos: Vec<_> = lote
            .iter()
            .map(|(id, v, qk)| json!({ "id": id, "vector": v, "payload": { "qk": qk } }))
            .collect();
        let r = http
            .put(format!("{base}/collections/{coleccion}/points?wait=true"))
            .json(&json!({ "points": puntos }))
            .send()
            .await?;
        anyhow::ensure!(r.status().is_success(), "Qdrant rechazó un lote: {}", r.text().await?);

        for (id, _, _) in lote {
            con.execute(
                "INSERT INTO vectores (imagen_id, modelo, estado) VALUES (?1, ?2, 'hecho')
                 ON CONFLICT (imagen_id, modelo) DO UPDATE SET estado = 'hecho'",
                rusqlite::params![id, modelo_id],
            )?;
        }
        subidas += lote.len();
        println!("{subidas}/{}", encontradas.len());
    }

    println!("listo: {subidas} vectores subidos y marcados 'hecho' para el modelo {modelo_id}.");
    Ok(())
}
