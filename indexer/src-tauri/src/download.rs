//! El planificador de descarga.
//!
//! La unidad de trabajo es TESELA × ORIGEN, y se anota al completarse. Eso es
//! lo único que hace que cortar una descarga a la mitad no cueste dinero al
//! retomarla, y es la razón de que exista la tabla `descargas`.
//!
//! Las dos clases de fallo del 7a, tal cual: «esta imagen no se puede bajar» es
//! un RESULTADO que el adaptador ya se saltó; que se caiga la red es una AVERÍA
//! y la tesela vuelve una vez, con contador.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use lumi_index::budget::Presupuesto;
use lumi_index::tiles::quadkey;
use serde::{Deserialize, Serialize};

use crate::origins::Origen;
use crate::spend;
use crate::store::Almacen;

/// La clave en `ajustes` bajo la que vive el plan de la descarga en curso —
/// mientras está en curso. Se escribe al arrancar y se borra al terminar
/// `correr()`, pase lo que pase (fin normal, `parar()` o sin saldo): si sigue
/// ahí al arrancar la aplicación, es porque `correr()` nunca llegó a su
/// final, que es justo lo que pasa cuando se cierra la app a mitad.
pub const CLAVE_PLAN_PENDIENTE: &str = "descarga_pendiente";

/// Lo mínimo para volver a lanzar la misma descarga tal cual se pidió la
/// primera vez. `imagenes_estimadas` viaja aquí y no se recalcula porque
/// recalcularlo exigiría sondear de nuevo — y es solo para el ETA, no para
/// decidir nada.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlanDescarga {
    pub indice_id: i64,
    pub nuevas: std::collections::BTreeMap<String, Vec<String>>,
    pub presupuesto_eur: f64,
    pub imagenes_estimadas: u32,
}

/// Reintentos de una tesela cuya descarga se cayó. Uno: si falla dos veces, el
/// problema no es de suerte.
pub const REINTENTOS_MAX: u32 = 1;

/// Mismo criterio que el log de servicios: tope en memoria, sin fichero. El
/// techo es que una descarga patológica pierde el principio; la salida, si
/// alguna vez duele, es escribirlo a disco como hace el runner del daemon.
pub const TOPE_REGISTRO: usize = 500;

fn apuntar_en(p: &mut Progreso, linea: String) {
    if p.registro.len() >= TOPE_REGISTRO {
        p.registro.remove(0);
    }
    p.ultimo = linea.clone();
    p.registro.push(linea);
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct LineaOrigen {
    pub fuente: String,
    pub hechas: u32,
    pub total: u32,
    /// Cuántas imágenes sirvió de verdad. Es lo que se enseña en los gratuitos,
    /// donde el euro no dice nada.
    pub imagenes: u32,
    pub coste_eur: f64,
}

fn sumar_a_origen(p: &mut Progreso, fuente: &str, imagenes: u32, coste_eur: f64) {
    if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == fuente) {
        l.imagenes += imagenes;
        l.coste_eur += coste_eur;
    }
}

/// Una tesela × origen del plan, para pintarla en el mapa en cuanto termina.
/// Vive aparte de `descargas` (la tabla, que es el contrato de reanudación):
/// esto es solo para que la interfaz sepa qué dibujar mientras la descarga
/// corre, y se descarta con el resto de `Progreso` al terminar.
#[derive(Debug, Clone, Serialize)]
pub struct TeselaProgreso {
    pub quadkey: String,
    pub fuente: String,
    pub hecha: bool,
}

