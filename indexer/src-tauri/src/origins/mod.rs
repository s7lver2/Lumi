//! Los orígenes de red, detrás de un solo contrato.
//!
//! `Falso` no es andamio de pruebas que sobra: es lo que permite probar el
//! planificador, la reanudación y el presupuesto SIN salir a internet ni gastar
//! cuota. Una prueba que necesita red y clave no se corre en cada commit.

pub mod calles;
pub mod commons;
pub mod flickr;
pub mod geograph;
pub mod google;
pub mod inaturalist;
pub mod kartaview;
pub mod mapbox;
pub mod mapillary;
pub mod monumentos;
pub mod openaerialmap;
pub mod panoramax;
pub mod wikipedia;
pub mod wms_orto;

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use async_trait::async_trait;
use lumi_index::budget::Presupuesto;
use lumi_index::manifest::Tipo;
use lumi_index::network::{Captura, Disponibilidad, Redistribucion, Tarifa};
use tokio::sync::Semaphore;

use crate::keys::Claves;

/// Cuánto espera un adaptador antes de darse por vencido con una petición.
pub const TIMEOUT: Duration = Duration::from_secs(30);

/// El `User-Agent` de TODOS los adaptadores. **La URL de contacto no es
/// decoración**: la política de Wikimedia exige que el agente identifique al
/// responsable y dé una forma de contactarlo, y desde 2025 la hacen cumplir
/// devolviendo `429 Too Many Requests` de forma casi inmediata a cualquier
/// cliente que no la traiga.
///
/// Medido el 2026-09-11 desde la misma IP y en el mismo segundo:
/// `LumiIndexer/0.1.0` → 429 en `es.wikipedia.org` y en
/// `commons.wikimedia.org`; con esta cadena → 200 en los dos. Ese 429 era todo
/// lo que hacía falta para que Wikipedia reportara 0 y para que Commons y
/// Wikidata→Commons se pintaran en ámbar.
///
/// Se usa la URL del proyecto, NO el correo del operador: esto viaja en una
/// cabecera a servidores de terceros en cada petición, y la política de
/// Wikimedia acepta una URL como contacto igual que un correo.
pub const AGENTE: &str = concat!(
    "LumiIndexer/",
    env!("CARGO_PKG_VERSION"),
    " (https://lumi.s7lver.xyz)"
);

/// Un limitador COMPARTIDO por todo lo que habla con Wikimedia, no el de cada
/// adaptador. `commons`, `wikipedia` y `monumentos` (que además pega a
/// `query.wikidata.org`) llevaban un `Ctx::limitador` propio de 2 req/s cada
/// uno: combinados, hasta 6 req/s contra la misma infraestructura donada, que
/// solo tolera pedir despacio.
///
/// Es exactamente el mismo problema que `calles::limitador_overpass` ya
/// resolvió para Google y KartaView, y con el mismo síntoma: un sondeo entero
/// saliendo en ámbar porque el proveedor rechaza la mayoría de las peticiones.
pub fn limitador_wikimedia() -> &'static Limitador {
    static L: std::sync::OnceLock<Limitador> = std::sync::OnceLock::new();
    L.get_or_init(|| Limitador::nuevo(1, 1))
}

#[async_trait]
pub trait OrigenDeRed: Send + Sync {
    fn id(&self) -> &'static str;
    fn tipo(&self) -> Tipo;
    fn tarifa(&self) -> Tarifa;
    fn redistribucion(&self) -> Redistribucion;

    /// Si el sondeo de este origen se puede pintar como puntos exactos. Solo
    /// Mapillary: es el único con teselas vectoriales públicas y estables, y
    /// esa asimetría llega hasta la leyenda del mapa.
    fn puntos_exactos(&self) -> bool {
        false
    }

    /// Qué hay aquí, sin bajar un píxel.
    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad>;

    /// Baja lo que haya contra un presupuesto que NO puede sobrepasar. Si el
    /// presupuesto se agota a mitad, devuelve lo que llevara: es trabajo bueno
    /// y ya pagado.
    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>>;

    /// Cuántas imágenes lleva bajadas este origen desde que arrancó, para que
    /// el planificador pueda decir algo cierto mientras una tesela tarda.
    ///
    /// Una tesela densa pasa la mayor parte de su tiempo AQUÍ, bajando fotos
    /// de una en una contra el limitador — no resolviendo la consulta. Sin
    /// este contador, el aviso periódico solo podía decir "sigue trabajando",
    /// que se lee igual que "está colgado". `0` por defecto: un origen sin
    /// `Ctx` (el falso de las pruebas) no tiene nada que contar.
    fn bajadas(&self) -> u32 {
        0
    }

