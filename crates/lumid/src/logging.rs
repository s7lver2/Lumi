//! Qué se escribe al log, por categoría — la pestaña Doctor lee y cambia
//! esto en caliente, sin reiniciar el daemon (`tracing_subscriber::reload`).
//!
//! Cada categoría es un grupo de módulos de Rust que un administrador
//! reconoce por lo que hacen, no por su ruta interna — "Hardware" en vez de
//! "lumid::hardware,lumid::hardware_cpu".

use crate::store::Store;

pub struct Categoria {
    pub id: &'static str,
    pub label: &'static str,
    pub objetivos: &'static [&'static str],
}

pub const CATEGORIAS: &[Categoria] = &[
    Categoria { id: "auth", label: "Autenticación y sesiones", objetivos: &["lumid::routes::auth", "lumid::routes::claim"] },
    Categoria {
        id: "solicitudes",
        label: "Solicitudes, usuarios y crédito",
        objetivos: &["lumid::routes::access", "lumid::routes::admin", "lumid::routes::credit_requests"],
    },
    Categoria { id: "cola", label: "Cola de análisis", objetivos: &["lumid::queue"] },
    Categoria { id: "hardware", label: "Hardware", objetivos: &["lumid::hardware", "lumid::hardware_cpu"] },
    Categoria {
        id: "seguridad",
        label: "Seguridad",
        objetivos: &["lumid::routes::security", "lumid::zero_trust", "lumid::mantenimiento"],
    },
    Categoria { id: "red", label: "Red", objetivos: &["lumid::routes::network"] },
    Categoria { id: "modelos", label: "Modelos e índices", objetivos: &["lumid::routes::models", "lumid::routes::indices"] },
    Categoria {
        id: "proyectos",
        label: "Proyectos, casos y claves API",
        objetivos: &["lumid::routes::projects", "lumid::routes::api_keys", "lumid::routes::cases", "lumid::routes::tasks"],
    },
    Categoria { id: "doctor", label: "Doctor", objetivos: &["lumid::routes::doctor"] },
    Categoria {
        id: "otros",
        label: "Avisos, perfil y políticas",
        objetivos: &["lumid::routes::avisos", "lumid::routes::perfil", "lumid::routes::policies"],
    },
];

/// En orden de menos a más ruido — el mismo orden que enseña el desplegable.
pub const NIVELES: &[&str] = &["error", "warn", "info", "debug", "trace"];
pub const NIVEL_DEFECTO: &str = "info";

fn clave(id: &str) -> String {
    format!("log_nivel_{id}")
}

/// Nivel guardado de una categoría, o el nivel base si nunca se tocó.
pub fn nivel_de(store: &Store, id: &str, base: &str) -> String {
    store.get_meta(&clave(id)).unwrap_or_else(|| base.to_string())
}

pub fn nivel_base(store: &Store) -> String {
    store.get_meta("log_nivel_base").unwrap_or_else(|| NIVEL_DEFECTO.to_string())
}

pub fn set_nivel_base(store: &Store, nivel: &str) -> anyhow::Result<()> {
    store.set_meta("log_nivel_base", nivel)
}

pub fn set_nivel_categoria(store: &Store, id: &str, nivel: &str) -> anyhow::Result<()> {
    store.set_meta(&clave(id), nivel)
}

/// El directive string completo de `EnvFilter` — el nivel base para todo lo
/// que no tiene categoría propia (incluidas las dependencias, para no
/// inundar el log con lo que ellas mismas registran), más un directive por
/// cada módulo de cada categoría con su nivel guardado.
pub fn construir_filtro(store: &Store) -> String {
    let base = nivel_base(store);
    let mut partes = vec![base.clone()];
    for cat in CATEGORIAS {
        let nivel = nivel_de(store, cat.id, &base);
        for objetivo in cat.objetivos {
            partes.push(format!("{objetivo}={nivel}"));
        }
    }
    partes.join(",")
}
