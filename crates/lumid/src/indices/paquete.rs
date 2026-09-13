//! Un asset publicado: bajar, comprobar, descifrar y desplegar.
//!
//! El orden importa. El SHA-256 se comprueba ANTES de descifrar y de abrir el
//! zip: descomprimir algo que no es lo que dijo la ficha es darle de comer al
//! parseador bytes de un desconocido.

use anyhow::{anyhow, Result};
use base64::{engine::general_purpose::STANDARD, Engine};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Techo de bytes descomprimidos por paquete. Sin esto, un zip de unos pocos
/// KB con una ratio de compresión absurda podía llenar el disco entero antes
/// de que nada se diera cuenta — el sha256 solo comprueba el CIFRADO, nunca
/// dice nada sobre cuánto pesa lo de dentro. 50 GiB es generoso para un
/// índice geo-referenciado real y sigue parando una bomba de verdad.
const MAX_DESCOMPRIMIDO: u64 = 50 * 1024 * 1024 * 1024;

/// La clave AES viaja en la ficha, en base64. Eso es deliberado: el cifrado es
/// ofuscación frente al alojamiento, no control de acceso.
pub fn clave_de(cifrado: &str) -> Result<[u8; 32]> {
    let bytes = STANDARD.decode(cifrado)?;
    bytes.try_into().map_err(|_| anyhow!("la clave del paquete no mide 32 bytes"))
}

/// Sin tope: si la conexión se queda muda a mitad de transferencia (un
/// salto de red, un proxy que suelta la conexión en silencio, un borde
/// de CDN que deja de mandar bytes sin cerrar nada), `flujo.next()` se
/// queda esperando para siempre — nada en `reqwest::Client::new()` pone
/// un límite. Eso es justo "se queda atascado en este punto y no
/// vuelve": la tarea nunca falla, así que tampoco hay error que ver ni
/// forma de que la instalación se recupere sola. Cada `next()` va
/// envuelto en un timeout de inactividad: si no llega NADA en este
/// margen, se corta con un error claro en vez de colgar para siempre.
/// Es un timeout de inactividad, no de duración total — una descarga de
/// 1.65GB legítima pero lenta sigue completando mientras sigan llegando
/// bytes, por lentos que sean.
const TIMEOUT_INACTIVIDAD: std::time::Duration = std::time::Duration::from_secs(45);

/// Baja una URL ANEXÁNDOLA a un fichero ya abierto, comprobando su sha256.
///
/// El asset se escribe a disco EN STREAMING, no se junta entero en RAM
/// con `.bytes()`: un cuerpo puede pesar hasta 1.8 GB (tope real de la
/// publicación, ver spec de `.lumidx`), y ese `.bytes()` original vivía
/// en memoria a la vez que, más abajo, el texto claro ya descifrado —
/// dos gigabytes largos, simultáneos, sin ninguna necesidad, en una
/// máquina que puede no sobrarle ese margen. Fue justo eso lo que dejó el
/// sistema colgado y tumbó el daemon a mitad de una descarga real. El
/// buffer aquí es del tamaño de un trozo de red, no del tamaño del asset.
///
/// `bytes_ya_contados` es el offset desde el que seguir sumando en
/// `asset_bytes_hechos`: reunir un cuerpo partido en tres ficheros tiene
/// que mover la barra de forma continua, no reiniciarla en cada frontera.
/// Devuelve el acumulado total (`bytes_ya_contados` + lo recibido aquí).
///
/// No borra nada al fallar: quien abrió el fichero es quien sabe su ruta y
/// quien limpia.
async fn bajar_anexando(
    http: &reqwest::Client,
    url: &str,
    sha256_esperado: &str,
    fichero: &mut tokio::fs::File,
    progreso: &crate::indices::EnCurso,
    bytes_ya_contados: u64,
    fijar_total: bool,
) -> Result<u64> {
    use futures::StreamExt;
    use tokio::io::AsyncWriteExt;

    let respuesta = http.get(url).send().await?.error_for_status()?;
    // Solo el camino de un fichero único deduce el total de la respuesta; el
    // multi-parte ya lo sabe por la ficha (la suma de todas las partes) y
    // pisarlo con el de la parte en curso dejaría la barra saltando.
    if fijar_total {
        if let Some(p) = progreso.lock().unwrap().as_mut() {
            p.asset_bytes_total = respuesta.content_length().unwrap_or(0);
        }
    }

    let mut hasher = Sha256::new();
    let mut recibidos: u64 = 0;
    let mut flujo = respuesta.bytes_stream();
    loop {
        let siguiente = match tokio::time::timeout(TIMEOUT_INACTIVIDAD, flujo.next()).await {
            Ok(v) => v,
            Err(_) => {
                return Err(anyhow!(
                    "la descarga se quedó sin recibir datos más de {}s a los {recibidos} bytes — \
                     conexión colgada, no un fallo declarado",
                    TIMEOUT_INACTIVIDAD.as_secs()
                ));
            }
        };
        let Some(trozo) = siguiente else { break };
        let trozo = trozo.map_err(|e| anyhow!("se cortó la descarga: {e}"))?;
        hasher.update(&trozo);
        fichero.write_all(&trozo).await?;
        recibidos += trozo.len() as u64;
        if let Some(p) = progreso.lock().unwrap().as_mut() {
            p.asset_bytes_hechos = bytes_ya_contados + recibidos;
        }
    }

    let visto = format!("{:x}", hasher.finalize());
    if visto != sha256_esperado {
        return Err(anyhow!("el asset no coincide con su sha256: dice {sha256_esperado}, es {visto}"));
    }
    Ok(bytes_ya_contados + recibidos)
}

