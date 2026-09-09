//! Exportar el caso entero a un informe forense en PDF: por cada imagen, su
//! miniatura, el GPS declarado por la cámara (si lo hay) y cada análisis que
//! se le ha hecho -- geolocalización o agentes -- resumido en texto. Pensado
//! para entregarse a un tercero como evidencia, así que un análisis sin
//! terminar o que falló se dice tal cual, nunca se omite.
//!
//! ponytail: `printpdf` 0.12 (la "segunda iteración" de su API) solo trae
//! ajuste de línea automático de verdad con la feature `text_layout`, que
//! arrastra el motor de layout de `azul` -- mucho más de lo que un informe de
//! texto plano en una fuente estándar necesita. Aquí el ajuste de línea es
//! por cuenta de caracteres (`envolver`), no por métrica real de la fuente:
//! una aproximación razonable para Helvetica a tamaño fijo, no un motor
//! tipográfico. No se intenta pintar un mapa real -- ni tesela ni proveedor
//! externo caben en un PDF generado del lado del servidor sin clave de
//! ninguna API -- las coordenadas en texto son la evidencia, no una postal.

use crate::routes::analyses::{agentes_por_caso, hypotheses_por_caso, image_ids_por_caso, row_to_analysis};
use crate::routes::cases::guard_case;
use crate::routes::images::{dir_for, row_to_image};
use crate::routes::projects::{err, Fail};
use crate::App;
use axum::extract::{Path, State};
use axum::{http::HeaderMap, http::StatusCode};
use lumi_proto::api::{Analysis, DichoDeAgente, Image};
use printpdf::*;

const PAGE_W_MM: f32 = 210.0;
const PAGE_H_MM: f32 = 297.0;
const MARGIN_MM: f32 = 18.0;
const CONTENT_TOP_MM: f32 = PAGE_H_MM - MARGIN_MM;
const THUMB_W_MM: f32 = 65.0;
const LINE_H_MM: f32 = 5.4;
const FONT_TITLE: f32 = 16.0;
const FONT_HEAD: f32 = 11.0;
const FONT_BODY: f32 = 9.5;
/// Ancho de línea aproximado, en caracteres, a `FONT_BODY` sobre el ancho de
/// contenido -- ver el `ponytail` de arriba: no es una métrica real.
const MAX_CHARS_BODY: usize = 100;

pub async fn export_pdf(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
) -> Result<([(axum::http::HeaderName, String); 2], Vec<u8>), Fail> {
    // Mismo guardián que el resto de rutas de caso: cualquier miembro del
    // proyecto puede pedir el informe, no solo el administrador.
    let (_, pid, _) = guard_case(&app, &headers, case_id)?;

    let case_name: String = app
        .store
        .conn()
        .query_row("SELECT name FROM cases WHERE id = ?1", [case_id], |r| r.get(0))
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

    // Decodificar cada miniatura y maquetar el PDF es CPU, no red -- al
    // pool de `spawn_blocking`, igual que `procesar_imagen` en la subida.
    let bytes = tokio::task::spawn_blocking(move || generar_pdf(&case_name, &filas))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    Ok((
        [
            (axum::http::header::CONTENT_TYPE, "application/pdf".to_string()),
            (axum::http::header::CONTENT_DISPOSITION, "attachment".to_string()),
        ],
        bytes,
    ))
}

fn generar_pdf(caso: &str, filas: &[(Image, Option<Vec<u8>>, Vec<Analysis>)]) -> Vec<u8> {
    let mut doc = PdfDocument::new(&format!("Lumi -- informe forense -- {caso}"));
    let mut warnings = Vec::new();

    // Un caso sin imágenes deja la portada sola: sigue siendo un PDF válido,
    // no un error -- el investigador pidió el informe de ESTE caso tal como
    // está, no una condición de "no hay nada que exportar".
    let mut paginas = vec![portada(caso, filas.len())];
    for (img, thumb, analyses) in filas {
        paginas.extend(paginas_de_imagen(&mut doc, img, thumb.as_deref(), analyses, &mut warnings));
    }

    let mut save_warnings = Vec::new();
    doc.with_pages(paginas).save(&PdfSaveOptions::default(), &mut save_warnings)
}

