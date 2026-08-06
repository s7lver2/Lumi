//! El contrato con los trabajadores de inferencia: JSON por líneas sobre las
//! tuberías estándar del proceso hijo.
//!
//! Vive en `lumi-proto` y no en `lumid` porque es el contrato, no un detalle
//! del daemon: quien escriba un trabajador nuevo lee esto para saber qué tiene
//! que cumplir. El subsistema 5 sustituye las tripas del trabajador de
//! referencia sin tocar ni una línea de aquí.

use serde::{Deserialize, Serialize};

/// Lo que el daemon manda por `stdin`, una línea por trabajo.
///
/// Las imágenes viajan como RUTAS y no como bytes: empujar decenas de MB por
/// una tubería en cada trabajo sería trabajo tirado, y el trabajador corre como
/// el mismo usuario en la misma máquina. El día que las imágenes se cifren en
/// reposo, esta es la decisión que hay que revisar.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Job {
    /// Siempre `"trabajo"`. Va explícito para que añadir órdenes nuevas en el
    /// futuro no rompa a un trabajador que solo entiende esta.
    pub tipo: String,
    pub id: i64,
    pub modelo: String,
    pub imagenes: Vec<String>,
}

impl Job {
    pub fn nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Self {
        Self { tipo: "trabajo".into(), id, modelo, imagenes }
    }
}

/// Lo que el trabajador contesta por `stdout`. Su `stderr` es el log y no
/// tiene contrato: se guarda tal cual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum Msg {
    /// Obligatorio al arrancar, con `modelo: None`, y otra vez cada vez que
    /// cambia de modelo. Hasta que llega, el trabajador NO cuenta como
    /// disponible: sin esta línea, «el modelo está cargando» y «la cola está
    /// colgada» se ven exactamente igual.
    Listo { dispositivo: String, modelo: Option<String> },
    /// Cuantos quiera. No se persiste nunca: se retransmite y se olvida.
    Progreso { id: i64, fase: String, pct: u8 },
    Resultado { id: i64, lat: f64, lng: f64, radio_m: f64, confianza: f64 },
    /// El motor contestó «no puedo». Es un RESULTADO, no una avería: no se
    /// reintenta, porque reintentarlo solo quema GPU.
    Fallo { id: i64, motivo: String },
}

impl Msg {
    /// Al trabajador se le cree el log, no los datos.
    ///
    /// Un `NaN` o una latitud de 300 llegarían hasta el mapa y lo romperían sin
    /// que nadie supiera por qué. Los rangos comparados con `NaN` dan siempre
    /// falso, así que `is_finite` solo hace falta donde no hay rango cerrado.
    pub fn validar(&self) -> Result<(), &'static str> {
        let Msg::Resultado { lat, lng, radio_m, confianza, .. } = self else {
            return Ok(());
        };
        if !(-90.0..=90.0).contains(lat) {
            return Err("la latitud no está entre -90 y 90");
        }
        if !(-180.0..=180.0).contains(lng) {
            return Err("la longitud no está entre -180 y 180");
        }
        if !radio_m.is_finite() || *radio_m <= 0.0 {
            return Err("el radio no es un número positivo");
        }
        if !(0.0..=1.0).contains(confianza) {
            return Err("la confianza no está entre 0 y 1");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_contrato_aguanta_basura_y_rechaza_numeros_imposibles() {
        // Una línea que no es JSON no entra por ningún lado. En el daemon esto
        // se registra y se sigue: un `print` de depuración perdido en el motor
        // no puede tumbar la cola.
        assert!(serde_json::from_str::<Msg>("esto no es json").is_err());
        assert!(serde_json::from_str::<Msg>(r#"{"tipo":"inventado","id":1}"#).is_err());

        // `listo` sin modelo es lo normal recién arrancado.
        let l: Msg =
            serde_json::from_str(r#"{"tipo":"listo","dispositivo":"cpu","modelo":null}"#).unwrap();
        assert_eq!(l, Msg::Listo { dispositivo: "cpu".into(), modelo: None });

        let bueno: Msg = serde_json::from_str(
            r#"{"tipo":"resultado","id":42,"lat":43.36,"lng":-8.41,"radio_m":1400,"confianza":0.72}"#,
        )
        .unwrap();
        assert!(bueno.validar().is_ok());

        for malo in [
            r#"{"tipo":"resultado","id":1,"lat":91,"lng":0,"radio_m":10,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":181,"radio_m":10,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":0,"confianza":0.5}"#,
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":10,"confianza":1.5}"#,
        ] {
            let m: Msg = serde_json::from_str(malo).unwrap();
            assert!(m.validar().is_err(), "debería rechazarse: {malo}");
        }

        // Y un fallo del motor pasa la validación: es un resultado legítimo.
        let f = Msg::Fallo { id: 1, motivo: "sin puntos de referencia".into() };
        assert!(f.validar().is_ok());

        // El trabajo se serializa con su `tipo` puesto.
        let j = Job::nuevo(7, "mini".into(), vec!["/tmp/a".into()]);
        let s = serde_json::to_string(&j).unwrap();
        assert!(s.contains(r#""tipo":"trabajo""#), "{s}");
        assert_eq!(serde_json::from_str::<Job>(&s).unwrap(), j);
    }
}
