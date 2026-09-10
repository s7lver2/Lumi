//! Exportar el caso entero a un informe forense en PDF: por cada imagen, su
//! miniatura, el GPS declarado por la cámara (si lo hay) y cada análisis que
//! se le ha hecho -- geolocalización o agentes -- resumido en texto. Pensado
//! para entregarse a un tercero como evidencia, así que un análisis sin
//! terminar o que falló se dice tal cual, nunca se omite.
//!
//! El documento se compila con `tectonic` (binario único autocontenido, sin
//! TeX Live/MiKTeX completo) a partir de una plantilla LaTeX rellenada con
//! `tera` -- ver `templates/informe.tex.tera`. Es la misma frontera de
//! proceso externo que ya usa el proyecto con los workers de Python
//! (`workers/`): un `std::process::Command`, entrada/salida por disco en un
//! directorio temporal propio de esta petición, nunca un `unwrap` sobre su
//! resultado.

use crate::routes::analyses::{agentes_por_caso, hypotheses_por_caso, image_ids_por_caso, row_to_analysis};
use crate::routes::cases::guard_case;
use crate::routes::images::{dir_for, row_to_image};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode, Json};
use lumi_proto::api::{Analysis, DichoDeAgente, ExportInformeReq, Image};
use lumi_proto::worker::Rasgos;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path as FsPath, PathBuf};
use std::process::Command;

pub async fn export_pdf(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    Json(req): Json<ExportInformeReq>,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    // Mismo guardián que el resto de rutas de caso: cualquier miembro del
    // proyecto puede pedir el informe, no solo el administrador.
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;

    let (case_name, case_created_at): (String, i64) = app
        .store
        .conn()
        .query_row("SELECT name, created_at FROM cases WHERE id = ?1", [case_id], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })
        .map_err(|_| err(StatusCode::NOT_FOUND, "no existe ese caso"))?;

    let mut images: Vec<Image> = {
        let c = app.store.conn();
        let cols = crate::routes::images::COLS;
        let mut q = c
            .prepare(&format!("SELECT {cols} FROM images WHERE case_id = ?1 ORDER BY created_at"))
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let filas: Vec<Image> = q
            .query_map([case_id], row_to_image)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
            .flatten()
            .collect();
        filas
    };

    // `None` (el valor de siempre) deja pasar todas -- una llamada vieja que
    // no manda este campo no cambia de comportamiento. Con una lista, solo
    // esas imágenes entran en el resto del pipeline.
    if let Some(ids) = &req.imagenes_incluidas {
        let incluidos: std::collections::HashSet<i64> = ids.iter().copied().collect();
        images.retain(|img| incluidos.contains(&img.id));
    }

    // Los análisis del caso entero, con sus imágenes/hipótesis/agentes ya
    // resueltos -- mismo patrón de `analyses::list` (3 consultas para el
    // caso completo, no una por análisis).
    let analyses: Vec<Analysis> = {
        let c = app.store.conn();
        let cols = crate::routes::analyses::COLS;
        let mut q = c
            .prepare(&format!("SELECT {cols} FROM analyses WHERE case_id = ?1 ORDER BY created_at"))
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        let mut rows: Vec<Analysis> = q
            .query_map([case_id], row_to_analysis)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
            .flatten()
            .collect();
        let mut imagenes = image_ids_por_caso(&c, case_id);
        let mut hipotesis = hypotheses_por_caso(&c, case_id);
        let mut dichos = agentes_por_caso(&c, case_id);
        for a in &mut rows {
            a.image_ids = imagenes.remove(&a.id).unwrap_or_default();
            a.hypotheses = hipotesis.remove(&a.id).unwrap_or_default();
            a.agentes = dichos.remove(&a.id).unwrap_or_default();
        }
        rows
    };

    // Un análisis solo trabaja con una imagen hoy (`image_ids` siempre trae
    // una), pero se agrupa por `image_ids` entero y no por "la primera" para
    // no dar por hecho ese límite aquí también.
    let mut por_imagen: std::collections::HashMap<i64, Vec<Analysis>> = std::collections::HashMap::new();
    for a in &analyses {
        for id in &a.image_ids {
            por_imagen.entry(*id).or_default().push(a.clone());
        }
    }

    let dir = dir_for(&app, pid);
    let filas: Vec<(Image, Option<Vec<u8>>, Vec<Analysis>)> = images
        .into_iter()
        .map(|img| {
            let thumb = std::fs::read(dir.join(format!("{}.thumb", img.id))).ok();
            let analyses = por_imagen.remove(&img.id).unwrap_or_default();
            (img, thumb, analyses)
        })
        .collect();

    // Las estadísticas de portada son, por defecto, del caso ENTERO -- un
    // resumen real, no de lo que quedó visible tras los interruptores de
    // texto (ver el comentario de `calcular_estadisticas`). Pero
    // `imagenes_incluidas` no es un interruptor de qué se ve, es una
    // selección real de qué DATOS entran en el informe: si el investigador
    // elige a mano que solo tres fotos formen parte del documento, las
    // estadísticas de esas tres es lo que espera leer, no las de fotos que ni
    // siquiera aparecen. Se filtra aquí, no dentro de `calcular_estadisticas`,
    // para que esa función siga recibiendo "los análisis que debe agregar" sin
    // tener que conocer el criterio de selección.
    let analyses_para_pdf: Vec<Analysis> = if req.imagenes_incluidas.is_some() {
        let ids_incluidos: std::collections::HashSet<i64> = filas.iter().map(|(img, _, _)| img.id).collect();
        analyses.into_iter().filter(|a| a.image_ids.iter().any(|id| ids_incluidos.contains(id))).collect()
    } else {
        analyses
    };

    // Montar el `.tex`, escribir los ficheros del trabajo y compilar es CPU +
    // un subproceso, no red -- al pool de `spawn_blocking`, igual que
    // `procesar_imagen` en la subida.
    let case_id_para_log = case_id;
    let resultado = tokio::task::spawn_blocking(move || {
        generar_pdf(&case_name, case_created_at, &dir, &filas, &req, &analyses_para_pdf)
    })
    .await
    .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let bytes = resultado.map_err(|fallo| match fallo {
        FalloInforme::FaltaTectonic(m) => {
            tracing::warn!(case_id = case_id_para_log, "export.pdf sin tectonic: {m}");
            err(StatusCode::SERVICE_UNAVAILABLE, &m)
        }
        FalloInforme::Compilacion(m) => {
            tracing::warn!(case_id = case_id_para_log, "export.pdf: tectonic falló: {m}");
            err(StatusCode::INTERNAL_SERVER_ERROR, &format!("no se pudo generar el informe: {m}"))
        }
    })?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/pdf".to_string()),
            (axum::http::header::CONTENT_DISPOSITION, "attachment".to_string()),
        ],
        bytes,
    ))
}

