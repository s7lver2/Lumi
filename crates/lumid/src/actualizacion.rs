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
const META_APLICANDO: &str = "actualizacion_aplicando";
const BIN_ACTUAL: &str = "/usr/local/bin/lumid";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EstadoActualizacion {
    pub version_instalada: String,
    pub disponible: Option<PublicacionInfo>,
    pub retirada: bool,
    pub comprobado_en: Option<i64>,
    pub error: Option<String>,
    /// Si hay una aplicación de actualización en curso ahora mismo — se lee
    /// de una clave separada de `meta`, no de este blob serializado, para
    /// que sobreviva intacta a cada `comprobar_y_cachear` (que reescribe
    /// todo lo demás). Es lo que el panel usa para reconciliar su botón
    /// "Actualizando…" con la realidad del backend en vez de fiarse solo de
    /// un flag local que nunca se resetea por su cuenta (#69).
    #[serde(default)]
    pub aplicando: bool,
}

fn aplicando_flag(app: &App) -> bool {
    app.store.get_meta(META_APLICANDO).as_deref() == Some("1")
}

/// Se llama al empezar/terminar `aplicar()` — ver `routes/actualizacion.rs`,
/// que es quien controla el ciclo de vida completo (inicio antes de lanzar
/// la tarea de fondo, fin en el `Err` que ya limpiaba mantenimiento).
pub fn set_aplicando(app: &App, on: bool) {
    let _ = app.store.set_meta(META_APLICANDO, if on { "1" } else { "0" });
}

/// A ejecutar al arrancar, antes de servir tráfico: ni el camino de éxito
/// de `aplicar()` (paso 6, `systemctl restart`, el proceso muere sin volver
/// a pasar por aquí) ni una caída/`systemctl restart` manual a mitad de
/// actualización limpian `META_APLICANDO`/mantenimiento — solo lo hace el
/// tope de 10 min DENTRO del mismo proceso, que un reinicio se salta por
/// completo. Sin esto, cada actualización (incluso una que sale bien) deja
/// el servidor pegado en mantenimiento para siempre tras reiniciar, porque
/// `/var/lib/lumi` sobrevive a una reinstalación — justo lo que bloqueó el
/// setup entero de un servidor recién reemparejado.
///
/// `META_APLICANDO` se limpia siempre: un proceso recién arrancado nunca
/// puede estar de verdad "aplicando" algo de una vida anterior. El
/// mantenimiento y su mensaje de sistema solo se apagan si fue ESTE flujo
/// quien los encendió (`mantenimiento_mensaje_sistema` no vacío) — si el
/// admin activó mantenimiento a mano por su cuenta, eso no se toca.
pub fn limpiar_estado_colgado_al_arrancar(app: &App) {
    let _ = app.store.set_meta(META_APLICANDO, "0");
    let sistema = app.store.get_meta("mantenimiento_mensaje_sistema").unwrap_or_default();
    if !sistema.trim().is_empty() {
        tracing::warn!("mantenimiento seguia activo por una actualizacion interrumpida por el reinicio anterior; se limpia");
        let _ = mantenimiento::set_activo(app, false);
        let _ = mantenimiento::set_mensaje_sistema(app, "");
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicacionInfo {
    pub version: String,
    pub notas: String,
    pub publicado: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PublicacionHistorial {
    pub version: String,
    pub notas: String,
    pub publicado: String,
    pub retirada: bool,
}

/// Historial completo de publicaciones de `lumid`, más recientes primero —
/// mismo patrón que `indexer/src-tauri/src/actualizacion.rs::historial`,
/// pero server-side: es lo que alimenta el selector de versión del panel
/// (#71), no solo "¿hay algo más nuevo que lo instalado?".
pub async fn historial() -> Result<Vec<PublicacionHistorial>, String> {
    let manifiesto = consultar_manifiesto().await?;
    let mut publicaciones: Vec<PublicacionHistorial> = manifiesto
        .publicaciones
        .iter()
        .filter(|p| p.producto == Producto::Lumid)
        .map(|p| PublicacionHistorial {
            version: p.version.clone(),
            notas: p.notas.clone(),
            publicado: p.publicado.clone(),
            retirada: p.retirada,
        })
        .collect();
    publicaciones.sort_by(|a, b| b.publicado.cmp(&a.publicado));
    Ok(publicaciones)
}

fn version_instalada() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

async fn consultar_manifiesto() -> Result<Manifiesto, String> {
    // Sin timeout, una conexión colgada deja esta llamada esperando para
    // siempre — y como `aplicar()` la hace ANTES de la espera acotada de la
    // cola (paso 3, 10 min), ese tope nunca llega a aplicarse: la
    // actualización se queda en "Aplicando" sin límite ni log, exactamente
    // el mismo síntoma que #48/#52 en otros binarios de este proyecto.
    let cliente = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    let manifiesto: Manifiesto = cliente
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
            aplicando: false,
        },
        Err(e) => EstadoActualizacion {
            version_instalada,
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some(e),
            aplicando: false,
        },
    };
    let _ = app.store.set_meta(META_ESTADO, &serde_json::to_string(&estado).unwrap_or_default());
}

/// Lectura pura de lo último cacheado — nunca hace red por su cuenta. Es lo
/// que sirve `GET /v1/admin/actualizacion`; solo el tick de fondo y
/// "comprobar ahora" llaman a `comprobar_y_cachear`.
pub fn estado_cacheado(app: &App) -> EstadoActualizacion {
    let mut estado = app
        .store
        .get_meta(META_ESTADO)
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| EstadoActualizacion {
            version_instalada: version_instalada(),
            disponible: None,
            retirada: false,
            comprobado_en: None,
            error: Some("todavía no se ha comprobado".into()),
            aplicando: false,
        });
    // Vive en una clave de `meta` separada del resto del blob (ver
    // `set_aplicando`), así que siempre se pisa aquí con el valor real en
    // vez de arrastrar lo que hubiera quedado serializado la última vez que
    // se cacheó el estado.
    estado.aplicando = aplicando_flag(app);
    estado
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
    #[error("la cola no vació a tiempo ({pendientes} análisis seguían en curso tras {minutos} min) — actualización cancelada, mantenimiento desactivado")]
    ColaAtascada { pendientes: u32, minutos: u64 },
}

