//! Teselas de Web Mercator, siempre a z14.
//!
//! Una sola granularidad en todo el sistema: la tesela z14 es la unidad del
//! fragmento, la de la cobertura y la del porcentaje por territorio. Mezclar
//! dos niveles de zoom obligaría a traducir entre ellos en cada consulta y a
//! explicar cuál manda en cada sitio.

use serde::{Deserialize, Serialize};

/// El único zoom del sistema. No parametrizar: ver el comentario de arriba.
pub const Z: u8 = 14;

/// Límite de Mercator. Más allá la proyección no está definida.
const LAT_MAX: f64 = 85.051_128_78;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Punto {
    pub lat: f64,
    pub lng: f64,
}

/// Índices de tesela (x, y) a z14.
fn xy(lat: f64, lng: f64) -> (u32, u32) {
    let escala = 1u32 << Z;
    let lat = lat.clamp(-LAT_MAX, LAT_MAX);
    let sen = lat.to_radians().sin();
    let x = (((lng + 180.0) / 360.0) * escala as f64).floor();
    let y = ((0.5 - ((1.0 + sen) / (1.0 - sen)).ln() / (4.0 * std::f64::consts::PI))
        * escala as f64)
        .floor();
    (
        (x.max(0.0) as u32).min(escala - 1),
        (y.max(0.0) as u32).min(escala - 1),
    )
}

/// Quadkey de Bing: se entrelazan el bit de y (valor 2) y el de x (valor 1)
/// desde el nivel más significativo hacia abajo. Idéntico a `quadkey_z16` de
/// la v1 salvo el zoom.
pub fn quadkey_de(x: u32, y: u32) -> String {
    let mut s = String::with_capacity(Z as usize);
    for nivel in (1..=Z).rev() {
        let mascara = 1u32 << (nivel - 1);
        let mut d = b'0';
        if x & mascara != 0 {
            d += 1;
        }
        if y & mascara != 0 {
            d += 2;
        }
        s.push(d as char);
    }
    s
}

pub fn quadkey(lat: f64, lng: f64) -> String {
    let (x, y) = xy(lat, lng);
    quadkey_de(x, y)
}

/// Centro geográfico de una tesela, que es el punto con el que se decide si
/// cae dentro de un polígono.
fn centro(x: u32, y: u32) -> Punto {
    let escala = (1u32 << Z) as f64;
    let lng = (x as f64 + 0.5) / escala * 360.0 - 180.0;
    let n = std::f64::consts::PI * (1.0 - 2.0 * (y as f64 + 0.5) / escala);
    let lat = n.sinh().atan().to_degrees();
    Punto { lat, lng }
}

/// Cruce de rayos, la prueba de punto en polígono de toda la vida. El polígono
/// se cierra solo: no hace falta repetir el primer vértice al final.
fn dentro(p: Punto, poligono: &[Punto]) -> bool {
    let mut d = false;
    let n = poligono.len();
    let mut j = n - 1;
    for i in 0..n {
        let (a, b) = (poligono[i], poligono[j]);
        if (a.lat > p.lat) != (b.lat > p.lat) {
            let corte = (b.lng - a.lng) * (p.lat - a.lat) / (b.lat - a.lat) + a.lng;
            if p.lng < corte {
                d = !d;
            }
        }
        j = i;
    }
    d
}

/// Teselas z14 cuyo CENTRO cae dentro del polígono. Se recorre la caja
/// envolvente y se filtra: es cuadrático sobre la caja, no sobre el planeta.
///
/// ponytail: el criterio es el centro y no la intersección de áreas. Una
/// tesela mordida por el borde entra o no según dónde caiga su centro, lo que
/// puede dejar fuera una franja de hasta media tesela. El techo es ese; la
/// salida, si molesta, es probar también las cuatro esquinas.
pub fn teselas_de_poligono(poligono: &[Punto]) -> Vec<String> {
    if poligono.len() < 3 {
        return Vec::new();
    }
    let (mut lat0, mut lat1) = (f64::MAX, f64::MIN);
    let (mut lng0, mut lng1) = (f64::MAX, f64::MIN);
    for p in poligono {
        lat0 = lat0.min(p.lat);
        lat1 = lat1.max(p.lat);
        lng0 = lng0.min(p.lng);
        lng1 = lng1.max(p.lng);
    }
    // y crece hacia el SUR, así que la esquina superior izquierda es
    // (lat máxima, lng mínima).
    let (x0, y0) = xy(lat1, lng0);
    let (x1, y1) = xy(lat0, lng1);

    let mut fuera = Vec::new();
    for y in y0..=y1 {
        for x in x0..=x1 {
            if dentro(centro(x, y), poligono) {
                fuera.push(quadkey_de(x, y));
            }
        }
    }
    fuera.sort();
    fuera.dedup();
    fuera
}

/// El rectángulo geográfico de una tesela, en grados. El orden de los campos es
/// el de las APIs que lo consumen (Mapillary y Flickr piden `oeste,sur,este,norte`).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Bbox {
    pub oeste: f64,
    pub sur: f64,
    pub este: f64,
    pub norte: f64,
}

/// Deshace el entrelazado de un quadkey en sus índices (x, y). Es la inversa
/// exacta de `quadkey_de`, y la comparte quien necesite comparar vecindad de
/// teselas sin pasar por grados — `agrupar::en_grupos` es el otro llamante.
pub fn xy_de_quadkey(qk: &str) -> (u32, u32) {
    let (mut x, mut y) = (0u32, 0u32);
    for c in qk.chars() {
        let d = c as u32 - '0' as u32;
        x = (x << 1) | (d & 1);
        y = (y << 1) | ((d >> 1) & 1);
    }
    (x, y)
}

