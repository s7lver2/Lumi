//! El contrato con el trabajador de embebido: JSON por líneas sobre las
//! tuberías estándar de un proceso hijo.
//!
//! No reutiliza `lumi_proto::worker`. Aquel contrato es «una imagen, dame una
//! coordenada»; este es «este lote de imágenes, dame sus vectores». Forzar los
//! dos por el mismo enum daría un tipo con la mitad de los campos siempre a
//! `None`.
//!
//! Los VECTORES NO VIAJAN POR LA TUBERÍA. Un lote de 32 imágenes con lumi-2
//! son 32 × 12288 flotantes, y en JSON eso son megabytes por línea para algo
//! que se va a escribir a disco de todas formas. El trabajador los escribe en
//! un fichero temporal y contesta con su ruta más el orden de las imágenes; la
//! línea de JSON se queda en unos cientos de bytes.

use serde::{Deserialize, Serialize};

/// Lo que la aplicación manda por `stdin`, una línea por lote.
///
/// Las imágenes viajan como RUTAS y no como bytes: el trabajador corre como el
/// mismo usuario en la misma máquina.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Lote {
    /// Siempre `"lote"`. Va explícito para que añadir órdenes nuevas no rompa
    /// a un trabajador que solo entiende esta.
    pub tipo: String,
    pub id: i64,
    pub modelo: String,
    pub imagenes: Vec<String>,
}

impl Lote {
    pub fn nuevo(id: i64, modelo: String, imagenes: Vec<String>) -> Self {
        Self { tipo: "lote".into(), id, modelo, imagenes }
    }
}

/// Lo que el trabajador contesta por `stdout`. Su `stderr` es el log y no
/// tiene contrato: se guarda tal cual.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
pub enum MsgEmbed {
    /// Obligatorio al arrancar, con `modelo: None`, y otra vez cada vez que
    /// cambia de modelo. Sin esta línea, «está cargando pesos» y «se ha
    /// colgado» se ven exactamente igual.
    Listo { dispositivo: String, modelo: Option<String> },
    /// Cuantos quiera. No se persiste: va a Redis y se olvida.
    Progreso { id: i64, hechas: u32, total: u32 },
    /// Los vectores de un lote, en un fichero de float32 crudo. `imagenes` va
    /// EN EL MISMO ORDEN que las filas del fichero: es lo único que ata cada
    /// vector a su imagen.
    Vectores { id: i64, dims: u32, cuenta: u32, fichero: String, imagenes: Vec<String> },
    /// Una imagen que no se puede embeber. Es un RESULTADO, no una avería: se
    /// anota el motivo, se salta y se sigue. No se reintenta, porque
    /// reintentarla solo quema GPU.
    Saltada { id: i64, ruta: String, motivo: String },
    /// El lote entero no se pudo hacer. Tampoco es una avería del proceso: el
    /// trabajador sigue vivo esperando el siguiente.
    Fallo { id: i64, motivo: String },
}

impl MsgEmbed {
    /// Al trabajador se le cree el log, no los datos.
    pub fn validar(&self) -> Result<(), &'static str> {
        let MsgEmbed::Vectores { dims, cuenta, fichero, imagenes, .. } = self else {
            return Ok(());
        };
        if *dims == 0 {
            return Err("un vector de cero dimensiones no es un vector");
        }
        if fichero.is_empty() {
            return Err("no dice dónde dejó los vectores");
        }
        if *cuenta as usize != imagenes.len() {
            return Err("la cuenta de vectores no cuadra con la lista de imágenes");
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_contrato_de_embebido_aguanta_basura_y_cuadra_sus_cuentas() {
        assert!(serde_json::from_str::<MsgEmbed>("esto no es json").is_err());
        assert!(serde_json::from_str::<MsgEmbed>(r#"{"tipo":"inventado"}"#).is_err());

        let l: MsgEmbed =
            serde_json::from_str(r#"{"tipo":"listo","dispositivo":"cuda:0","modelo":null}"#).unwrap();
        assert_eq!(l, MsgEmbed::Listo { dispositivo: "cuda:0".into(), modelo: None });

        // El caso que importa: la cuenta declarada tiene que cuadrar con la
        // lista de imágenes, porque es lo único que ata cada fila del fichero
        // de vectores a su imagen. Si no cuadra, cada vector quedaría pegado a
        // la imagen equivocada y nadie se enteraría nunca.
        let bueno = MsgEmbed::Vectores {
            id: 4,
            dims: 12288,
            cuenta: 2,
            fichero: "/tmp/lote-4.f32".into(),
            imagenes: vec!["/a.jpg".into(), "/b.jpg".into()],
        };
        assert!(bueno.validar().is_ok());

        let descuadrado = MsgEmbed::Vectores {
            id: 4,
            dims: 12288,
            cuenta: 3,
            fichero: "/tmp/lote-4.f32".into(),
            imagenes: vec!["/a.jpg".into(), "/b.jpg".into()],
        };
        assert!(descuadrado.validar().is_err());

        let sin_dims = MsgEmbed::Vectores {
            id: 4,
            dims: 0,
            cuenta: 0,
            fichero: "/tmp/x".into(),
            imagenes: vec![],
        };
        assert!(sin_dims.validar().is_err());

        // Una imagen saltada es un RESULTADO, no una avería: pasa la
        // validación y no se reintenta.
        let s = MsgEmbed::Saltada { id: 4, ruta: "/c.jpg".into(), motivo: "sin coordenadas".into() };
        assert!(s.validar().is_ok());

        let lote = Lote::nuevo(7, "lumi-2".into(), vec!["/a.jpg".into()]);
        let s = serde_json::to_string(&lote).unwrap();
        assert!(s.contains(r#""tipo":"lote""#), "{s}");
        assert_eq!(serde_json::from_str::<Lote>(&s).unwrap(), lote);
    }
}
