//! Canal de actualizaciones del propio `lumid`: comprobar contra el
//! manifiesto firmado (`lumi_proto::actualizacion`), cachear el resultado
//! en `meta`, y aplicar la actualización cuando un admin la pide desde el
//! panel — el esquema no distingue "owner" de "admin" hoy (solo existe
//! `users.is_admin`), así que cualquier admin puede hacerlo; ver la nota en
//! la spec sobre esta decisión.

use crate::mantenimiento;
use crate::App;
use lumi_proto::actualizacion::{Manifiesto, Producto};
use serde::{Deserialize, Serialize};

const VERSIONES_URL: &str = "https://lumi.s7lver.xyz/api/versiones";
const META_ESTADO: &str = "actualizacion_estado";
const BIN_ACTUAL: &str = "/usr/local/bin/lumid";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoActualizacion {
    pub version_instalada: String,
    pub disponible: Option<PublicacionInfo>,
    pub retirada: bool,
    pub comprobado_en: Option<i64>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicacionInfo {
    pub version: String,
    pub notas: String,
    pub publicado: String,
}

fn version_instalada() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

async fn consultar_manifiesto() -> Result<Manifiesto, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;
    Ok(manifiesto)
}

/// Consulta el manifiesto y cachea el resultado en `meta`. No falla nunca
/// hacia afuera: un problema de red o de firma se guarda como parte del
/// propio estado (`error: Some(...)`), no como un `Result` que tumbe el
/// tick de fondo.
pub async fn comprobar_y_cachear(app: &App) {
    let version_instalada = version_instalada();
    let ahora = crate::routes::access::now();
    let estado = match consultar_manifiesto().await {
        Ok(manifiesto) => EstadoActualizacion {
            retirada: manifiesto.version_retirada(Producto::Lumid, &version_instalada),
            disponible: manifiesto
                .mas_nueva(Producto::Lumid, &version_instalada, "linux-x86_64")
                .map(|p| PublicacionInfo {
                    version: p.version.clone(),
                    notas: p.notas.clone(),
                    publicado: p.publicado.clone(),
                }),
            version_instalada,
            comprobado_en: Some(ahora),
            error: None,
        },
        Err(e) => EstadoActualizacion {
            version_instalada,
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some(e),
        },
    };
    let _ = app.store.set_meta(META_ESTADO, &serde_json::to_string(&estado).unwrap_or_default());
}

/// Lectura pura de lo último cacheado — nunca hace red por su cuenta. Es lo
/// que sirve `GET /v1/admin/actualizacion`; solo el tick de fondo y
/// "comprobar ahora" llaman a `comprobar_y_cachear`.
pub fn estado_cacheado(app: &App) -> EstadoActualizacion {
    app.store
        .get_meta(META_ESTADO)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| EstadoActualizacion {
            version_instalada: version_instalada(),
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some("todavía no se ha comprobado".into()),
        })
}

/// Una vez al día, para siempre, mientras el daemon viva. Mismo patrón que
/// `telemetry::muestrear_historial`.
pub async fn tick(app: App) {
    loop {
        comprobar_y_cachear(&app).await;
        tokio::time::sleep(std::time::Duration::from_secs(24 * 3600)).await;
    }
}

#[derive(Debug, thiserror::Error)]
pub enum AplicarError {
    #[error("no hay ninguna actualización disponible para aplicar")]
    SinDisponible,
    #[error("no se pudo descargar el artefacto: {0}")]
    Descarga(String),
    #[error("la huella no coincide: esperada {esperado}, recibida {recibido}")]
    HashNoCoincide { esperado: String, recibido: String },
    #[error("no se pudo escribir el binario nuevo: {0}")]
    Escritura(String),
    #[error("no se pudo hacer la copia de seguridad de la base: {0}")]
    Backup(String),
}

/// La secuencia completa. Deliberadamente en orden: nada destructivo pasa
/// antes de que todo lo verificable esté verificado. El proceso que ejecuta
/// esto muere al final (paso 6, `systemctl restart`) — quien la llama
/// (`routes/actualizacion.rs::aplicar`) la dispara con `tokio::spawn` y no
/// espera una respuesta HTTP limpia al final, por diseño.
pub async fn aplicar(app: &App) -> Result<(), AplicarError> {
    // 1. Descargar y verificar el hash. Nada se ha tocado todavía si esto falla.
    let manifiesto = consultar_manifiesto().await.map_err(AplicarError::Descarga)?;
    let version_instalada = version_instalada();
    let publicacion = manifiesto
        .mas_nueva(Producto::Lumid, &version_instalada, "linux-x86_64")
        .ok_or(AplicarError::SinDisponible)?
        .clone();
    let artefacto = publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == "linux-x86_64")
        .ok_or(AplicarError::SinDisponible)?
        .clone();

    let bytes = reqwest::Client::new()
        .get(&artefacto.url)
        .send()
        .await
        .map_err(|e| AplicarError::Descarga(e.to_string()))?
        .bytes()
        .await
        .map_err(|e| AplicarError::Descarga(e.to_string()))?;

    let recibido = {
        use sha2::{Digest, Sha256};
        let mut h = Sha256::new();
        h.update(&bytes);
        format!("{:x}", h.finalize())
    };
    if recibido != artefacto.sha256 {
        return Err(AplicarError::HashNoCoincide { esperado: artefacto.sha256.clone(), recibido });
    }

    // 2. Mantenimiento: rechaza trabajo nuevo, no cancela el que corre.
    let _ = mantenimiento::set_activo(app, true);
    let _ = mantenimiento::set_mensaje(app, &format!("Actualizando a {}…", publicacion.version));

    // 3. Esperar a que la cola en curso vacíe. Sin tope de tiempo: el
    //    trabajo empezado no se cancela nunca.
    while app.queue.foto().en_curso > 0 {
        tokio::time::sleep(std::time::Duration::from_secs(5)).await;
    }

    // 4. Copia de seguridad de la base antes de tocar nada en disco.
    let ruta_backup = app.dir.join(format!("lumi.db.bak-{version_instalada}"));
    app.store
        .conn()
        .execute("VACUUM INTO ?1", [ruta_backup.to_string_lossy().as_ref()])
        .map_err(|e| AplicarError::Backup(e.to_string()))?;

    // 5. Sustituir el binario. En Linux se puede renombrar un binario en
    //    ejecución sin detenerlo antes.
    let viejo = format!("{BIN_ACTUAL}.viejo");
    std::fs::rename(BIN_ACTUAL, &viejo).map_err(|e| AplicarError::Escritura(e.to_string()))?;
    std::fs::write(BIN_ACTUAL, &bytes).map_err(|e| AplicarError::Escritura(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(BIN_ACTUAL, std::fs::Permissions::from_mode(0o755));
    }

    // 6. Reiniciar. El nuevo proceso corre `store::migrate()` al arrancar,
    //    como en cualquier arranque normal — no hace falta nada especial
    //    aquí para eso. Este proceso muere aquí.
    let _ = std::process::Command::new("systemctl").args(["restart", "lumid"]).status();

    Ok(())
}
