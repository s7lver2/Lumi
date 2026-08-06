//! La cola de lotes y el trabajador que los resuelve.
//!
//! REDIS ES EL TIMBRE Y EL ESTADO CALIENTE; SQLITE ES LA VERDAD. En Redis van
//! la lista de lotes pendientes y el progreso que la interfaz pinta; el estado
//! por imagen está en SQLite. Si Redis se vacía se pierde la barra y nada más:
//! la cola se reconstruye leyendo qué imágenes siguen sin vector.
//!
//! Dos clases de fallo, y no se tratan igual:
//!   - «esta imagen no se puede embeber» es un RESULTADO. Se anota el motivo,
//!     se salta y se sigue. No se reintenta: reintentarla solo quema GPU.
//!   - que el PROCESO se muera es una AVERÍA. El lote vuelve a la cola una vez,
//!     con un contador que impide el bucle infinito.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::{Arc, Mutex};

use anyhow::{bail, Result};
use lumi_index::embed::{Lote, MsgEmbed};
use serde::Serialize;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};

use crate::qdrant::{coleccion_de, Cliente};
use crate::runtime::python_del_venv;
use crate::services::Log;
use crate::store::Almacen;

/// Imágenes por lote enviado al trabajador. 32 es lo que cabía holgadamente en
/// una GPU de 8 GB con lumi-2 en las pruebas de la v1.
const POR_LOTE: u32 = 32;
/// Reintentos de un lote cuyo proceso murió. Uno: si muere dos veces, el
/// problema no es de suerte.
const REINTENTOS_MAX: u32 = 1;

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub trabajando: bool,
    pub pausada: bool,
    pub lote_actual: Option<i64>,
    pub hechas: u32,
    pub total: u32,
    pub dispositivo: String,
    pub modelo: Option<String>,
    pub saltadas: u32,
    pub reinicios: u32,
}

pub struct Cola {
    dir: PathBuf,
    almacen: Arc<Almacen>,
    log: Arc<Log>,
    progreso: Arc<Mutex<Progreso>>,
    pausada: Arc<Mutex<bool>>,
}

struct Trabajador {
    hijo: Child,
    entrada: ChildStdin,
    salida: tokio::sync::mpsc::Receiver<MsgEmbed>,
}

/// Arranca el trabajador y deja sus dos tuberías separadas: `stdout` es el
/// contrato, `stderr` es el log. `-u` es obligatorio: sin él Python no suelta
/// una línea hasta que el proceso muere, y «cargando pesos» y «colgado» se ven
/// exactamente igual.
async fn arrancar(dir: &std::path::Path, log: Arc<Log>, dispositivo: &str) -> Result<Trabajador> {
    let py = python_del_venv(dir);
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../workers/lumi_embed.py");
    if !script.exists() {
        bail!("no encuentro el trabajador en {}", script.display());
    }
    let mut hijo = Command::new(&py)
        .arg("-u")
        .arg(&script)
        .env("LUMI_DEVICE", dispositivo)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;

    let entrada = hijo.stdin.take().expect("stdin pedido");
    let stdout = hijo.stdout.take().expect("stdout pedido");
    let stderr = hijo.stderr.take().expect("stderr pedido");

    let (tx, rx) = tokio::sync::mpsc::channel(64);
    tokio::spawn(async move {
        let mut lineas = BufReader::new(stdout).lines();
        while let Ok(Some(l)) = lineas.next_line().await {
            match serde_json::from_str::<MsgEmbed>(&l) {
                // Una línea ilegible se registra y se sigue: un `print` de
                // depuración perdido en el motor no puede tumbar la cola.
                Err(e) => log::warn!("línea ilegible del trabajador ({e}): {}", &l[..l.len().min(160)]),
                Ok(m) => {
                    if let Err(e) = m.validar() {
                        log::warn!("mensaje descartado, {e}");
                        continue;
                    }
                    if tx.send(m).await.is_err() {
                        break;
                    }
                }
            }
        }
    });
    tokio::spawn(async move {
        let mut l = BufReader::new(stderr).lines();
        while let Ok(Some(x)) = l.next_line().await {
            log.apuntar(format!("trabajador: {x}"));
        }
    });

    Ok(Trabajador { hijo, entrada, salida: rx })
}

