//! Autoemisión de la clave de vinculación, para el instalador (antes solo
//! `lumi install`, en Rust, escribía esta fila directamente en el SQLite —
//! ver el comentario en `tools/../web/app/install-py/route.ts` sobre por qué
//! el instalador en Python no reimplementa Argon2id él mismo).
//!
//! Se blinda por dos lados a la vez, no uno: **origen** (solo localhost —
//! nadie que no esté ya en la máquina puede ni intentarlo) y **estado**
//! (solo si el servidor está genuinamente virgen — sin usuarios y sin
//! ninguna clave ya emitida, ni siquiera una caducada o consumida). La
//! combinación importa: sin la comprobación de origen, cualquiera en la red
//! podría pedir una clave nueva de un servidor ya reclamado si por lo que
//! sea `pair_key`/`users` estuvieran vacíos; sin la de estado, cualquier
//! proceso local podría reemitir una clave de un servidor que ya tiene
//! dueño.

use crate::App;
use axum::extract::{ConnectInfo, State};
use axum::{http::StatusCode, Json};
use lumi_proto::key::{PairKey, SECRET_BYTES};
use rand::RngCore;
use std::net::SocketAddr;

#[derive(serde::Serialize)]
pub struct BootstrapKeyRes {
    pub key: String,
}

pub async fn emitir_clave(
    State(app): State<App>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
) -> Result<Json<BootstrapKeyRes>, (StatusCode, String)> {
    if !peer.ip().is_loopback() {
        return Err((StatusCode::FORBIDDEN, "esta ruta solo responde a localhost".to_string()));
    }
    let c = app.store.conn();
    let hay_usuarios: i64 = c
        .query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    let hay_clave: i64 = c
        .query_row("SELECT COUNT(*) FROM pair_key", [], |r| r.get(0))
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;
    if hay_usuarios > 0 || hay_clave > 0 {
        return Err((
            StatusCode::FORBIDDEN,
            "este servidor ya no está virgen — usa 'lumi key reissue' en el host".to_string(),
        ));
    }

    let addr = crate::red::direccion_publica(&app.store);
    let mut secreto = [0u8; SECRET_BYTES];
    rand::thread_rng().fill_bytes(&mut secreto);
    // Se construye a mano en vez de `PairKey::generate(addr, cert_der)`: esa
    // función recalcula la huella a partir del certificado en disco, pero
    // `app.fingerprint` ya la trae calculada desde el arranque — releer el
    // fichero aquí solo para recalcular lo mismo no aporta nada.
    let key = PairKey { addr, fingerprint: app.fingerprint.clone(), secret: bs58::encode(secreto).into_string() };

    let expires = if std::env::var("LUMI_NO_EXPIRY").is_ok() {
        None
    } else {
        Some(crate::routes::access::now() + 24 * 3600)
    };
    c.execute(
        "INSERT INTO pair_key (id, secret_phc, expires_at, consumed) VALUES (1, ?1, ?2, 0)",
        rusqlite::params![
            lumi_proto::crypto::hash_password(&key.secret)
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?,
            expires
        ],
    )
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?;

    tracing::info!("clave de vinculación autoemitida por el instalador (localhost, servidor virgen)");
    Ok(Json(BootstrapKeyRes { key: key.to_string() }))
}
