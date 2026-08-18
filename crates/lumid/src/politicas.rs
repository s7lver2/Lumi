//! El documento que se muestra al crear una cuenta nueva, si el admin lo
//! activa. Mismo patrón que `mantenimiento.rs`/`red.rs`: escalares sueltos
//! en `meta` — es un único documento, no una lista que merezca tabla propia.

use crate::store::Store;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub active: bool,
    pub title: String,
    /// Documento Tiptap JSON, mismo formato que `avisos.contenido`.
    pub content: serde_json::Value,
}

fn doc_vacio() -> serde_json::Value {
    serde_json::json!({ "type": "doc", "content": [{ "type": "paragraph" }] })
}

pub fn leer(store: &Store) -> Settings {
    Settings {
        active: activo(store),
        title: store.get_meta("politicas_titulo").unwrap_or_default(),
        content: store
            .get_meta("politicas_contenido")
            .and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_else(doc_vacio),
    }
}

/// Aparte de `leer`: `access.rs::create_account` solo necesita saber si el
/// gate está activo, no el documento entero.
pub fn activo(store: &Store) -> bool {
    store.get_meta("politicas_activas").as_deref() == Some("1")
}

pub fn set_active(store: &Store, on: bool) -> anyhow::Result<()> {
    store.set_meta("politicas_activas", if on { "1" } else { "0" })
}

pub fn set_title(store: &Store, title: &str) -> anyhow::Result<()> {
    store.set_meta("politicas_titulo", title)
}

pub fn set_content(store: &Store, content: &serde_json::Value) -> anyhow::Result<()> {
    store.set_meta("politicas_contenido", &serde_json::to_string(content)?)
}
