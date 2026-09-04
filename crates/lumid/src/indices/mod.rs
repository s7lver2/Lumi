//! Instalar un índice del catálogo. Mismo patrón reanudable que descargar y
//! publicar en el Indexer, porque es el mismo problema: gigabytes por una red
//! que se corta.

pub mod paquete;
pub mod volcar;

use anyhow::{anyhow, Result};
use lumi_index::ficha::Ficha;
use serde::Serialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub paquete: String,
    pub asset: String,
    pub hechos: usize,
    pub total: usize,
    /// Bytes ya bajados del asset EN CURSO (no acumulado entre assets: se
    /// reinicia a 0 cuando empieza el siguiente). `hechos`/`total` solo se
    /// mueve al terminar un asset entero — para un paquete con un único
    /// cuerpo grande (el caso más fácil de confundir con "se ha colgado"),
    /// eso deja el progreso clavado en 0% durante toda la descarga. Estos
    /// dos campos son lo que permite que la barra se mueva de verdad
    /// mientras ese asset se descarga.
    pub asset_bytes_hechos: u64,
    pub asset_bytes_total: u64,
    pub registro: Vec<String>,
    pub terminado: bool,
    pub error: Option<String>,
    /// Las zonas que este índice daba por cubiertas y que nadie cubre porque
    /// su paquete ya no existe. No se esconden: son respuestas que no van a
    /// llegar nunca.
    pub rotas: Vec<String>,
}

/// Un solo hueco: no tiene sentido instalar dos índices a la vez contra el
/// mismo disco y la misma red, y un hueco único hace que el progreso sea
/// trivial de servir.
pub type EnCurso = Arc<Mutex<Option<Progreso>>>;

async fn traer_ficha(http: &reqwest::Client, url: &str) -> Result<Ficha> {
    let f: Ficha = http.get(url).send().await?.error_for_status()?.json().await?;
    // La firma se comprueba SIEMPRE, en la raíz y en cada dependencia. No hay
    // «instalar igualmente»: ese diálogo es la puerta de entrada.
    f.comprobar().map_err(|e| anyhow!("firma invalida en {}: {e}", f.paquete))?;
    Ok(f)
}

pub async fn instalar(app: crate::App, url: String) -> Result<()> {
    // Sin User-Agent, `reqwest::Client::new()` no manda ninguno — a
    // diferencia de curl, que siempre se identifica como `curl/x.x.x`. Un
    // CDN de asset binarios (el de GitHub Releases incluido) puede tratar
    // eso como sospechoso y no cortar la conexión con un error, sino
    // arrastrar la respuesta a un goteo o dejarla de mandar bytes sin
    // cerrar nada: exactamente "se queda atascado y no vuelve", reproducido
    // en el mismo asset con curl completando en segundos y lumid colgado
    // media hora.
    // `pool_max_idle_per_host(0)`: esta instalación hace varias peticiones
    // pequeñas (cada ficha.json) antes de la descarga grande del cuerpo, y
    // todas comparten este mismo cliente. Si una conexión pooled y
    // reutilizada arrastra algún estado interno raro de una petición
    // anterior a la siguiente, es terreno fértil para el tipo de "tarea
    // que deja de sondearse" cazado con tokio-console — cada petición
    // fuerza una conexión nueva en vez de arriesgarse a heredar una.
    let http = reqwest::Client::builder()
        .user_agent(concat!("lumid/", env!("CARGO_PKG_VERSION")))
        .pool_max_idle_per_host(0)
        .build()?;
    let raiz_ficha = traer_ficha(&http, &url).await?;

    // De qué URL salió cada ficha, para poder derivar la de sus assets (misma
    // carpeta del release). La ficha no lleva su propia URL dentro de sí
    // misma —solo la de sus DEPENDENCIAS, en `Dependencia::url`— así que hay
    // que recordarla aparte según se va descubriendo el grafo.
    let mut urls: HashMap<String, String> = HashMap::new();
    urls.insert(raiz_ficha.paquete.clone(), url.clone());

    // Las dependencias se traen antes de resolver, igual que en
    // `routes::catalogo`: `resolver` es lógica pura y no puede esperar a la red.
    let mut conocidas: HashMap<String, Ficha> = HashMap::new();
    let mut por_ver: Vec<String> = raiz_ficha.dependencias.iter().map(|d| d.url.clone()).collect();
    for d in &raiz_ficha.dependencias {
        urls.insert(d.paquete.clone(), d.url.clone());
    }
    while let Some(u) = por_ver.pop() {
        let Ok(f) = traer_ficha(&http, &u).await else { continue };
        if conocidas.contains_key(&f.paquete) {
            continue;
        }
        for d in &f.dependencias {
            urls.entry(d.paquete.clone()).or_insert_with(|| d.url.clone());
            por_ver.push(d.url.clone());
        }
        conocidas.insert(f.paquete.clone(), f);
    }
    let grafo = lumi_index::grafo::resolver(&raiz_ficha, &|p| conocidas.get(p).cloned());

    // De las hojas hacia la raíz: si se corta a la mitad, lo que queda
    // instalado son dependencias completas y no una raíz que apunta al vacío.
    let mut nodos = grafo.nodos.clone();
    nodos.sort_by_key(|n| std::cmp::Reverse(n.profundidad));

    let ficha_de = |paquete: &str| -> Option<Ficha> {
        if paquete == raiz_ficha.paquete { Some(raiz_ficha.clone()) } else { conocidas.get(paquete).cloned() }
    };

    // El total cuenta ASSETS a lo largo de todo el grafo, no paquetes: con "un
    // paquete = un peldaño" un paquete sin dependencias (el caso más común)
    // se queda en 0% durante TODA su instalación y salta a 100% de golpe al
    // terminar — que es justo lo que parece "se ha quedado colgado".
    let total: usize = nodos
        .iter()
        .filter(|n| !n.roto)
        .map(|n| ficha_de(&n.paquete).map(|f| assets_de(&f)).unwrap_or(0))
        .sum();

    {
        let mut g = app.indices_en_curso.lock().unwrap();
        *g = Some(Progreso {
            paquete: raiz_ficha.paquete.clone(),
            total: total.max(1),
            rotas: grafo.rotas.clone(),
            ..Default::default()
        });
    }

    for nodo in nodos {
        if nodo.roto {
            anotar(&app, format!("{} no está disponible, se instala sin esa zona", nodo.paquete));
            continue;
        }
        let Some(ficha) = ficha_de(&nodo.paquete) else { continue };
        if ya_instalado(&app, &ficha.paquete) {
            anotar(&app, format!("{} ya estaba instalado", ficha.paquete));
            avanzar(&app, assets_de(&ficha));
            continue;
        }
        let ficha_url = urls.get(&ficha.paquete).cloned().unwrap_or_default();
        instalar_uno(&app, &http, &ficha, &ficha_url).await?;
    }

    if let Some(p) = app.indices_en_curso.lock().unwrap().as_mut() {
        p.terminado = true;
    }
    Ok(())
}

