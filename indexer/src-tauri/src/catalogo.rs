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

use crate::red::cliente_http;
use crate::store::Almacen;

/// La etiqueta con la que un repositorio se declara parte del catálogo.
pub(crate) const ETIQUETA: &str = "lumi-index";

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
    /// Qué porcentaje de las teselas del paquete declara cada fuente. Sale de
    /// `fuentes_por_quadkey`, así que puede sumar más de 100: una tesela con
    /// dos fuentes cuenta en las dos.
    pub por_fuente: Vec<lumi_index::manifest::PctFuente>,
}

/// El mismo cálculo que `lumi_index::manifest::porcentajes`, pero sobre
/// `fuentes_por_quadkey` (quadkey → fuentes) en vez de sobre imágenes: la
/// ficha no lleva ninguna imagen, así que teselas es la unidad que hay.
fn por_fuente_de(f: &Ficha) -> Vec<lumi_index::manifest::PctFuente> {
    let total = f.fuentes_por_quadkey.len() as u32;
    let mut cuenta: std::collections::BTreeMap<&str, u32> = Default::default();
    for (_, fuentes) in &f.fuentes_por_quadkey {
        for fu in fuentes {
            *cuenta.entry(fu.as_str()).or_default() += 1;
        }
    }
    cuenta
        .into_iter()
        .map(|(fuente, teselas)| lumi_index::manifest::PctFuente {
            fuente: fuente.to_string(),
            imagenes: teselas,
            imagenes_pct: if total == 0 { 0.0 } else { (teselas as f64) * 100.0 / (total as f64) },
        })
        .collect()
}

#[derive(Debug, Clone, Serialize)]
pub struct PerfilGithub {
    pub avatar_url: String,
    pub nombre: Option<String>,
    pub bio: Option<String>,
    pub seguidores: u32,
    pub url: String,
}

/// La ficha pública de GitHub de una cuenta: solo lo que hace falta para que
/// el perfil se vea como un perfil de GitHub. Anónimo, como el resto del
/// catálogo -- no hace falta estar identificado para mirar el de otro.
pub async fn perfil_github(cuenta: &str) -> Result<PerfilGithub> {
    #[derive(serde::Deserialize)]
    struct U {
        avatar_url: String,
        name: Option<String>,
        bio: Option<String>,
        followers: u32,
        html_url: String,
    }
    let u: U = cliente_http()
        .get(format!("https://api.github.com/users/{cuenta}"))
        .header("user-agent", "lumi-indexer")
        .send()
        .await?
        .json()
        .await?;
    Ok(PerfilGithub { avatar_url: u.avatar_url, nombre: u.name, bio: u.bio, seguidores: u.followers, url: u.html_url })
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
        por_fuente: por_fuente_de(f),
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
    let cliente = cliente_http();
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
    let cliente = cliente_http();
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

#[derive(Debug, Clone, Serialize)]
pub struct DependenciaRota {
    pub indice_id: i64,
    pub indice: String,
    pub paquete: String,
    pub autor: String,
    pub quadkeys: usize,
    pub dias_caida: i64,
}

/// Las dependencias de lo publicado desde aquí que han dejado de existir.
/// Sale gratis porque el refresco ya está pasando por las fichas: cruzar las
/// propias con las marcadas `viva = 0` no cuesta ni una petición más.
pub fn dependencias_rotas(almacen: &Almacen, cuenta: &str) -> Result<Vec<DependenciaRota>> {
    let todas = fichas(almacen)?;
    let muertas: std::collections::HashSet<String> = todas
        .iter()
        .filter(|(_, _, viva)| !viva)
        .map(|(f, _, _)| f.paquete.clone())
        .collect();
    let mut fuera = Vec::new();
    for (f, _, _) in todas.iter().filter(|(f, _, _)| f.autor == cuenta) {
        for d in f.dependencias.iter().filter(|d| muertas.contains(&d.paquete)) {
            fuera.push(DependenciaRota {
                // El índice local del que salió esto ya no tiene por qué
                // existir: lo que importa es el paquete publicado.
                indice_id: 0,
                indice: f.nombre.clone(),
                paquete: d.paquete.clone(),
                autor: d.autor.clone(),
                quadkeys: d.quadkeys.len(),
                dias_caida: 0,
            });
        }
    }
    Ok(fuera)
}

#[derive(Debug, Clone, Serialize)]
pub struct CapaRemota {
    pub modelo: String,
    pub version: String,
    pub dims: u32,
    pub autor: String,
    pub paquete: String,
    /// Si quien firmó la capa es también quien publicó el cuerpo. Cuando dos
    /// capas del mismo modelo pasan el muestreo, gana esta.
    pub del_autor_del_cuerpo: bool,
}

/// Todas las capas conocidas, incluidas las dos del mismo modelo firmadas por
/// personas distintas. Conviven a propósito: no se borra ninguna porque no hay
/// autoridad que pueda decidir eso.
pub fn capas(almacen: &Almacen) -> Result<Vec<CapaRemota>> {
    let todas = fichas(almacen)?;
    // Quién publicó cada cuerpo, para saber cuál de dos capas empatadas gana.
    let autor_del_cuerpo: std::collections::HashMap<String, String> = todas
        .iter()
        .filter(|(f, _, _)| !f.cuerpos.is_empty())
        .map(|(f, _, _)| (f.paquete.clone(), f.autor.clone()))
        .collect();
    let mut fuera = Vec::new();
    for (f, _, viva) in &todas {
        if !viva {
            continue;
        }
        // Una ficha de capa suelta apunta a su cuerpo por dependencia.
        let cuerpo = f
            .dependencias
            .first()
            .map(|d| d.paquete.clone())
            .unwrap_or_else(|| f.paquete.clone());
        for c in &f.capas {
            fuera.push(CapaRemota {
                modelo: c.modelo.clone(),
                version: c.version.clone(),
                dims: c.dims,
                autor: c.autor.clone(),
                paquete: f.paquete.clone(),
                del_autor_del_cuerpo: autor_del_cuerpo.get(&cuerpo) == Some(&c.autor),
            });
        }
    }
    Ok(fuera)
}

pub async fn refrescar_desreclamos(almacen: &Almacen) -> Result<()> {
    let Ok(r) = reqwest::get(URL_DESRECLAMOS).await else { return Ok(()) };
    let lista: Vec<(String, String)> = r.json().await.unwrap_or_default();
    // Firmada por Lumi: una lista sin firma valida no quita nada a nadie.
    almacen.desreclamos_fijar(&lista)
}