/// La tesela × origen que se está bajando AHORA MISMO, con lo único que se
/// sabe de verdad mientras corre: cuántas fotos van. No hay un total que
/// enseñar aquí —eso solo se sabe al terminar la consulta— así que esto no es
/// una barra de progreso de la tesela, es la prueba de que sigue viva.
#[derive(Debug, Clone, Default, Serialize)]
pub struct TeselaEnCurso {
    pub quadkey: String,
    pub fuente: String,
    pub imagenes: u32,
    /// Cuántas trae la tesela en total, si ya se sabe. `0` es "no se sabe
    /// todavía" — ver `OrigenDeRed::objetivo`.
    pub objetivo: u32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub trabajando: bool,
    pub teselas_hechas: u32,
    pub teselas_total: u32,
    pub imagenes: u32,
    pub gastado_eur: f64,
    pub sin_saldo: bool,
    pub por_origen: Vec<LineaOrigen>,
    pub teselas: Vec<TeselaProgreso>,
    pub en_curso: Option<TeselaEnCurso>,
    pub ultimo: String,
    pub registro: Vec<String>,
}

pub struct Descarga {
    almacen: Arc<Almacen>,
    indice_id: i64,
    tope: Presupuesto,
    modelos: Vec<String>,
    progreso: Mutex<Progreso>,
    parar: AtomicBool,
}

impl Descarga {
    pub fn nueva(almacen: Arc<Almacen>, indice_id: i64, presupuesto_eur: f64, modelos: &[String]) -> Self {
        Self {
            almacen,
            indice_id,
            tope: Presupuesto::nuevo(presupuesto_eur),
            modelos: modelos.to_vec(),
            progreso: Mutex::new(Progreso::default()),
            parar: AtomicBool::new(false),
        }
    }

    pub fn progreso(&self) -> Progreso {
        self.progreso.lock().unwrap().clone()
    }

    /// Parar termina la tesela en curso y no coge la siguiente. Nunca mata
    /// trabajo que ya está pagado: misma regla que la pausa de la cola del 7a.
    pub fn parar(&self) {
        self.parar.store(true, Ordering::SeqCst);
    }

    /// Todos los orígenes activos, uno tras otro. `trabajando` se enciende y
    /// se apaga AQUÍ, una sola vez para la descarga entera — antes cada
    /// `un_origen` apagaba `trabajando` al terminar SU lista, y con dos
    /// orígenes activos eso significaba que tras terminar Mapillary la
    /// interfaz veía `trabajando: false` un instante y se creía la descarga
    /// completa mientras KartaView ni había empezado: `DownloadView` se
    /// navegaba fuera sola, y "Detener" parecía no hacer nada porque el
    /// operador ya no estaba en la pantalla para verlo parar.
    pub async fn correr(&self, origenes: &[Origen], nuevas: &std::collections::BTreeMap<String, Vec<String>>) {
        self.progreso.lock().unwrap().trabajando = true;
        for o in origenes {
            if self.parar.load(Ordering::SeqCst) {
                break;
            }
            let Some(teselas) = nuevas.get(o.id()) else { continue };
            self.un_origen(o, teselas).await;
        }
        self.progreso.lock().unwrap().trabajando = false;
        // Llegar aquí —por el motivo que sea— es la prueba de que esta
        // descarga ya no necesita reanudarse sola al reabrir la aplicación.
        let _ = self.almacen.borrar_ajuste(CLAVE_PLAN_PENDIENTE);
    }

