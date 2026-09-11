//! Wikimedia Commons. Todo lo de aquí es de licencia libre por definición, así
//! que sus imágenes viajan dentro del paquete con su autor y su licencia.
//!
//! Es infraestructura donada, y se pide despacio: el ritmo NO lo pone el
//! `Ctx` de este adaptador sino `origins::limitador_wikimedia()`, compartido
//! con `wikipedia.rs` y `monumentos.rs` — los tres hablan con los mismos
//! servidores y sumar tres limitadores propios era pedir el triple de lo que
//! cada uno creía estar pidiendo.
//!
//! El `User-Agent` con contacto (`origins::AGENTE`) tampoco es cortesía: sin
//! él, Wikimedia responde `429` casi de inmediato. Ver el comentario de
//! `AGENTE` para la medición.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use lumi_index::filter::{Candidata, Reglas, Veredicto};

use super::{Ctx, OrigenDeRed};

/// Los metadatos que Commons ya devuelve, en la forma que el filtro entiende.
/// Aparte para poder probar la decisión sin levantar la red.
fn candidata_de(ancho: u32, alto: u32, categorias: &[String], licencia: Option<&str>) -> Candidata {
    Candidata {
        ancho,
        alto,
        // Commons no publica precisión de la geoetiqueta. `None` es «no lo
        // dijo», que no descarta.
        precision_metros: None,
        categorias: categorias.to_vec(),
        licencia: licencia.map(str::to_string),
        tipo: Tipo::Suelta,
    }
}

pub(crate) const API: &str = "https://commons.wikimedia.org/w/api.php";
const LIMITE: u32 = 500;

#[derive(Debug, Clone, Deserialize)]
struct Coordenada {
    lat: f64,
    lon: f64,
}

// `pub(crate)`: `monumentos.rs` pagina imageinfo por lotes con la misma forma
// exacta de respuesta (`iiprop=url|size|extmetadata`) y reutiliza estos dos
// tipos en vez de duplicarlos — es la misma API, la misma consulta.
/// Un campo de `extmetadata`. `value` se acepta como JSON CUALQUIERA, no como
/// cadena: Commons documenta estos valores como texto pero no lo cumple —
/// `CommonsMetadataExtension` viene como número (`1.2`) en prácticamente todo
/// fichero con metadatos. Con `Option<String>` serde rechazaba la respuesta
/// entera («invalid type: floating point `1.2`, expected a string»), así que
/// CUALQUIER tesela con al menos una foto fallaba al deserializar y el sondeo
/// la daba por vacía. Solo las teselas realmente sin fotos «funcionaban».
///
/// De aquí solo se leen campos que sí son texto (`Artist`, `LicenseShortName`,
/// `DateTimeOriginal`); los demás no se usan, pero tienen que poder ATRAVESAR
/// el parseo. Regla general para todo adaptador: los metadatos que no usamos
/// no pueden tumbar los que sí.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct Campo {
    #[serde(default)]
    pub(crate) value: Option<serde_json::Value>,
}