    /// Cuántas fotos trae la tesela que está bajando ahora mismo, si ya se
    /// sabe. Algunos orígenes (Mapillary) resuelven la lista entera ANTES de
    /// bajar la primera foto, así que el total se sabe desde el principio —
    /// solo hace falta enseñarlo. `0` es "todavía no se sabe" (o el origen no
    /// lo rastrea, como los que descubren fotos punto a punto sobre la marcha).
    fn objetivo(&self) -> u32 {
        0
    }
}

/// Peticiones por segundo y peticiones a la vez. Los dos hacen falta: el
/// semáforo evita abrir cincuenta conexiones y el intervalo evita que las dos
/// permitidas salgan disparadas mil veces por segundo.
pub struct Limitador {
    permisos: Semaphore,
    intervalo: Duration,
    ultima: tokio::sync::Mutex<Option<tokio::time::Instant>>,
}

impl Limitador {
    pub fn nuevo(req_s: u32, concurrencia: usize) -> Self {
        Self {
            permisos: Semaphore::new(concurrencia),
            intervalo: Duration::from_micros(1_000_000 / req_s.max(1) as u64),
            ultima: tokio::sync::Mutex::new(None),
        }
    }

    /// El permiso se suelta al soltar lo devuelto. Un `429` cuesta más tiempo
    /// que la petición que se habría ahorrado yendo deprisa, así que estos
    /// números son conservadores a propósito.
    pub async fn permiso(&self) -> tokio::sync::SemaphorePermit<'_> {
        let p = self.permisos.acquire().await.expect("el semáforo no se cierra");
        let mut u = self.ultima.lock().await;
        if let Some(t) = *u {
            let pasado = t.elapsed();
            if pasado < self.intervalo {
                tokio::time::sleep(self.intervalo - pasado).await;
            }
        }
        *u = Some(tokio::time::Instant::now());
        p
    }
}

/// Sustituye todo lo que `lumi_index::legacy::nombre_seguro` no acepta y deja
/// un nombre que no puede salir de su directorio.
///
/// Se SUSTITUYE en vez de rechazar porque el identificador viene del proveedor
/// y un carácter raro no debería costar la imagen; lo que no se negocia es que
/// el resultado no pueda escapar. La comprobación final es la misma función que
/// el 7a usa para los paquetes legacy, así que las dos puertas coinciden.
pub fn sanear(nombre: &str) -> String {
    let limpio: String = nombre
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.') { c } else { '_' })
        .collect();
    // `..` sigue siendo posible con puntos legítimos ("a..b.jpg"), y
    // `nombre_seguro` lo rechaza con razón: se colapsan.
    let limpio = limpio.replace("..", "._");
    if lumi_index::legacy::nombre_seguro(&limpio) {
        limpio
    } else {
        // Última red: un nombre vacío o imposible se sustituye por su hash.
        format!("{:x}.jpg", <sha2::Sha256 as sha2::Digest>::digest(nombre.as_bytes()))
    }
}

/// Centro y radio (en km) que cubren una tesela CON margen. La usan los
/// orígenes que consultan por punto+radio en vez de por bbox — Wikidata
/// (`monumentos.rs`) y Geograph (`geograph.rs`) — para no duplicar la misma
/// cuenta dos veces.
///
/// Aproximación plana, igual que `lumi_index::tiles::area_km2`: a la escala
/// de una tesela z14 el error frente a una fórmula geodésica exacta es
/// insignificante.
pub fn centro_y_radio_km(b: lumi_index::tiles::Bbox) -> (f64, f64, f64) {
    let lat = (b.norte + b.sur) / 2.0;
    let lng = (b.oeste + b.este) / 2.0;
    let ancho_km = (b.este - b.oeste) * 111.320 * lat.to_radians().cos();
    let alto_km = (b.norte - b.sur) * 110.574;
    let radio = (ancho_km.powi(2) + alto_km.powi(2)).sqrt() / 2.0;
    // 20% de margen: un punto justo en el borde de la tesela no debe
    // perderse por un radio calculado al milímetro.
    (lat, lng, (radio * 1.2).max(0.05))
}