enum FalloInforme {
    /// El binario no está disponible en este servidor -- accionable: hay que
    /// reinstalar, no un fallo transitorio de compilación.
    FaltaTectonic(String),
    Compilacion(String),
}

// ------------------------------------------------------------- contexto --
// Lo que ve la plantilla `informe.tex.tera`. Nombres en español porque la
// plantilla también lo está, y son lo mismo que un investigador leería en el
// documento final.

#[derive(Serialize)]
struct Contexto {
    caso: String,
    generado: String,
    firmado_por: String,
    n_imagenes: usize,
    incluir_estadisticas: bool,
    estadisticas: Option<Estadisticas>,
    imagenes: Vec<ImagenCtx>,
    /// Notas libres del investigador -- vacío significa que la plantilla no
    /// dibuja la sección entera, no que se dibuje una en blanco.
    notas: String,
    /// `"oscuro"` (editorial, por defecto) o `"claro"` (el documento
    /// imprimible de siempre). Cualquier otra cosa que llegue del cliente se
    /// normaliza aquí a `"claro"` en vez de propagar un valor desconocido a
    /// la plantilla -- ver `ExportInformeReq::tema`.
    tema: String,
}

#[derive(Serialize)]
struct ModeloCount {
    modelo: String,
    n: usize,
}

#[derive(Serialize)]
struct Estadisticas {
    creado_en: String,
    por_modelo: Vec<ModeloCount>,
    /// Ya redondeada a un entero de porcentaje -- `None` cuando NINGÚN
    /// análisis de geolocalización dejó una confianza registrada, nunca un
    /// 0 inventado (principio "nunca se inventa" del proyecto).
    confianza_media_pct: Option<i64>,
    agentes_total: usize,
    agentes_respondieron: usize,
    agentes_abstuvieron: usize,
    /// Los cuatro números grandes de la portada del tema oscuro -- se
    /// calculan por imagen (ver `resumen_oscuro`), no por análisis, porque
    /// "imágenes con hipótesis" e "imágenes sin resolver" son conteos de
    /// fotos, no de filas de la tabla `analyses`. El tema claro no los usa,
    /// pero calcularlos siempre es más simple que duplicar
    /// `calcular_estadisticas` según el tema (ver comentario en esa función).
    n_con_hipotesis: usize,
    n_con_agente: usize,
    n_sin_resolver: usize,
    n_errores: usize,
    n_abstenciones: usize,
}

#[derive(Serialize, Clone)]
struct Linea {
    texto: String,
    /// `"cabecera"` (negrita) o `"cuerpo"` (texto normal) -- las dos únicas
    /// variantes que usaba `linea()` en la versión de `printpdf`, portadas
    /// tal cual.
    variante: &'static str,
}