pub async fn traer_y_abrir(
    http: &reqwest::Client,
    url: &str,
    sha256_esperado: &str,
    clave: &[u8; 32],
    destino: &Path,
    progreso: &crate::indices::EnCurso,
) -> Result<()> {
    std::fs::create_dir_all(destino)?;
    let temporal = destino.join(format!(".{sha256_esperado}.parcial"));

    let bajada = async {
        let mut fichero = tokio::fs::File::create(&temporal).await?;
        bajar_anexando(http, url, sha256_esperado, &mut fichero, progreso, 0, true).await
    }
    .await;
    if let Err(e) = bajada {
        let _ = std::fs::remove_file(&temporal);
        return Err(e);
    }

    descifrar_y_desplegar(&temporal, clave, destino).await
}

/// Reúne un cuerpo publicado en varios ficheros físicos y lo abre.
///
/// Las partes se bajan EN ORDEN y se anexan a un mismo fichero temporal —
/// reensamblar un `.001/.002` de toda la vida—, verificando el sha256 de
/// CADA PARTE por separado contra el suyo: así un fallo a mitad señala qué
/// parte falló, no el blob entero. A partir de ahí, la cola es exactamente
/// la misma que la de un asset de una sola pieza.
///
/// Si el proceso muere a mitad, al reiniciar se vuelve a empezar desde la
/// primera parte — igual que hoy pasa con un asset de una pieza que se
/// corta a mitad. No es una regresión: es el mismo comportamiento.
pub async fn traer_y_abrir_multiparte(
    http: &reqwest::Client,
    ficha_url: &str,
    asset: &lumi_index::ficha::Asset,
    clave: &[u8; 32],
    destino: &Path,
    progreso: &crate::indices::EnCurso,
) -> Result<()> {
    std::fs::create_dir_all(destino)?;
    let temporal = destino.join(format!(".{}.parcial", asset.sha256));

    let bytes_total: u64 = asset.partes.iter().map(|p| p.bytes).sum();
    if let Some(p) = progreso.lock().unwrap().as_mut() {
        p.asset_bytes_total = bytes_total;
        p.asset_bytes_hechos = 0;
    }

    let reunion = async {
        let mut fichero = tokio::fs::File::create(&temporal).await?;
        let mut acumulado = 0u64;
        for (i, parte) in asset.partes.iter().enumerate() {
            let url = crate::indices::url_de(ficha_url, &parte.nombre);
            acumulado =
                bajar_anexando(http, &url, &parte.sha256, &mut fichero, progreso, acumulado, false)
                    .await
                    .map_err(|e| {
                        anyhow!("bajando {} ({}/{}): {e}", parte.nombre, i + 1, asset.partes.len())
                    })?;
        }
        Ok::<(), anyhow::Error>(())
    }
    .await;
    if let Err(e) = reunion {
        let _ = std::fs::remove_file(&temporal);
        return Err(e);
    }

    descifrar_y_desplegar(&temporal, clave, destino).await
}