/// Lado largo de la miniatura que se escribe junto a cada imagen bajada.
/// `thumbnail` mantiene la proporción, así que es un tope, no un tamaño.
pub const LADO_MINIATURA: u32 = 512;

/// La miniatura de una imagen vive junto a ella, con `-mini` antes de la
/// extensión: `mly-123.jpg` → `mly-123-mini.jpg`. Determinista a propósito, sin
/// columna nueva en la base de datos — pero quien la necesita la pide por aquí
/// y no reconstruye el nombre a mano, y menos en otro lenguaje.
pub fn ruta_miniatura(ruta: &std::path::Path) -> PathBuf {
    let ext = ruta.extension().and_then(|e| e.to_str()).unwrap_or("jpg");
    let base = ruta.file_stem().and_then(|e| e.to_str()).unwrap_or("imagen");
    ruta.with_file_name(format!("{base}-mini.{ext}"))
}

/// Lo que todo adaptador necesita: un cliente HTTP, su clave si la tiene, y el
/// directorio de paso donde deja lo que baje.
pub struct Ctx {
    pub cliente: reqwest::Client,
    pub clave: Option<String>,
    pub stage: PathBuf,
    pub limitador: Limitador,
    /// Limitador SOLO para bajar bytes del CDN, separado del de consultas a la
    /// API. Sin él, bajar una foto de `scontent.xx.fbcdn.net` se cobraba contra
    /// la cuota de `graph.mapillary.com`, que es el techo de verdad de una
    /// descarga: casi todo el tiempo son bytes, no consultas.
    ///
    /// `None` cuando el proveedor no tiene CDN separado de su API. Wikimedia es
    /// EL caso: `upload.wikimedia.org` cae bajo la misma política de contacto y
    /// ritmo que `commons.wikimedia.org`, así que ahí bajar bytes se sigue
    /// cobrando contra el mismo limitador, a propósito.
    pub limitador_bytes: Option<Limitador>,
    /// Contador vivo de imágenes bajadas, para `OrigenDeRed::bajadas`. Es lo
    /// único observable desde fuera mientras una tesela larga está en marcha.
    bajadas: std::sync::atomic::AtomicU32,
    /// El total de la tesela en curso, para `OrigenDeRed::objetivo`. Se pisa
    /// entero al empezar cada tesela — no es acumulado como `bajadas`.
    objetivo: std::sync::atomic::AtomicU32,
}

impl Ctx {
    pub fn nuevo(clave: Option<String>, stage: PathBuf, req_s: u32, conc: usize) -> Self {
        Self::con_bytes(clave, stage, req_s, conc, None)
    }

    /// Igual que `nuevo`, pero declarando la cola de bytes del proveedor —
    /// `(req_s, concurrencia)` del CDN, que es distinta de la de su API.
    pub fn con_bytes(
        clave: Option<String>,
        stage: PathBuf,
        req_s: u32,
        conc: usize,
        bytes: Option<(u32, usize)>,
    ) -> Self {
        Self {
            cliente: reqwest::Client::builder()
                .timeout(TIMEOUT)
                .user_agent(AGENTE)
                .build()
                .expect("el cliente HTTP se construye con la configuración por defecto"),
            clave,
            stage,
            limitador: Limitador::nuevo(req_s, conc),
            limitador_bytes: bytes.map(|(r, c)| Limitador::nuevo(r, c)),
            bajadas: std::sync::atomic::AtomicU32::new(0),
            objetivo: std::sync::atomic::AtomicU32::new(0),
        }
    }

