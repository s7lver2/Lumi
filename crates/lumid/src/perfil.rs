//! Fotos de perfil (usuario) y perfil de servidor (foto, banner, título,
//! descripción). Mismo pipeline de imagen que `routes/images.rs`:
//! decodificar, recortar a un tamaño fijo, guardar como JPEG. Un archivo por
//! rol, sin versionado — subir uno nuevo sobrescribe.

use crate::store::Store;
use image::imageops::FilterType;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const AVATAR_SIDE: u32 = 256;
pub const BANNER_W: u32 = 1200;
pub const BANNER_H: u32 = 360;
pub const MAX_BYTES: usize = 8 * 1024 * 1024;

fn dir(app_dir: &Path) -> PathBuf {
    app_dir.join("perfil")
}

pub fn ruta_avatar_usuario(app_dir: &Path, user_id: i64) -> PathBuf {
    dir(app_dir).join(format!("usuario_{user_id}.jpg"))
}
pub fn ruta_avatar_servidor(app_dir: &Path) -> PathBuf {
    dir(app_dir).join("servidor_avatar.jpg")
}
pub fn ruta_banner_servidor(app_dir: &Path) -> PathBuf {
    dir(app_dir).join("servidor_banner.jpg")
}

/// Decodifica, recorta centrado a `(w, h)` cubriendo el rectángulo entero
/// (`resize_to_fill`, no `thumbnail`: un banner panorámico subido como foto
/// cuadrada se recorta, no se deforma ni deja bordes vacíos) y guarda como
/// JPEG en `ruta`.
pub fn guardar_recortada(bytes: &[u8], w: u32, h: u32, ruta: &Path) -> anyhow::Result<()> {
    if let Some(padre) = ruta.parent() {
        std::fs::create_dir_all(padre)?;
    }
    let fmt = image::guess_format(bytes)?;
    let decoded = image::load_from_memory_with_format(bytes, fmt)?;
    let recortada = decoded.resize_to_fill(w, h, FilterType::Lanczos3);
    let mut buf = std::io::Cursor::new(Vec::new());
    recortada.to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg)?;
    std::fs::write(ruta, buf.into_inner())?;
    Ok(())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerProfile {
    /// Mismo patrón que `politicas::Settings.active` (#77): el perfil
    /// existe siempre en `meta`, pero solo se muestra en "Añadir servidor"
    /// si el admin lo activa explícitamente — evita que un servidor a medio
    /// configurar (título en blanco, sin foto) se enseñe por defecto.
    pub active: bool,
    pub title: String,
    pub description: serde_json::Value,
    pub member_count: i64,
    pub has_avatar: bool,
    pub has_banner: bool,
}

fn doc_vacio() -> serde_json::Value {
    serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
}

pub fn leer_servidor(store: &Store, app_dir: &Path) -> ServerProfile {
    let member_count: i64 = store
        .conn()
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .unwrap_or(0);
    ServerProfile {
        active: activo(store),
        title: store.get_meta("servidor_titulo").unwrap_or_default(),
        description: store
            .get_meta("servidor_descripcion")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(doc_vacio),
        member_count,
        has_avatar: ruta_avatar_servidor(app_dir).exists(),
        has_banner: ruta_banner_servidor(app_dir).exists(),
    }
}

pub fn activo(store: &Store) -> bool {
    store.get_meta("servidor_perfil_activo").as_deref() == Some("1")
}

pub fn set_activo(store: &Store, on: bool) -> anyhow::Result<()> {
    store.set_meta("servidor_perfil_activo", if on { "1" } else { "0" })
}

pub fn set_titulo(store: &Store, title: &str) -> anyhow::Result<()> {
    store.set_meta("servidor_titulo", title)
}
pub fn set_descripcion(store: &Store, content: &serde_json::Value) -> anyhow::Result<()> {
    store.set_meta("servidor_descripcion", &serde_json::to_string(content)?)
}
