//! Mapillary. El único origen con puntos exactos, y por dos vías distintas:
//!
//!   - En el NAVEGADOR, sus teselas vectoriales oficiales, que Mapbox GL pinta
//!     como una capa más. Gratis, ya cacheadas, sin pasar por el backend.
//!   - En el BACKEND, la Graph API por bbox. Una tesela z14 mide ~0,0005 grados
//!     cuadrados y el tope de área de la Graph API es 0,01: cabe veinte veces.
//!     Por eso aquí no hace falta decodificar teselas vectoriales en Rust.

use std::path::PathBuf;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::coverage::Atribucion;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use lumi_index::tiles::bbox_de_tesela;
use serde::Deserialize;

use super::{Ctx, OrigenDeRed};

const GRAPH: &str = "https://graph.mapillary.com/images";
const CAMPOS: &str = "id,compass_angle,thumb_2048_url,captured_at,creator,computed_geometry,geometry";
/// Sin `computed_geometry`: es el campo caro, refinado por SfM sobre el GPS
/// crudo, y es lo primero que se sacrifica cuando la consulta completa no
/// cabe. `geometry` (el GPS crudo) sigue viniendo, así que la posición no se
/// pierde — solo el refinado.
const CAMPOS_LIGERO: &str = "id,compass_angle,thumb_2048_url,captured_at,creator,geometry";

/// Tope de fotos por tesela, ahora alcanzado de verdad: se sigue `paging.next`
/// hasta este techo o hasta que la Graph API deje de ofrecer página siguiente,
/// lo que llegue antes. 2000 fotos en 2,4 km² sigue siendo cobertura densa de
/// sobra; lo que cambiaba es que antes se pedía ese número y solo se recibía
/// la primera página de camino a él.
const LIMITE: u32 = 2000;
/// La consulta de reintento tras un 500: un cuarto del límite y sin
/// `computed_geometry`. Un centro urbano muy denso (Tokio, por ejemplo) puede
/// hacer que la Graph API se ahogue construyendo la respuesta completa —varios
/// cientos de fotos con su geometría refinada por SfM cuesta más de calcular
/// que devolver— y responde 500 en vez de recortar ella misma. Confirmado
/// contra el fallo real: la misma tesela, la misma bbox, siempre 500 con la
/// consulta completa.
const LIMITE_LIGERO: u32 = LIMITE / 4;

/// Cuántas veces se puede partir el área en cuadrantes si ni la consulta
/// ligera cabe. Una tesela z14 cabe veinte veces en el tope de área de la
/// Graph API, así que hay margen de sobra: al nivel 3 cada cuadrante mide un
/// 1/64 de la tesela original, muy lejos de ese tope. El límite es para no
/// encadenar peticiones sin fin si un área fuera anormalmente densa en todos
/// sus cuadrantes a la vez.
const PROFUNDIDAD_MAXIMA: u32 = 3;

/// Tope de tiempo para toda la subdivisión de una tesela. Si el área entera
/// sigue devolviendo 500 incluso partida, el problema ya no es "muy densa"
/// sino un fallo real de Mapillary en la zona, y no tiene sentido seguir
/// gastando minutos en algo que no va a resolverse solo.
const TIEMPO_MAXIMO: std::time::Duration = std::time::Duration::from_secs(60);

/// Tope de TODO `consultar()`, incluida la primera consulta completa (la que
/// no pasa por `TIEMPO_MAXIMO`). Confirmado contra un caso real: una tesela se
/// quedó colgada más de 500 segundos sin que `TIEMPO_MAXIMO` la parara, lo que
/// solo cuadra si el cuelgue está en esa primera petición y no en la
/// subdivisión — un `reqwest::Client::timeout` que no corta una conexión
/// atascada tan pronto como debería. Esta es la red de seguridad de fuera:
/// pase lo que pase dentro, `consultar()` entero no puede tardar más de esto.
const TIEMPO_MAXIMO_TOTAL: std::time::Duration = std::time::Duration::from_secs(90);

#[derive(Debug, Deserialize)]
pub struct Geometria {
    pub coordinates: [f64; 2],
}