fn portada(caso: &str, n_imagenes: usize) -> PdfPage {
    let mut ops = vec![Op::StartTextSection];
    let mut y = CONTENT_TOP_MM - 40.0;
    linea(&mut ops, &mut y, "Lumi -- informe forense", FONT_TITLE, true);
    y -= 6.0;
    linea(&mut ops, &mut y, &format!("Caso: {caso}"), FONT_HEAD, true);
    linea(&mut ops, &mut y, &format!("Imágenes incluidas: {n_imagenes}"), FONT_BODY, false);
    linea(&mut ops, &mut y, &format!("Generado: {}", fecha_legible(now())), FONT_BODY, false);
    y -= 8.0;
    linea(
        &mut ops,
        &mut y,
        "Documento generado por Lumi. Cada hipótesis de geolocalización y cada",
        FONT_BODY,
        false,
    );
    linea(
        &mut ops,
        &mut y,
        "veredicto de agente son inferencias automáticas, no una confirmación",
        FONT_BODY,
        false,
    );
    linea(&mut ops, &mut y, "pericial -- se entregan con su nivel de confianza declarado.", FONT_BODY, false);
    ops.push(Op::EndTextSection);
    PdfPage::new(Mm(PAGE_W_MM), Mm(PAGE_H_MM), ops)
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

/// Fecha legible sin arrastrar `chrono`/`time` solo para esto -- el epoch ya
/// va también en el texto crudo si alguien necesita precisión.
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

/// Todas las páginas de una imagen: al menos una, más las que hagan falta si
/// el texto (EXIF + análisis) no cabe en la primera.
fn paginas_de_imagen(
    doc: &mut PdfDocument, imagen: &Image, thumb: Option<&[u8]>, analyses: &[Analysis],
    warnings: &mut Vec<PdfWarnMsg>,
) -> Vec<PdfPage> {
    let mut paginas = Vec::new();
    let mut ops = vec![Op::StartTextSection];
    let mut y = CONTENT_TOP_MM;

    linea(&mut ops, &mut y, &format!("Imagen: {}", imagen.filename), FONT_TITLE, true);
    y -= 4.0;

    // La miniatura va fuera de la sección de texto: es un XObject, no texto.
    ops.push(Op::EndTextSection);
    if let Some(bytes) = thumb {
        match RawImage::decode_from_bytes(bytes, warnings) {
            Ok(raw) if raw.width > 0 && raw.height > 0 => {
                let ancho_px = raw.width as f32;
                let alto_px = raw.height as f32;
                let alto_mm = THUMB_W_MM * alto_px / ancho_px;
                if y - alto_mm < MARGIN_MM {
                    salto_de_pagina(&mut paginas, &mut ops, &mut y, imagen);
                }
                let dpi = ancho_px * 25.4 / THUMB_W_MM;
                let id = doc.add_image(&raw);
                let y_bottom_mm = y - alto_mm;
                ops.push(Op::UseXobject {
                    id,
                    transform: XObjectTransform {
                        translate_x: Some(Mm(MARGIN_MM).into()),
                        translate_y: Some(Mm(y_bottom_mm).into()),
                        dpi: Some(dpi),
                        ..Default::default()
                    },
                });
                y = y_bottom_mm - 6.0;
            }
            _ => {
                ops.push(Op::StartTextSection);
                linea(&mut ops, &mut y, "(la miniatura no se pudo decodificar)", FONT_BODY, false);
                ops.push(Op::EndTextSection);
                y -= 2.0;
            }
        }
    } else {
        ops.push(Op::StartTextSection);
        linea(&mut ops, &mut y, "(sin miniatura en disco para esta imagen)", FONT_BODY, false);
        ops.push(Op::EndTextSection);
        y -= 2.0;
    }
    ops.push(Op::StartTextSection);

    // EXIF: el GPS declarado, aparte del inferido, nunca mezclado con él
    // (mismo principio que `exif.rs`). El resto del EXIF es un mapa de
    // etiqueta→texto entero (ver `exif::read`); solo se citan aquí los
    // campos simples que de verdad importan a un informe forense, y solo si
    // el fichero los trae -- no se inventa ninguno que falte.
    check_salto(&mut paginas, &mut ops, &mut y, imagen);
    match (imagen.exif_lat, imagen.exif_lng) {
        (Some(lat), Some(lng)) => linea(
            &mut ops, &mut y,
            &format!("GPS declarado por la cámara: {lat:.6}, {lng:.6}"),
            FONT_BODY, false,
        ),
        _ => linea(&mut ops, &mut y, "GPS declarado por la cámara: no consta en el EXIF", FONT_BODY, false),
    }
    if let Some(obj) = imagen.exif.as_ref().and_then(|v| v.as_object()) {
        for (etiqueta, clave) in
            [("Cámara", "Model"), ("Fabricante", "Make"), ("Capturada", "DateTimeOriginal"), ("Software", "Software")]
        {
            if let Some(valor) = obj.get(clave).and_then(|v| v.as_str()) {
                if !valor.trim().is_empty() {
                    check_salto(&mut paginas, &mut ops, &mut y, imagen);
                    linea(&mut ops, &mut y, &format!("{etiqueta}: {valor}"), FONT_BODY, false);
                }
            }
        }
    }
    y -= 3.0;

    if analyses.is_empty() {
        check_salto(&mut paginas, &mut ops, &mut y, imagen);
        linea(&mut ops, &mut y, "Sin análisis lanzados sobre esta imagen.", FONT_BODY, false);
    }
    for a in analyses {
        check_salto(&mut paginas, &mut ops, &mut y, imagen);
        y -= 1.5;
        check_salto(&mut paginas, &mut ops, &mut y, imagen);
        linea(&mut ops, &mut y, &format!("Análisis · modelo {}", a.model), FONT_HEAD, true);

        match a.state.as_str() {
            "pendiente" => {
                check_salto(&mut paginas, &mut ops, &mut y, imagen);
                linea(&mut ops, &mut y, "Estado: pendiente -- todavía no ha empezado a correr.", FONT_BODY, false);
                continue;
            }
            "en_curso" => {
                check_salto(&mut paginas, &mut ops, &mut y, imagen);
                linea(&mut ops, &mut y, "Estado: en curso en el momento de generar este informe.", FONT_BODY, false);
                continue;
            }
            "error" => {
                let motivo = a.error.as_deref().unwrap_or("sin motivo registrado");
                for l in envolver(&format!("Estado: error -- {motivo}"), MAX_CHARS_BODY) {
                    check_salto(&mut paginas, &mut ops, &mut y, imagen);
                    linea(&mut ops, &mut y, &l, FONT_BODY, false);
                }
                continue;
            }
            _ => {}
        }

        if a.model == "agentes" {
            escribir_agentes(&mut paginas, &mut ops, &mut y, imagen, &a.agentes, a.agente.as_deref());
        } else {
            escribir_geolocalizacion(&mut paginas, &mut ops, &mut y, imagen, a);
        }
    }

    ops.push(Op::EndTextSection);
    paginas.push(PdfPage::new(Mm(PAGE_W_MM), Mm(PAGE_H_MM), ops));
    paginas
}

fn escribir_geolocalizacion(
    paginas: &mut Vec<PdfPage>, ops: &mut Vec<Op>, y: &mut f32, imagen: &Image, a: &Analysis,
) {
    match (a.result_lat, a.result_lng) {
        (Some(lat), Some(lng)) => {
            let radio = a.result_radius_m.map(|r| format!("{r:.0} m")).unwrap_or_else(|| "sin radio".into());
            let confianza = a
                .result_confidence
                .map(|c| format!("{:.0}%", c * 100.0))
                .unwrap_or_else(|| "sin confianza registrada".into());
            check_salto(paginas, ops, y, imagen);
            linea(ops, y, &format!("Hipótesis principal: {lat:.6}, {lng:.6}"), FONT_BODY, false);
            check_salto(paginas, ops, y, imagen);
            linea(ops, y, &format!("Radio: {radio} · confianza: {confianza}"), FONT_BODY, false);
            if let (Some(inliers), Some(verif)) = (a.result_inliers, a.result_verificador.as_deref()) {
                check_salto(paginas, ops, y, imagen);
                linea(ops, y, &format!("Respaldo geométrico: {inliers} correspondencias ({verif})"), FONT_BODY, false);
            }
        }
        _ => {
            check_salto(paginas, ops, y, imagen);
            linea(ops, y, "Sin hipótesis: el motor no encontró un candidato.", FONT_BODY, false);
        }
    }
    if !a.hypotheses.is_empty() {
        check_salto(paginas, ops, y, imagen);
        linea(ops, y, "Alternativas:", FONT_BODY, true);
        for h in &a.hypotheses {
            let linea_txt = format!(
                "  · {:.6}, {:.6} · radio {:.0} m · peso {:.0}%",
                h.lat, h.lng, h.radio_m, h.peso * 100.0,
            );
            check_salto(paginas, ops, y, imagen);
            linea(ops, y, &linea_txt, FONT_BODY, false);
        }
    }
}

fn escribir_agentes(
    paginas: &mut Vec<PdfPage>, ops: &mut Vec<Op>, y: &mut f32, imagen: &Image,
    dichos: &[DichoDeAgente], agente_pedido: Option<&str>,
) {
    if dichos.is_empty() {
        check_salto(paginas, ops, y, imagen);
        linea(ops, y, "El agente no contestó a tiempo.", FONT_BODY, false);
        return;
    }
    let dicho = dichos.iter().find(|d| Some(d.agente.as_str()) == agente_pedido).unwrap_or(&dichos[0]);
    check_salto(paginas, ops, y, imagen);
    linea(ops, y, &format!("Agente: {}", dicho.nombre), FONT_BODY, false);
    if dicho.etiqueta == "abstiene" {
        check_salto(paginas, ops, y, imagen);
        linea(ops, y, "Veredicto: se abstuvo -- no llegó a su umbral de confianza.", FONT_BODY, false);
    } else {
        check_salto(paginas, ops, y, imagen);
        linea(ops, y, &format!("Veredicto: {} ({:.0}%)", dicho.etiqueta, dicho.confianza * 100.0), FONT_BODY, false);
    }
    if !dicho.detalle.is_empty() {
        for l in envolver(&format!("Detalle: {}", dicho.detalle), MAX_CHARS_BODY) {
            check_salto(paginas, ops, y, imagen);
            linea(ops, y, &l, FONT_BODY, false);
        }
    }
}

/// Nueva página si lo que sigue ya no cabe -- se comprueba ANTES de escribir
/// cada línea, no después, así nunca se llega a pintar fuera del margen.
fn check_salto(paginas: &mut Vec<PdfPage>, ops: &mut Vec<Op>, y: &mut f32, imagen: &Image) {
    if *y - LINE_H_MM < MARGIN_MM {
        salto_de_pagina(paginas, ops, y, imagen);
    }
}

fn salto_de_pagina(paginas: &mut Vec<PdfPage>, ops: &mut Vec<Op>, y: &mut f32, imagen: &Image) {
    ops.push(Op::EndTextSection);
    let contenido = std::mem::replace(ops, vec![Op::StartTextSection]);
    paginas.push(PdfPage::new(Mm(PAGE_W_MM), Mm(PAGE_H_MM), contenido));
    *y = CONTENT_TOP_MM;
    linea(ops, y, &format!("{} (continúa)", imagen.filename), FONT_HEAD, true);
    *y -= 3.0;
}

/// Coloca el cursor y escribe una línea completa -- sin ajuste automático,
/// ver el `ponytail` al principio del fichero. Deja el cursor listo para la
/// siguiente línea.
fn linea(ops: &mut Vec<Op>, y: &mut f32, texto: &str, tam: f32, negrita: bool) {
    let fuente = if negrita { BuiltinFont::HelveticaBold } else { BuiltinFont::Helvetica };
    ops.push(Op::SetFont { font: PdfFontHandle::Builtin(fuente), size: Pt(tam) });
    ops.push(Op::SetTextCursor { pos: Point::new(Mm(MARGIN_MM), Mm(*y)) });
    ops.push(Op::ShowText { items: vec![TextItem::Text(texto.to_string())] });
    *y -= LINE_H_MM;
}

/// Ajuste de línea por cuenta de caracteres, palabra a palabra -- ver el
/// `ponytail` al principio del fichero.
fn envolver(texto: &str, max_chars: usize) -> Vec<String> {
    let mut salida = Vec::new();
    let mut actual = String::new();
    for palabra in texto.split_whitespace() {
        if !actual.is_empty() && actual.len() + 1 + palabra.len() > max_chars {
            salida.push(std::mem::take(&mut actual));
        }
        if !actual.is_empty() {
            actual.push(' ');
        }
        actual.push_str(palabra);
    }
    if !actual.is_empty() {
        salida.push(actual);
    }
    if salida.is_empty() {
        salida.push(String::new());
    }
    salida
}
