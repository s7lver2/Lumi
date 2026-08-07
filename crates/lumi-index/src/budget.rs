//! Las dos puertas del gasto, y son de naturaleza distinta.
//!
//! `cabe` es una BARRERA: se comprueba una vez, antes de empezar, y si no pasa
//! el trabajo se rechaza entero. Media descarga es un índice con agujeros que
//! nadie sabe dónde están.
//!
//! `Presupuesto` es un CONTADOR VIVO que viaja con la descarga y se decrementa
//! por unidad servida. Un origen que se desmadre se queda sin saldo a mitad, en
//! vez de descubrirse al final.

use std::fmt;
use std::sync::Mutex;

use serde::Serialize;

use crate::network::Tarifa;

/// Una fila de la estimación. Lo gratuito TAMBIÉN se lista: hace falta para
/// entender de dónde va a salir cada imagen, aunque sume cero.
#[derive(Debug, Clone, Serialize)]
pub struct LineaPrevista {
    pub fuente: String,
    pub teselas: u32,
    pub unidades: u32,
    pub tarifa: Tarifa,
    pub coste_eur: f64,
}

impl LineaPrevista {
    pub fn nueva(fuente: &str, teselas: u32, unidades: u32, tarifa: Tarifa) -> Self {
        Self { fuente: fuente.to_string(), teselas, unidades, coste_eur: tarifa.coste_eur(unidades), tarifa }
    }
}

pub fn previsto(lineas: &[LineaPrevista]) -> f64 {
    lineas.iter().map(|l| l.coste_eur).sum()
}

#[derive(Debug, Clone, Serialize)]
pub struct ExcedeTope {
    pub gastado_eur: f64,
    pub previsto_eur: f64,
    pub tope_eur: f64,
    pub exceso_eur: f64,
}

impl fmt::Display for ExcedeTope {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "esta descarga pasaría el tope del mes: llevas {:.2} € y sumaría {:.2} €, \
             que son {:.2} € por encima del tope de {:.2} €",
            self.gastado_eur, self.previsto_eur, self.exceso_eur, self.tope_eur
        )
    }
}

impl std::error::Error for ExcedeTope {}

/// `gastado + previsto > tope` rechaza. Igual al tope todavía cabe: el tope es
/// lo que se puede gastar, no lo que no se puede alcanzar.
pub fn cabe(gastado_eur: f64, previsto_eur: f64, tope_eur: f64) -> Result<(), ExcedeTope> {
    let total = gastado_eur + previsto_eur;
    if total > tope_eur {
        return Err(ExcedeTope {
            gastado_eur,
            previsto_eur,
            tope_eur,
            exceso_eur: total - tope_eur,
        });
    }
    Ok(())
}

#[derive(Debug)]
pub struct SinSaldo {
    pub pedido_eur: f64,
    pub restante_eur: f64,
}

impl fmt::Display for SinSaldo {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "sin saldo: hacían falta {:.4} € y quedaban {:.4} €",
            self.pedido_eur, self.restante_eur
        )
    }
}

impl std::error::Error for SinSaldo {}

/// El contador que viaja con la descarga.
///
/// Un lote que no cabe entero se rechaza entero: no se sirve media petición. El
/// adaptador que recibe `SinSaldo` para y devuelve lo que llevara hecho, que es
/// trabajo bueno y ya pagado.
pub struct Presupuesto {
    tope_eur: f64,
    gastado_eur: Mutex<f64>,
}

impl Presupuesto {
    pub fn nuevo(tope_eur: f64) -> Self {
        Self { tope_eur, gastado_eur: Mutex::new(0.0) }
    }

    pub fn gastado_eur(&self) -> f64 {
        *self.gastado_eur.lock().unwrap()
    }

    pub fn restante_eur(&self) -> f64 {
        (self.tope_eur - self.gastado_eur()).max(0.0)
    }

    /// Apunta `unidades` SERVIDAS y devuelve lo que han costado. Lo gratuito
    /// nunca agota nada, así que un origen sin tarifa no necesita presupuesto.
    pub fn gastar(&self, tarifa: &Tarifa, unidades: u32) -> Result<f64, SinSaldo> {
        if tarifa.es_gratis() {
            return Ok(0.0);
        }
        let coste = tarifa.coste_eur(unidades);
        let mut g = self.gastado_eur.lock().unwrap();
        if *g + coste > self.tope_eur {
            return Err(SinSaldo { pedido_eur: coste, restante_eur: (self.tope_eur - *g).max(0.0) });
        }
        *g += coste;
        Ok(coste)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_previsto_suma_las_lineas_y_lo_gratis_no_suma() {
        let lineas = vec![
            LineaPrevista::nueva("mapillary", 71, 18_402, Tarifa::Gratis),
            LineaPrevista::nueva("google", 62, 9_240, Tarifa::PorUnidad { usd_por_mil: 7.00 }),
            LineaPrevista::nueva(
                "mapbox-satelite",
                98,
                6_272,
                Tarifa::PorUnidad { usd_por_mil: 0.75 },
            ),
        ];
        // (64,68 + 4,704) $ · 0,93 = 64,5271… €
        let total = previsto(&lineas);
        assert!((total - 64.5271_2).abs() < 1e-3, "{total}");
        assert_eq!(lineas[0].coste_eur, 0.0, "lo gratuito se lista pero no suma");
    }

    #[test]
    fn el_tope_rechaza_el_trabajo_entero_y_dice_cuanto_sobra() {
        assert!(cabe(148.30, 64.21, 400.00).is_ok());
        // Justo en el borde: gastar exactamente el tope todavía cabe.
        assert!(cabe(300.00, 100.00, 400.00).is_ok());

        let e = cabe(371.40, 64.21, 400.00).unwrap_err();
        assert!((e.exceso_eur - 35.61).abs() < 1e-9, "{}", e.exceso_eur);
        assert_eq!(e.tope_eur, 400.00);
        // El mensaje lleva los tres números: es lo que la pantalla enseña.
        let m = e.to_string();
        assert!(m.contains("371.40") && m.contains("64.21") && m.contains("400.00"), "{m}");
    }

    #[test]
    fn el_presupuesto_es_un_contador_y_corta_a_mitad_cuando_se_agota() {
        // 1,00 € da para 1/0,00651 ≈ 153 imágenes de Google (7 $/1000 · 0,93).
        let p = Presupuesto::nuevo(1.00);
        let tarifa = Tarifa::PorUnidad { usd_por_mil: 7.00 };

        for _ in 0..100 {
            p.gastar(&tarifa, 1).expect("las primeras 100 caben de sobra");
        }
        assert!(p.gastado_eur() > 0.64 && p.gastado_eur() < 0.66, "{}", p.gastado_eur());

        // Un lote que no cabe entero se RECHAZA entero: nada de servir media
        // petición. Quien llama para al recibir esto.
        assert!(p.gastar(&tarifa, 1_000).is_err(), "1000 más no caben en lo que queda");
        assert!(p.gastar(&tarifa, 50).is_ok(), "pero 50 sí, y el contador sigue vivo");

        // Lo gratuito nunca agota nada.
        let vacio = Presupuesto::nuevo(0.0);
        assert!(vacio.gastar(&Tarifa::Gratis, 100_000).is_ok());
        assert_eq!(vacio.gastado_eur(), 0.0);
    }
}