#[derive(Debug, Deserialize)]
pub struct Autor {
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Foto {
    pub id: String,
    pub compass_angle: Option<f32>,
    pub thumb_2048_url: Option<String>,
    pub captured_at: Option<i64>,
    pub creator: Option<Autor>,
    /// Posición refinada por SfM: más exacta que el GPS crudo de `geometry`,
    /// así que se prefiere cuando viene.
    pub computed_geometry: Option<Geometria>,
    pub geometry: Option<Geometria>,
}

#[derive(Debug, Deserialize)]
pub struct Respuesta {
    pub data: Vec<Foto>,
    pub paging: Option<Paging>,
}

#[derive(Debug, Deserialize)]
pub struct Paging {
    pub next: Option<String>,
}

/// `(lat, lng)`. GeoJSON las da al revés, y confundirlas coloca A Coruña en
/// mitad del Atlántico sin que nada falle.
pub fn posicion(f: &Foto) -> Option<(f64, f64)> {
    let g = f.computed_geometry.as_ref().or(f.geometry.as_ref())?;
    Some((g.coordinates[1], g.coordinates[0]))
}

/// Los cuatro cuadrantes de una bbox, partiendo por el medio de cada eje.
fn cuadrantes_de(b: lumi_index::tiles::Bbox) -> [lumi_index::tiles::Bbox; 4] {
    let lng_medio = (b.oeste + b.este) / 2.0;
    let lat_medio = (b.sur + b.norte) / 2.0;
    [
        lumi_index::tiles::Bbox { oeste: b.oeste, sur: b.sur, este: lng_medio, norte: lat_medio },
        lumi_index::tiles::Bbox { oeste: lng_medio, sur: b.sur, este: b.este, norte: lat_medio },
        lumi_index::tiles::Bbox { oeste: b.oeste, sur: lat_medio, este: lng_medio, norte: b.norte },
        lumi_index::tiles::Bbox { oeste: lng_medio, sur: lat_medio, este: b.este, norte: b.norte },
    ]
}

pub struct Mapillary {
    ctx: Ctx,
}

impl Mapillary {
    pub fn nuevo(token: String, stage: PathBuf) -> Self {
        Self { ctx: Ctx::nuevo(Some(token), stage, 8, 4) }
    }

    fn url_de_bbox(&self, b: lumi_index::tiles::Bbox, limite: u32, campos: &str) -> String {
        format!(
            "{GRAPH}?fields={campos}&limit={limite}&bbox={},{},{},{}",
            b.oeste, b.sur, b.este, b.norte
        )
    }

    async fn pedir(&self, url: &str) -> Result<reqwest::Response> {
        let _p = self.ctx.limitador.permiso().await;
        let token = self.ctx.clave.as_deref().unwrap_or_default();
        Ok(self.ctx.cliente.get(url).header("Authorization", format!("OAuth {token}")).send().await?)
    }

    /// La consulta ligera para un área. Si ni así cabe (un 500 persistente:
    /// confirmado contra Tokio, donde ni siquiera `LIMITE_LIGERO` basta en el
    /// núcleo urbano más denso), el problema es el volumen de fotos del área,
    /// no los campos pedidos — así que se parte en cuatro cuadrantes y se
    /// repite en cada uno, hasta `PROFUNDIDAD_MAXIMA` niveles.
    fn consultar_ligero<'a>(
        &'a self,
        b: lumi_index::tiles::Bbox,
        profundidad: u32,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<Foto>>> + Send + 'a>> {
        Box::pin(self.consultar_ligero_interno(b, profundidad))
    }

