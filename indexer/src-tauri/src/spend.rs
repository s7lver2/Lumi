//! El libro de gasto y las dos fechas que lo indexan.
//!
//! Aquí solo entra lo que el proveedor SIRVIÓ. Una petición que falla y no
//! devuelve imagen no se cobra ni se apunta, y los sondeos de metadatos de
//! Google son gratuitos y no pasan nunca por esta función.

use anyhow::Result;

use crate::store::Almacen;

/// `YYYY-MM-DD` en UTC, sin arrastrar `chrono`. Reutiliza el mismo calendario
/// que la marca de tiempo de Mapillary, que ya está escrito y probado.
pub fn hoy_iso() -> String {
    let s = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    crate::origins::mapillary::marca_iso(s * 1000)[..10].to_string()
}

/// `YYYY-MM`.
pub fn mes_iso() -> String {
    hoy_iso()[..7].to_string()
}

pub fn apuntar(almacen: &Almacen, fuente: &str, unidades: u32, coste_eur: f64) -> Result<()> {
    if unidades == 0 && coste_eur == 0.0 {
        return Ok(());
    }
    almacen.gasto_apuntar(&hoy_iso(), fuente, unidades, coste_eur)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn las_dos_fechas_tienen_la_forma_que_la_consulta_espera() {
        let d = hoy_iso();
        assert_eq!(d.len(), 10, "{d}");
        assert_eq!(&d[4..5], "-");
        assert_eq!(mes_iso(), d[..7]);
        // `gasto_del_mes` filtra con `dia LIKE mes || '-%'`, así que el mes
        // tiene que ser prefijo exacto del día o no encontraría nada.
        assert!(d.starts_with(&mes_iso()));
    }
}