/// Los nombres de asset que este paquete ya tiene en disco, de una
/// instalación anterior cortada a mitad. Vacío si el paquete es nuevo.
fn hechos_de(app: &crate::App, paquete: &str) -> std::collections::HashSet<String> {
    app.store
        .conn()
        .query_row("SELECT hechos FROM installed_indices WHERE paquete = ?1", [paquete], |r| {
            r.get::<_, String>(0)
        })
        .unwrap_or_default()
        .lines()
        .map(str::to_string)
        .collect()
}

/// Anota un asset como ya volcado. Se escribe INMEDIATAMENTE después de
/// abrirlo, no al final del paquete: es justo lo que permite que matar el
/// daemon a mitad de una instalación no repita descarga ni descifrado de lo
/// que ya está en disco.
///
/// El orden de estas dos líneas es el arreglo de un cuelgue real, no estilo:
/// antes se tomaba el guard de `conn()` ARRIBA y solo después se llamaba a
/// `hechos_de`, que pide `conn()` otra vez. `Store::conn()` devuelve un
/// `MutexGuard` de un `std::sync::Mutex` pelado, que no es reentrante: el
/// hilo se quedaba esperando un mutex que él mismo tenía cogido, para
/// siempre. Con `worker_threads = 2`, el segundo hilo caía en cuanto
/// cualquier petición pedía la base —el propio cliente sondeando el progreso
/// de la instalación bastaba— y el daemon entero dejaba de responder, con la
/// CPU a cero y todos los hilos en `FUTEX_WAIT`. Se manifestaba como "la
/// instalación se congela a mitad" a porcentajes distintos cada vez, porque
/// lo que dispara esto no es la descarga sino el primer asset que TERMINA.
/// `hechos_de` toma y suelta el mutex antes de que se vuelva a pedir.
fn marcar_hecho(app: &crate::App, paquete: &str, asset: &str) -> Result<()> {
    let mut hechos = hechos_de(app, paquete);
    if !hechos.insert(asset.to_string()) {
        return Ok(());
    }
    app.store.conn().execute(
        "UPDATE installed_indices SET hechos = ?2 WHERE paquete = ?1",
        rusqlite::params![paquete, hechos.into_iter().collect::<Vec<_>>().join("\n")],
    )?;
    Ok(())
}