impl Cola {
    pub fn nueva(dir: PathBuf, almacen: Arc<Almacen>, log: Arc<Log>) -> Arc<Self> {
        Arc::new(Self {
            dir,
            almacen,
            log,
            progreso: Arc::new(Mutex::new(Progreso::default())),
            pausada: Arc::new(Mutex::new(false)),
        })
    }

    pub fn progreso(&self) -> Progreso {
        self.progreso.lock().unwrap().clone()
    }

    /// Pausar termina el lote en curso y no coge el siguiente. Nunca mata
    /// trabajo que ya está corriendo: es la misma regla del subsistema 4.
    pub fn pausar(&self, si: bool) {
        *self.pausada.lock().unwrap() = si;
        self.progreso.lock().unwrap().pausada = si;
    }

    /// Bucle principal. Se lanza una vez al arrancar la app.
    pub fn arrancar_bucle(self: Arc<Self>, modelo: String, dims: u32, version: String) {
        tokio::spawn(async move {
            let qdrant = Cliente::nuevo();
            let coleccion = coleccion_de(&modelo, &version);
            if let Err(e) = qdrant.asegurar_coleccion(&coleccion, dims).await {
                self.log.apuntar(format!("cola: no se pudo preparar Qdrant: {e}"));
                return;
            }
            let mut trabajador: Option<Trabajador> = None;

            loop {
                if *self.pausada.lock().unwrap() {
                    tokio::time::sleep(std::time::Duration::from_millis(600)).await;
                    continue;
                }
                // La verdad está en SQLite: se pregunta a ella, no a Redis.
                let Ok(lotes) = self.almacen.lotes_sin_terminar() else {
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };
                let Some((lote_id, indice_id)) = lotes.into_iter().next() else {
                    self.progreso.lock().unwrap().trabajando = false;
                    tokio::time::sleep(std::time::Duration::from_secs(2)).await;
                    continue;
                };

                if trabajador.is_none() {
                    match arrancar(&self.dir, self.log.clone(), "cuda:0").await {
                        Ok(t) => trabajador = Some(t),
                        Err(e) => {
                            self.log.apuntar(format!("cola: no arrancó el trabajador: {e}"));
                            tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                            continue;
                        }
                    }
                }

                let vivo = self
                    .resolver_lote(trabajador.as_mut().unwrap(), lote_id, indice_id, &modelo, &coleccion, &qdrant)
                    .await;
                if !vivo {
                    // El proceso murió: AVERÍA. El lote vuelve a la cola una
                    // vez; el contador impide el bucle infinito.
                    trabajador = None;
                    self.progreso.lock().unwrap().reinicios += 1;
                    match self.almacen.sumar_reintento(lote_id) {
                        Ok(n) if n > REINTENTOS_MAX => {
                            let _ = self.almacen.estado_lote(
                                lote_id,
                                "error",
                                Some("el trabajador murió más veces de las permitidas"),
                            );
                        }
                        _ => {}
                    }
                }
            }
        });
    }