/// La cola común: el blob cifrado ya reunido en `temporal` se lee, se
/// descifra y se despliega. Idéntica para un asset de una pieza y para uno
/// reensamblado de varias — desde aquí abajo no hay diferencia ninguna.
async fn descifrar_y_desplegar(temporal: &Path, clave: &[u8; 32], destino: &Path) -> Result<()> {
    // El descifrado (AES-256-GCM, un solo golpe) sigue exigiendo el asset
    // sellado entero en memoria — la biblioteca no ofrece una variante en
    // streaming y cambiarlo tocaría el formato de cifrado que ya comparten
    // el Indexer (que firma) y este mismo lector, así que queda fuera de
    // este arreglo. `sellado` se libera en cuanto `descifrar` devuelve
    // `claro`, así que el pico de aquí en adelante es de un solo asset, no
    // de dos a la vez como antes.
    let sellado = tokio::fs::read(&temporal).await?;
    let _ = tokio::fs::remove_file(&temporal).await;
    let claro = lumi_index::cifrado::descifrar(&sellado, clave)?;
    drop(sellado);
    let destino = destino.to_path_buf();

    // Descomprimir gigabytes es CPU pura: en el hilo async bloquearía el
    // worker de tokio entero y con él las peticiones que no tienen nada que
    // ver. Misma lección que costó el "colgado" al publicar en el 8.
    tokio::task::spawn_blocking(move || -> Result<()> {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(claro))?;

        // Se suma el tamaño DESCOMPRIMIDO que el propio zip declara para cada
        // entrada antes de escribir ni un byte — un vistazo a las cabeceras,
        // no a los datos. Una bomba de descompresión (unos pocos KB que se
        // convierten en gigabytes) se corta aquí, no a mitad de escribir en
        // disco.
        let total: u64 = (0..z.len())
            .map(|i| z.by_index(i).map(|f| f.size()).unwrap_or(0))
            .sum();
        if total > MAX_DESCOMPRIMIDO {
            return Err(anyhow!(
                "el paquete descomprime a {total} bytes, por encima del tope de {MAX_DESCOMPRIMIDO}"
            ));
        }

        std::fs::create_dir_all(&destino)?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            let Some(rel) = f.enclosed_name() else {
                // Un nombre que se escapa del directorio (`../`) no se abre.
                // `enclosed_name` es justo la comprobación que lo impide.
                continue;
            };
            let salida = destino.join(rel);
            if f.is_dir() {
                std::fs::create_dir_all(&salida)?;
                continue;
            }
            if let Some(p) = salida.parent() {
                std::fs::create_dir_all(p)?;
            }
            let mut w = std::fs::File::create(&salida)?;
            std::io::copy(&mut f, &mut w)?;
        }
        Ok(())
    })
    .await??;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// Un zip mínimo pero real: es lo que `descifrar_y_desplegar` espera
    /// encontrar dentro del blob una vez descifrado.
    fn zip_de_prueba(contenido: &[u8]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        z.start_file::<_, ()>("filas/03133320022212.jsonl", zip::write::SimpleFileOptions::default())
            .unwrap();
        z.write_all(contenido).unwrap();
        z.finish().unwrap().into_inner()
    }

    /// Bytes que el zip NO puede comprimir: si el contenido se comprimiera
    /// a unos pocos cientos de bytes, el blob cifrado nunca daría para
    /// varias partes y el test no probaría nada.
    fn incompresible(n: usize) -> Vec<u8> {
        let mut x: u32 = 0x9e3779b9;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 17;
                x ^= x << 5;
                (x >> 11) as u8
            })
            .collect()
    }

    fn carpeta(nombre: &str) -> std::path::PathBuf {
        let d = std::env::temp_dir().join(format!(
            "lumid-multiparte-{nombre}-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    /// Lo que hace `traer_y_abrir_multiparte` una vez las partes están en
    /// disco: pegarlas EN ORDEN en un solo fichero. Aquí sin red, que es lo
    /// único que no se puede probar en un test unitario.
    fn reunir(partes: &[&[u8]], en: &std::path::Path) {
        let mut f = std::fs::File::create(en).unwrap();
        for p in partes {
            f.write_all(p).unwrap();
        }
    }

    /// El camino completo del lado que instala, menos la red: un cuerpo
    /// cifrado que se partió al publicarse se reensambla, se descifra y se
    /// despliega igual que si nunca se hubiera partido.
    #[tokio::test]
    async fn un_cuerpo_partido_se_reensambla_descifra_y_despliega() {
        let clave = [3u8; 32];
        let dentro = incompresible(20_000);
        let sellado = lumi_index::cifrado::cifrar(&zip_de_prueba(&dentro), &clave, [1u8; 12]).unwrap();
        assert!(sellado.len() > 3_000, "hace falta que dé para varias partes");

        let partes = lumi_index::troceado::partir_en_trozos(&sellado, 1_000);
        assert!(partes.len() >= 3, "el fixture tiene que partirse de verdad");

        let destino = carpeta("ok");
        let temporal = destino.join(".prueba.parcial");
        reunir(&partes, &temporal);

        descifrar_y_desplegar(&temporal, &clave, &destino).await.unwrap();

        let salida = std::fs::read(destino.join("filas/03133320022212.jsonl")).unwrap();
        assert_eq!(salida, dentro);
        assert!(!temporal.exists(), "el parcial se borra al abrirlo");
        let _ = std::fs::remove_dir_all(&destino);
    }

    /// Y si las partes se pegan en el orden equivocado, AES-GCM lo rechaza:
    /// no hay forma de desplegar medio índice silenciosamente mal pegado.
    /// Es la razón por la que `partes` es una lista ORDENADA y cada parte
    /// lleva además su propio sha256.
    #[tokio::test]
    async fn pegar_las_partes_al_reves_no_descifra() {
        let clave = [3u8; 32];
        let sellado =
            lumi_index::cifrado::cifrar(&zip_de_prueba(&incompresible(20_000)), &clave, [1u8; 12]).unwrap();
        let mut partes = lumi_index::troceado::partir_en_trozos(&sellado, 1_000);
        partes.reverse();

        let destino = carpeta("alreves");
        let temporal = destino.join(".prueba.parcial");
        reunir(&partes, &temporal);

        assert!(descifrar_y_desplegar(&temporal, &clave, &destino).await.is_err());
        let _ = std::fs::remove_dir_all(&destino);
    }

    /// El caso normal no cambia: un cuerpo que cabía en un asset da UNA sola
    /// parte, y reensamblar esa parte única es el mismo fichero de siempre.
    #[tokio::test]
    async fn un_cuerpo_que_cabe_sigue_abriendose_igual() {
        let clave = [3u8; 32];
        let dentro = b"una sola pieza".to_vec();
        let sellado = lumi_index::cifrado::cifrar(&zip_de_prueba(&dentro), &clave, [1u8; 12]).unwrap();
        let partes = lumi_index::troceado::partir_en_trozos(&sellado, 2 * 1024 * 1024 * 1024);
        assert_eq!(partes.len(), 1);

        let destino = carpeta("entera");
        let temporal = destino.join(".prueba.parcial");
        reunir(&partes, &temporal);

        descifrar_y_desplegar(&temporal, &clave, &destino).await.unwrap();
        assert_eq!(std::fs::read(destino.join("filas/03133320022212.jsonl")).unwrap(), dentro);
        let _ = std::fs::remove_dir_all(&destino);
    }
}
