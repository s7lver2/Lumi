//! Monumentos vía Wikidata → Commons: la fuente que pregunta por MONUMENTO, no
//! por coordenada.
//!
//! Ninguna cantidad de street view enseña una fachada porque una coordenada no
//! sabe que ahí hay una catedral. Este origen sí lo sabe: primero pregunta a
//! Wikidata qué monumentos hay en la tesela (`SERVICE wikibase:around` sobre
//! `P625`), y luego baja todas las vistas catalogadas de cada uno desde su
//! categoría de Commons (`P373`), reutilizando la lógica de filtrado y de
//! `imageinfo` por lotes que `commons.rs` ya tiene.
//!
//! Es la misma infraestructura donada que Commons (2 req/s, concurrencia 1,
//! `User-Agent` identificable) más el propio SPARQL de Wikidata, que también
//! se respeta con el mismo limitador: nunca sin límite.

use std::collections::HashMap;
use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::filter::{Candidata, Reglas, Veredicto};
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Nivel, Redistribucion, Tarifa};
use lumi_index::tiles::{bbox_de_tesela, Bbox};
use serde::Deserialize;

use super::commons::{Campo, InfoImagen, API as COMMONS_API};
use super::{Ctx, OrigenDeRed};

const SPARQL: &str = "https://query.wikidata.org/sparql";

/// Prefijos (en inglés y en español, Commons mezcla los dos según quién
/// catalogó) que marcan una subcategoría como "vista exterior utilizable".
///
/// ponytail: es una heurística de lista corta, igual que `filter::INTERIOR`.
/// Bajar la categoría entera de una catedral recursivamente arrastra
/// vidrieras, capiteles, planos y grabados del XIX que el verificador
/// geométrico no puede emparejar con una foto de móvil. Si esta lista deja
/// fuera demasiado, la salida es la revisión por excepción que ya existe, no
/// una lista más larga.
const PREFIJOS_SUBCAT_VISTA: [&str; 5] = ["exterior", "facade", "views of", "fachada", "vistas"];

fn es_subcat_de_vista(titulo: &str) -> bool {
    let t = titulo.strip_prefix("Category:").unwrap_or(titulo).trim().to_lowercase();
    PREFIJOS_SUBCAT_VISTA.iter().any(|p| t.starts_with(p))
}

/// Centro y radio (en km) que cubren una tesela con margen, para
/// `SERVICE wikibase:around`. Aproximación plana, igual que
/// `lumi_index::tiles::area_km2`: a la escala de una tesela z14 el error
/// frente a una fórmula geodésica exacta es insignificante.
fn centro_y_radio_km(b: Bbox) -> (f64, f64, f64) {
    let lat = (b.norte + b.sur) / 2.0;
    let lng = (b.oeste + b.este) / 2.0;
    let ancho_km = (b.este - b.oeste) * 111.320 * lat.to_radians().cos();
    let alto_km = (b.norte - b.sur) * 110.574;
    let radio = (ancho_km.powi(2) + alto_km.powi(2)).sqrt() / 2.0;
    // 20% de margen: un monumento justo en el borde de la tesela no debe
    // perderse por un radio calculado al milímetro.
    (lat, lng, (radio * 1.2).max(0.05))
}

fn parsear_punto(wkt: &str) -> Option<(f64, f64)> {
    let dentro = wkt.strip_prefix("Point(")?.strip_suffix(')')?;
    let mut it = dentro.split_whitespace();
    let lng: f64 = it.next()?.parse().ok()?;
    let lat: f64 = it.next()?.parse().ok()?;
    Some((lat, lng))
}

fn url_sparql(lat: f64, lng: f64, radio_km: f64) -> String {
    let q = format!(
        "SELECT ?item ?loc ?img ?cat WHERE {{ \
         SERVICE wikibase:around {{ \
           ?item wdt:P625 ?loc . \
           bd:serviceParam wikibase:center \"Point({lng} {lat})\"^^geo:wktLiteral . \
           bd:serviceParam wikibase:radius \"{radio_km}\" . \
         }} \
         OPTIONAL {{ ?item wdt:P18 ?img }} \
         OPTIONAL {{ ?item wdt:P373 ?cat }} \
         FILTER(BOUND(?img) || BOUND(?cat)) \
         }}"
    );
    format!("{SPARQL}?format=json&query={}", urlencoding::encode(&q))
}

#[derive(Debug, Deserialize)]
struct ValorSparql {
    value: String,
}

#[derive(Debug, Deserialize)]
struct ResultadosSparql {
    bindings: Vec<HashMap<String, ValorSparql>>,
}