#[derive(Serialize)]
struct ImagenCtx {
    /// Número de orden dentro del informe (1-based) -- solo lo usa la
    /// cabecera mono de la página del tema oscuro ("03 — foto.jpg"), el tema
    /// claro sigue usando `\subsection*` de siempre.
    orden: usize,
    filename: String,
    /// Nombre de fichero relativo, ya escrito junto al `.tex`, de la
    /// miniatura -- `None` si no hay miniatura en disco o no se pudo
    /// decodificar como imagen real (nunca se referencia un fichero que no
    /// se sabe abrir: un `\includegraphics` roto tira la compilación del
    /// informe ENTERO, no solo esa página).
    thumb_file: Option<String>,
    /// Sha256 del archivo ORIGINAL (no la miniatura), para cadena de
    /// custodia -- `None` cuando `integridad_sha256` está apagado o el
    /// archivo no se pudo leer del disco (nunca un hash inventado).
    sha256: Option<String>,
    exif_lineas: Vec<Linea>,
    /// Usado tal cual por el tema claro (bloque único "Análisis" tabular).
    /// El tema oscuro NO usa este campo -- separa hipótesis y agente en sus
    /// propios bloques con icono, ver `hipotesis_extra`/`agente_lineas`.
    analisis_lineas: Vec<Linea>,
    /// Rasgos reales de agentes (recuadros OCR, mapa de profundidad) para
    /// dibujar como gráfico -- vacío cuando `rasgos_como_imagen` está
    /// apagado o ningún agente de esta imagen trajo rasgos de verdad.
    rasgos_graficos: Vec<RasgoImgCtx>,

    // ---- Campos exclusivos del tema oscuro (ver `resumen_oscuro`) ----
    /// `true` cuando el análisis de geolocalización o el de agentes de esta
    /// imagen terminó en error, o el de agentes terminó en abstención total
    /// (todos sus veredictos con etiqueta "abstiene"). Es un hecho real del
    /// caso, no depende de qué secciones estén activadas en este informe --
    /// mismo criterio que `calcular_estadisticas` para el resto de cifras de
    /// portada.
    sin_resuelto: bool,
    /// Motivo real citado en el aviso ámbar que sustituye a los bloques de
    /// resultado cuando `sin_resuelto` -- nunca un texto inventado: el
    /// `error` registrado, o el genérico ya usado en el cliente cuando no
    /// hay uno.
    motivo_sin_resuelto: Option<String>,
    /// `sin_resuelto` Y además al menos una de las dos secciones de
    /// resultado (`hipotesis_geolocalizacion`/`veredictos_agentes`) está
    /// activada en este informe -- si el investigador apagó las dos, no
    /// hay ningún bloque de resultado que sustituir, así que tampoco se
    /// imprime el aviso ámbar (no estaría reemplazando nada).
    mostrar_aviso_sin_resuelto: bool,
    /// Confianza de la hipótesis principal, ya redondeada a entero de
    /// porcentaje -- el número grande junto a la miniatura. `None` cuando no
    /// hay hipótesis, la sección está apagada, o `sin_resuelto`.
    confianza_pct: Option<i64>,
    coord_txt: Option<String>,
    radio_txt: Option<String>,
    /// Alternativas y respaldo geométrico de la hipótesis principal -- todo
    /// lo que no es "el número grande" ni la coordenada/radio de cabecera.
    hipotesis_extra: Vec<Linea>,
    /// Nombre, veredicto y detalle del agente -- mismo contenido que
    /// producía `lineas_agentes` para el tema claro, aparte para poder
    /// dibujarlo en su propio bloque con icono.
    agente_lineas: Vec<Linea>,
}

/// Un recuadro OCR ya convertido a coordenadas TikZ (origen abajo-izquierda,
/// `y` creciendo hacia arriba) -- `CajaOcr` viene en convención de imagen
/// (origen arriba-izquierda, `y` creciendo hacia abajo), la misma que usa
/// PaddleOCR/PIL. La conversión se hace aquí, no en la plantilla, para que
/// Tera no tenga que saber de convenciones de coordenadas.
#[derive(Serialize)]
struct CajaCtx {
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    etiqueta: String,
}

/// Lo que la plantilla dibuja por cada rasgo real de un agente sobre una
/// imagen. `tipo` decide qué rama de la plantilla se usa.
#[derive(Serialize)]
#[serde(tag = "tipo", rename_all = "lowercase")]
enum RasgoImgCtx {
    Ocr {
        agente: String,
        cajas: Vec<CajaCtx>,
    },
    Profundidad {
        agente: String,
        /// Nombre de fichero relativo, ya escrito junto al `.tex`.
        archivo: String,
    },
}