    pub fn fijar_objetivo(&self, n: u32) {
        self.objetivo.store(n, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn objetivo(&self) -> u32 {
        self.objetivo.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Contra qué limitador se cobra bajar bytes: el del CDN si el proveedor
    /// declaró uno, y si no el mismo de la API.
    pub fn limitador_de_bytes(&self) -> &Limitador {
        self.limitador_bytes.as_ref().unwrap_or(&self.limitador)
    }

    pub fn bajadas(&self) -> u32 {
        self.bajadas.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// Baja unos bytes y los deja en el directorio de paso. Comprueba que
    /// DECODIFICA como imagen antes de devolver la ruta: la extensión no basta
    /// ni con material propio.
    ///
    /// EL NOMBRE SE SANEA SIEMPRE. Los adaptadores lo componen con el
    /// identificador que da el proveedor (`mly-{id}.jpg`), y ese identificador
    /// viene de fuera: un `id` con `../` escaparía del directorio de paso y
    /// escribiría donde quisiera. En la v1 esto mismo era escritura de fichero
    /// arbitraria, y `nombre_seguro` existe desde el 7a justamente por eso.
    pub async fn bajar_imagen(&self, url: &str, nombre: &str) -> Result<PathBuf> {
        let nombre = sanear(nombre);
        let _p = self.limitador_de_bytes().permiso().await;
        let r = self.cliente.get(url).send().await?;
        if !r.status().is_success() {
            anyhow::bail!("{} respondió {}", crate::keys::redactar(url), r.status());
        }
        let bytes = r.bytes().await?;
        let ruta = self.stage.join(&nombre);
        // Escribir a disco y decodificar son trabajo bloqueante, y hacerlo
        // dentro de un `async fn` atasca el runtime de Tokio entero — que es
        // por donde Tauri enruta TODO el IPC, así que la interfaz se congela
        // mientras se baja. Mismo fallo que `sellar()` tuvo hasta `d81bfc2`.
        // El error de decodificación se devuelve como un booleano y el mensaje
        // se compone fuera, para no mover `url` al hilo bloqueante.
        let stage = self.stage.clone();
        let destino = ruta.clone();
        let decodifica = tokio::task::spawn_blocking(move || -> Result<bool> {
            std::fs::create_dir_all(&stage)?;
            std::fs::write(&destino, &bytes)?;
            // Decodificar entera en vez de leer solo la cabecera: la pasada
            // sirve a la vez para validar que es una imagen de verdad y para
            // escribir la miniatura, que es lo que la rejilla de revisión
            // necesita. Las fotos reales van de 228 KB de mediana a 13 MB, y
            // un JPEG de 4000×3000 son ~48 MB de mapa de bits en el WebView.
            let Ok(img) = image::open(&destino) else {
                let _ = std::fs::remove_file(&destino);
                return Ok(false);
            };
            // Si la miniatura falla, la imagen sigue valiendo: la revisión cae
            // al original, igual que con todo lo bajado antes de este cambio.
            let _ = img.thumbnail(LADO_MINIATURA, LADO_MINIATURA).save(ruta_miniatura(&destino));
            Ok(true)
        })
        .await??;
        if !decodifica {
            anyhow::bail!("lo que devolvió {} no decodifica como imagen", crate::keys::redactar(url));
        }
        // Se cuenta lo que de verdad quedó en disco y decodifica, igual que el
        // gasto cuenta lo servido: un 404 o unos bytes corruptos no son avance.
        self.bajadas.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        Ok(ruta)
    }
}

/// Todos los orígenes con clave configurada. **Uno sin clave no entra en la
/// lista**: mejor ausente que presente y reventando cuando el gasto ya está
/// confirmado.
pub fn registro(claves: &Claves, stage: PathBuf) -> Vec<Box<dyn OrigenDeRed>> {
    let mut v: Vec<Box<dyn OrigenDeRed>> = Vec::new();
    if let Ok(Some(k)) = claves.leer("mapillary") {
        v.push(Box::new(mapillary::Mapillary::nuevo(k, stage.clone())));
    }
    // KartaView no necesita clave: entra siempre.
    v.push(Box::new(kartaview::KartaView::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("google") {
        v.push(Box::new(google::Google::nuevo(k, stage.clone())));
    }
    if let Ok(Some(k)) = claves.leer("mapbox-satelite") {
        v.push(Box::new(mapbox::MapboxSatelite::nuevo(k, stage.clone())));
    }
    // Commons tampoco necesita clave.
    v.push(Box::new(commons::Commons::nuevo(stage.clone())));
    v.push(Box::new(wikipedia::Wikipedia::nuevo(stage.clone())));
    // Ni monumentos (Wikidata → Commons) ni Panoramax: entran siempre.
    v.push(Box::new(monumentos::Monumentos::nuevo(stage.clone())));
    v.push(Box::new(panoramax::Panoramax::nuevo(stage.clone())));
    v.push(Box::new(inaturalist::INaturalist::nuevo(stage.clone())));
    v.push(Box::new(geograph::Geograph::nuevo(stage.clone())));
    v.push(Box::new(openaerialmap::OpenAerialMap::nuevo(stage.clone())));
    if let Ok(Some(k)) = claves.leer("flickr") {
        v.push(Box::new(flickr::Flickr::nuevo(k, stage.clone())));
    }
    // Sin clave: la tabla de servicios decide la cobertura real, no una
    // credencial. Ausente = degradado a "no hay" en cualquier tesela.
    v.push(Box::new(wms_orto::WmsOrto::nuevo(stage)));
    v
}

// ── El origen falso ──────────────────────────────────────────────────────

/// Un origen guionizado. Existe para probar el planificador entero sin red.
///
/// Solo lo usan los `#[cfg(test)]` de este módulo, `probe.rs` y `download.rs`:
/// bajo una build normal (no test) no hay ninguna llamada de producción, y
/// clippy lo marca como muerto. Es exactamente lo que se pretende — no es
/// código de producción disfrazado.
#[allow(dead_code)]
pub struct Falso {
    id: &'static str,
    tipo: Tipo,
    tarifa: Tarifa,
    guion: std::collections::HashMap<String, u32>,
}

#[allow(dead_code)]
impl Falso {
    pub fn nuevo(id: &'static str, tipo: Tipo, tarifa: Tarifa) -> Self {
        Self { id, tipo, tarifa, guion: Default::default() }
    }
    pub fn con(mut self, tesela: &str, cuantas: u32) -> Self {
        self.guion.insert(tesela.to_string(), cuantas);
        self
    }
}

#[async_trait]
impl OrigenDeRed for Falso {
    fn id(&self) -> &'static str {
        self.id
    }
    fn tipo(&self) -> Tipo {
        self.tipo
    }
    fn tarifa(&self) -> Tarifa {
        self.tarifa
    }
    fn redistribucion(&self) -> Redistribucion {
        Redistribucion::Libre { licencia: "CC BY-SA 4.0".into() }
    }

    async fn sondear(&self, tesela: &str) -> Result<Disponibilidad> {
        let n = self.guion.get(tesela).copied().unwrap_or(0);
        Ok(Disponibilidad::Muestreo { nivel: lumi_index::network::Nivel::de(n), estimadas: n })
    }

    async fn descargar(&self, tesela: &str, tope: &Presupuesto) -> Result<Vec<Captura>> {
        let n = self.guion.get(tesela).copied().unwrap_or(0);
        // El centro de LA TESELA PEDIDA, no una constante fija: `un_origen`
        // recorta cualquier captura cuya coordenada real caiga fuera de la
        // tesela que se pidió (ver `download.rs`), así que un origen falso
        // que siempre devolviera el mismo punto solo podría servir de verdad
        // a UNA tesela — cualquier prueba con una segunda tesela vería sus
        // capturas descartadas en silencio por ese mismo recorte, sin que el
        // guion (`con(...)`) tuviera ninguna culpa.
        let b = lumi_index::tiles::bbox_de_tesela(tesela);
        let (lat, lng) = ((b.norte + b.sur) / 2.0, (b.oeste + b.este) / 2.0);
        let mut fuera = Vec::new();
        for i in 0..n {
            // Se apunta ANTES de "servir": si no cabe, se para y se devuelve lo
            // que llevara. Media petición no existe.
            if tope.gastar(&self.tarifa, 1).is_err() {
                break;
            }
            fuera.push(Captura {
                fuente: self.id,
                id_origen: format!("{tesela}-{i}"),
                ruta: PathBuf::from(format!("/dev/null/{tesela}-{i}.jpg")),
                lat,
                lng,
                rumbo: Some(0.0),
                capturada_en: None,
                atribucion: lumi_index::coverage::Atribucion {
                    autor: self.id.to_string(),
                    url: format!("https://example.org/{tesela}/{i}"),
                    licencia: "CC BY-SA 4.0".into(),
                },
                unidades: 1,
            });
        }
        Ok(fuera)
    }
}

/// `Arc` para poder compartir un origen entre las tareas concurrentes del
/// planificador sin clonarlo.
pub type Origen = Arc<dyn OrigenDeRed>;

#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::budget::Presupuesto;

    #[tokio::test]
    async fn el_origen_falso_responde_lo_guionizado_y_respeta_el_presupuesto() {
        let f = Falso::nuevo("falso", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
            .con("AAA", 148)
            .con("BBB", 0);

        assert_eq!(f.sondear("AAA").await.unwrap().unidades(), 148);
        assert!(!f.sondear("BBB").await.unwrap().hay());
        assert!(!f.sondear("CCC").await.unwrap().hay(), "lo no guionizado no existe");

        // 148 imágenes a 7 $/1000 · 0,93 son 0,963 €: con 10 € caben.
        let p = Presupuesto::nuevo(10.0);
        let caps = f.descargar("AAA", &p).await.unwrap();
        assert_eq!(caps.len(), 148);
        assert!(caps.iter().all(|c| c.atribucion.autor == "falso"));
        assert!((p.gastado_eur() - 0.963_48).abs() < 1e-4, "{}", p.gastado_eur());

        // Con saldo justo, se para a mitad y devuelve lo que llevaba: eso es
        // trabajo bueno y ya pagado, no se tira.
        let p = Presupuesto::nuevo(0.10);
        let caps = f.descargar("AAA", &p).await.unwrap();
        assert!(caps.len() < 148 && !caps.is_empty(), "bajó {} de 148", caps.len());
        assert!(p.restante_eur() < 0.01);
    }

    #[tokio::test]
    async fn el_limitador_no_deja_pasar_mas_de_su_concurrencia() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        use std::sync::Arc;

        let l = Arc::new(Limitador::nuevo(1000, 2));
        let vivos = Arc::new(AtomicUsize::new(0));
        let pico = Arc::new(AtomicUsize::new(0));

        let mut tareas = Vec::new();
        for _ in 0..12 {
            let (l, vivos, pico) = (l.clone(), vivos.clone(), pico.clone());
            tareas.push(tokio::spawn(async move {
                let _p = l.permiso().await;
                let n = vivos.fetch_add(1, Ordering::SeqCst) + 1;
                pico.fetch_max(n, Ordering::SeqCst);
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                vivos.fetch_sub(1, Ordering::SeqCst);
            }));
        }
        for t in tareas {
            t.await.unwrap();
        }
        assert!(pico.load(Ordering::SeqCst) <= 2, "pico de {}", pico.load(Ordering::SeqCst));
    }

    /// Bajar bytes se cobra contra la cola del CDN cuando el proveedor declara
    /// una, y contra la de la API cuando no — que es el caso de Wikimedia, a
    /// propósito: `upload.wikimedia.org` cae bajo la misma política.
    #[tokio::test]
    async fn la_cola_de_bytes_es_la_del_cdn_solo_si_el_origen_la_declara() {
        use std::time::Instant;

        // Sin declararla, `bajar_imagen` cobra contra el limitador de la API.
        let api = Ctx::nuevo(None, PathBuf::from("."), 4, 2);
        assert!(api.limitador_bytes.is_none());
        assert!(
            std::ptr::eq(api.limitador_de_bytes(), &api.limitador),
            "sin CDN declarado se usa el mismo limitador de la API"
        );

        // Declarándola, se usa la del CDN. Se comprueba por el ritmo: la de la
        // API es de 1 req/s (un segundo entre permisos) y la de bytes de 1000,
        // así que dos permisos seguidos tienen que salir casi al instante.
        let cdn = Ctx::con_bytes(None, PathBuf::from("."), 1, 1, Some((1000, 4)));
        assert!(!std::ptr::eq(cdn.limitador_de_bytes(), &cdn.limitador));
        let t0 = Instant::now();
        {
            let _a = cdn.limitador_de_bytes().permiso().await;
        }
        let _b = cdn.limitador_de_bytes().permiso().await;
        assert!(t0.elapsed().as_millis() < 500, "tardó {} ms", t0.elapsed().as_millis());
    }

    #[test]
    fn el_nombre_que_da_el_proveedor_no_puede_salir_del_directorio() {
        // En la v1 esto mismo era escritura de fichero arbitraria. El `id` de
        // una foto viene de fuera y se mete tal cual en el nombre.
        assert!(!sanear("../../.ssh/authorized_keys").contains('/'));
        assert!(!sanear("../../evil").contains(".."));
        assert!(!sanear("a/b/c.jpg").contains('/'));
        assert!(!sanear("x\\y.jpg").contains('\\'));
        // Y lo normal se conserva legible, que es la mitad de para qué sirve
        // un nombre de fichero.
        assert_eq!(sanear("mly-1234567890.jpg"), "mly-1234567890.jpg");
        assert_eq!(sanear("goo-CAoSLEFG-90.jpg"), "goo-CAoSLEFG-90.jpg");
        // Un nombre imposible cae al hash en vez de quedarse vacío.
        assert!(sanear("").ends_with(".jpg"));
    }
}