    async fn consultar_ligero_interno(&self, b: lumi_index::tiles::Bbox, profundidad: u32) -> Result<Vec<Foto>> {
        let url = self.url_de_bbox(b, LIMITE_LIGERO, CAMPOS_LIGERO);
        let r = self.pedir(&url).await?;
        if r.status().as_u16() == 500 {
            if profundidad == 0 {
                anyhow::bail!(
                    "Mapillary respondió 500 a {} tras agotar la subdivisión del área",
                    crate::keys::redactar(&url)
                );
            }
            log::warn!("mapillary: 500 incluso con la consulta ligera, partiendo el área en cuatro");
            // Los cuatro cuadrantes EN PARALELO, no uno tras otro: en serie,
            // un área que sigue fallando en profundidad multiplica el tiempo
            // por cuatro en cada nivel (hasta 85 peticiones seguidas al fondo
            // de `PROFUNDIDAD_MAXIMA`, minutos de espera confirmados contra un
            // caso real). En paralelo el coste es por NIVEL, no por rama, y de
            // paso aprovecha la concurrencia de 4 que ya tiene el limitador.
            let [c0, c1, c2, c3] = cuadrantes_de(b);
            let (r0, r1, r2, r3) = tokio::join!(
                self.consultar_ligero(c0, profundidad - 1),
                self.consultar_ligero(c1, profundidad - 1),
                self.consultar_ligero(c2, profundidad - 1),
                self.consultar_ligero(c3, profundidad - 1),
            );
            // Un punto justo en el corte podría caer en dos cuadrantes a la
            // vez; sin esto entraría duplicado en el índice.
            let mut vistas = std::collections::HashSet::new();
            let mut fuera = Vec::new();
            for r in [r0, r1, r2, r3] {
                for f in r? {
                    if vistas.insert(f.id.clone()) {
                        fuera.push(f);
                    }
                }
            }
            // EL TOPE SE APLICA EN CADA NIVEL, no solo al final. Sin esto, la
            // subdivisión multiplica el techo por cuatro en cada nivel: a
            // `PROFUNDIDAD_MAXIMA` son 64 subáreas × `LIMITE_LIGERO` = 32.000
            // fotos para UNA tesela, dieciséis veces el `LIMITE` que esto
            // siempre quiso respetar. Y como cada foto es una descarga
            // aparte contra el limitador, eso son horas de trabajo por
            // tesela — confirmado contra el caso real de Tokio, donde la
            // consulta resolvía en 49 s y la tesela seguía bajando imágenes
            // ocho minutos después.
            fuera.truncate(LIMITE as usize);
            return Ok(fuera);
        }
        if !r.status().is_success() {
            anyhow::bail!("Mapillary respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        Ok(r.json::<Respuesta>().await?.data)
    }

    /// Envoltorio fino: TODO `consultar_interno` —incluida la primera consulta,
    /// que no pasa por `TIEMPO_MAXIMO`— tiene que resolver dentro de
    /// `TIEMPO_MAXIMO_TOTAL` sí o sí. Ver el comentario de esa constante: es la
    /// red de seguridad de fuera, para el caso de que el cuelgue esté en un
    /// sitio que la de dentro no cubre.
    async fn consultar(&self, tesela: &str) -> Result<Vec<Foto>> {
        let inicio = tokio::time::Instant::now();
        match tokio::time::timeout(TIEMPO_MAXIMO_TOTAL, self.consultar_interno(tesela, inicio)).await {
            Ok(r) => r,
            Err(_) => anyhow::bail!(
                "mapillary {tesela}: consultar() entero superó los {}s, se abandona (tope exterior)",
                TIEMPO_MAXIMO_TOTAL.as_secs()
            ),
        }
    }

    async fn consultar_interno(&self, tesela: &str, inicio: tokio::time::Instant) -> Result<Vec<Foto>> {
        let b = bbox_de_tesela(tesela);
        let url = self.url_de_bbox(b, LIMITE, CAMPOS);
        log::warn!("mapillary {tesela}: pidiendo consulta completa (t={}s)", inicio.elapsed().as_secs());
        let r = self.pedir(&url).await?;
        log::warn!(
            "mapillary {tesela}: consulta completa respondió {} (t={}s)",
            r.status(), inicio.elapsed().as_secs()
        );
        if r.status().as_u16() == 500 {
            // Un 500 en un área muy densa suele ser el servidor ahogándose en
            // construir la respuesta completa, no un fallo transitorio de red
            // — reintentar la MISMA consulta no cambiaría nada. Se pide menos
            // y más barato antes de darse por vencido, y si ni eso basta, se
            // parte el área (`consultar_ligero`) en vez de rendirse.
            log::warn!("mapillary {tesela}: 500 con la consulta completa, reintentando más barata");
            // Con las cuatro ramas en paralelo el coste ya es por nivel, pero
            // si el área entera está muerta (no solo densa: un fallo real de
            // Mapillary en esa región) los tres niveles de profundidad
            // seguirían gastando minutos antes de rendirse. Este tope es la
            // red de seguridad: pasado `TIEMPO_MAXIMO` se abandona con un
            // error claro en vez de dejar la tesela — y con ella la descarga
            // entera— colgada indefinidamente.
            let resultado = tokio::time::timeout(TIEMPO_MAXIMO, self.consultar_ligero(b, PROFUNDIDAD_MAXIMA)).await;
            log::warn!(
                "mapillary {tesela}: subdivisión terminó de esperar (t={}s, {})",
                inicio.elapsed().as_secs(),
                if resultado.is_ok() { "resolvió" } else { "tope agotado" }
            );
            return match resultado {
                Ok(r) => r,
                Err(_) => anyhow::bail!(
                    "mapillary {tesela}: sigue en 500 tras {}s subdividiendo, se abandona",
                    TIEMPO_MAXIMO.as_secs()
                ),
            };
        }
        if !r.status().is_success() {
            anyhow::bail!("Mapillary respondió {} a {}", r.status(), crate::keys::redactar(&url));
        }
        let primera: Respuesta = r.json().await?;
        self.seguir_paginas(primera).await
    }

    /// Sigue `paging.next` hasta `LIMITE` o hasta que la API deje de
    /// ofrecer página siguiente. La Graph API sí pagina de verdad — quedarse
    /// con `primera.data` era el bug: aquí es donde se pedía más y no se
    /// recibía más que la primera página.
    async fn seguir_paginas(&self, primera: Respuesta) -> Result<Vec<Foto>> {
        let mut fuera = primera.data;
        let mut siguiente = primera.paging.and_then(|p| p.next);
        while let Some(url) = siguiente {
            if fuera.len() >= LIMITE as usize {
                break;
            }
            let r = self.pedir(&url).await?;
            if !r.status().is_success() {
                // Una página posterior que falla no invalida lo ya reunido:
                // se para aquí con lo que hay, no se tira todo por un fallo
                // a mitad de la lista.
                log::warn!("mapillary: página siguiente respondió {}, se para con lo reunido", r.status());
                break;
            }
            let pagina: Respuesta = r.json().await?;
            fuera.extend(pagina.data);
            siguiente = pagina.paging.and_then(|p| p.next);
        }
        fuera.truncate(LIMITE as usize);
        Ok(fuera)
    }
}

#[async_trait]
impl OrigenDeRed for Mapillary {
    fn id(&self) -> &'static str {
        "mapillary"
    }
    fn tipo(&self) -> Tipo {
        Tipo::Calle
    }
    fn tarifa(&self) -> Tarifa {
        Tarifa::Gratis
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }
    fn bajadas(&self) -> u32 {
        self.ctx.bajadas()
    }
    fn objetivo(&self) -> u32 {
        self.ctx.objetivo()
    }
    fn puntos_exactos(&self) -> bool {
        true
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        Ok(Disponibilidad::Puntos { cuantos: self.consultar(tesela).await?.len() as u32 })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        // A 0 antes de consultar: si no, mientras se resuelve esta tesela se
        // seguiría enseñando el total de la ANTERIOR, que ya no pinta nada.
        self.ctx.fijar_objetivo(0);
        let fotos = self.consultar(tesela).await?;
        // Se sabe entero ANTES de bajar la primera: Mapillary resuelve la
        // lista completa de una vez, así que este es el único momento en que
        // hay un total real que enseñar en vez de solo un contador que sube.
        self.ctx.fijar_objetivo(fotos.len() as u32);
        let mut fuera = Vec::new();
        for f in fotos {
            // Los dos casos de abajo son RESULTADOS, no averías: una foto sin
            // URL o sin posición no se puede usar, se salta y no se reintenta.
            let Some(url) = f.thumb_2048_url.clone() else { continue };
            let Some((lat, lng)) = posicion(&f) else { continue };
            if tope.gastar(&self.tarifa(), 1).is_err() {
                break;
            }
            let ruta = match self.ctx.bajar_imagen(&url, &format!("mly-{}.jpg", f.id)).await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("mapillary {}: {e}", f.id);
                    continue;
                }
            };
            let autor = f.creator.as_ref().and_then(|c| c.username.clone());
            fuera.push(Captura {
                fuente: "mapillary",
                id_origen: f.id.clone(),
                ruta,
                lat,
                lng,
                rumbo: f.compass_angle,
                capturada_en: f.captured_at.map(marca_iso),
                atribucion: Atribucion {
                    autor: autor.unwrap_or_else(|| "Mapillary".into()),
                    url: format!("https://www.mapillary.com/app/?pKey={}", f.id),
                    licencia: "CC BY-SA 4.0".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

/// Milisegundos de época a ISO 8601 en UTC, sin arrastrar `chrono` por una
/// función. `capturada_en` es una cadena que solo se guarda y se enseña.
/// El calendario es el `civil_from_days` de Howard Hinnant.
pub fn marca_iso(ms: i64) -> String {
    let s = ms.div_euclid(1000);
    let (dias, resto) = (s.div_euclid(86_400), s.rem_euclid(86_400));
    let z = dias + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z",
        resto / 3600,
        (resto % 3600) / 60,
        resto % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_url_de_consulta_lleva_el_bbox_y_nunca_la_clave() {
        let m = Mapillary::nuevo("MLY|SECRETO".into(), std::path::PathBuf::from("/tmp"));
        let u = m.url_de_bbox(bbox_de_tesela("03113322013021"), LIMITE, CAMPOS);
        assert!(u.contains("graph.mapillary.com/images"), "{u}");
        assert!(u.contains("bbox="), "{u}");
        // Mapillary SÍ ofrece cabecera (`Authorization: OAuth`), así que aquí
        // la regla de «ningún secreto en una ruta» se cumple sin excepción.
        assert!(!u.contains("SECRETO"), "la clave no puede ir en la URL: {u}");
        assert!(!u.contains("access_token"), "{u}");
    }

    #[test]
    fn el_bbox_va_en_el_orden_que_pide_la_graph_api() {
        let m = Mapillary::nuevo("t".into(), std::path::PathBuf::from("/tmp"));
        let qk = lumi_index::tiles::quadkey(43.3623, -8.4115);
        let u = m.url_de_bbox(bbox_de_tesela(&qk), LIMITE, CAMPOS);
        let bbox = u.split("bbox=").nth(1).unwrap().split('&').next().unwrap();
        let n: Vec<f64> = bbox.split(',').map(|s| s.parse().unwrap()).collect();
        assert_eq!(n.len(), 4);
        assert!(n[0] < n[2], "oeste antes que este: {bbox}");
        assert!(n[1] < n[3], "sur antes que norte: {bbox}");
        // Y el área cabe de sobra en el tope de 0,01 de la Graph API.
        assert!((n[2] - n[0]) * (n[3] - n[1]) < 0.001, "{bbox}");
    }

    #[test]
    fn una_foto_sin_url_de_imagen_es_un_resultado_y_se_salta() {
        let json = r#"{"data":[
          {"id":"1","thumb_2048_url":"https://x/1.jpg","compass_angle":10.0,
           "geometry":{"type":"Point","coordinates":[-8.41,43.36]},
           "creator":{"username":"ana"},"captured_at":1714646400000},
          {"id":"2","compass_angle":20.0,
           "geometry":{"type":"Point","coordinates":[-8.42,43.37]}}
        ]}"#;
        let r: Respuesta = serde_json::from_str(json).unwrap();
        let utiles: Vec<_> = r.data.iter().filter(|f| f.thumb_2048_url.is_some()).collect();
        assert_eq!(utiles.len(), 1);
        assert_eq!(utiles[0].id, "1");
        assert_eq!(posicion(utiles[0]), Some((43.36, -8.41)), "lat primero, lng después");
    }

    #[test]
    fn los_cuatro_cuadrantes_cubren_la_bbox_entera_sin_hueco() {
        let b = lumi_index::tiles::Bbox { oeste: 139.68, sur: 35.675, este: 139.70, norte: 35.71 };
        let c = cuadrantes_de(b);
        // Área total conservada: la suma de las cuatro es la del original.
        let area = |x: lumi_index::tiles::Bbox| (x.este - x.oeste) * (x.norte - x.sur);
        let suma: f64 = c.iter().map(|&x| area(x)).sum();
        assert!((suma - area(b)).abs() < 1e-12, "suma={suma} original={}", area(b));
        // Las esquinas exteriores de los cuadrantes coinciden con la bbox madre.
        assert_eq!(c[0].oeste, b.oeste);
        assert_eq!(c[0].sur, b.sur);
        assert_eq!(c[3].este, b.este);
        assert_eq!(c[3].norte, b.norte);
    }

    #[test]
    fn la_marca_de_tiempo_sale_en_iso_utc() {
        // 1714646400000 ms = 2024-05-02T10:40:00Z
        assert_eq!(marca_iso(1_714_646_400_000), "2024-05-02T10:40:00Z");
        assert_eq!(marca_iso(0), "1970-01-01T00:00:00Z");
    }
}
