//! Las claves de los proveedores, cifradas con la clave maestra local.
//!
//! Es generalizar lo que el 7a ya hacía con la de Mapbox: la misma `Maestra`,
//! la misma tabla `ajustes`, una fila por proveedor. Nunca en claro en disco y
//! nunca dentro de un paquete.
//!
//! El mapa base y el origen cenital de Mapbox Satellite son cuentas
//! DISTINTAS en la práctica: un operador puede tener acceso al estilo del
//! mapa sin tener activado el producto de satélite, o preferir cuentas
//! separadas para no mezclar la cuota de una con la otra. Cada una vive en su
//! propia fila.

use anyhow::Result;

use crate::crypto::Maestra;
use crate::store::Almacen;

/// Tope mensual por defecto, en euros. Se puede cambiar desde ajustes.
pub const TOPE_MENSUAL_EUR_POR_DEFECTO: f64 = 100.0;

// El mismo literal que ya usaban `mapbox_clave_guardar`/`mapbox_clave_leer`
// (código de la 7a, sin tocar aquí): es la clave del MAPA BASE, no la del
// origen cenital — esa vive en `ajuste_de("mapbox-satelite")`, como cualquier
// otro proveedor.
pub const CLAVE_MAPBOX: &str = "mapbox";
pub const CLAVE_TOPE: &str = "tope_mensual_eur";
pub const TERRITORIO_RECIENTES: &str = "territorio_recientes";

/// La clave de ajuste donde vive el secreto de un proveedor.
pub fn ajuste_de(proveedor: &str) -> String {
    format!("clave_{proveedor}")
}

pub struct Claves<'a> {
    pub almacen: &'a Almacen,
    pub maestra: &'a Maestra,
}

impl Claves<'_> {
    pub fn guardar(&self, proveedor: &str, clave: &str) -> Result<()> {
        let sellado = self.maestra.sellar(clave.as_bytes())?;
        self.almacen.guardar_ajuste_sellado(&ajuste_de(proveedor), &sellado)
    }

    pub fn leer(&self, proveedor: &str) -> Result<Option<String>> {
        let Some(sellado) = self.almacen.leer_ajuste_sellado(&ajuste_de(proveedor))? else {
            return Ok(None);
        };
        Ok(Some(String::from_utf8(self.maestra.abrir(&sellado)?)?))
    }

    pub fn hay(&self, proveedor: &str) -> bool {
        matches!(self.leer(proveedor), Ok(Some(k)) if !k.is_empty())
    }

    pub fn tope_eur(&self) -> f64 {
        self.almacen
            .leer_ajuste(CLAVE_TOPE)
            .ok()
            .flatten()
            .and_then(|v| v.parse().ok())
            .unwrap_or(TOPE_MENSUAL_EUR_POR_DEFECTO)
    }

    pub fn fijar_tope_eur(&self, eur: f64) -> Result<()> {
        self.almacen.guardar_ajuste(CLAVE_TOPE, &format!("{eur}"))
    }
}

/// Quita el valor de cualquier parámetro que huela a secreto antes de que una
/// URL llegue al log. Flickr y Google Static solo aceptan la clave por
/// parámetro de consulta —no ofrecen cabecera—, así que la URL que se registra
/// tiene que pasar por aquí sí o sí.
pub fn redactar(url: &str) -> String {
    let mut fuera = String::with_capacity(url.len());
    for (i, trozo) in url.split(['?', '&']).enumerate() {
        fuera.push(if i == 0 { ' ' } else if url[..].contains('?') && i == 1 { '?' } else { '&' });
        let secreto = ["key=", "api_key=", "access_token=", "token="]
            .iter()
            .find(|p| trozo.starts_with(**p));
        match secreto {
            Some(p) => {
                fuera.push_str(p);
                fuera.push_str("···");
            }
            None => fuera.push_str(trozo),
        }
    }
    fuera.trim_start().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_clave_nunca_llega_entera_al_log() {
        let u = "https://maps.googleapis.com/maps/api/streetview?size=640x640&location=43.3,-8.4&key=AIzaSyREAL";
        let r = redactar(u);
        assert!(!r.contains("AIzaSyREAL"), "{r}");
        assert!(r.contains("key=···"), "{r}");
        // Y lo que no es secreto se conserva: un log sin la ubicación no sirve.
        assert!(r.contains("location=43.3,-8.4"), "{r}");
    }

    #[test]
    fn mapbox_satelite_tiene_su_propia_clave_distinta_del_mapa() {
        assert_ne!(ajuste_de("mapbox-satelite"), CLAVE_MAPBOX);
        assert_eq!(ajuste_de("mapbox-satelite"), "clave_mapbox-satelite");
        assert_eq!(ajuste_de("flickr"), "clave_flickr");
    }
}