fn cabecera(texto: String) -> Linea {
    Linea { texto, variante: "cabecera" }
}
fn cuerpo(texto: String) -> Linea {
    Linea { texto, variante: "cuerpo" }
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Fecha legible sin arrastrar `chrono`/`time` solo para esto.
fn fecha_legible(epoch_s: i64) -> String {
    let dias_desde_epoch = epoch_s.div_euclid(86400);
    let secs_del_dia = epoch_s.rem_euclid(86400);
    let (h, m, s) = (secs_del_dia / 3600, (secs_del_dia % 3600) / 60, secs_del_dia % 60);
    // Civil-from-days de Howard Hinnant, de dominio público -- la misma
    // cuenta que usa `time`/`chrono` por debajo, sin la dependencia.
    let z = dias_desde_epoch + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = (z - era * 146097) as i64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mth = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if mth <= 2 { y + 1 } else { y };
    format!("{year:04}-{mth:02}-{d:02} {h:02}:{m:02}:{s:02} UTC")
}

/// Las líneas de EXIF de una imagen -- GPS declarado por la cámara (aparte
/// del inferido, nunca mezclado con él, mismo principio que `exif.rs`) y los
/// campos simples que de verdad importan a un informe forense. Solo se citan
/// si el fichero los trae -- no se inventa ninguno que falte.
fn lineas_exif(imagen: &Image) -> Vec<Linea> {
    let mut out = Vec::new();
    match (imagen.exif_lat, imagen.exif_lng) {
        (Some(lat), Some(lng)) => out.push(cuerpo(format!("GPS declarado por la cámara: {lat:.6}, {lng:.6}"))),
        _ => out.push(cuerpo("GPS declarado por la cámara: no consta en el EXIF".into())),
    }
    if let Some(obj) = imagen.exif.as_ref().and_then(|v| v.as_object()) {
        for (etiqueta, clave) in
            [("Cámara", "Model"), ("Fabricante", "Make"), ("Capturada", "DateTimeOriginal"), ("Software", "Software")]
        {
            if let Some(valor) = obj.get(clave).and_then(|v| v.as_str()) {
                if !valor.trim().is_empty() {
                    out.push(cuerpo(format!("{etiqueta}: {valor}")));
                }
            }
        }
    }
    out
}

/// Las líneas de todos los análisis de una imagen que la configuración deja
/// pasar. Los que no -- geolocalización con `hipotesis_geolocalizacion`
/// apagado, o `agentes` con `veredictos_agentes` apagado -- se cuentan aparte
/// para poder decir POR QUÉ no aparecen, en vez de dejar la sección muda como
/// si nunca se hubiera lanzado nada.
fn lineas_analisis(analyses: &[Analysis], req: &ExportInformeReq) -> Vec<Linea> {
    let mut out = Vec::new();
    if analyses.is_empty() {
        out.push(cuerpo("Sin análisis lanzados sobre esta imagen.".into()));
        return out;
    }

    let incluidos: Vec<&Analysis> = analyses
        .iter()
        .filter(|a| if a.model == "agentes" { req.veredictos_agentes } else { req.hipotesis_geolocalizacion })
        .collect();

    if incluidos.is_empty() {
        out.push(cuerpo("Los análisis de esta imagen no se incluyen según la configuración de este informe.".into()));
        return out;
    }

    for a in incluidos {
        out.push(cabecera(format!("Análisis · modelo {}", a.model)));
        match a.state.as_str() {
            "pendiente" => {
                out.push(cuerpo("Estado: pendiente -- todavía no ha empezado a correr.".into()));
                continue;
            }
            "en_curso" => {
                out.push(cuerpo("Estado: en curso en el momento de generar este informe.".into()));
                continue;
            }
            "error" => {
                let motivo = a.error.as_deref().unwrap_or("sin motivo registrado");
                out.push(cuerpo(format!("Estado: error -- {motivo}")));
                continue;
            }
            _ => {}
        }
        if a.model == "agentes" {
            lineas_agentes(&mut out, &a.agentes, a.agente.as_deref());
        } else {
            lineas_geolocalizacion(&mut out, a);
        }
    }
    out
}

fn lineas_geolocalizacion(out: &mut Vec<Linea>, a: &Analysis) {
    match (a.result_lat, a.result_lng) {
        (Some(lat), Some(lng)) => {
            let radio = a.result_radius_m.map(|r| format!("{r:.0} m")).unwrap_or_else(|| "sin radio".into());
            let confianza = a
                .result_confidence
                .map(|c| format!("{:.0}%", c * 100.0))
                .unwrap_or_else(|| "sin confianza registrada".into());
            out.push(cuerpo(format!("Hipótesis principal: {lat:.6}, {lng:.6}")));
            out.push(cuerpo(format!("Radio: {radio} · confianza: {confianza}")));
            if let (Some(inliers), Some(verif)) = (a.result_inliers, a.result_verificador.as_deref()) {
                out.push(cuerpo(format!("Respaldo geométrico: {inliers} correspondencias ({verif})")));
            }
        }
        _ => out.push(cuerpo("Sin hipótesis: el motor no encontró un candidato.".into())),
    }
    if !a.hypotheses.is_empty() {
        out.push(cabecera("Alternativas:".into()));
        for h in &a.hypotheses {
            out.push(cuerpo(format!(
                "· {:.6}, {:.6} · radio {:.0} m · peso {:.0}%",
                h.lat, h.lng, h.radio_m, h.peso * 100.0,
            )));
        }
    }
}

fn lineas_agentes(out: &mut Vec<Linea>, dichos: &[DichoDeAgente], agente_pedido: Option<&str>) {
    if dichos.is_empty() {
        out.push(cuerpo("El agente no contestó a tiempo.".into()));
        return;
    }
    let dicho = dichos.iter().find(|d| Some(d.agente.as_str()) == agente_pedido).unwrap_or(&dichos[0]);
    out.push(cuerpo(format!("Agente: {}", dicho.nombre)));
    if dicho.etiqueta == "abstiene" {
        out.push(cuerpo("Veredicto: se abstuvo -- no llegó a su umbral de confianza.".into()));
    } else {
        out.push(cuerpo(format!("Veredicto: {} ({:.0}%)", dicho.etiqueta, dicho.confianza * 100.0)));
    }
    if !dicho.detalle.is_empty() {
        out.push(cuerpo(format!("Detalle: {}", dicho.detalle)));
    }
}

/// Lo que necesita la página por imagen (y los cuatro números de portada) del
/// tema oscuro: una sola hipótesis principal, un solo veredicto de agente, y
/// si ambos -- o alguno -- terminaron en error o abstención total, para poder
/// sustituir sus bloques por un único aviso ámbar en vez de dejarlos vacíos o
/// a medias. Deliberadamente NO toca `analisis_lineas`/`lineas_analisis`: esa
/// ruta la sigue usando el tema claro tal cual estaba, sin tocar su salida.
struct ResumenOscuro {
    sin_resuelto: bool,
    es_error: bool,
    motivo_sin_resuelto: Option<String>,
    con_hipotesis: bool,
    con_agente: bool,
    confianza_pct: Option<i64>,
    coord_txt: Option<String>,
    radio_txt: Option<String>,
    hipotesis_extra: Vec<Linea>,
    agente_lineas: Vec<Linea>,
}

fn resumen_oscuro(analyses: &[Analysis], req: &ExportInformeReq) -> ResumenOscuro {
    let geo = analyses.iter().find(|a| a.model != "agentes");
    let ag = analyses.iter().find(|a| a.model == "agentes");

    let con_hipotesis = geo.map(|a| a.result_lat.is_some() && a.result_lng.is_some()).unwrap_or(false);
    let con_agente = ag.map(|a| a.agentes.iter().any(|d| d.etiqueta != "abstiene")).unwrap_or(false);

    let geo_error = geo.map(|a| a.state == "error").unwrap_or(false);
    let ag_error = ag.map(|a| a.state == "error").unwrap_or(false);
    // "Abstención total": el análisis de agentes SÍ contestó, pero ninguno
    // de sus veredictos llegó a un umbral -- distinto de que no contestara a
    // tiempo (`ag_error`/dichos vacío), que ya cuenta como error arriba.
    let ag_abstencion_total =
        ag.map(|a| !a.agentes.is_empty() && a.agentes.iter().all(|d| d.etiqueta == "abstiene")).unwrap_or(false);

    let (sin_resuelto, es_error, motivo_sin_resuelto) = if geo_error {
        (true, true, Some(geo.unwrap().error.clone().unwrap_or_else(|| "sin motivo registrado".into())))
    } else if ag_error {
        (true, true, Some(ag.unwrap().error.clone().unwrap_or_else(|| "El agente no contest\u{f3} a tiempo.".into())))
    } else if ag_abstencion_total {
        (true, false, Some("El agente se abstuvo -- no lleg\u{f3} a su umbral de confianza.".into()))
    } else {
        (false, false, None)
    };

    // Los campos que de verdad se imprimen sí respetan los interruptores del
    // informe (`hipotesis_geolocalizacion`/`veredictos_agentes`) y quedan en
    // blanco cuando `sin_resuelto` -- ese caso lo cubre el aviso ámbar, no
    // estos campos.
    let mut confianza_pct = None;
    let mut coord_txt = None;
    let mut radio_txt = None;
    let mut hipotesis_extra = Vec::new();
    if req.hipotesis_geolocalizacion && !sin_resuelto {
        if let Some(a) = geo {
            if let (Some(lat), Some(lng)) = (a.result_lat, a.result_lng) {
                confianza_pct = a.result_confidence.map(|c| (c * 100.0).round() as i64);
                coord_txt = Some(format!("{lat:.6}, {lng:.6}"));
                radio_txt =
                    Some(a.result_radius_m.map(|r| format!("{r:.0} m")).unwrap_or_else(|| "sin radio".into()));
                if let (Some(inliers), Some(verif)) = (a.result_inliers, a.result_verificador.as_deref()) {
                    hipotesis_extra.push(cuerpo(format!("Respaldo geom\u{e9}trico: {inliers} correspondencias ({verif})")));
                }
                if !a.hypotheses.is_empty() {
                    hipotesis_extra.push(cabecera("Alternativas:".into()));
                    for h in &a.hypotheses {
                        hipotesis_extra.push(cuerpo(format!(
                            "\u{b7} {:.6}, {:.6} \u{b7} radio {:.0} m \u{b7} peso {:.0}%",
                            h.lat, h.lng, h.radio_m, h.peso * 100.0,
                        )));
                    }
                }
            }
        }
    }

    let mut agente_lineas = Vec::new();
    if req.veredictos_agentes && !sin_resuelto {
        if let Some(a) = ag {
            if !a.agentes.is_empty() {
                let dicho =
                    a.agentes.iter().find(|d| Some(d.agente.as_str()) == a.agente.as_deref()).unwrap_or(&a.agentes[0]);
                agente_lineas.push(cabecera(dicho.nombre.clone()));
                agente_lineas.push(cuerpo(format!("Veredicto: {} ({:.0}%)", dicho.etiqueta, dicho.confianza * 100.0)));
                if !dicho.detalle.is_empty() {
                    agente_lineas.push(cuerpo(format!("Detalle: {}", dicho.detalle)));
                }
            }
        }
    }

    ResumenOscuro {
        sin_resuelto,
        es_error,
        motivo_sin_resuelto,
        con_hipotesis,
        con_agente,
        confianza_pct,
        coord_txt,
        radio_txt,
        hipotesis_extra,
        agente_lineas,
    }
}

/// Agregados de TODO el caso -- independientes de qué per-imagen se termine
/// mostrando: son un resumen del caso real, no de la vista filtrada por los
/// interruptores del popup. Cada estadística que no tiene datos de verdad se
/// omite entera (`Option`/vacío), nunca se dibuja un cero inventado.
///
/// `resueltos`: los cuatro números de portada del tema oscuro
/// (con_hipotesis/con_agente/sin_resolver/errores/abstenciones), ya
/// agregados por imagen en `generar_pdf` -- se reciben calculados en vez de
/// recalcularse aquí porque esta función trabaja sobre la lista plana de
/// `Analysis` del caso, no agrupada por imagen (ver `ResumenOscuro`).
fn calcular_estadisticas(
    case_created_at: i64, analyses: &[Analysis], resueltos: (usize, usize, usize, usize, usize),
) -> Estadisticas {
    let mut por_modelo: std::collections::BTreeMap<String, usize> = std::collections::BTreeMap::new();
    let mut confianzas: Vec<f64> = Vec::new();
    let (mut respondieron, mut abstuvieron) = (0usize, 0usize);
    for a in analyses {
        *por_modelo.entry(a.model.clone()).or_default() += 1;
        if a.model != "agentes" {
            if let Some(c) = a.result_confidence {
                if a.result_lat.is_some() && a.result_lng.is_some() {
                    confianzas.push(c as f64);
                }
            }
        } else {
            for d in &a.agentes {
                if d.etiqueta == "abstiene" {
                    abstuvieron += 1;
                } else {
                    respondieron += 1;
                }
            }
        }
    }
    let confianza_media_pct =
        if confianzas.is_empty() { None } else { Some((confianzas.iter().sum::<f64>() / confianzas.len() as f64 * 100.0).round() as i64) };
    let (n_con_hipotesis, n_con_agente, n_sin_resolver, n_errores, n_abstenciones) = resueltos;
    Estadisticas {
        creado_en: fecha_legible(case_created_at),
        por_modelo: por_modelo.into_iter().map(|(modelo, n)| ModeloCount { modelo, n }).collect(),
        confianza_media_pct,
        agentes_total: respondieron + abstuvieron,
        agentes_respondieron: respondieron,
        agentes_abstuvieron: abstuvieron,
        n_con_hipotesis,
        n_con_agente,
        n_sin_resolver,
        n_errores,
        n_abstenciones,
    }
}

/// Escapa lo que va dentro de comandos LaTeX -- registrado como filtro `tex`
/// de Tera y usado en la plantilla para TODO texto que no haya escrito Lumi
/// mismo (nombre de caso, de fichero, detalle de un agente, motivo de
/// error...). Sin esto, un nombre de fichero con un `_` o un `%` rompe la
/// compilación entera, y uno con `\` puede inyectar comandos LaTeX propios.
fn escapar_tex(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\textbackslash{}"),
            '{' => out.push_str("\\{"),
            '}' => out.push_str("\\}"),
            '$' => out.push_str("\\$"),
            '&' => out.push_str("\\&"),
            '#' => out.push_str("\\#"),
            '^' => out.push_str("\\^{}"),
            '_' => out.push_str("\\_"),
            '~' => out.push_str("\\~{}"),
            '%' => out.push_str("\\%"),
            '\n' => out.push_str("\\\\\n"),
            _ => out.push(c),
        }
    }
    out
}

