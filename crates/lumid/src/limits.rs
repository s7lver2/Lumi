//! Dos niveles: el valor global del servidor y la anulación por usuario.
//!
//! Este subsistema DEFINE, ALMACENA y EXPONE los límites. Quien los APLICA es
//! la cola (subsistema 4) y los proyectos (6). La frontera es `effective`.

use crate::store::Store;
use anyhow::Result;
use lumi_proto::api::Limits;
use serde_json::Value;
use std::collections::HashMap;

/// Las claves válidas. Cualquier otra se rechaza al escribir: una errata en un
/// PATCH crearía una fila que nadie lee nunca y un límite que nadie entiende.
pub const KEYS: [&str; 9] = [
    "models",
    "max_concurrent",
    "max_daily",
    "max_storage_gb",
    "queue_priority",
    "can_create_projects",
    "background_jobs",
    "weekly_enabled",
    "max_weekly",
];

fn rows(s: &Store, user_id: Option<i64>) -> HashMap<String, Value> {
    let c = s.conn();
    let mut q = match user_id {
        Some(_) => c.prepare("SELECT key, value FROM limits WHERE user_id = ?1"),
        None => c.prepare("SELECT key, value FROM limits WHERE user_id IS NULL"),
    }
    .expect("sql de límites inválido");
    let map = |r: &rusqlite::Row| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?));
    let it = match user_id {
        Some(id) => q.query_map([id], map),
        None => q.query_map([], map),
    };
    it.into_iter()
        .flatten()
        .flatten()
        .filter_map(|(k, v)| Some((k, serde_json::from_str(&v).ok()?)))
        .collect()
}

fn apply(l: &mut Limits, k: &str, v: &Value) {
    match k {
        "models" => {
            if let Ok(m) = serde_json::from_value(v.clone()) {
                l.models = m;
            }
        }
        "max_concurrent" => l.max_concurrent = v.as_i64().unwrap_or(l.max_concurrent),
        "max_daily" => l.max_daily = v.as_i64().unwrap_or(l.max_daily),
        "max_storage_gb" => l.max_storage_gb = v.as_i64().unwrap_or(l.max_storage_gb),
        "queue_priority" => l.queue_priority = v.as_i64().unwrap_or(l.queue_priority).clamp(-5, 5),
        "can_create_projects" => {
            l.can_create_projects = v.as_bool().unwrap_or(l.can_create_projects)
        }
        "background_jobs" => l.background_jobs = v.as_bool().unwrap_or(l.background_jobs),
        "weekly_enabled" => l.weekly_enabled = v.as_bool().unwrap_or(l.weekly_enabled),
        "max_weekly" => l.max_weekly = v.as_i64().unwrap_or(l.max_weekly),
        _ => {}
    }
}

/// Los valores del servidor, sin anulaciones.
pub fn global(s: &Store) -> Limits {
    let mut l = Limits::default();
    for (k, v) in rows(s, None) {
        apply(&mut l, &k, &v);
    }
    l
}

/// Sus anulaciones, tal cual, para que la interfaz pueda decir de dónde viene
/// cada límite. Un límite sin origen visible es indepurable cuando alguien
/// pregunta por qué solo puede lanzar uno.
pub fn overrides(s: &Store, user_id: i64) -> HashMap<String, Value> {
    rows(s, Some(user_id))
}

/// El valor que rige para este usuario: su anulación si existe, si no el global.
///
/// Esta es la ÚNICA función que los subsistemas 4 y 6 deben llamar. No lean la
/// tabla por su cuenta: la precedencia de dos niveles vive aquí y en un solo
/// sitio, y así un tercer nivel (roles) se añade sin tocarlos.
pub fn effective(s: &Store, user_id: i64) -> Limits {
    let mut l = global(s);
    for (k, v) in overrides(s, user_id) {
        apply(&mut l, &k, &v);
    }
    l
}

pub fn set(s: &Store, user_id: Option<i64>, key: &str, value: &Value) -> Result<()> {
    anyhow::ensure!(KEYS.contains(&key), "límite desconocido: {key}");
    let json = serde_json::to_string(value)?;
    let c = s.conn();
    match user_id {
        Some(id) => c.execute(
            "INSERT INTO limits (user_id, key, value) VALUES (?1, ?2, ?3)
             ON CONFLICT(user_id, key) DO UPDATE SET value = ?3",
            rusqlite::params![id, key, json],
        ),
        // El ON CONFLICT por columnas no dispara con user_id NULL (cada NULL
        // es distinto): para los globales el conflicto lo detecta el índice
        // parcial, así que se apunta a él por nombre.
        None => c.execute(
            "INSERT INTO limits (user_id, key, value) VALUES (NULL, ?1, ?2)
             ON CONFLICT(key) WHERE user_id IS NULL DO UPDATE SET value = ?2",
            rusqlite::params![key, json],
        ),
    }?;
    Ok(())
}

/// Quita una anulación: el usuario vuelve a heredar del global.
pub fn clear(s: &Store, user_id: Option<i64>, key: &str) -> Result<()> {
    let c = s.conn();
    match user_id {
        Some(id) => c.execute(
            "DELETE FROM limits WHERE user_id = ?1 AND key = ?2",
            rusqlite::params![id, key],
        ),
        None => c.execute("DELETE FROM limits WHERE user_id IS NULL AND key = ?1", [key]),
    }?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_anulacion_gana_al_global_y_el_resto_se_hereda() {
        let dir = std::env::temp_dir().join(format!("lumi-lim-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = crate::store::Store::open(&dir).unwrap();

        // Sin nada configurado, salen los defectos de la spec.
        let d = effective(&s, 1);
        assert_eq!(d.models, vec!["mini".to_string()]);
        assert_eq!(d.max_daily, 50);

        // El global cambia para todos.
        set(&s, None, "max_daily", &serde_json::json!(200)).unwrap();
        assert_eq!(effective(&s, 1).max_daily, 200);

        // La anulación cambia solo para uno, y no toca las demás palancas.
        set(&s, Some(1), "max_daily", &serde_json::json!(5)).unwrap();
        set(&s, Some(1), "models", &serde_json::json!(["mini", "vision"])).unwrap();
        assert_eq!(effective(&s, 1).max_daily, 5);
        assert_eq!(effective(&s, 2).max_daily, 200);
        assert_eq!(effective(&s, 1).models.len(), 2);
        assert_eq!(effective(&s, 1).max_concurrent, 2);

        // Y quitarla devuelve al global, no al defecto de fábrica.
        clear(&s, Some(1), "max_daily").unwrap();
        assert_eq!(effective(&s, 1).max_daily, 200);

        // El límite nuevo hereda la misma maquinaria de dos niveles que los
        // otros seis, sin nada específico suyo.
        assert!(!effective(&s, 1).background_jobs, "apagado por defecto");
        set(&s, None, "background_jobs", &serde_json::json!(true)).unwrap();
        assert!(effective(&s, 1).background_jobs);
        set(&s, Some(1), "background_jobs", &serde_json::json!(false)).unwrap();
        assert!(!effective(&s, 1).background_jobs);
        assert!(effective(&s, 2).background_jobs);

        drop(s);
        std::fs::remove_dir_all(&dir).ok();
    }
}
