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
use lumi_index::geo::{dentro, Pais, Paises};
use lumi_proto::api::{Analysis, ExportInformeReq, Image};
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

    // Contornos de país para el localizador (§7 del spec) -- se lee el mutex
    // UNA sola vez por informe y se clona lo que haga falta, no una vez por
    // imagen (mismo criterio que ya sigue `queue::mod` con este mutex).
    let paises: Option<Paises> = app.queue.geo.lock().unwrap().paises.clone();

    // Montar el `.tex`, escribir los ficheros del trabajo y compilar es CPU +
    // un subproceso, no red -- al pool de `spawn_blocking`, igual que
    // `procesar_imagen` en la subida.
    let case_id_para_log = case_id;
    let resultado = tokio::task::spawn_blocking(move || {
        generar_pdf(&case_name, case_created_at, &dir, &filas, &req, &analyses_para_pdf, &paises)
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
    /// Un punto por imagen para la «franja de confianza» de la portada
    /// oscura (§5 del spec) -- solo imágenes con una confianza real o
    /// `sin_resuelto` entran aquí; una imagen cuyo análisis está pendiente
    /// no tiene ningún valor que enseñar y se omite (principio "nunca se
    /// inventa" del proyecto, por encima de la lectura literal de "un punto
    /// por imagen" del spec). Vacío cuando `incluir_estadisticas` es falso.
    franja: Vec<PuntoFranjaCtx>,
    /// Notas libres del investigador -- vacío significa que la plantilla no
    /// dibuja la sección entera, no que se dibuje una en blanco.
    notas: String,
    /// `"oscuro"` (editorial, por defecto) o `"claro"` (el documento
    /// imprimible de siempre). Cualquier otra cosa que llegue del cliente se
    /// normaliza aquí a `"claro"` en vez de propagar un valor desconocido a
    /// la plantilla -- ver `ExportInformeReq::tema`.
    tema: String,
    /// `"compacta"` o `"banda"` -- ver `ExportInformeReq::disposicion`.
    /// Normalizada aquí, no en la plantilla: `"banda"` solo tiene sentido en
    /// el tema oscuro (el claro es siempre para imprimir), así que un
    /// informe claro fuerza `"compacta"` sin importar lo que pida el
    /// cliente.
    disposicion: String,
}

#[derive(Serialize)]
struct ModeloCount {
    modelo: String,
    n: usize,
}

/// Un punto de la «franja de confianza» de la portada oscura -- eje 0–100,
/// `sin_resuelto` en ámbar y a `pct = 0` (decisión de diseño no especificada
/// literalmente en el spec: un caso sin resolver no tiene una confianza que
/// situar en el eje, y `0` es la lectura honesta -- "no hubo señal" -- en
/// vez de omitir el punto o inventar un valor intermedio).
#[derive(Serialize)]
struct PuntoFranjaCtx {
    pct: i64,
    sin_resuelto: bool,
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
    /// Numéricos, para el localizador TikZ (§7 del spec) -- `coord_txt`
    /// sigue siendo lo que se IMPRIME, esto es lo que se PROYECTA. `None` en
    /// los mismos casos que `coord_txt`/`radio_txt`.
    lat: Option<f64>,
    lng: Option<f64>,
    radio_km: Option<f64>,
    /// Contorno del país + punto + radio ya proyectados a coordenadas de
    /// dibujo -- `None` cuando no hay hipótesis, no hay `paises.json`
    /// instalado, o la coordenada cae fuera de todo país (mar). Nunca deja
    /// hueco en la plantilla: sin esto solo faltan las líneas del contorno,
    /// la coordenada y el radio en mono se siguen imprimiendo igual.
    mapa: Option<MapaCtx>,
    /// Alternativas y respaldo geométrico de la hipótesis principal -- todo
    /// lo que no es "el número grande" ni la coordenada/radio de cabecera.
    hipotesis_extra: Vec<Linea>,
    /// Nombre, veredicto y detalle del agente.
    agente_lineas: Vec<Linea>,
}

/// Contorno de país + hipótesis, ya proyectados al espacio de dibujo del
/// localizador -- ver `construir_mapa`. Todas las coordenadas comparten la
/// MISMA unidad (fracción del ancho del lienzo, `MAPA_ANCHO_PT`), para que
/// dibujarlas en TikZ con ejes isótropos (`x=<ancho>pt,y=<ancho>pt`, no
/// `x=ancho,y=alto`) reproduzca el mismo factor de escala en los dos ejes y
/// el círculo de radio salga circular, no una elipse.
#[derive(Serialize)]
struct MapaCtx {
    /// Uno por anillo del país (normalmente uno solo: el contorno exterior).
    contorno: Vec<Vec<Punto>>,
    punto: Punto,
    radio: f64,
}

/// `{x, y}` en vez de una tupla `(f64, f64)` -- Tera no admite acceso por
/// índice numérico tras un punto (`pt.0`), solo por nombre de campo, así
/// que una tupla se serializa a un array de JSON al que la plantilla no
/// puede llegar sin esa sintaxis.
#[derive(Serialize, Clone, Copy)]
struct Punto {
    x: f64,
    y: f64,
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

// ponytail / decisión de diseño no especificada literalmente en el spec:
// antes de este rediseño, `lineas_analisis`/`lineas_geolocalizacion`/
// `lineas_agentes` alimentaban un bloque "Análisis" tabular EXCLUSIVO del
// tema claro, mientras que `resumen_oscuro` (debajo) calculaba lo mismo por
// separado para el tema oscuro -- dos caminos de datos para la misma
// pregunta. El spec (§6a) dice que el tema claro pasa a usar "los mismos
// bloques, en el mismo orden" que el oscuro (EXIF/Integridad/Hipótesis/
// Agente), así que las tres funciones de arriba quedan sin ningún llamador y
// se retiran aquí -- los dos temas comparten ahora `ResumenOscuro` como
// única fuente de la ficha de resultado. Efecto secundario aceptado: el
// texto expl\u{ed}cito de "pendiente"/"en curso" que ese camino imprim\u{ed}a para el
// tema claro desaparece -- el tema oscuro ya no lo mostraba (un an\u{e1}lisis sin
// terminar simplemente no deja hip\u{f3}tesis que imprimir), y unificar bajo el
// mismo criterio es mejor que mantener dos comportamientos distintos por
// tema para el mismo caso.
//
// Lo mismo aplica a `Estadisticas::por_modelo`: el spec pide expl\u{ed}citamente
// mantenerlo en la struct sin consumidor (se elimina el gr\u{a}fico de barras),
// as\u{ed} que no se ha tocado.

/// Lo que necesita la ficha por imagen (y los cuatro números de portada de
/// la portada oscura) de los DOS temas: una sola hipótesis principal, un
/// solo veredicto de agente, y si ambos -- o alguno -- terminaron en error o
/// abstención total, para poder sustituir sus bloques por un único aviso en
/// vez de dejarlos vacíos o a medias.
struct ResumenOscuro {
    sin_resuelto: bool,
    es_error: bool,
    motivo_sin_resuelto: Option<String>,
    con_hipotesis: bool,
    con_agente: bool,
    confianza_pct: Option<i64>,
    coord_txt: Option<String>,
    radio_txt: Option<String>,
    lat: Option<f64>,
    lng: Option<f64>,
    radio_km: Option<f64>,
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
    let mut lat_out = None;
    let mut lng_out = None;
    let mut radio_km = None;
    let mut hipotesis_extra = Vec::new();
    if req.hipotesis_geolocalizacion && !sin_resuelto {
        if let Some(a) = geo {
            if let (Some(lat), Some(lng)) = (a.result_lat, a.result_lng) {
                confianza_pct = a.result_confidence.map(|c| (c * 100.0).round() as i64);
                coord_txt = Some(format!("{lat:.6}, {lng:.6}"));
                radio_txt =
                    Some(a.result_radius_m.map(|r| format!("{r:.0} m")).unwrap_or_else(|| "sin radio".into()));
                lat_out = Some(lat);
                lng_out = Some(lng);
                radio_km = a.result_radius_m.map(|r| r as f64 / 1000.0);
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
        lat: lat_out,
        lng: lng_out,
        radio_km,
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
/// filtro (`veredictos_agentes`) que usa `resumen_oscuro` para el resto del
/// veredicto, porque un rasgo es parte de ese veredicto, no una sección
/// aparte. Escribe los PNG de profundidad que haga falta junto al `.tex`, en
/// `job`.
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

/// Ficheros que la plantilla carga con `fontspec` -- copiados al directorio
/// del job igual que las miniaturas, ver `registros/fuentes/LEEME.md`. Un
/// fichero que falte simplemente no se copia; `\IfFileExists` en la
/// plantilla decide entonces caer a `lmodern` (§3 del spec).
const FICHEROS_FUENTES: [&str; 5] =
    ["Inter-Regular.ttf", "Inter-Medium.ttf", "Inter-SemiBold.ttf", "JetBrainsMono-Regular.ttf", "JetBrainsMono-Medium.ttf"];

fn copiar_fuentes(job: &FsPath) {
    for nombre in FICHEROS_FUENTES {
        let origen = crate::assets::ruta(&format!("registros/fuentes/{nombre}"));
        // Se ignora el error a propósito: sin el fichero, la plantilla cae a
        // `lmodern` -- un informe que no compila es peor que uno con la
        // fuente equivocada (mismo criterio que ya usa el resto de export.rs
        // con recursos opcionales).
        let _ = std::fs::copy(&origen, job.join(nombre));
    }
}

/// Ancho del lienzo del localizador, en puntos -- ver el comentario de
/// `MapaCtx`. El alto (62pt) solo entra en el cálculo de encaje del
/// contorno; las coordenadas que salen de aquí están todas en fracción de
/// ESTE ancho, nunca del alto, para que los dos ejes compartan la misma
/// unidad física y el círculo de radio salga circular.
const MAPA_ANCHO_PT: f64 = 86.0;
const MAPA_ALTO_PT: f64 = 62.0;
/// Margen alrededor del contorno + el círculo de radio, como fracción del
/// tamaño del contenido -- para que no toquen el borde del lienzo.
const MAPA_MARGEN: f64 = 0.12;
const KM_POR_GRADO_LAT: f64 = 111.32;

/// El país cuyo contorno contiene `(lat, lng)` -- mismo trazado de rayos que
/// `Paises::iso_de`, pero devolviendo el `Pais` entero (con sus anillos, que
/// hace falta dibujar) en vez de solo el ISO.
fn pais_conteniendo(paises: &Paises, lat: f64, lng: f64) -> Option<&Pais> {
    paises.paises.iter().find(|p| p.anillos.iter().any(|a| dentro(a, lat, lng)))
}

/// Proyecta el contorno del país que contiene `(lat, lng)`, el punto y el
/// círculo de radio (`radio_km`) al espacio de dibujo del localizador --
/// ver §7 del spec y el comentario de `MapaCtx`. Se hace en Rust, no en la
/// plantilla, mismo criterio que ya sigue `rasgos_graficos_de` con las cajas
/// OCR: Tera no tiene que saber de convenciones de coordenadas.
///
/// `None` sin agitar ninguna alarma cuando: no hay `paises.json` cargado, la
/// coordenada no cae dentro de ningún país (mar), o el país resuelto es
/// degenerado (un único punto/línea, sin área) -- los tres casos son "no se
/// dibuja el localizador", nunca un error de exportación.
///
/// Proyección: equirectangular simple (sin corrección de longitud por
/// latitud MÁS ALLÁ de un único factor de escala en el centro del país,
/// suficiente a escala 1:110m) a un espacio local en kilómetros, encajado
/// después en un lienzo de `MAPA_ANCHO_PT` × `MAPA_ALTO_PT` con UN SOLO
/// factor de escala isótropo (mismo pt/km en los dos ejes) -- así el círculo
/// de radio sale circular, no una elipse. Las coordenadas finales se
/// expresan como fracción de `MAPA_ANCHO_PT` en los dos ejes (nunca de
/// `MAPA_ALTO_PT`, que solo entra al calcular el encaje): dibujarlas en TikZ
/// con ejes isótropos `x=<MAPA_ANCHO_PT>pt,y=<MAPA_ANCHO_PT>pt` reproduce el
/// mismo factor físico en los dos ejes.
fn construir_mapa(paises: &Option<Paises>, lat: f64, lng: f64, radio_km: f64) -> Option<MapaCtx> {
    let paises = paises.as_ref()?;
    let pais = pais_conteniendo(paises, lat, lng)?;

    let (mut lat_min, mut lat_max, mut lng_min, mut lng_max) = (f64::MAX, f64::MIN, f64::MAX, f64::MIN);
    for anillo in &pais.anillos {
        for &(alng, alat) in anillo {
            lat_min = lat_min.min(alat);
            lat_max = lat_max.max(alat);
            lng_min = lng_min.min(alng);
            lng_max = lng_max.max(alng);
        }
    }
    if !(lat_min < lat_max && lng_min < lng_max) {
        return None;
    }

    // Un solo factor lng->km, fijado en la latitud media del país -- es la
    // aproximación que hace "simple" a esta proyección (spec §7): correcta
    // en el centro, se degrada suavemente hacia los bordes, y a escala
    // 1:110m ("norte de España", no un mapa de calle) el error no importa.
    let lat_ref = (lat_min + lat_max) / 2.0;
    let km_por_grado_lng = KM_POR_GRADO_LAT * lat_ref.to_radians().cos().max(0.01);
    let a_km = |lng_p: f64, lat_p: f64| ((lng_p - lng_min) * km_por_grado_lng, (lat_p - lat_min) * KM_POR_GRADO_LAT);

    let (x_km, y_km) = a_km(lng, lat);
    let ancho_pais_km = (lng_max - lng_min) * km_por_grado_lng;
    let alto_pais_km = (lat_max - lat_min) * KM_POR_GRADO_LAT;

    // El rectángulo a encajar cubre el país Y el círculo de radio -- si la
    // hipótesis cae cerca del borde, el círculo puede salirse del contorno.
    let (min_x, max_x) = ((x_km - radio_km).min(0.0), (x_km + radio_km).max(ancho_pais_km));
    let (min_y, max_y) = ((y_km - radio_km).min(0.0), (y_km + radio_km).max(alto_pais_km));
    let ancho_km = ((max_x - min_x) * (1.0 + MAPA_MARGEN * 2.0)).max(0.001);
    let alto_km = ((max_y - min_y) * (1.0 + MAPA_MARGEN * 2.0)).max(0.001);
    // Escala isótropa: la MENOR de las dos, para que el rectángulo encaje
    // entero en el lienzo sin desbordar ningún eje.
    let escala = (MAPA_ANCHO_PT / ancho_km).min(MAPA_ALTO_PT / alto_km);

    let (centro_x_km, centro_y_km) = ((min_x + max_x) / 2.0, (min_y + max_y) / 2.0);
    let a_frac = |x_km: f64, y_km: f64| -> Punto {
        let px = (x_km - centro_x_km) * escala + MAPA_ANCHO_PT / 2.0;
        let py = (y_km - centro_y_km) * escala + MAPA_ALTO_PT / 2.0;
        Punto { x: px / MAPA_ANCHO_PT, y: py / MAPA_ANCHO_PT }
    };

    let contorno = pais
        .anillos
        .iter()
        .map(|anillo| {
            anillo
                .iter()
                .map(|&(alng, alat)| {
                    let (xk, yk) = a_km(alng, alat);
                    a_frac(xk, yk)
                })
                .collect()
        })
        .collect();
    let punto = a_frac(x_km, y_km);
    let radio = (radio_km * escala) / MAPA_ANCHO_PT;

    Some(MapaCtx { contorno, punto, radio })
}

fn generar_pdf(
    caso: &str, case_created_at: i64, originales_dir: &FsPath, filas: &[(Image, Option<Vec<u8>>, Vec<Analysis>)],
    req: &ExportInformeReq, analyses_del_caso: &[Analysis], paises: &Option<Paises>,
) -> Result<Vec<u8>, FalloInforme> {
    let job = std::env::temp_dir().join(format!("lumi-informe-{}-{}", now(), rand::random::<u32>()));
    std::fs::create_dir_all(&job).map_err(|e| FalloInforme::Compilacion(format!("no se pudo crear el directorio de trabajo: {e}")))?;
    // Se limpia al salir de esta función por cualquier camino (éxito o
    // error) -- nunca se acumulan directorios de un informe fallido.
    let _limpieza = TmpDirGuard(job.clone());
    copiar_fuentes(&job);

    let mut imagenes = Vec::with_capacity(filas.len());
    let mut franja = Vec::with_capacity(filas.len());
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
        let mapa = match (r.lat, r.lng, r.radio_km) {
            (Some(lat), Some(lng), Some(radio_km)) => construir_mapa(paises, lat, lng, radio_km),
            _ => None,
        };
        if let Some(pct) = r.confianza_pct {
            franja.push(PuntoFranjaCtx { pct, sin_resuelto: false });
        } else if r.sin_resuelto {
            franja.push(PuntoFranjaCtx { pct: 0, sin_resuelto: true });
        }
        imagenes.push(ImagenCtx {
            orden: orden + 1,
            filename: img.filename.clone(),
            thumb_file,
            sha256,
            exif_lineas: if req.exif_por_imagen { lineas_exif(img) } else { Vec::new() },
            rasgos_graficos: rasgos_graficos_de(analyses, req, &job, img.id),
            sin_resuelto: r.sin_resuelto,
            mostrar_aviso_sin_resuelto: r.sin_resuelto && (req.hipotesis_geolocalizacion || req.veredictos_agentes),
            motivo_sin_resuelto: r.motivo_sin_resuelto,
            confianza_pct: r.confianza_pct,
            coord_txt: r.coord_txt,
            radio_txt: r.radio_txt,
            lat: r.lat,
            lng: r.lng,
            radio_km: r.radio_km,
            mapa,
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
    // "banda" solo existe en el tema oscuro (§1 del spec: el claro es
    // siempre para imprimir, siempre compacto) -- cualquier otro valor, o
    // "banda" pedida sobre tema claro, cae a "compacta".
    let disposicion =
        if tema == "oscuro" && req.disposicion == "banda" { "banda".to_string() } else { "compacta".to_string() };

    let ctx = Contexto {
        caso: caso.to_string(),
        generado: fecha_legible(now()),
        firmado_por: req.firmado_por.trim().to_string(),
        n_imagenes: imagenes.len(),
        incluir_estadisticas: req.portada_estadisticas,
        estadisticas,
        imagenes,
        franja: if req.portada_estadisticas { franja } else { Vec::new() },
        notas: req.notas.trim().to_string(),
        tema,
        disposicion,
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