/// La secuencia completa. Deliberadamente en orden: nada destructivo pasa
/// antes de que todo lo verificable esté verificado. El proceso que ejecuta
/// esto muere al final (paso 6, `systemctl restart`) — quien la llama
/// (`routes/actualizacion.rs::aplicar`) la dispara con `tokio::spawn` y no
/// espera una respuesta HTTP limpia al final, por diseño.
///
/// `version_objetivo`: `None` es el comportamiento de siempre (la más
/// nueva disponible); `Some(v)` instala esa versión concreta —
/// downgrade incluido, igual que `version_exacta` ya contempla (#71). Una
/// publicación marcada como retirada no se ofrece por ninguna de las dos
/// vías: "retirada" significa "no instalar esto", sea cual sea la
/// dirección.
pub async fn aplicar(app: &App, version_objetivo: Option<&str>) -> Result<(), AplicarError> {
    // 1. Descargar y verificar el hash. Nada se ha tocado todavía si esto falla.
    let manifiesto = consultar_manifiesto().await.map_err(AplicarError::Descarga)?;
    let version_instalada = version_instalada();
    let publicacion = match version_objetivo {
        Some(v) => manifiesto.version_exacta(Producto::Lumid, v, "linux-x86_64"),
        None => manifiesto.mas_nueva(Producto::Lumid, &version_instalada, "linux-x86_64"),
    }
    .ok_or(AplicarError::SinDisponible)?
    .clone();
    let artefacto = publicacion
        .artefactos
        .iter()
        .find(|a| a.plataforma == "linux-x86_64")
        .ok_or(AplicarError::SinDisponible)?
        .clone();

    // 120s, no 10s: aquí se descarga el binario completo de lumid, no solo
    // el manifiesto JSON — mismo criterio que el resto de este proyecto.
    let cliente_descarga = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(120))
        .build()
        .map_err(|e| AplicarError::Descarga(e.to_string()))?;
    let bytes = cliente_descarga
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
    let _ = mantenimiento::set_mensaje_sistema(app, &format!("Actualizando a {}…", publicacion.version));

    // 3. Esperar a que la cola en curso vacíe — el trabajo empezado no se
    //    cancela nunca, pero esperar SIN tope de tiempo dejaba el servidor
    //    en mantenimiento para siempre si una fila se quedaba atascada en
    //    `en_curso` (un worker colgado que nunca la mueve a un estado
    //    terminal): sin límite, sin log, sin ninguna señal de que la
    //    actualización seguía viva. Diez minutos es más que de sobra para
    //    cualquier análisis real; pasado ese tope se desactiva mantenimiento
    //    y se aborta en vez de quedarse esperando para siempre.
    const TOPE_ESPERA_COLA: std::time::Duration = std::time::Duration::from_secs(600);
    let empezado_a_esperar = std::time::Instant::now();
    loop {
        let en_curso = app.queue.foto().en_curso;
        if en_curso == 0 {
            break;
        }
        if empezado_a_esperar.elapsed() >= TOPE_ESPERA_COLA {
            // El mantenimiento se apaga aquí explícitamente y no solo en el
            // `Err` genérico de `routes/actualizacion.rs::aplicar` — ese
            // camino existe, pero duplicarlo aquí deja este módulo
            // correcto por sí solo si algún día se llama desde otro sitio.
            tracing::error!("actualización a {}: la cola no vació tras 10 min ({en_curso} en curso) — se cancela", publicacion.version);
            let _ = mantenimiento::set_activo(app, false);
            let _ = mantenimiento::set_mensaje_sistema(app, "");
            return Err(AplicarError::ColaAtascada { pendientes: en_curso, minutos: 10 });
        }
        tracing::info!("actualización a {}: esperando a que la cola vacíe ({en_curso} en curso, {}s transcurridos)",
            publicacion.version, empezado_a_esperar.elapsed().as_secs());
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