const PLANTILLA: &str = include_str!("../../templates/informe.tex.tera");

fn tera() -> Result<tera::Tera, String> {
    let mut t = tera::Tera::default();
    t.register_filter("tex", |val: &str, _: tera::Kwargs, _: &tera::State| escapar_tex(val));
    t.add_raw_template("informe.tex", PLANTILLA).map_err(|e| format!("plantilla del informe inválida: {e}"))?;
    Ok(t)
}

/// Dónde vive el binario de `tectonic`. Mismo criterio que `assets::ruta`:
/// primero la instalación real (`lumi install` lo deja en
/// `/var/lib/lumi/tectonic/tectonic`), luego una variable de entorno para
/// desarrollo -- útil en Windows, donde no hay instalador de servidor y este
/// binario se coloca a mano para probar --, y por último el PATH del
/// sistema, por si alguien lo puso ahí.
fn tectonic_bin() -> PathBuf {
    if let Ok(p) = std::env::var("LUMI_TECTONIC") {
        return PathBuf::from(p);
    }
    let instalado = PathBuf::from("/var/lib/lumi/tectonic/tectonic");
    if instalado.exists() {
        return instalado;
    }
    PathBuf::from("tectonic")
}

fn compilar_con_tectonic(dir: &FsPath) -> Result<Vec<u8>, FalloInforme> {
    let bin = tectonic_bin();
    let salida = Command::new(&bin).args(["-o", ".", "informe.tex"]).current_dir(dir).output();
    let salida = match salida {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Err(FalloInforme::FaltaTectonic(format!(
                "falta el binario tectonic para generar informes ({bin:?} no existe o no es ejecutable) -- reinstala el servidor, o define LUMI_TECTONIC con su ruta"
            )));
        }
        Err(e) => return Err(FalloInforme::Compilacion(format!("no se pudo lanzar tectonic: {e}"))),
    };
    if !salida.status.success() {
        let log = String::from_utf8_lossy(&salida.stderr);
        // Solo la cola: un fallo de paquete puede volcar miles de líneas de
        // "downloading X" antes del error real.
        let cola: String = {
            let chars: Vec<char> = log.chars().collect();
            let desde = chars.len().saturating_sub(4000);
            chars[desde..].iter().collect()
        };
        return Err(FalloInforme::Compilacion(cola));
    }
    std::fs::read(dir.join("informe.pdf"))
        .map_err(|e| FalloInforme::Compilacion(format!("tectonic terminó sin error pero no dejó informe.pdf: {e}")))
}