/// La carpeta del release donde vive `ficha.json`, con el nombre del asset
/// pegado al final: los assets de un paquete viven junto a su ficha.
fn url_de(ficha_url: &str, asset: &str) -> String {
    match ficha_url.rfind('/') {
        Some(i) => format!("{}/{asset}", &ficha_url[..i]),
        None => asset.to_string(),
    }
}

fn ya_instalado(app: &crate::App, paquete: &str) -> bool {
    app.store
        .conn()
        .query_row(
            "SELECT completo FROM installed_indices WHERE paquete = ?1",
            [paquete],
            |r| r.get::<_, i64>(0),
        )
        .map(|v| v == 1)
        .unwrap_or(false)
}

fn anotar(app: &crate::App, linea: String) {
    tracing::info!("indices: {linea}");
    if let Some(p) = app.indices_en_curso.lock().unwrap().as_mut() {
        p.registro.push(linea);
    }
}

fn avanzar(app: &crate::App, n: usize) {
    if let Some(p) = app.indices_en_curso.lock().unwrap().as_mut() {
        p.hechos += n;
        // El asset que acaba de contarse en `hechos` sigue con sus bytes a
        // tope (la descarga termina con `asset_bytes_hechos == _total` antes
        // de llegar aquí) y el siguiente asset del bucle es quien los pone a
        // cero — para el ÚLTIMO asset del paquete no hay "siguiente" que los
        // reinicie. El cliente suma la fracción de bytes del asset en curso
        // a `hechos` para que la barra avance dentro de un asset grande
        // (`fraccionAssetActual` en IndexToast/InstallFlow); sin este reset,
        // ese mismo asset contaba doble — una vez como unidad entera en
        // `hechos`, otra vez como fracción completa — y el paquete de dos
        // assets terminaba mostrando 150% en vez de 100%.
        p.asset_bytes_hechos = 0;
        p.asset_bytes_total = 0;
    }
}

/// Cuántos assets tiene un paquete: cuerpos más los de cada capa. Es la
/// unidad real de progreso — ver `total` en `instalar()`.
fn assets_de(ficha: &Ficha) -> usize {
    ficha.cuerpos.len() + ficha.capas.iter().map(|c| c.assets.len()).sum::<usize>()
}

/// Envuelve `paquete::traer_y_abrir` en su propia tarea de tokio y la
/// vigila desde FUERA, en vez de confiar en un timeout que corre dentro de
/// la misma tarea que se quiere vigilar.
///
/// Diagnosticado en vivo con tokio-console y un latido de 2s aparte: el
/// runtime seguia sano (el latido nunca dejo de sonar) y `ss -i` mostraba
/// el asset entero YA recibido por el kernel (`bytes_received` igual al
/// tamaño del fichero, `lastrcv` de minutos atras) mientras el progreso
/// del cliente seguia clavado — los datos habian llegado, pero la tarea
/// que los consume dejo de ser sondeada por el scheduler (un despertar
/// perdido). Un timeout de inactividad DENTRO de esa misma tarea nunca
/// dispara en ese caso: si la tarea entera no vuelve a sondearse, tampoco
/// se sondea su propio timeout. Por eso esto vive en una tarea aparte:
/// si la de descarga se pierde, esta sigue funcionando (es un `select!`
/// distinto, con su propio despertar via `tokio::time::sleep`) y puede
/// abortar la perdida y devolver un error real en vez de colgar para
/// siempre.
async fn bajar_con_vigilante(
    http: &reqwest::Client,
    url: &str,
    sha256_esperado: &str,
    clave: &[u8; 32],
    destino: &std::path::Path,
    progreso: &EnCurso,
) -> Result<()> {
    let http = http.clone();
    let url = url.to_string();
    let sha256_esperado = sha256_esperado.to_string();
    let clave = *clave;
    let destino = destino.to_path_buf();
    let progreso_tarea = progreso.clone();
    let mut tarea = tokio::spawn(async move {
        paquete::traer_y_abrir(&http, &url, &sha256_esperado, &clave, &destino, &progreso_tarea).await
    });

    // Generoso a propósito: un asset legítimo pero lento sigue avanzando
    // bytes de sobra dentro de este margen. Lo que esto caza es la
    // ausencia TOTAL de avance, no la lentitud.
    const SIN_AVANCE_MAX: Duration = Duration::from_secs(90);
    let mut vistos: u64 = 0;
    let mut desde_ultimo_avance = Instant::now();
    loop {
        tokio::select! {
            resultado = &mut tarea => {
                return match resultado {
                    Ok(r) => r,
                    Err(e) => Err(anyhow!("la tarea de descarga murió sin avisar: {e}")),
                };
            }
            _ = tokio::time::sleep(Duration::from_secs(2)) => {
                let (actuales, total) = progreso
                    .lock()
                    .unwrap()
                    .as_ref()
                    .map(|p| (p.asset_bytes_hechos, p.asset_bytes_total))
                    .unwrap_or((0, 0));
                // Con todos los bytes ya recibidos, la tarea pasa a descifrar
                // (AES sobre el asset entero) y a descomprimir: dos fases que
                // no mueven ni un byte de este contador y que en un disco
                // lento tardan de sobra más que `SIN_AVANCE_MAX`. Vigilar ahí
                // sería abortar instalaciones sanas, así que el vigilante se
                // retira y se limita a esperar el resultado.
                if total > 0 && actuales >= total {
                    return match (&mut tarea).await {
                        Ok(r) => r,
                        Err(e) => Err(anyhow!("la tarea de descarga murió sin avisar: {e}")),
                    };
                }
                if actuales != vistos {
                    vistos = actuales;
                    desde_ultimo_avance = Instant::now();
                } else if desde_ultimo_avance.elapsed() > SIN_AVANCE_MAX {
                    tarea.abort();
                    return Err(anyhow!(
                        "la descarga dejó de avanzar más de {}s a los {actuales} bytes — \
                         la tarea se perdió (no es un fallo de red), se aborta para poder reintentar",
                        SIN_AVANCE_MAX.as_secs()
                    ));
                }
            }
        }
    }
}

