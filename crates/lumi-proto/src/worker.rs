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
    /// Un solo modelo. Se conserva por los trabajadores que ya existen y que
    /// solo saben leer esto.
    pub modelo: String,
    /// Los N modelos del nivel. Vacío significa «usa `modelo`», que es cómo
    /// un trabajador viejo sigue funcionando sin tocar una línea.
    #[serde(default)]
    pub modelos: Vec<String>,
    pub imagenes: Vec<String>,
}

impl Job {
    pub fn nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Self {
        Self { tipo: "trabajo".into(), id, modelo, modelos: Vec::new(), imagenes }
    }

    /// Un trabajo de ensemble: el trabajador contesta una línea `vectores`
    /// por cada modelo. `modelo` se rellena con el primero para que un
    /// trabajador que solo entienda el campo viejo siga haciendo algo útil.
    pub fn con_modelos(id: i64, modelos: Vec<String>, imagenes: Vec<String>) -> Self {
        let modelo = modelos.first().cloned().unwrap_or_default();
        Self { tipo: "trabajo".into(), id, modelo, modelos, imagenes }
    }
}

/// Una zona candidata con su respaldo. `peso` no es una probabilidad: es
/// cuánto pesa este grupo frente a los demás del mismo análisis.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Hipotesis {
    pub lat: f64,
    pub lng: f64,
    pub radio_m: f64,
    pub peso: f64,
    pub indice: String,
    pub autor: String,
    /// Cuántas correspondencias sostienen esta coordenada. `None` significa
    /// que no pasó por verificación geométrica, no que sacara cero.
    #[serde(default)]
    pub inliers: Option<u32>,
    #[serde(default)]
    pub verificador: Option<String>,
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
    /// El trabajador solo embebe: escribe el vector a un fichero y contesta su
    /// ruta. Los flotantes NO salen por stdout, misma razón que en el Indexer.
    ///
    /// Con varios modelos se manda UNA LÍNEA POR MODELO y no una con todo
    /// dentro: si el tercero de ocho revienta, los dos primeros ya están
    /// escritos y el fallo dice cuál fue.
    Vectores {
        id: i64,
        /// Vacío en un trabajador viejo: significa «el modelo del trabajo».
        #[serde(default)]
        modelo: String,
        dims: u32,
        fichero: String,
    },
    /// Un verificador geométrico ha mirado un candidato. Cuantas quiera: una
    /// por (candidato, verificador). `inliers` es el respaldo con el que el
    /// daemon arbitra; no hay peso ni confianza aquí, a propósito.
    Verificado {
        id: i64,
        /// El `reference_images.id` del candidato mirado.
        candidato: i64,
        verificador: String,
        inliers: u32,
        lat: f64,
        lng: f64,
    },
    Resultado {
        id: i64,
        lat: f64,
        lng: f64,
        radio_m: f64,
        confianza: f64,
        /// `#[serde(default)]` a propósito: un trabajador que no las mande
        /// —como el de referencia— sigue siendo válido sin tocar una línea.
        #[serde(default)]
        alternativas: Vec<Hipotesis>,
    },
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
        let Msg::Resultado { lat, lng, radio_m, confianza, alternativas, .. } = self else {
            return Ok(());
        };
        validar_coordenada(*lat, *lng, *radio_m)?;
        if !(0.0..=1.0).contains(confianza) {
            return Err("la confianza no está entre 0 y 1");
        }
        // Al trabajador se le cree el log, no los datos — y eso vale igual
        // para la hipótesis número tres: una alternativa con una latitud
        // imposible es tan peligrosa como que lo fuera la principal. `peso`
        // no se acota: no es una probabilidad, es una comparación entre
        // grupos y no tiene un rango cerrado que comprobar.
        for alt in alternativas {
            validar_coordenada(alt.lat, alt.lng, alt.radio_m)?;
        }
        Ok(())
    }
}

/// Los rangos que cualquier coordenada tiene que cumplir, sea la principal o
/// una alternativa.
fn validar_coordenada(lat: f64, lng: f64, radio_m: f64) -> Result<(), &'static str> {
    if !(-90.0..=90.0).contains(&lat) {
        return Err("la latitud no está entre -90 y 90");
    }
    if !(-180.0..=180.0).contains(&lng) {
        return Err("la longitud no está entre -180 y 180");
    }
    if !radio_m.is_finite() || radio_m <= 0.0 {
        return Err("el radio no es un número positivo");
    }
    Ok(())
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

        // Una alternativa con una latitud imposible se rechaza igual que si
        // lo fuera la principal: al trabajador se le cree el log, no los
        // datos, y eso vale para la hipótesis número tres también.
        let con_alt_mala: Msg = serde_json::from_str(
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":10,"confianza":0.5,
                "alternativas":[{"lat":91,"lng":0,"radio_m":10,"peso":1.0,"indice":"a","autor":"@x"}]}"#,
        )
        .unwrap();
        assert!(con_alt_mala.validar().is_err());

        // Y una alternativa válida no rompe nada.
        let con_alt_buena: Msg = serde_json::from_str(
            r#"{"tipo":"resultado","id":1,"lat":0,"lng":0,"radio_m":10,"confianza":0.5,
                "alternativas":[{"lat":1,"lng":1,"radio_m":500,"peso":2.3,"indice":"a","autor":"@x"}]}"#,
        )
        .unwrap();
        assert!(con_alt_buena.validar().is_ok());

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