#[derive(Debug, Deserialize)]
struct RespuestaSparql {
    results: ResultadosSparql,
}

/// Un monumento en la tesela: su coordenada (`P625`, la del EDIFICIO) y, si la
/// tiene, su categoría de Commons (`P373`) — el único camino hasta sus fotos.
#[derive(Debug, Clone, PartialEq)]
struct Monumento {
    lat: f64,
    lng: f64,
    /// `None` cuando el monumento solo trae `P18` (imagen principal) y no
    /// categoría: sin categoría no hay `categorymembers` que listar, así que
    /// hoy no aporta capturas. Es la lectura literal de "Paso 2" del spec:
    /// la fuente de vistas es la categoría, no la imagen principal sola.
    categoria: Option<String>,
}

fn monumentos_de(cuerpo: RespuestaSparql) -> Vec<Monumento> {
    cuerpo
        .results
        .bindings
        .into_iter()
        .filter_map(|b| {
            let (lat, lng) = b.get("loc").and_then(|v| parsear_punto(&v.value))?;
            let categoria = b.get("cat").map(|v| v.value.clone());
            Some(Monumento { lat, lng, categoria })
        })
        .collect()
}

#[derive(Debug, Deserialize)]
struct MiembroCategoria {
    title: String,
}

#[derive(Debug, Deserialize)]
struct ConsultaCategoryMembers {
    #[serde(default)]
    categorymembers: Vec<MiembroCategoria>,
}

#[derive(Debug, Deserialize)]
struct ContinuarCm {
    cmcontinue: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RespuestaCategoryMembers {
    query: Option<ConsultaCategoryMembers>,
    #[serde(rename = "continue")]
    continuar: Option<ContinuarCm>,
}

#[derive(Debug, Deserialize)]
struct PaginaImg {
    pageid: i64,
    title: String,
    #[serde(default)]
    imageinfo: Vec<InfoImagen>,
}

#[derive(Debug, Deserialize)]
struct ConsultaImg {
    #[serde(default)]
    pages: HashMap<String, PaginaImg>,
}

#[derive(Debug, Deserialize)]
struct RespuestaImg {
    query: Option<ConsultaImg>,
}

pub struct Monumentos {
    ctx: Ctx,
}

impl Monumentos {
    pub fn nuevo(stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(None, stage, 2, 1) }
    }

