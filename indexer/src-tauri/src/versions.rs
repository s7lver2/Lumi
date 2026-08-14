//! Crear una versión nueva de un índice sellado.
//!
//! Clonar es barato porque solo toca la base de datos (`Almacen::clonar_version`,
//! una sola transacción); lo caro —ficheros de imagen, puntos de Qdrant— vive
//! fuera de ella, y es lo que este módulo orquesta: hardlink con fallback a
//! copia para lo primero, duplicar el punto para lo segundo, porque un
//! `imagen_id` nuevo no tiene vector propio hasta que alguien lo sube.

use std::collections::{BTreeMap, HashMap};
use std::path::Path;

use anyhow::{anyhow, bail, Result};

use crate::qdrant;
use crate::Estado;

/// Crea la versión nueva de `padre_id` y devuelve su `id`, ya abierta. Solo
/// válido sobre un índice sellado — reindexar uno que todavía cambia no
/// significa nada, y el frontend solo ofrece el botón ahí.
pub async fn crear(estado: &Estado, padre_id: i64) -> Result<i64> {
    let (nombre, slug, estado_padre) = estado
        .almacen
        .listar_indices()?
        .into_iter()
        .find(|(id, ..)| *id == padre_id)
        .map(|(_, n, s, e)| (n, s, e))
        .ok_or_else(|| anyhow!("ese índice no existe"))?;
    if estado_padre != "sellado" {
        bail!("solo se puede crear una versión nueva de un índice sellado");
    }
    let (_, numero_version_padre) = estado.almacen.genealogia(padre_id)?;
    let numero_version = numero_version_padre + 1;
    // `{slug_padre}-v{n}`: el slug de la v1 nunca lleva número, así que no hay
    // ambigüedad entre "el índice de nombre -v2" y "la versión 2".
    let slug_nuevo = format!("{slug}-v{numero_version}");

    let nueva_id = estado.almacen.crear_version(padre_id, &nombre, &slug_nuevo, numero_version)?;

    // Clonar filas y hardlinkear ficheros son trabajo síncrono de disco/CPU —
    // para un índice grande, minutos de una transacción SQLite gigante y
    // miles de syscalls de hardlink. Hecho directamente en un comando async
    // de Tauri, eso bloqueaba el runtime entero (y con él, cualquier otra
    // ventana/comando) durante todo ese tiempo — lo que se veía como el
    // ordenador entero congelándose, no solo esta pestaña.
    let almacen = estado.almacen.clone();
    let dir = estado.dir.clone();
    let clon = tokio::task::spawn_blocking(move || -> Result<crate::store::ClonVersion> {
        let clon = almacen.clonar_version(padre_id, nueva_id)?;
        hardlinkear_ficheros(&almacen, &dir, padre_id, nueva_id, &clon)?;
        Ok(clon)
    })
    .await??;

    duplicar_vectores(estado, &clon).await?;

    Ok(nueva_id)
}

/// Hardlinkea los ficheros de imagen que este equipo gestiona (los que viven
/// bajo `imagenes/<padre_id>/`) al directorio de la versión nueva, y repunta
/// `imagenes.ruta` al resultado. Una carpeta importada nunca se movió ahí —
/// su ruta ya es la del operador, compartida sin que nadie tenga que
/// enlazar nada — así que esas se dejan tal cual.
fn hardlinkear_ficheros(
    almacen: &crate::store::Almacen,
    dir: &Path,
    padre_id: i64,
    nueva_id: i64,
    clon: &crate::store::ClonVersion,
) -> Result<()> {
    let dir_padre = dir.join("imagenes").join(padre_id.to_string());
    let dir_nueva = dir.join("imagenes").join(nueva_id.to_string());
    for (_, nueva_imagen_id, ruta_vieja, _) in &clon.imagenes {
        let origen = Path::new(ruta_vieja);
        if !origen.starts_with(&dir_padre) {
            continue;
        }
        let Some(nombre_fichero) = origen.file_name() else { continue };
        std::fs::create_dir_all(&dir_nueva)?;
        let destino = dir_nueva.join(nombre_fichero);
        if std::fs::hard_link(origen, &destino).is_err() {
            // El fallback nunca falla en silencio: un hardlink entre
            // filesystems distintos no debería pasar en el caso normal, pero
            // un owner pudo mover `DATA`, y aquí es donde se nota.
            log::warn!(
                "versión {nueva_id}: el hardlink de {} falló, se copia entero (más lento, más disco)",
                origen.display()
            );
            if let Err(e) = std::fs::copy(origen, &destino) {
                log::warn!("versión {nueva_id}: tampoco se pudo copiar {}: {e}", origen.display());
                continue;
            }
        }
        almacen.actualizar_ruta_imagen(*nueva_imagen_id, &destino.display().to_string())?;
    }
    Ok(())
}

/// Duplica en Qdrant los vectores que ya estaban `hecho` en el padre, bajo el
/// `imagen_id` nuevo — Qdrant indexa por ese id, así que sin esto el sellado
/// de la versión nueva vería filas `hecho` sin ningún punto que leer.
async fn duplicar_vectores(estado: &Estado, clon: &crate::store::ClonVersion) -> Result<()> {
    if clon.vectores_hechos.is_empty() {
        return Ok(());
    }
    let quadkey_de_nuevo: HashMap<i64, String> =
        clon.imagenes.iter().map(|(_, nuevo, _, qk)| (*nuevo, qk.clone())).collect();

    let mut por_modelo: BTreeMap<String, Vec<(i64, i64)>> = Default::default();
    for (modelo, viejo, nuevo) in &clon.vectores_hechos {
        por_modelo.entry(modelo.clone()).or_default().push((*viejo, *nuevo));
    }

    let cliente = qdrant::Cliente::nuevo();
    for (modelo_id, pares) in por_modelo {
        let Some(m) = estado.modelos.iter().find(|m| m.id == modelo_id) else { continue };
        let coleccion = qdrant::coleccion_de(&m.id, &m.version);
        let viejos: Vec<i64> = pares.iter().map(|(v, _)| *v).collect();
        let vectores = cliente.leer(&coleccion, &viejos).await?;
        let nuevos: Vec<i64> = pares.iter().map(|(_, n)| *n).collect();
        let quadkeys: Vec<String> = nuevos
            .iter()
            .map(|id| quadkey_de_nuevo.get(id).cloned().unwrap_or_default())
            .collect();
        cliente.subir(&coleccion, &nuevos, &vectores, &quadkeys).await?;
    }
    Ok(())
}