/// Proyecta las dos esquinas de una tesela de vuelta a grados.
///
/// Una tesela z14 mide ~0,0005 grados cuadrados, veinte veces menos que el tope
/// de área de la Graph API de Mapillary: por eso una tesela entera cabe en una
/// sola consulta y el 7b nunca necesita decodificar teselas vectoriales en Rust.
pub fn bbox_de_tesela(qk: &str) -> Bbox {
    let (x, y) = xy_de_quadkey(qk);
    let escala = (1u32 << qk.len().min(31)) as f64;
    let lng_de = |tx: f64| tx / escala * 360.0 - 180.0;
    let lat_de = |ty: f64| {
        let n = std::f64::consts::PI * (1.0 - 2.0 * ty / escala);
        n.sinh().atan().to_degrees()
    };
    Bbox {
        oeste: lng_de(x as f64),
        // y crece hacia el sur, así que `y` es el norte e `y + 1` el sur.
        sur: lat_de(y as f64 + 1.0),
        este: lng_de(x as f64 + 1.0),
        norte: lat_de(y as f64),
    }
}

/// Área aproximada de una tesela en km², a partir de su rectángulo en grados.
/// Aproximación plana: a la escala de una tesela z14 (unas décimas de grado)
/// el error frente a una fórmula geodésica exacta es insignificante, y evita
/// traer trigonometría esférica solo para esto.
pub fn area_km2(qk: &str) -> f64 {
    let b = bbox_de_tesela(qk);
    let lat_media = (b.norte + b.sur) / 2.0;
    let ancho_km = (b.este - b.oeste) * 111.320 * lat_media.to_radians().cos();
    let alto_km = (b.norte - b.sur) * 110.574;
    ancho_km * alto_km
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_quadkey_es_de_catorce_y_el_poligono_da_las_teselas_de_dentro() {
        // Valor de referencia de la implementación de Bing, la misma que usaba
        // `quadkey_z16` en la v1: A Coruña, centro.
        let qk = quadkey(43.3623, -8.4115);
        assert_eq!(qk.len(), Z as usize, "z14 son 14 dígitos: {qk}");
        assert!(qk.chars().all(|c| ('0'..='3').contains(&c)), "{qk}");

        // Dos puntos a menos de un metro caen en la misma tesela.
        assert_eq!(qk, quadkey(43.36230_5, -8.41150_5));

        // La misma latitud a media vuelta del planeta, no.
        assert_ne!(qk, quadkey(43.3623, 171.5885));

        // Un cuadrado pequeño da un puñado de teselas, todas distintas y
        // ordenadas, y su propia esquina inferior izquierda está dentro.
        // NOTA: el plan original fijaba este cuadro entre 43.35/43.38 y
        // -8.43/-8.39 (~3 km de lado), pero con la implementación de arriba
        // ese cuadro concreto solo deja 2 teselas cuyo centro cae dentro (el
        // borde queda pegado a la fila de teselas y el redondeo se lo come),
        // lo que no cumple el propio `t.len() > 4` del plan. Se ensancha el
        // cuadro (~6.5 km de lado) para que el resultado no dependa de dónde
        // caiga exactamente el borde con la tesela.
        let cuadro = vec![
            Punto { lat: 43.33, lng: -8.44 },
            Punto { lat: 43.33, lng: -8.38 },
            Punto { lat: 43.39, lng: -8.38 },
            Punto { lat: 43.39, lng: -8.44 },
        ];
        let t = teselas_de_poligono(&cuadro);
        assert!(t.len() > 4, "un cuadro de ~3 km debe dar varias teselas z14: {}", t.len());
        let mut ordenado = t.clone();
        ordenado.sort();
        ordenado.dedup();
        assert_eq!(t, ordenado, "deben venir ordenadas y sin repetir");
        assert!(t.contains(&quadkey(43.3623, -8.4115)));

        // Un punto claramente fuera no aparece.
        assert!(!t.contains(&quadkey(40.4168, -3.7038)));
    }

    #[test]
    fn el_bbox_de_una_tesela_la_contiene_y_es_pequeno() {
        // A Coruña. La tesela que contiene el punto tiene que contener el punto.
        let (lat, lng) = (43.3623, -8.4115);
        let qk = quadkey(lat, lng);
        let b = bbox_de_tesela(&qk);
        assert!(b.oeste < lng && lng < b.este, "lng fuera: {b:?}");
        assert!(b.sur < lat && lat < b.norte, "lat fuera: {b:?}");

        // El área en grados cuadrados tiene que quedar MUY por debajo del tope
        // de 0,01 de la Graph API: es lo que permite una consulta por tesela.
        let area = (b.este - b.oeste) * (b.norte - b.sur);
        assert!(area < 0.001, "el bbox mide {area} grados cuadrados, no cabe en una consulta");

        // Y el centro del bbox tiene que devolver la misma tesela: si no, hay
        // un desfase de medio píxel en la proyección.
        let centro_lat = (b.sur + b.norte) / 2.0;
        let centro_lng = (b.oeste + b.este) / 2.0;
        assert_eq!(quadkey(centro_lat, centro_lng), qk);
    }
}