    /// Devuelve `false` si el trabajador se murió a mitad.
    async fn resolver_lote(
        &self,
        t: &mut Trabajador,
        lote_id: i64,
        indice_id: i64,
        modelo: &str,
        coleccion: &str,
        qdrant: &Cliente,
    ) -> bool {
        let Ok(pendientes) = self.almacen.pendientes_de(indice_id, modelo, POR_LOTE) else {
            return true;
        };
        if pendientes.is_empty() {
            let _ = self.almacen.estado_lote(lote_id, "hecho", None);
            return true;
        }
        let _ = self.almacen.estado_lote(lote_id, "en_curso", None);
        {
            let mut p = self.progreso.lock().unwrap();
            p.trabajando = true;
            p.lote_actual = Some(lote_id);
            p.hechas = 0;
            p.total = pendientes.len() as u32;
        }

        let por_ruta: std::collections::HashMap<String, i64> =
            pendientes.iter().map(|(id, r)| (r.clone(), *id)).collect();
        let orden = Lote::nuevo(lote_id, modelo.to_string(), pendientes.iter().map(|(_, r)| r.clone()).collect());
        let linea = format!("{}\n", serde_json::to_string(&orden).unwrap());
        if t.entrada.write_all(linea.as_bytes()).await.is_err() {
            return false;
        }
        let _ = t.entrada.flush().await;

        loop {
            let Some(msg) = t.salida.recv().await else { return false };
            match msg {
                MsgEmbed::Listo { dispositivo, modelo } => {
                    let mut p = self.progreso.lock().unwrap();
                    p.dispositivo = dispositivo;
                    p.modelo = modelo;
                }
                MsgEmbed::Progreso { hechas, .. } => {
                    self.progreso.lock().unwrap().hechas = hechas;
                }
                MsgEmbed::Saltada { ruta, motivo, .. } => {
                    // RESULTADO, no avería: se anota y no vuelve a la cola.
                    if let Some(id) = por_ruta.get(&ruta) {
                        let _ = self.almacen.marcar_saltada(*id, &motivo);
                    }
                    self.progreso.lock().unwrap().saltadas += 1;
                }
                MsgEmbed::Fallo { motivo, .. } => {
                    let _ = self.almacen.estado_lote(lote_id, "error", Some(&motivo));
                    return true;
                }
                MsgEmbed::Vectores { dims, cuenta, fichero, imagenes, .. } => {
                    let ok = self
                        .guardar(qdrant, coleccion, &fichero, dims, cuenta, &imagenes, &por_ruta, modelo)
                        .await;
                    // El temporal es del trabajador y ya no hace falta; si se
                    // quedara, una indexación larga llenaría /tmp sola.
                    let _ = std::fs::remove_file(&fichero);
                    if let Err(e) = ok {
                        self.log.apuntar(format!("cola: no se pudieron guardar los vectores: {e}"));
                        let _ = self.almacen.estado_lote(lote_id, "error", Some(&e.to_string()));
                    }
                    return true;
                }
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    async fn guardar(
        &self,
        qdrant: &Cliente,
        coleccion: &str,
        fichero: &str,
        dims: u32,
        cuenta: u32,
        imagenes: &[String],
        por_ruta: &std::collections::HashMap<String, i64>,
        modelo: &str,
    ) -> Result<()> {
        let bytes = std::fs::read(fichero)?;
        let esperado = cuenta as usize * dims as usize * 4;
        if bytes.len() != esperado {
            bail!("el fichero de vectores mide {} y debería medir {esperado}", bytes.len());
        }
        let mut vectores = Vec::with_capacity(cuenta as usize);
        for i in 0..cuenta as usize {
            let base = i * dims as usize * 4;
            vectores.push(
                (0..dims as usize)
                    .map(|j| {
                        let o = base + j * 4;
                        f32::from_le_bytes(bytes[o..o + 4].try_into().unwrap())
                    })
                    .collect::<Vec<f32>>(),
            );
        }
        let ids: Vec<i64> = imagenes.iter().filter_map(|r| por_ruta.get(r).copied()).collect();
        if ids.len() != vectores.len() {
            bail!("el trabajador devolvió rutas que no había pedido");
        }
        let quadkeys: Vec<String> =
            ids.iter().map(|id| self.almacen.quadkey_de_imagen(*id).unwrap_or_default()).collect();
        qdrant.subir(coleccion, &ids, &vectores, &quadkeys).await?;
        for id in &ids {
            self.almacen.marcar_vector(*id, modelo, "hecho")?;
        }
        Ok(())
    }
}