    /// Un origen contra su lista de teselas. Lo que ya está `hecho` ni se pide.
    async fn un_origen(&self, o: &Origen, teselas: &[String]) {
        let mut pendientes = self
            .almacen
            .descargas_pendientes(self.indice_id, o.id(), teselas)
            .unwrap_or_default();
        // Las que el sondeo ya marcó con más fotos van primero: si el
        // presupuesto se agota a mitad de la lista, lo que se queda sin
        // nutrir es lo que ya se sabía pobre, no lo que resultó estar bien
        // surtido por azar del orden alfabético de quadkey. Sin sondeo (o
        // caducado) ordena como 0 — al final, no al principio.
        pendientes.sort_by_key(|qk| {
            std::cmp::Reverse(
                self.almacen
                    .sondeo_leer(o.id(), qk, crate::probe::CADUCIDAD_DIAS)
                    .ok()
                    .flatten()
                    .map(|(_, estimadas)| estimadas)
                    .unwrap_or(0),
            )
        });
        // Lo que ya está `hecho` de una ejecución anterior no se vuelve a
        // pedir (arriba), pero el contador tiene que saber que existió: sin
        // esto, reanudar una descarga a medias enseña "0 de 8" en vez de
        // "12 de 20" — el trabajo real nunca se repitió, solo el contador
        // olvidaba lo que ya llevaba hecho.
        let (hechas_ya, imagenes_ya, unidades_ya) = self
            .almacen
            .descargas_hechas_resumen(self.indice_id, o.id(), teselas)
            .unwrap_or((0, 0, 0));
        let coste_ya = o.tarifa().coste_eur(unidades_ya);
        {
            let mut p = self.progreso.lock().unwrap();
            p.teselas_total += pendientes.len() as u32 + hechas_ya;
            p.teselas_hechas += hechas_ya;
            p.imagenes += imagenes_ya;
            // `p.gastado_eur` NO se siembra igual: más abajo se sobrescribe
            // con `self.tope.gastado_eur()` en cuanto termina cualquier
            // tesela, y `self.tope` (el `Presupuesto` de ESTA ejecución) no
            // sabe nada de lo gastado en una ejecución anterior. Sembrarlo
            // aquí solo daría un número correcto un instante, hasta el
            // primer tile — y además tocar el presupuesto es una cuestión
            // de política (¿reanudar da presupuesto fresco, o hereda el
            // gastado?) que el reporte de este bug no pidió resolver.
            p.por_origen.push(LineaOrigen {
                fuente: o.id().to_string(),
                hechas: hechas_ya,
                total: pendientes.len() as u32 + hechas_ya,
                imagenes: imagenes_ya,
                coste_eur: coste_ya,
            });
            for qk in teselas {
                if !pendientes.contains(qk) {
                    p.teselas.push(TeselaProgreso { quadkey: qk.clone(), fuente: o.id().to_string(), hecha: true });
                }
            }
            for qk in &pendientes {
                p.teselas.push(TeselaProgreso { quadkey: qk.clone(), fuente: o.id().to_string(), hecha: false });
            }
        }

        // Un lote por origen: la fila padre ES la cadena de custodia, y la
        // procedencia del material es el propio origen, no algo que declare
        // nadie. Por eso `declarada_por_operador` va a false.
        let lote_id = match self.almacen.crear_lote(
            self.indice_id,
            "red",
            o.id(),
            Some(&format!("{:?}", o.tipo()).to_lowercase()),
            o.id(),
            None,
            None,
            false,
        ) {
            Ok(l) => l,
            Err(e) => {
                self.anotar(format!("no se pudo crear el lote de {}: {e}", o.id()));
                return;
            }
        };

        for qk in pendientes {
            if self.parar.load(Ordering::SeqCst) || self.progreso().sin_saldo {
                break;
            }
            let _ = self.almacen.descarga_marcar(self.indice_id, o.id(), &qk, "en_curso", 0, 0, None);
            let antes = self.tope.gastado_eur();

            match self.descargar_con_avisos(o, &qk).await {
                Ok(caps) => {
                    let gastado = self.tope.gastado_eur() - antes;
                    let unidades: u32 = caps.iter().map(|c| c.unidades).sum();
                    // El quadkey se recalcula de las coordenadas REALES de la
                    // foto: Overpass devuelve vías enteras (`calles.rs`), así
                    // que sin este descarte una captura de la tesela vecina
                    // se colaba en el índice aunque el usuario nunca la
                    // seleccionara. `puntos_de_tesela` ya recorta los puntos
                    // de sondeo a esta tesela, pero Google/KartaView pueden
                    // devolver la foto más cercana a un punto del borde y esa
                    // foto real seguir cayendo al otro lado — última defensa
                    // aquí: solo entra al índice lo que de verdad cae en la
                    // tesela que se pidió, ni una más.
                    let mut n = 0u32;
                    for c in &caps {
                        let qk_real = quadkey(c.lat, c.lng);
                        if qk_real != qk {
                            continue;
                        }
                        let _ = self.almacen.insertar_imagen_de_red(
                            self.indice_id,
                            lote_id,
                            c,
                            &qk_real,
                            &self.modelos,
                        );
                        n += 1;
                    }
                    // SOLO SE APUNTA LO SERVIDO.
                    let _ = spend::apuntar(&self.almacen, o.id(), unidades, gastado);

                    // Una tesela que se quedó a medias por falta de saldo NO se
                    // marca como hecha: si no, al retomar con más presupuesto
                    // se la saltaría para siempre.
                    //
                    // El corte se mide contra el COSTE DE UNA UNIDAD y no
                    // contra cero: el adaptador para cuando la siguiente no
                    // cabe, así que casi nunca deja el saldo exactamente a
                    // cero — con `<= 0.0` esto no se detectaría nunca.
                    let unitario = o.tarifa().coste_eur(1);
                    let sin_saldo = unitario > 0.0 && self.tope.restante_eur() < unitario;
                    let estado = if sin_saldo { "error" } else { "hecho" };
                    let motivo = sin_saldo.then_some("se agotó el presupuesto a mitad");
                    let _ = self.almacen.descarga_marcar(
                        self.indice_id, o.id(), &qk, estado, n, unidades, motivo,
                    );
                    if !sin_saldo {
                        // La procedencia DEL TRABAJO, que es distinta de la de las
                        // imágenes: esta suma 100 % porque una tesela la indexó
                        // exactamente uno. Sin esta línea el manifiesto sale con la
                        // tabla vacía y nadie sabe quién pagó la GPU.
                        let _ = self.almacen.anotar_tesela(self.indice_id, &qk, "aqui", None, None);
                    }

                    let mut p = self.progreso.lock().unwrap();
                    p.imagenes += n;
                    p.gastado_eur = self.tope.gastado_eur();
                    sumar_a_origen(&mut p, o.id(), n, gastado);
                    if sin_saldo {
                        p.sin_saldo = true;
                    } else {
                        p.teselas_hechas += 1;
                        if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == o.id()) {
                            l.hechas += 1;
                        }
                        if let Some(t) = p.teselas.iter_mut().find(|t| t.quadkey == qk && t.fuente == o.id()) {
                            t.hecha = true;
                        }
                    }
                    apuntar_en(&mut p, format!("{} {qk} · {n} imágenes", o.id()));
                }
                Err(e) => {
                    // AVERÍA: vuelve una vez, y el contador impide el bucle.
                    let n = self
                        .almacen
                        .descarga_sumar_reintento(self.indice_id, o.id(), &qk)
                        .unwrap_or(u32::MAX);
                    let definitivo = n > REINTENTOS_MAX;
                    let motivo = if definitivo {
                        format!("falló más veces de las permitidas: {e}")
                    } else {
                        format!("avería, vuelve una vez: {e}")
                    };
                    let _ = self.almacen.descarga_marcar(
                        self.indice_id, o.id(), &qk, "error", 0, 0, Some(&motivo),
                    );
                    self.anotar(format!("{} {qk} · {motivo}", o.id()));
                }
            }
        }

