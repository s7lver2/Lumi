//! El GPS que la cámara ya escribió dentro de la foto.
//!
//! Se lee, se guarda y se muestra APARTE de lo inferido: una parte real de las
//! imágenes que recibe esta herramienta ya trae las coordenadas dentro, y
//! ocultarlo contradice de frente el principio de que nada desaparece en
//! silencio. Falsificar un EXIF es trivial, y por eso se etiqueta como
//! declarado en vez de esconderse.

pub struct ExifRead {
    /// El EXIF entero, como objeto JSON de etiqueta a valor.
    pub json: Option<String>,
    pub lat: Option<f64>,
    pub lng: Option<f64>,
}

/// Grados/minutos/segundos a grados decimales. `refr` es 'N'/'S'/'E'/'W'.
fn dms(v: &exif::Value, refr: &str) -> Option<f64> {
    let exif::Value::Rational(r) = v else { return None };
    if r.len() < 3 {
        return None;
    }
    let d = r[0].to_f64() + r[1].to_f64() / 60.0 + r[2].to_f64() / 3600.0;
    Some(if refr.starts_with('S') || refr.starts_with('W') { -d } else { d })
}

pub fn read(bytes: &[u8]) -> ExifRead {
    let none = ExifRead { json: None, lat: None, lng: None };
    let mut cur = std::io::Cursor::new(bytes);
    let Ok(r) = exif::Reader::new().read_from_container(&mut cur) else { return none };

    let mut map = serde_json::Map::new();
    for f in r.fields() {
        map.insert(
            format!("{}", f.tag),
            serde_json::Value::String(f.display_value().with_unit(&r).to_string()),
        );
    }

    let get = |tag: exif::Tag| r.get_field(tag, exif::In::PRIMARY);
    let refr = |tag: exif::Tag| get(tag).map(|f| f.display_value().to_string()).unwrap_or_default();
    let lat = get(exif::Tag::GPSLatitude).and_then(|f| dms(&f.value, &refr(exif::Tag::GPSLatitudeRef)));
    let lng = get(exif::Tag::GPSLongitude).and_then(|f| dms(&f.value, &refr(exif::Tag::GPSLongitudeRef)));

    ExifRead { json: serde_json::to_string(&map).ok(), lat, lng }
}
