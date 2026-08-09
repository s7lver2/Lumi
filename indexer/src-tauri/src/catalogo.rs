//! Qué hay ahí fuera.
//!
//! No hay servidor de descubrimiento: se recorren los repositorios con la
//! etiqueta `lumi-index` y se leen sus fichas, que viajan en claro y pesan
//! kilobytes. Con eso se resuelven el buscador, el mapa de cobertura y el
//! reclamo sin descargar un solo gigabyte.
//!
//! Un repositorio privado no necesita ninguna comprobación: su ficha no se
//! puede leer, así que nunca entra en `fichas_remotas` y por tanto no reclama
//! nada. Es consecuencia del diseño, no un olvido.

use anyhow::Result;
use lumi_index::ficha::Ficha;
use serde::Serialize;

use crate::store::Almacen;

/// La etiqueta con la que un repositorio se declara parte del catálogo.
const ETIQUETA: &str = "lumi-index";

/// La web puede QUITAR reclamos, nunca anadirlos. Esa asimetria es lo que
/// impide que el producto dependa de un servicio: si esto no responde, se usa
/// la ultima lista conocida y todo lo demas sigue funcionando.
const URL_DESRECLAMOS: &str = "http://localhost:8788/desreclamos.json";

#[derive(Debug, Clone, Serialize)]
pub struct Reclamo {
    pub quadkey: String,
    pub fuente: String,
    pub paquete: String,
    pub autor: String,
    pub url: String,
    pub sha256: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FichaResumen {
    pub paquete: String,
    pub nombre: String,
    pub autor: String,
    pub url: String,
    pub teselas: usize,
    pub viva: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Resultados {
    pub indices: Vec<FichaResumen>,
    pub cuentas: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Perfil {
    pub cuenta: String,
    pub publicaciones: Vec<FichaResumen>,
    pub teselas: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct RepoRemoto {
    pub repo: String,
    pub paquetes: Vec<FichaResumen>,
}

fn resumen(f: &Ficha, url: &str, viva: bool) -> FichaResumen {
    FichaResumen {
        paquete: f.paquete.clone(),
        nombre: f.nombre.clone(),
        autor: f.autor.clone(),
        url: url.to_string(),
        teselas: f.fuentes_por_quadkey.len(),
        viva,
    }
}

fn fichas(almacen: &Almacen) -> Result<Vec<(Ficha, String, bool)>> {
    Ok(almacen
        .fichas_remotas()?
        .into_iter()
        .filter_map(|(_, _, url, json, viva)| {
            serde_json::from_str::<Ficha>(&json).ok().map(|f| (f, url, viva))
        })
        .collect())
}

/// Recorre los repositorios con la etiqueta, se trae solo las fichas y guarda
/// las que llevan firma válida. Nunca al mover el mapa: al abrir Territorio,
/// al abrir Índices, y a petición.
pub async fn refrescar(almacen: &Almacen) -> Result<u32> {
    #[derive(serde::Deserialize)]
    struct Busqueda {
        items: Vec<Repo>,
    }
    #[derive(serde::Deserialize)]
    struct Repo {
        full_name: String,
    }
    let cliente = reqwest::Client::new();
    let r: Busqueda = cliente
        .get(format!("https://api.github.com/search/repositories?q=topic:{ETIQUETA}&per_page=100"))
        .header("user-agent", "lumi-indexer")
        .send()
        .await?
        .json()
        .await?;

    let mut guardadas = 0;
    for repo in r.items {
        for (url, json) in fichas_de_repo(&cliente, &repo.full_name).await {
            let Ok(f) = serde_json::from_str::<Ficha>(&json) else { continue };
            // La firma se comprueba SIEMPRE. Una ficha sin firma válida no
            // entra: sin esto, cualquiera podría reclamar el territorio de
            // otro con solo copiar su nombre.
            if f.comprobar().is_err() {
                log::warn!("ficha descartada por firma inválida: {}", f.paquete);
                continue;
            }
            almacen.ficha_remota_guardar(&f.paquete, &f.autor, &url, &json)?;
            guardadas += 1;
        }
    }
    // Las caducadas no se borran —son la única copia que queda de "esto
    // existió"— pero sí se anotan: es lo que explica en el registro por qué
    // un territorio que parecía cubierto ayer hoy vuelve a costar dinero.
    for p in caducadas(almacen)? {
        log::info!("ficha caducada, ya no reclama: {p}");
    }
    rehacer_cobertura(almacen)?;
    Ok(guardadas)
}

/// Las `ficha.json` de los releases de un repositorio. Un repositorio sin
/// releases, privado o borrado simplemente no aporta nada.
async fn fichas_de_repo(cliente: &reqwest::Client, repo: &str) -> Vec<(String, String)> {
    #[derive(serde::Deserialize)]
    struct Release {
        assets: Vec<AssetRemoto>,
    }
    #[derive(serde::Deserialize)]
    struct AssetRemoto {
        name: String,
        browser_download_url: String,
    }
    let Ok(r) = cliente
        .get(format!("https://api.github.com/repos/{repo}/releases?per_page=100"))
        .header("user-agent", "lumi-indexer")
        .send()
        .await
    else {
        return Vec::new();
    };
    let Ok(releases) = r.json::<Vec<Release>>().await else { return Vec::new() };
    let mut fuera = Vec::new();
    for rel in releases {
        for a in rel.assets.into_iter().filter(|a| a.name == "ficha.json") {
            if let Ok(j) = cliente.get(&a.browser_download_url).send().await {
                if let Ok(t) = j.text().await {
                    fuera.push((a.browser_download_url, t));
                }
            }
        }
    }
    fuera
}

/// Una petición de cabecera por asset. Un 404 marca la ficha como muerta, y
/// con ello el reclamo se cae y las teselas vuelven a `nueva`. Cubre
/// repositorio borrado, pasado a privado o asset retirado, sin que nadie tenga
/// que enterarse ni avisar.
pub async fn comprobar_vivos(almacen: &Almacen) -> Result<Vec<String>> {
    let cliente = reqwest::Client::new();
    let mut caidas = Vec::new();
    for (f, url, _) in fichas(almacen)? {
        let Ok(r) = cliente.head(&url).header("user-agent", "lumi-indexer").send().await else {
            continue; // Un fallo de red no es una baja: no se castiga a nadie por eso.
        };
        if r.status() == reqwest::StatusCode::NOT_FOUND {
            almacen.ficha_remota_marcar_muerta(&f.paquete)?;
            caidas.push(f.paquete);
        }
    }
    rehacer_cobertura(almacen)?;
    Ok(caidas)
}

/// Las fichas cuya vigencia ya pasó. Dejan de reclamar sin que nadie las
/// borre: es lo que impide que un reclamo abandonado bloquee territorio para
/// siempre.
pub fn caducadas(almacen: &Almacen) -> Result<Vec<String>> {
    let ahora: i64 = crate::chrono_ahora().parse().unwrap_or(0);
    Ok(fichas(almacen)?
        .into_iter()
        .filter(|(f, _, _)| f.vigente_hasta.parse::<i64>().map(|v| v < ahora).unwrap_or(false))
        .map(|(f, _, _)| f.paquete)
        .collect())
}

/// Reconstruye la caché de cobertura a partir de las fichas. Las caducadas no
/// entran, igual que las muertas.
fn rehacer_cobertura(almacen: &Almacen) -> Result<()> {
    let ahora: i64 = crate::chrono_ahora().parse().unwrap_or(0);
    let mut filas = Vec::new();
    for (f, _, viva) in fichas(almacen)? {
        if !viva || f.vigente_hasta.parse::<i64>().map(|v| v < ahora).unwrap_or(false) {
            continue;
        }
        for (qk, fuentes) in &f.fuentes_por_quadkey {
            for fu in fuentes {
                filas.push((qk.clone(), fu.clone(), f.paquete.clone()));
            }
        }
    }
    almacen.cobertura_remota_rehacer(&filas)
}

pub fn reclamos(almacen: &Almacen, quadkeys: &[String]) -> Result<Vec<Reclamo>> {
    // El sha256 sale de la ficha: es el del cuerpo que cubre esa tesela, y es
    // lo que hará comprobable la dependencia cuando se declare.
    let por_paquete: std::collections::HashMap<String, String> = fichas(almacen)?
        .into_iter()
        .map(|(f, _, _)| {
            (f.paquete.clone(), f.cuerpos.first().map(|c| c.sha256.clone()).unwrap_or_default())
        })
        .collect();
    Ok(almacen
        .reclamos_de(quadkeys)?
        .into_iter()
        .map(|(quadkey, fuente, paquete, autor, url)| Reclamo {
            sha256: por_paquete.get(&paquete).cloned().unwrap_or_default(),
            quadkey,
            fuente,
            paquete,
            autor,
            url,
        })
        .collect())
}

pub fn buscar(almacen: &Almacen, texto: &str) -> Result<Resultados> {
    let t = texto.to_lowercase();
    let mut indices = Vec::new();
    let mut cuentas: Vec<String> = Vec::new();
    for (f, url, viva) in fichas(almacen)? {
        if f.nombre.to_lowercase().contains(&t) || f.paquete.to_lowercase().contains(&t) {
            indices.push(resumen(&f, &url, viva));
        }
        if f.autor.to_lowercase().contains(&t) && !cuentas.contains(&f.autor) {
            cuentas.push(f.autor.clone());
        }
    }
    Ok(Resultados { indices, cuentas })
}

pub fn perfil(almacen: &Almacen, cuenta: &str) -> Result<Perfil> {
    let publicaciones: Vec<FichaResumen> = fichas(almacen)?
        .into_iter()
        .filter(|(f, _, _)| f.autor == cuenta)
        .map(|(f, url, viva)| resumen(&f, &url, viva))
        .collect();
    Ok(Perfil {
        teselas: publicaciones.iter().map(|p| p.teselas).sum(),
        cuenta: cuenta.to_string(),
        publicaciones,
    })
}

/// Lo publicado por la cuenta conectada, agrupado por repositorio: la URL de
/// descarga lleva dentro `owner/repo`, y agrupar por ahí es lo que hace que la
/// pantalla se parezca a lo que el operador ve en GitHub.
pub fn mios(almacen: &Almacen, cuenta: &str) -> Result<Vec<RepoRemoto>> {
    let mut por_repo: std::collections::BTreeMap<String, Vec<FichaResumen>> = Default::default();
    for (f, url, viva) in fichas(almacen)? {
        if f.autor != cuenta {
            continue;
        }
        let repo = url
            .split("/download/")
            .next()
            .and_then(|u| u.strip_prefix("https://github.com/"))
            .map(|u| u.trim_end_matches("/releases").to_string())
            .unwrap_or_else(|| "sin repositorio".into());
        por_repo.entry(repo).or_default().push(resumen(&f, &url, viva));
    }
    Ok(por_repo.into_iter().map(|(repo, paquetes)| RepoRemoto { repo, paquetes }).collect())
}

pub async fn refrescar_desreclamos(almacen: &Almacen) -> Result<()> {
    let Ok(r) = reqwest::get(URL_DESRECLAMOS).await else { return Ok(()) };
    let lista: Vec<(String, String)> = r.json().await.unwrap_or_default();
    // Firmada por Lumi: una lista sin firma valida no quita nada a nadie.
    almacen.desreclamos_fijar(&lista)
}
