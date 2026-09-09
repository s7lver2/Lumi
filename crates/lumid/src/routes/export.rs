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
use serde::Serialize;
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

    let images: Vec<Image> = {
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

    // Montar el `.tex`, escribir los ficheros del trabajo y compilar es CPU +
    // un subproceso, no red -- al pool de `spawn_blocking`, igual que
    // `procesar_imagen` en la subida.
    let case_id_para_log = case_id;
    let resultado = tokio::task::spawn_blocking(move || {
        generar_pdf(&case_name, case_created_at, &filas, &req, &analyses)
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
    filename: String,
    /// Nombre de fichero relativo, ya escrito junto al `.tex`, de la
    /// miniatura -- `None` si no hay miniatura en disco o no se pudo
    /// decodificar como imagen real (nunca se referencia un fichero que no
    /// se sabe abrir: un `\includegraphics` roto tira la compilación del
    /// informe ENTERO, no solo esa página).
    thumb_file: Option<String>,
    exif_lineas: Vec<Linea>,
    analisis_lineas: Vec<Linea>,
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

/// Agregados de TODO el caso -- independientes de qué per-imagen se termine
/// mostrando: son un resumen del caso real, no de la vista filtrada por los
/// interruptores del popup. Cada estadística que no tiene datos de verdad se
/// omite entera (`Option`/vacío), nunca se dibuja un cero inventado.
fn calcular_estadisticas(case_created_at: i64, analyses: &[Analysis]) -> Estadisticas {
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
    Estadisticas {
        creado_en: fecha_legible(case_created_at),
        por_modelo: por_modelo.into_iter().map(|(modelo, n)| ModeloCount { modelo, n }).collect(),
        confianza_media_pct,
        agentes_total: respondieron + abstuvieron,
        agentes_respondieron: respondieron,
        agentes_abstuvieron: abstuvieron,
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

fn generar_pdf(
    caso: &str, case_created_at: i64, filas: &[(Image, Option<Vec<u8>>, Vec<Analysis>)], req: &ExportInformeReq,
    analyses_del_caso: &[Analysis],
) -> Result<Vec<u8>, FalloInforme> {
    let job = std::env::temp_dir().join(format!("lumi-informe-{}-{}", now(), rand::random::<u32>()));
    std::fs::create_dir_all(&job).map_err(|e| FalloInforme::Compilacion(format!("no se pudo crear el directorio de trabajo: {e}")))?;
    // Se limpia al salir de esta función por cualquier camino (éxito o
    // error) -- nunca se acumulan directorios de un informe fallido.
    let _limpieza = TmpDirGuard(job.clone());

    let mut imagenes = Vec::with_capacity(filas.len());
    for (img, thumb, analyses) in filas {
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
        imagenes.push(ImagenCtx {
            filename: img.filename.clone(),
            thumb_file,
            exif_lineas: if req.exif_por_imagen { lineas_exif(img) } else { Vec::new() },
            analisis_lineas: lineas_analisis(analyses, req),
        });
    }

    let estadisticas = if req.portada_estadisticas { Some(calcular_estadisticas(case_created_at, analyses_del_caso)) } else { None };

    let ctx = Contexto {
        caso: caso.to_string(),
        generado: fecha_legible(now()),
        firmado_por: req.firmado_por.trim().to_string(),
        n_imagenes: imagenes.len(),
        incluir_estadisticas: req.portada_estadisticas,
        estadisticas,
        imagenes,
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