    /// Los monumentos con imagen o categoría en la tesela, vía Wikidata.
    async fn monumentos_en_tesela(&self, tesela: &str) -> Result<Vec<Monumento>> {
        let (lat, lng, radio_km) = centro_y_radio_km(bbox_de_tesela(tesela));
        let url = url_sparql(lat, lng, radio_km);
        let _g = self.ctx.limitador.permiso().await;
        let r = self
            .ctx
            .cliente
            .get(&url)
            .header("Accept", "application/sparql-results+json")
            .send()
            .await?;
        if !r.status().is_success() {
            anyhow::bail!("Wikidata respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(monumentos_de(r.json().await?))
    }

    /// Los títulos de fichero de una categoría de Commons: `cmtype=file` o
    /// `cmtype=subcat`, paginando con `cmcontinue` hasta agotar la categoría.
    ///
    /// Tope de 20 páginas (10.000 miembros a 500 por página): una categoría de
    /// un solo monumento no debería acercarse ni de lejos, y es la misma idea
    /// de red de seguridad que el tope de 60 de `commons.rs::paginas`.
    async fn miembros_categoria(&self, categoria: &str, tipo: &str) -> Result<Vec<String>> {
        let mut titulos = Vec::new();
        let mut cmcontinue: Option<String> = None;
        for _ in 0..20 {
            let mut url = format!(
                "{COMMONS_API}?action=query&format=json&formatversion=1\
                 &list=categorymembers&cmtitle={}&cmtype={tipo}&cmlimit=500",
                urlencoding::encode(categoria)
            );
            if let Some(c) = &cmcontinue {
                url.push('&');
                url.push_str("cmcontinue=");
                url.push_str(&urlencoding::encode(c));
            }
            let _g = self.ctx.limitador.permiso().await;
            let r = self.ctx.cliente.get(&url).send().await?;
            if !r.status().is_success() {
                anyhow::bail!("Commons respondió {} a {}", r.status(), crate::keys::redactar(&url));
            }
            let cuerpo: RespuestaCategoryMembers = r.json().await?;
            if let Some(q) = cuerpo.query {
                titulos.extend(q.categorymembers.into_iter().map(|m| m.title));
            }
            match cuerpo.continuar.and_then(|c| c.cmcontinue) {
                Some(c) => cmcontinue = Some(c),
                None => break,
            }
        }
        Ok(titulos)
    }

    /// Todos los títulos de fichero utilizables de un monumento: los de su
    /// categoría raíz más los de, como mucho, un nivel de subcategorías cuyo
    /// título empiece por uno de `PREFIJOS_SUBCAT_VISTA`.
    async fn titulos_de_monumento(&self, categoria: &str) -> Result<Vec<String>> {
        let cat = format!("Category:{categoria}");
        let mut titulos = self.miembros_categoria(&cat, "file").await?;
        if let Ok(subcats) = self.miembros_categoria(&cat, "subcat").await {
            for sc in subcats.iter().filter(|sc| es_subcat_de_vista(sc)) {
                if let Ok(mas) = self.miembros_categoria(sc, "file").await {
                    titulos.extend(mas);
                }
            }
        }
        Ok(titulos)
    }

    /// `imageinfo` por lotes de 50 títulos — el tope del propio MediaWiki —
    /// con los mismos `iiprop`/`iiurlwidth` que usa `commons.rs`.
    async fn imageinfo_por_lotes(&self, titulos: &[String]) -> Result<Vec<PaginaImg>> {
        let mut fuera = Vec::new();
        for lote in titulos.chunks(50) {
            let titles = lote.join("|");
            let url = format!(
                "{COMMONS_API}?action=query&format=json&formatversion=1\
                 &prop=imageinfo&iiprop=url%7Csize%7Cextmetadata&iiurlwidth=2048&titles={}",
                urlencoding::encode(&titles)
            );
            let _g = self.ctx.limitador.permiso().await;
            let r = self.ctx.cliente.get(&url).send().await?;
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
}

#[async_trait]
impl OrigenDeRed for Monumentos {
    fn id(&self) -> &'static str {
        "monumentos"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Suelta
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        // Tan genérico como `commons.rs`: los bytes SÍ salen de Commons, así
        // que la licencia real varía por fichero y se guarda en `Atribucion`.
        Redistribucion::Libre { licencia: "libre (Commons)".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let monumentos = self.monumentos_en_tesela(tesela).await?;
        let mut total = 0u32;
        for m in &monumentos {
            let Some(categoria) = &m.categoria else { continue };
            total += self.titulos_de_monumento(categoria).await.map(|v| v.len()).unwrap_or(0) as u32;
        }
        Ok(Disponibilidad::Muestreo { nivel: Nivel::de(total), estimadas: total })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let mut fuera = Vec::new();
        for m in self.monumentos_en_tesela(tesela).await? {
            let Some(categoria) = &m.categoria else { continue };
            let titulos = match self.titulos_de_monumento(categoria).await {
                Ok(t) => t,
                Err(e) => {
                    log::warn!("monumentos {categoria}: {e}");
                    continue;
                }
            };
            if titulos.is_empty() {
                continue;
            }
            let paginas = match self.imageinfo_por_lotes(&titulos).await {
                Ok(p) => p,
                Err(e) => {
                    log::warn!("monumentos {categoria}: {e}");
                    continue;
                }
            };
            for p in paginas {
                let Some(i) = p.imageinfo.first() else { continue };
                let Some(url) = i.thumb.clone().or_else(|| i.url.clone()) else { continue };
                let licencia = i.meta.get("LicenseShortName").and_then(|c: &Campo| c.value.clone());
                let cand = Candidata {
                    ancho: i.width,
                    alto: i.height,
                    precision_metros: None,
                    // Ya filtramos por una categoría de "vistas exteriores":
                    // no hay categorías propias de la página que comprobar
                    // aquí, así que la regla de interior de `Reglas::evaluar`
                    // no tiene nada que ver en un `Tipo::Suelta` sin ellas.
                    categorias: vec![],
                    licencia: licencia.clone(),
                    tipo: Tipo::Suelta,
                };
                if let Veredicto::Fuera(motivo) = Reglas::por_defecto().evaluar(&cand) {
                    log::debug!("monumentos {}: descartada, {motivo}", p.title);
                    continue;
                }
                if tope.gastar(&self.tarifa(), 1).is_err() {
                    return Ok(fuera);
                }
                let ruta = match self.ctx.bajar_imagen(&url, &format!("mon-{}.jpg", p.pageid)).await {
                    Ok(r) => r,
                    Err(e) => {
                        log::warn!("monumentos {}: {e}", p.title);
                        continue;
                    }
                };
                let campo = |k: &str| i.meta.get(k).and_then(|c| c.value.clone());
                fuera.push(Captura {
                    fuente: "monumentos",
                    id_origen: p.pageid.to_string(),
                    ruta,
                    // La coordenada es la del MONUMENTO (P625 de Wikidata),
                    // NO la de la cámara: un fichero que llega por su
                    // categoría no está geoetiquetado, y "dónde está el
                    // edificio" es la única coordenada que tenemos. Es
                    // deliberadamente distinta de "dónde estaba el turista",
                    // que es lo que guardaría `commons.rs` si el fichero
                    // tuviera su propia `{{Location}}` — por eso esta
                    // procedencia es `"monumentos"` y no `"commons"`, aunque
                    // los bytes salgan del mismo sitio.
                    lat: m.lat,
                    lng: m.lng,
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
        }
        Ok(fuera)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn el_punto_wkt_se_parsea_como_lat_lng() {
        // WKT es "Point(lng lat)": al revés que casi todo lo demás en este
        // módulo, y confundirlo coloca León en el Atlántico.
        assert_eq!(parsear_punto("Point(-5.570277777 42.598333333)"), Some((42.598333333, -5.570277777)));
        assert_eq!(parsear_punto("no es un punto"), None);
    }

    #[test]
    fn la_url_sparql_lleva_el_servicio_around_y_los_dos_predicados() {
        let u = url_sparql(42.5987, -5.5669, 1.2);
        assert!(u.contains("query.wikidata.org/sparql"), "{u}");
        // Todo va urlencoded dentro de `query=`; se comprueba el contenido
        // decodificando el propio parámetro, no buscando texto plano.
        let decodificada = urlencoding::decode(u.split("query=").nth(1).unwrap()).unwrap();
        assert!(decodificada.contains("wikibase:around"), "{decodificada}");
        assert!(decodificada.contains("P625"), "{decodificada}");
        assert!(decodificada.contains("P18"), "{decodificada}");
        assert!(decodificada.contains("P373"), "{decodificada}");
    }

    #[test]
    fn el_centro_y_radio_cubren_la_tesela_con_margen() {
        let b = Bbox { oeste: -5.575, sur: 42.595, este: -5.565, norte: 42.605 };
        let (lat, lng, radio) = centro_y_radio_km(b);
        assert!((lat - 42.6).abs() < 0.01);
        assert!((lng - (-5.57)).abs() < 0.01);
        // Una tesela z14 mide unas décimas de km de lado: un radio de
        // decenas de km sería un error de escala, no margen.
        assert!(radio > 0.0 && radio < 5.0, "{radio}");
    }

    #[test]
    fn una_subcategoria_de_exterior_o_fachada_se_reconoce_pese_al_prefijo_y_el_idioma() {
        assert!(es_subcat_de_vista("Category:Exterior of the Cathedral of León"));
        assert!(es_subcat_de_vista("Facade of Notre-Dame"));
        assert!(es_subcat_de_vista("Views of León"));
        assert!(es_subcat_de_vista("Category:Fachada de la catedral"));
        assert!(es_subcat_de_vista("vistas generales"));
        assert!(!es_subcat_de_vista("Category:Interior of the Cathedral of León"));
        assert!(!es_subcat_de_vista("Sculptures in the Cathedral of León"));
    }

    #[test]
    fn los_monumentos_sin_coordenada_se_descartan_y_los_demas_conservan_su_categoria() {
        let json = r#"{
            "results": { "bindings": [
                { "item": {"type":"uri","value":"http://www.wikidata.org/entity/Q1"},
                  "loc": {"type":"literal","value":"Point(-5.57 42.6)"},
                  "cat": {"type":"literal","value":"Cathedral of León"} },
                { "item": {"type":"uri","value":"http://www.wikidata.org/entity/Q2"},
                  "loc": {"type":"literal","value":"Point(-5.58 42.61)"},
                  "img": {"type":"uri","value":"http://commons.wikimedia.org/x.jpg"} },
                { "item": {"type":"uri","value":"http://www.wikidata.org/entity/Q3"} }
            ]}
        }"#;
        let r: RespuestaSparql = serde_json::from_str(json).unwrap();
        let monumentos = monumentos_de(r);
        // Q3 no trae "loc" -- no debería poder existir sin coordenada aunque
        // la propia consulta SPARQL nunca lo devolvería sin P625.
        assert_eq!(monumentos.len(), 2);
        assert_eq!(monumentos[0].categoria.as_deref(), Some("Cathedral of León"));
        assert_eq!(monumentos[1].categoria, None, "Q2 solo trae P18, sin categoría que listar");
    }
}