/// Hash del ORIGINAL leyéndolo por bloques, no de una sola vez -- una imagen
/// forense puede pesar decenas de MB, y `procesar_imagen` (subida) ya lo
/// carga entero para decodificarlo, pero exportar no necesita repetir eso
/// solo para hashear. `None` si el archivo no está o no se puede leer -- una
/// fila sin fichero en disco es una inconsistencia real (ver `serve`), nunca
/// se inventa un hash para taparla.
fn sha256_de_fichero(path: &FsPath) -> Option<String> {
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = f.read(&mut buf).ok()?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Some(format!("{:x}", hasher.finalize()))
}

/// Los rasgos reales (recuadros OCR, mapa de profundidad) de los agentes que
/// corrieron sobre esta imagen y que la configuración deja pasar -- mismo
/// filtro que `lineas_analisis` (`veredictos_agentes`), porque un rasgo es
/// parte del veredicto del agente, no una sección aparte. Escribe los PNG de
/// profundidad que haga falta junto al `.tex`, en `job`.
fn rasgos_graficos_de(analyses: &[Analysis], req: &ExportInformeReq, job: &FsPath, img_id: i64) -> Vec<RasgoImgCtx> {
    if !req.rasgos_como_imagen || !req.veredictos_agentes {
        return Vec::new();
    }
    let mut out = Vec::new();
    for a in analyses {
        if a.model != "agentes" {
            continue;
        }
        for (i, dicho) in a.agentes.iter().enumerate() {
            match &dicho.rasgos {
                Some(Rasgos::Ocr { cajas }) if !cajas.is_empty() => {
                    // `CajaOcr` viene en convención de imagen (origen
                    // arriba-izquierda, `y` hacia abajo) -- TikZ dibuja con
                    // origen abajo-izquierda, así que `y` se invierte aquí,
                    // una vez, en vez de complicar la plantilla.
                    let cajas_ctx = cajas
                        .iter()
                        .map(|c| CajaCtx {
                            x1: c.x.clamp(0.0, 1.0),
                            y1: (1.0 - c.y - c.h).clamp(0.0, 1.0),
                            x2: (c.x + c.w).clamp(0.0, 1.0),
                            y2: (1.0 - c.y).clamp(0.0, 1.0),
                            etiqueta: c.etiqueta.clone(),
                        })
                        .collect();
                    out.push(RasgoImgCtx::Ocr { agente: dicho.nombre.clone(), cajas: cajas_ctx });
                }
                Some(Rasgos::Profundidad { png_base64 }) if !png_base64.is_empty() => {
                    use base64::{engine::general_purpose::STANDARD, Engine};
                    if let Ok(bytes) = STANDARD.decode(png_base64) {
                        let nombre = format!("profundidad_{img_id}_{}_{i}.png", a.id);
                        if std::fs::write(job.join(&nombre), &bytes).is_ok() {
                            out.push(RasgoImgCtx::Profundidad { agente: dicho.nombre.clone(), archivo: nombre });
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

fn generar_pdf(
    caso: &str, case_created_at: i64, originales_dir: &FsPath, filas: &[(Image, Option<Vec<u8>>, Vec<Analysis>)],
    req: &ExportInformeReq, analyses_del_caso: &[Analysis],
) -> Result<Vec<u8>, FalloInforme> {
    let job = std::env::temp_dir().join(format!("lumi-informe-{}-{}", now(), rand::random::<u32>()));
    std::fs::create_dir_all(&job).map_err(|e| FalloInforme::Compilacion(format!("no se pudo crear el directorio de trabajo: {e}")))?;
    // Se limpia al salir de esta función por cualquier camino (éxito o
    // error) -- nunca se acumulan directorios de un informe fallido.
    let _limpieza = TmpDirGuard(job.clone());

    let mut imagenes = Vec::with_capacity(filas.len());
    // Agregados para los cuatro números de portada del tema oscuro -- se
    // suman aquí, imagen a imagen, en vez de recorrer `analyses_del_caso`
    // aparte (esa lista es plana y no agrupada por imagen; `filas` sí lo
    // está, ver `ResumenOscuro`).
    let (mut n_con_hipotesis, mut n_con_agente, mut n_sin_resolver, mut n_errores, mut n_abstenciones) =
        (0usize, 0usize, 0usize, 0usize, 0usize);
    for (orden, (img, thumb, analyses)) in filas.iter().enumerate() {
        // La miniatura solo se referencia si de verdad es una imagen
        // decodificable -- un `\includegraphics` sobre un fichero corrupto
        // tira la compilación del informe ENTERO, no solo esta página.
        let thumb_file = thumb.as_deref().and_then(|bytes| {
            if image::load_from_memory(bytes).is_err() {
                return None;
            }
            let nombre = format!("thumb_{}.jpg", img.id);
            std::fs::write(job.join(&nombre), bytes).ok()?;
            Some(nombre)
        });
        let sha256 =
            if req.integridad_sha256 { sha256_de_fichero(&originales_dir.join(img.id.to_string())) } else { None };
        let r = resumen_oscuro(analyses, req);
        if r.con_hipotesis {
            n_con_hipotesis += 1;
        }
        if r.con_agente {
            n_con_agente += 1;
        }
        if r.sin_resuelto {
            n_sin_resolver += 1;
            if r.es_error {
                n_errores += 1;
            } else {
                n_abstenciones += 1;
            }
        }
        imagenes.push(ImagenCtx {
            orden: orden + 1,
            filename: img.filename.clone(),
            thumb_file,
            sha256,
            exif_lineas: if req.exif_por_imagen { lineas_exif(img) } else { Vec::new() },
            analisis_lineas: lineas_analisis(analyses, req),
            rasgos_graficos: rasgos_graficos_de(analyses, req, &job, img.id),
            sin_resuelto: r.sin_resuelto,
            mostrar_aviso_sin_resuelto: r.sin_resuelto && (req.hipotesis_geolocalizacion || req.veredictos_agentes),
            motivo_sin_resuelto: r.motivo_sin_resuelto,
            confianza_pct: r.confianza_pct,
            coord_txt: r.coord_txt,
            radio_txt: r.radio_txt,
            hipotesis_extra: r.hipotesis_extra,
            agente_lineas: r.agente_lineas,
        });
    }

    let estadisticas = if req.portada_estadisticas {
        Some(calcular_estadisticas(
            case_created_at,
            analyses_del_caso,
            (n_con_hipotesis, n_con_agente, n_sin_resolver, n_errores, n_abstenciones),
        ))
    } else {
        None
    };

    // Cualquier valor que no sea exactamente "claro" se trata como "oscuro"
    // -- es el tema por defecto y el que corresponde a un cliente viejo que
    // no manda el campo (`tema_oscuro()` en `ExportInformeReq`).
    let tema = if req.tema == "claro" { "claro".to_string() } else { "oscuro".to_string() };

    let ctx = Contexto {
        caso: caso.to_string(),
        generado: fecha_legible(now()),
        firmado_por: req.firmado_por.trim().to_string(),
        n_imagenes: imagenes.len(),
        incluir_estadisticas: req.portada_estadisticas,
        estadisticas,
        imagenes,
        notas: req.notas.trim().to_string(),
        tema,
    };

    let t = tera().map_err(FalloInforme::Compilacion)?;
    let contexto_tera = tera::Context::from_serialize(&ctx)
        .map_err(|e| FalloInforme::Compilacion(format!("no se pudo montar el contexto de la plantilla: {e}")))?;
    let tex = t
        .render("informe.tex", &contexto_tera)
        .map_err(|e| FalloInforme::Compilacion(format!("no se pudo rellenar la plantilla del informe: {e}")))?;
    std::fs::write(job.join("informe.tex"), &tex)
        .map_err(|e| FalloInforme::Compilacion(format!("no se pudo escribir el .tex del informe: {e}")))?;

    compilar_con_tectonic(&job)
}

/// Borra el directorio de trabajo del informe al salir de `generar_pdf`,
/// tanto si terminó bien como si tectonic falló -- si no, un informe fallado
/// deja basura en el disco del servidor para siempre.
struct TmpDirGuard(PathBuf);
impl Drop for TmpDirGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