async fn instalar_uno(app: &crate::App, http: &reqwest::Client, ficha: &Ficha, ficha_url: &str) -> Result<()> {
    let clave = paquete::clave_de(&ficha.cifrado)?;
    let raiz = app.dir.join("indices").join(&ficha.paquete);
    let assets: Vec<_> = ficha.cuerpos.iter().chain(ficha.capas.iter().flat_map(|c| &c.assets)).collect();

    // Fila de reserva ANTES de bajar nada: es donde `hechos` va a ir anotando
    // qué asset ha caído. `completo` nace en 0, y solo pasa a 1 al terminar.
    app.store.conn().execute(
        "INSERT OR IGNORE INTO installed_indices
           (paquete, nombre, autor, url, ficha_sha256, modelo, version, teselas, bytes, hechos, completo, installed_at)
         VALUES (?1,?2,?3,?4,'', ?5, ?6, 0, 0, '', 0, ?7)",
        rusqlite::params![
            &ficha.paquete,
            &ficha.nombre,
            &ficha.autor,
            ficha_url,
            ficha.capas.first().map(|c| c.modelo.clone()).unwrap_or_default(),
            ficha.capas.first().map(|c| c.version.clone()).unwrap_or_default(),
            crate::routes::access::now(),
        ],
    )?;

    // Todas las capas, no solo la primera: es lo que permite que
    // `recuperar` sepa qué niveles puede correr contra este índice.
    for capa in &ficha.capas {
        app.store.conn().execute(
            "INSERT OR IGNORE INTO installed_index_layers (paquete, modelo, version, dims)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![&ficha.paquete, &capa.modelo, &capa.version, capa.dims],
        )?;
    }

    let ya_hechos = hechos_de(app, &ficha.paquete);
    for a in assets {
        if ya_hechos.contains(&a.nombre) {
            anotar(app, format!("{} ya estaba en disco", a.nombre));
            avanzar(app, 1);
            continue;
        }
        anotar(app, format!("bajando {}", a.nombre));
        if let Some(p) = app.indices_en_curso.lock().unwrap().as_mut() {
            p.asset = a.nombre.clone();
            p.asset_bytes_hechos = 0;
            p.asset_bytes_total = 0;
        }
        bajar_con_vigilante(http, &url_de(ficha_url, &a.nombre), &a.sha256, &clave, &raiz, &app.indices_en_curso).await?;
        marcar_hecho(app, &ficha.paquete, &a.nombre)?;
        avanzar(app, 1);
    }

    let cuantas = volcar::paquete(app, ficha, &raiz).await?;
    app.store.conn().execute(
        "UPDATE installed_indices SET teselas = ?2, bytes = ?3, completo = 1 WHERE paquete = ?1",
        rusqlite::params![
            &ficha.paquete,
            ficha.fuentes_por_quadkey.len() as i64,
            ficha.cuerpos.iter().map(|a| a.bytes).sum::<u64>() as i64,
        ],
    )?;
    anotar(app, format!("{} · {cuantas} imágenes de referencia", ficha.paquete));
    Ok(())
}