        let _ = self.almacen.estado_lote(lote_id, "pendiente", None);
    }

    /// `o.descargar()` puede tardar minutos sin devolver nada intermedio, y la
    /// mayor parte de ese tiempo no está resolviendo la consulta: está BAJANDO
    /// imágenes de una en una contra el limitador del origen. Una tesela densa
    /// con dos mil fotos a 8 por segundo son más de cuatro minutos de trabajo
    /// legítimo. Sin esto el registro se queda mudo y la pantalla se lee como
    /// congelada en «0 de N teselas».
    ///
    /// El contador de `bajadas()` es lo que hace que el aviso diga algo cierto
    /// en vez de un «sigue trabajando» que se lee igual que «está colgado»: si
    /// el número sube, hay avance real; si no sube, el tiempo se está yendo en
    /// la consulta y eso también se ve.
    async fn descargar_con_avisos(
        &self,
        o: &Origen,
        qk: &str,
    ) -> anyhow::Result<Vec<lumi_index::network::Captura>> {
        let base = o.bajadas();
        let futura = o.descargar(qk, &self.tope);
        tokio::pin!(futura);
        let inicio = tokio::time::Instant::now();
        let mut ticks = 0u32;
        loop {
            tokio::select! {
                r = &mut futura => {
                    // Se apaga aquí, no solo cuando arranca la siguiente: si
                    // no, la última tesela se quedaría enseñando su cuenta de
                    // fotos para siempre después de terminar la descarga.
                    self.progreso.lock().unwrap().en_curso = None;
                    return r;
                }
                // Cada segundo para que la barra se vea viva; el aviso al
                // registro solo cada sexto tick (6s), que es ruido de sobra
                // para un log que hay que poder leer.
                _ = tokio::time::sleep(std::time::Duration::from_secs(1)) => {
                    let hechas = o.bajadas().saturating_sub(base);
                    {
                        let mut p = self.progreso.lock().unwrap();
                        p.en_curso = Some(TeselaEnCurso {
                            quadkey: qk.to_string(), fuente: o.id().to_string(),
                            imagenes: hechas, objetivo: o.objetivo(),
                        });
                    }
                    ticks += 1;
                    if ticks % 6 == 0 {
                        let s = inicio.elapsed().as_secs();
                        let objetivo = o.objetivo();
                        self.anotar(match (hechas, objetivo) {
                            (0, _) => format!("{} {qk} · resolviendo la consulta, aún sin imágenes ({s}s)", o.id()),
                            (h, 0) => format!("{} {qk} · {h} imágenes bajadas ({s}s)", o.id()),
                            (h, t) => format!("{} {qk} · {h} de {t} imágenes ({s}s)", o.id()),
                        });
                    }
                }
            }
        }
    }

    fn anotar(&self, s: String) {
        log::warn!("{s}");
        apuntar_en(&mut self.progreso.lock().unwrap(), s);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::manifest::Tipo;
    use lumi_index::network::Tarifa;
    use crate::origins::Falso;

    fn temporal() -> (tempfile::TempDir, std::sync::Arc<Almacen>) {
        let d = tempfile::tempdir().unwrap();
        let a = std::sync::Arc::new(Almacen::abrir(d.path()).unwrap());
        (d, a)
    }

    #[tokio::test]
    async fn una_tesela_ya_hecha_no_se_vuelve_a_bajar_ni_a_pagar() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 10)
                .con("BBB", 10),
        );

        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d.un_origen(&o, &["AAA".into(), "BBB".into()]).await;
        let primera = d.progreso().gastado_eur;
        assert!(primera > 0.0);
        assert_eq!(d.progreso().teselas_hechas, 2);

        // Segunda pasada sobre las mismas: ni una petición ni un céntimo.
        // `teselas_hechas` SÍ cuenta las dos — es la cuenta durable de lo que
        // ya está hecho, sembrada desde SQLite, no lo que esta ejecución
        // trabajó de nuevo. Ese es justo el bug que arregla: sin la siembra,
        // reanudar una descarga a medias enseñaba "0 hechas" aunque el disco
        // ya tuviera el trabajo real.
        let d2 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d2.un_origen(&o, &["AAA".into(), "BBB".into()]).await;
        assert_eq!(d2.progreso().gastado_eur, 0.0, "no se paga dos veces");
        assert_eq!(d2.progreso().teselas_hechas, 2, "lo ya hecho se recuerda, no se olvida al reanudar");

        // La fila por origen es justo lo que se veía en "Mapillary 0/0 · 0
        // fotos" pese a haber fotos de verdad ya bajadas: sin la siembra,
        // estos tres campos nacían en cero en cada `Descarga` nueva.
        let linea = d2.progreso().por_origen.into_iter().find(|l| l.fuente == "caro").unwrap();
        assert_eq!(linea.hechas, 2);
        assert_eq!(linea.total, 2);
        assert_eq!(linea.imagenes, 20);
    }

    /// El bug real: `un_origen` apagaba `trabajando` al terminar SU lista, así
    /// que con dos orígenes activos la interfaz veía `trabajando: false` al
    /// terminar el primero y se creía la descarga completa mientras el
    /// segundo ni había empezado — se navegaba fuera de `DownloadView` sola.
    #[tokio::test]
    async fn un_origen_no_apaga_trabajando_de_la_descarga_entera() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(Falso::nuevo("f", Tipo::Suelta, Tarifa::Gratis).con("AAA", 1));
        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d.progreso.lock().unwrap().trabajando = true;
        d.un_origen(&o, &["AAA".into()]).await;
        assert!(d.progreso().trabajando, "un origen que termina no apaga la descarga entera");
    }

    #[tokio::test]
    async fn correr_procesa_todos_los_origenes_y_solo_entonces_apaga_trabajando() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o1: Origen = std::sync::Arc::new(Falso::nuevo("uno", Tipo::Suelta, Tarifa::Gratis).con("AAA", 1));
        let o2: Origen = std::sync::Arc::new(Falso::nuevo("dos", Tipo::Suelta, Tarifa::Gratis).con("BBB", 1));
        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        let nuevas = std::collections::BTreeMap::from([
            ("uno".to_string(), vec!["AAA".to_string()]),
            ("dos".to_string(), vec!["BBB".to_string()]),
        ]);
        d.correr(&[o1, o2], &nuevas).await;
        assert!(!d.progreso().trabajando, "termina apagado");
        assert_eq!(d.progreso().teselas_hechas, 2, "los dos orígenes se procesan, no solo el primero");
    }

    #[tokio::test]
    async fn el_presupuesto_agotado_para_la_descarga_y_lo_bajado_se_conserva() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 100)
                .con("BBB", 100),
        );
        // 0,10 € da para ~15 imágenes: no llega ni a terminar AAA.
        let d = Descarga::nueva(a.clone(), i, 0.10, &[]);
        d.un_origen(&o, &["AAA".into(), "BBB".into()]).await;

        let p = d.progreso();
        assert!(p.imagenes > 0 && p.imagenes < 200, "bajó {}", p.imagenes);
        assert!(p.sin_saldo, "tiene que quedar dicho que se quedó sin saldo");
        // Y una tesela que se quedó a medias NO queda como hecha: si no, al
        // retomar con más presupuesto se la saltaría para siempre.
        assert_ne!(a.descarga_estado(i, "caro", "AAA").unwrap().as_deref(), Some("hecho"));
    }

    #[tokio::test]
    async fn el_gasto_apuntado_es_el_servido_y_no_el_previsto() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 10),
        );
        Descarga::nueva(a.clone(), i, 100.0, &[]).un_origen(&o, &["AAA".into()]).await;

        // 10 imágenes · 7 $/1000 · 0,93 = 0,0651 €
        let mes = crate::spend::mes_iso();
        let g = a.gasto_del_mes(&mes).unwrap();
        assert!((g - 0.0651).abs() < 1e-6, "{g}");
    }

    /// El plan pendiente solo tiene sentido mientras `correr()` no ha llegado
    /// a su final: si se cierra la app a mitad, `correr()` nunca corre esta
    /// línea, y por eso sigue ahí para reanudar. Si SÍ llega al final —el
    /// caso de este test—, tiene que desaparecer, o cada descarga terminada
    /// se ofrecería para "reanudar" sin nada que reanudar.
    #[tokio::test]
    async fn correr_borra_el_plan_pendiente_al_terminar() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        a.guardar_ajuste(CLAVE_PLAN_PENDIENTE, "{\"lo que sea\":true}").unwrap();
        let o: Origen = std::sync::Arc::new(Falso::nuevo("uno", Tipo::Suelta, Tarifa::Gratis).con("AAA", 1));
        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        let nuevas = std::collections::BTreeMap::from([("uno".to_string(), vec!["AAA".to_string()])]);

        d.correr(&[o], &nuevas).await;

        assert_eq!(a.leer_ajuste(CLAVE_PLAN_PENDIENTE).unwrap(), None);
    }
}