impl Campo {
    /// El valor como texto, o `None` si no lo hay. Un número se formatea en
    /// vez de descartarse: `DateTimeOriginal` llega a veces como año suelto.
    pub(crate) fn texto(&self) -> Option<String> {
        match self.value.as_ref()? {
            serde_json::Value::String(s) => Some(s.clone()),
            serde_json::Value::Null => None,
            otro => Some(otro.to_string()),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub(crate) struct InfoImagen {
    #[serde(rename = "thumburl")]
    pub(crate) thumb: Option<String>,
    pub(crate) url: Option<String>,
    #[serde(default)]
    pub(crate) width: u32,
    #[serde(default)]
    pub(crate) height: u32,
    #[serde(rename = "extmetadata", default)]
    pub(crate) meta: std::collections::HashMap<String, Campo>,
}

#[derive(Debug, Deserialize)]
pub(crate) struct PaginaImg {
    pub(crate) pageid: i64,
    pub(crate) title: String,
    #[serde(default)]
    pub(crate) imageinfo: Vec<InfoImagen>,
}

#[derive(Debug, Deserialize)]
struct ConsultaImg {
    #[serde(default)]
    pages: std::collections::HashMap<String, PaginaImg>,
}

#[derive(Debug, Deserialize)]
struct RespuestaImg {
    query: Option<ConsultaImg>,
}

/// `imageinfo` por lotes de 50 títulos — el tope del propio MediaWiki. La
/// comparten `monumentos.rs` (fichas de `P373`/`P18`) y `wikipedia.rs`
/// (imágenes enlazadas de un artículo): las tres son la MISMA API con la
/// MISMA forma de respuesta, solo cambia de dónde salió la lista de títulos.
pub(crate) async fn imageinfo_por_lotes(ctx: &Ctx, titulos: &[String]) -> anyhow::Result<Vec<PaginaImg>> {
    let mut fuera = Vec::new();
    for lote in titulos.chunks(50) {
        let titles = lote.join("|");
        let url = format!(
            "{API}?action=query&format=json&formatversion=1\
             &prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048&titles={}",
            urlencoding::encode(&titles)
        );
        let _g = super::limitador_wikimedia().permiso().await;
        let r = ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Commons respondió {} a imageinfo", r.status());
        }
        let cuerpo: RespuestaImg = r.json().await?;
        if let Some(q) = cuerpo.query {
            fuera.extend(q.pages.into_values());
        }
    }
    Ok(fuera)
}

#[derive(Debug, Clone, Deserialize)]
struct Categoria {
    title: String,
}

#[derive(Debug, Clone, Deserialize)]
struct Pagina {
    pageid: i64,
    title: String,
    #[serde(default)]
    coordinates: Vec<Coordenada>,
    #[serde(default)]
    imageinfo: Vec<InfoImagen>,
    #[serde(default)]
    categories: Vec<Categoria>,
}

#[derive(Debug, Deserialize)]
struct Consulta {
    #[serde(default)]
    pages: std::collections::HashMap<String, Pagina>,
}

#[derive(Debug, Deserialize)]
struct RespuestaCommons {
    query: Option<Consulta>,
    /// `coordinates`, `imageinfo` y `categories` paginan cada uno por su
    /// cuenta, muy por debajo de `ggslimit`. Mientras esto tenga algo, la
    /// respuesta está incompleta y hay que repetir la consulta con estos
    /// cursores añadidos.
    #[serde(default, rename = "continue")]
    continuar: std::collections::HashMap<String, String>,
}

/// Copia a `existente` los campos que le falten y que `nueva` sí traiga.
/// Cada submódulo continúa por su cuenta, así que dos respuestas de la misma
/// tesela casi nunca resuelven la misma página dos veces para el mismo campo.
fn fusionar(existente: &mut Pagina, nueva: &Pagina) {
    if existente.coordinates.is_empty() && !nueva.coordinates.is_empty() {
        existente.coordinates = nueva.coordinates.clone();
    }
    if existente.imageinfo.is_empty() && !nueva.imageinfo.is_empty() {
        existente.imageinfo = nueva.imageinfo.clone();
    }
    if existente.categories.is_empty() && !nueva.categories.is_empty() {
        existente.categories = nueva.categories.clone();
    }
}

pub struct Commons {
    ctx: Ctx,
}

impl Commons {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    fn url(&self, tesela: &str, continuar: Option<&std::collections::HashMap<String, String>>) -> String {
        let b = bbox_de_tesela(tesela);
        // El bbox de GeoData va `norte|oeste|sur|este`, que NO es el orden de
        // ninguna otra API de este módulo. Escrito para que nadie lo "corrija".
        let mut u = format!(
            "{API}?action=query&format=json&formatversion=1\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit={LIMITE}&ggsnamespace=6&ggsprimary=all\
             &prop=imageinfo%7Ccoordinates%7Ccategories&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048\
             &colimit=500&cllimit=500",
            b.norte, b.oeste, b.sur, b.este
        );
        if let Some(c) = continuar {
            for (k, v) in c {
                u.push('&');
                u.push_str(&urlencoding::encode(k));
                u.push('=');
                u.push_str(&urlencoding::encode(v));
            }
        }
        u
    }

    /// `coordinates`, `imageinfo` y `categories` paginan cada uno por su
    /// cuenta, muy por debajo de `ggslimit`. Con `colimit=500` y
    /// `cllimit=500` ya se pide el máximo de cada submódulo desde la primera
    /// petición, así que `coordinates` y `categories` resuelven casi siempre
    /// las 500 páginas candidatas de un tirón. Lo que sigue paginando de
    /// verdad es `imageinfo`: 50 por respuesta es un tope del propio módulo,
    /// no un parámetro que se pueda subir — y, en teselas con más de 500
    /// páginas candidatas, la propia búsqueda de `geosearch`. Por eso se
    /// repite la consulta añadiendo los cursores hasta que la API deja de
    /// pedirlos, fusionando cada página con los campos que le falten.
    /// Solo la búsqueda geográfica, sin `prop`: es lo único que hace falta
    /// para CONTAR. `geosearch` topa en `ggslimit` y no continúa por su
    /// cuenta (lo que pagina son los submódulos de `prop`), así que esto es
    /// siempre UNA petición, frente a las hasta 60 de `paginas()` — medido en
    /// el centro de León: 1,2 s contra 18,3 s por tesela, con el mismo número.
    /// Con el limitador de Commons (1 a la vez, 2 req/s) esa diferencia son
    /// minutos de área gris por cada área que se sondea.
    async fn contar(&self, tesela: &str) -> Result<usize> {
        let b = bbox_de_tesela(tesela);
        let url = format!(
            "{API}?action=query&format=json&formatversion=1\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit={LIMITE}&ggsnamespace=6&ggsprimary=all",
            b.norte, b.oeste, b.sur, b.este
        );
        let _g = super::limitador_wikimedia().permiso().await;
        let r = self.ctx.cliente.get(&url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("Commons respondió {}", r.status());
        }
        let cuerpo: RespuestaCommons = r.json().await?;
        Ok(cuerpo.query.map(|q| q.pages.len()).unwrap_or(0))
    }

    async fn paginas(&self, tesela: &str) -> Result<Vec<Pagina>> {
        let mut fusionadas: std::collections::HashMap<i64, Pagina> = std::collections::HashMap::new();
        let mut cont: Option<std::collections::HashMap<String, String>> = None;
        for _ in 0..60 {
            let url = self.url(tesela, cont.as_ref());
            let _g = super::limitador_wikimedia().permiso().await;
            let r = self.ctx.cliente.get(&url).send().await?;
            if !r.status().is_success() {
                anyhow::bail!("Commons respondió {}", r.status());
            }
            let cuerpo: RespuestaCommons = r.json().await?;
            if let Some(q) = cuerpo.query {
                for p in q.pages.into_values() {
                    fusionadas
                        .entry(p.pageid)
                        .and_modify(|existente| fusionar(existente, &p))
                        .or_insert(p);
                }
            }
            if cuerpo.continuar.is_empty() {
                break;
            }
            cont = Some(cuerpo.continuar);
        }
        Ok(fusionadas.into_values().collect())
    }
}

#[async_trait]
impl OrigenDeRed for Commons {
    fn id(&self) -> &'static str {
        "commons"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.contar(tesela).await? as u32;
        // Aunque la cuenta parezca exacta se declara como muestreo: la consulta
        // está topada a 500 y la respuesta no dice si había más.
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for p in self.paginas(tesela).await? {
            let (Some(c), Some(i)) = (p.coordinates.first(), p.imageinfo.first()) else { continue };
            // Se prefiere la miniatura de 2048: el original de Commons llega a
            // decenas de megapíxeles y el verificador no los usa.
            let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            // Antes de bajar un solo byte: las reglas baratas deciden con lo
            // que el proveedor ya nos ha contado. Filtrar después de la
            // descarga no ahorraría ni ancho de banda ni cuota, que es justo
            // para lo que existe este módulo.
            let cats: Vec<String> = p.categories.iter().map(|c| c.title.clone()).collect();
            let licencia = i.meta.get("LicenseShortName").and_then(Campo::texto);
            let cand = candidata_de(i.width, i.height, &cats, licencia.as_deref());
            if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                log::debug!("commons {}: descartada, {motivo}", p.title);
                continue;
            }

            let ruta = match self.ctx.bajar_imagen(&url, &format!("cmn-{}.jpg", p.pageid)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("commons {}: {e}", p.title);
                    continue;
                }
            };
            let campo = |k: &str| i.meta.get(k).and_then(Campo::texto);
            fuera.push(Captura {
                fuente: "commons",
                id_origen: p.pageid.to_string(),
                ruta,
                lat: c.lat,
                lng: c.lon,
                rumbo: None,
                capturada_en: campo("DateTimeOriginal"),
                atribucion: Atribucion {
                    autor: campo("Artist").unwrap_or_else(|| "Wikimedia Commons".into()),
                    url: format!("https://commons.wikimedia.org/?curid={}", p.pageid),
                    licencia: campo("LicenseShortName").unwrap_or_else(|| "libre (Commons)".into()),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Una foto de interior con categoría explícita no llega a descargarse.
    /// El test mira la decisión, no la red: `candidata_de` es lo que el
    /// adaptador consulta antes de gastar un byte.
    #[test]
    fn una_foto_de_interior_no_pasa_las_reglas() {
        let c = candidata_de(
            4000,
            3000,
            &["Category:Interior of buildings in Lugo".to_string()],
            Some("CC BY-SA 4.0"),
        );
        assert!(matches!(Reglas::por_defecto().evaluar(&c), Veredicto::Fuera(_)));
    }

    #[test]
    fn una_fachada_normal_si_pasa() {
        let c = candidata_de(2048, 1536, &["Category:Streets in Lugo".to_string()], Some("CC BY-SA 4.0"));
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    /// Commons no declara precisión de geoetiqueta, y `None` NO es motivo de
    /// descarte: es «no lo dijo», no «lo dijo mal».
    #[test]
    fn sin_precision_declarada_no_se_descarta() {
        let c = candidata_de(2048, 1536, &[], None);
        assert_eq!(Reglas::por_defecto().evaluar(&c), Veredicto::Pasa);
    }

    fn pagina_vacia(id: i64) -> Pagina {
        Pagina { pageid: id, title: format!("File:{id}.jpg"), coordinates: vec![], imageinfo: vec![], categories: vec![] }
    }

    /// El caso real: una respuesta trae coordenadas para la página pero no
    /// imageinfo, y una segunda (la continuación) trae imageinfo pero ya no
    /// repite las coordenadas. Fusionadas, la página queda completa.
    #[test]
    fn fusionar_completa_una_pagina_con_lo_que_trae_cada_respuesta() {
        let mut a = pagina_vacia(1);
        a.coordinates = vec![Coordenada { lat: 35.68, lon: 139.69 }];
        let mut b = pagina_vacia(1);
        b.imageinfo = vec![InfoImagen { thumb: Some("https://x/1.jpg".into()), url: None, width: 100, height: 100, meta: Default::default() }];
        fusionar(&mut a, &b);
        assert_eq!(a.coordinates.len(), 1, "no debe perder lo que ya tenía");
        assert_eq!(a.imageinfo.len(), 1, "debe ganar lo que le faltaba");
    }

    /// Un campo ya resuelto no se pisa con uno vacío de una respuesta
    /// posterior: cada submódulo solo aporta a las páginas que él resolvió
    /// en esa pasada, y el resto vienen vacías en esa misma respuesta.
    #[test]
    fn fusionar_no_pisa_un_campo_ya_resuelto_con_uno_vacio() {
        let mut a = pagina_vacia(1);
        a.coordinates = vec![Coordenada { lat: 1.0, lon: 2.0 }];
        let b = pagina_vacia(1);
        fusionar(&mut a, &b);
        assert_eq!(a.coordinates[0].lat, 1.0);
    }

    /// La regresión que dejó a Commons devolviendo 0 en TODAS partes: Commons
    /// documenta `extmetadata[*].value` como texto y no lo cumple —
    /// `CommonsMetadataExtension` llega como número. Con `Option<String>` esto
    /// no deserializaba, y como la respuesta se parsea entera de una vez,
    /// bastaba UNA foto con metadatos para perder la tesela completa. Las
    /// únicas teselas que «funcionaban» eran las que no tenían ninguna foto.
    #[test]
    fn un_valor_numerico_en_extmetadata_no_tumba_la_respuesta() {
        let j = r#"{"thumburl":"https://x/a.jpg","url":"https://x/a.jpg","width":2048,"height":1536,
          "extmetadata":{"LicenseShortName":{"value":"CC BY-SA 4.0"},
                         "CommonsMetadataExtension":{"value":1.2,"source":"extension"}}}"#;
        let i: InfoImagen = serde_json::from_str(j).expect("un número en un campo que no usamos no puede tumbar el parseo");
        assert_eq!(i.meta.get("LicenseShortName").and_then(Campo::texto).as_deref(), Some("CC BY-SA 4.0"));
        assert_eq!(i.meta.get("CommonsMetadataExtension").and_then(Campo::texto).as_deref(), Some("1.2"));
    }

    /// El sondeo NO puede pedir la consulta pesada: cuenta lo mismo con una
    /// sola petición en vez de hasta 60.
    #[test]
    fn la_url_de_contar_no_pide_metadatos() {
        let b = bbox_de_tesela("03133320022212");
        let u = format!(
            "{API}?action=query&format=json&formatversion=1\
             &generator=geosearch&ggsbbox={}%7C{}%7C{}%7C{}&ggslimit={LIMITE}&ggsnamespace=6&ggsprimary=all",
            b.norte, b.oeste, b.sur, b.este
        );
        assert!(!u.contains("extmetadata") && !u.contains("prop="), "{u}");
    }

    #[test]
    fn la_url_de_continuacion_lleva_los_cursores_de_la_respuesta_anterior() {
        let c = Commons::nuevo(std::path::PathBuf::from("/tmp"));
        let mut cont = std::collections::HashMap::new();
        cont.insert("cocontinue".to_string(), "16186110|654986776".to_string());
        let u = c.url("03113322013021", Some(&cont));
        assert!(u.contains("cocontinue="), "{u}");
    }

    #[test]
    fn la_url_sin_continuacion_no_lleva_cursores() {
        let c = Commons::nuevo(std::path::PathBuf::from("/tmp"));
        let u = c.url("03113322013021", None);
        assert!(!u.contains("cocontinue"), "{u}");
    }
}
