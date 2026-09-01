//! De dónde salen las calles de una tesela: Overpass.
//!
//! Es infraestructura donada, así que se le pide poco y despacio. Y se le pide
//! **una vez por tesela**: el resultado sirve para los tres orígenes que
//! muestrean, no uno por origen.

use std::sync::OnceLock;

use anyhow::Result;
use lumi_index::tiles::{bbox_de_tesela, Punto};
use serde::Deserialize;

use super::{Ctx, Limitador};

const OVERPASS: &str = "https://overpass-api.de/api/interpreter";

/// Un limitador PROPIO de Overpass, no el de quien lo llame. `Ctx::limitador`
/// es de Google (10 req/s) o de KartaView (4 req/s), y las dos lo llaman aquí:
/// combinados eso es hasta 14 req/s contra un servicio donado que solo tolera
/// pedir despacio. El síntoma real de esto era un sondeo entero saliendo gris
/// — Overpass rechazando la mayoría de las peticiones y cada una cayendo al
/// mismo "nada" sin distinguirse de una tesela sin calles de verdad.
fn limitador_overpass() -> &'static Limitador {
    static L: OnceLock<Limitador> = OnceLock::new();
    L.get_or_init(|| Limitador::nuevo(1, 1))
}

/// Cada cuántos metros se pregunta. 20 m es lo que usaba la v1: más fino
/// devuelve la misma panorámica repetida, más grueso deja huecos de fachada.
pub const PASO_M: f64 = 20.0;

/// Cuántos puntos se sondean de verdad para estimar. Sondear los ~600 puntos de
/// una tesela urbana solo para saber si hay cobertura cuesta casi tanto como
/// bajarla.
///
/// ponytail: la estimación extrapola de esta muestra al total. El techo es que
/// una tesela con cobertura muy desigual se estima mal; la salida, subir el
/// número. Se acepta porque la estimación orienta antes de confirmar, no
/// factura: en el libro de gasto solo entra lo servido.
pub const PUNTOS_DE_SONDEO: usize = 24;

#[derive(Debug, Deserialize)]
struct Nodo {
    lat: f64,
    lon: f64,
}

#[derive(Debug, Deserialize)]
struct Elemento {
    #[serde(default)]
    geometry: Vec<Nodo>,
}

#[derive(Debug, Deserialize)]
struct Respuesta {
    elements: Vec<Elemento>,
}

/// Las vías transitables de una tesela, como polilíneas.
///
/// Overpass devuelve la geometría ENTERA de una vía aunque solo cruce la
/// tesela. No se recorta aquí —el muestreo colapsa duplicados primero—, pero
/// sí en `puntos_de_tesela`, justo después de muestrear: cada punto fuera de
/// esta tesela se descarta ahí antes de que llegue a ningún origen.
pub async fn calles_de_tesela(ctx: &Ctx, tesela: &str) -> Result<Vec<Vec<Punto>>> {
    let b = bbox_de_tesela(tesela);
    let consulta = format!(
        "[out:json][timeout:25];\
         way[\"highway\"~\"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|pedestrian|service)$\"]\
         ({},{},{},{});out geom;",
        b.sur, b.oeste, b.norte, b.este
    );
    let _p = limitador_overpass().permiso().await;
    let r = ctx.cliente.post(OVERPASS).body(consulta).send().await?;
    if !r.status().is_success() {
        anyhow::bail!("Overpass respondió {}", r.status());
    }
    Ok(r.json::<Respuesta>()
        .await?
        .elements
        .into_iter()
        .map(|e| e.geometry.into_iter().map(|n| Punto { lat: n.lat, lng: n.lon }).collect())
        .filter(|v: &Vec<Punto>| !v.is_empty())
        .collect())
}

pub async fn puntos_de_tesela(ctx: &Ctx, tesela: &str) -> Result<Vec<Punto>> {
    let lineas = calles_de_tesela(ctx, tesela).await?;
    let puntos = lumi_index::streets::muestrear(&lineas, PASO_M);
    // Overpass devuelve la vía entera aunque solo cruce la tesela (comentario
    // de `calles_de_tesela`) — sin recortar aquí, muestrear una calle que se
    // extiende kilómetros hacia la tesela vecina generaba cientos de puntos
    // fuera de lo que el usuario pidió indexar, y Google/KartaView acababan
    // devolviendo fotos de esa tesela vecina nunca seleccionada. Se descarta
    // todo punto cuya tesela real (mismo cálculo que usa `download.rs` para
    // reatribuir capturas) no sea exactamente esta.
    Ok(puntos.into_iter().filter(|p| lumi_index::tiles::quadkey(p.lat, p.lng) == tesela).collect())
}

/// Una muestra repartida por toda la tesela, no los primeros N: esos estarían
/// todos en la misma calle y la extrapolación diría cualquier cosa.
pub fn muestra_para_sondeo(puntos: &[Punto]) -> Vec<Punto> {
    if puntos.len() <= PUNTOS_DE_SONDEO {
        return puntos.to_vec();
    }
    let paso = (puntos.len() / PUNTOS_DE_SONDEO).max(1);
    puntos.iter().step_by(paso).take(PUNTOS_DE_SONDEO).copied().collect()
}

/// Extrapola lo encontrado en la muestra al total de puntos de la tesela.
pub fn extrapolar(encontradas: u32, muestra: usize, total: usize) -> u32 {
    if muestra == 0 {
        return 0;
    }
    (encontradas as f64 * total as f64 / muestra as f64).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_muestra_se_reparte_por_la_tesela_y_no_se_apelotona() {
        let muchos: Vec<Punto> =
            (0..600).map(|i| Punto { lat: 43.0 + i as f64 * 1e-5, lng: -8.0 }).collect();
        let m = muestra_para_sondeo(&muchos);
        assert_eq!(m.len(), PUNTOS_DE_SONDEO);
        assert_eq!(m[0], muchos[0]);
        // El último de la muestra cae en la segunda mitad. Si estuvieran los 24
        // primeros, todos caerían en la misma calle.
        assert!(m[PUNTOS_DE_SONDEO - 1].lat > 43.0 + 300.0 * 1e-5, "{:?}", m.last());
    }

    #[test]
    fn con_pocos_puntos_se_sondean_todos() {
        let pocos: Vec<Punto> =
            (0..5).map(|i| Punto { lat: 43.0 + i as f64 * 1e-4, lng: -8.0 }).collect();
        assert_eq!(muestra_para_sondeo(&pocos).len(), 5);
    }

    #[test]
    fn la_extrapolacion_escala_y_aguanta_el_cero() {
        assert_eq!(extrapolar(12, 24, 600), 300);
        assert_eq!(extrapolar(0, 24, 600), 0);
        // Una tesela sin calles no divide por cero.
        assert_eq!(extrapolar(0, 0, 0), 0);
    }
}
