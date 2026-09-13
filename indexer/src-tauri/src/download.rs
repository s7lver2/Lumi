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
    /// Cuántas se bajaron pero NO entraron al índice por caer fuera de la
    /// tesela que se pidió (ver el recorte por quadkey de `un_origen`).
    ///
    /// Existe porque sin él la diferencia entre lo prometido y lo entregado no
    /// se podía explicar desde ningún sitio: el operador veía «40.000» en la
    /// estimación y 26.325 en el índice, y la única pista era restar a mano
    /// dos columnas de la base de datos. Los orígenes que preguntan por radio
    /// en vez de por bbox (`monumentos`) descartan la mitad de lo que sirven:
    /// medido, 4.024 servidas → 1.882 guardadas.
    pub fuera_de_tesela: u32,
    /// Teselas que fallaron y no se reintentarán. Mismo motivo: 12 teselas en
    /// error repartidas entre tres orígenes no pueden ser invisibles en el
    /// recuento final.
    pub fallidas: u32,
    pub coste_eur: f64,
}

fn sumar_a_origen(p: &mut Progreso, fuente: &str, imagenes: u32, fuera_de_tesela: u32, coste_eur: f64) {
    if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == fuente) {
        l.imagenes += imagenes;
        l.fuera_de_tesela += fuera_de_tesela;
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
    /// "hecha" | "pendiente" | "abandonada". Antes era un `bool` (`hecha`),
    /// y una tesela abandonada (reintentos agotados) no tenía dónde
    /// pintarse: `!pendientes.contains(qk)` la hacía indistinguible de una
    /// que sí había terminado bien.
    pub estado: String,
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
    /// Total de imágenes bajadas que no entraron al índice por caer fuera de
    /// su tesela. Ver `LineaOrigen::fuera_de_tesela`.
    pub fuera_de_tesela: u32,
    /// Total de teselas × origen que fallaron definitivamente.
    pub fallidas: u32,
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
    /// `trabajando` empieza en `true`, no en `false` — es EL BUG que dejaba la
    /// pantalla congelada para siempre cuando todas las teselas pedidas ya
    /// estaban `hecho` (mismo índice, mismos proveedores, relanzada sin
    /// sellar): `correr()` termina su bucle casi instantáneamente porque no
    /// hay nada que pedir, y el primer sondeo del frontend (cada 700 ms)
    /// podía llegar DESPUÉS de que la tarea entera ya hubiera puesto
    /// `trabajando` en `false` otra vez — la interfaz nunca llegaba a
    /// OBSERVAR el `true` intermedio, así que su lógica de "avisar solo
    /// cuando pase de trabajando a parado" nunca se disparaba: `DownloadView`
    /// se quedaba enseñando el resumen final (con los números reales,
    /// sembrados desde SQLite) para siempre, sin pasar nunca a la pantalla de
    /// embebido, y "Detener" tampoco lo arreglaba porque no había ninguna
    /// tesela en curso que terminar.
    ///
    /// Poniéndolo aquí, en la CONSTRUCCIÓN — antes incluso de que la tarea
    /// async arranque — se garantiza que cualquier sondeo del frontend hecho
    /// después de que `descarga_arrancar` devuelva (que es cuando esta
    /// `Descarga` ya existe y está registrada) vea `trabajando: true` al
    /// menos una vez, sin importar lo rápido que `correr()` termine.
    pub fn nueva(almacen: Arc<Almacen>, indice_id: i64, presupuesto_eur: f64, modelos: &[String]) -> Self {
        Self {
            almacen,
            indice_id,
            tope: Presupuesto::nuevo(presupuesto_eur),
            modelos: modelos.to_vec(),
            progreso: Mutex::new(Progreso { trabajando: true, ..Default::default() }),
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

    /// Todos los orígenes activos, uno tras otro, y solo AQUÍ se apaga
    /// `trabajando` — `Descarga::nueva` ya lo puso en `true` (ver su doc).
    /// Antes cada `un_origen` apagaba `trabajando` al terminar SU lista, y
    /// con dos orígenes activos eso significaba que tras terminar Mapillary
    /// la interfaz veía `trabajando: false` un instante y se creía la
    /// descarga completa mientras KartaView ni había empezado:
    /// `DownloadView` se navegaba fuera sola, y "Detener" parecía no hacer
    /// nada porque el operador ya no estaba en la pantalla para verlo parar.
    ///
    /// Con `paralelo`, los orígenes avanzan a la vez en vez de uno tras otro.
    /// Es seguro por construcción y no le pide ni una petición más a nadie:
    /// cada `Origen` tiene su propio `Ctx` con su propio `Limitador`, y donde
    /// dos comparten proveedor (commons, wikipedia y monumentos pasan por
    /// `limitador_wikimedia()`) siguen serializándose ENTRE ELLOS aunque el
    /// bucle los lance juntos. Lo que cambia es solo CUÁNDO se descarga cada
    /// cosa, no QUÉ: sobre el índice de 26.739 imágenes, 83,4 min en serie
    /// contra 40,5 min en paralelo, que es el suelo del origen más lento.
    ///
    /// El interruptor se lee al arrancar la descarga, no aquí dentro: cambiar
    /// el ajuste a mitad no reconfigura un plan en curso.
    pub async fn correr(
        self: &Arc<Self>,
        origenes: &[Origen],
        nuevas: &std::collections::BTreeMap<String, Vec<String>>,
        paralelo: bool,
    ) {
        if paralelo {
            let mut tareas = tokio::task::JoinSet::new();
            for o in origenes.iter().cloned() {
                let Some(teselas) = nuevas.get(o.id()).cloned() else { continue };
                let este = Arc::clone(self);
                tareas.spawn(async move {
                    // Defensivo, no una garantía nueva: `un_origen` ya
                    // comprueba `parar` en su propio bucle de teselas. Esto
                    // solo evita arrancar un origen que ni ha empezado si se
                    // pidió parar entre construir el plan y correrlo.
                    if este.parar.load(Ordering::SeqCst) {
                        return;
                    }
                    este.un_origen(&o, &teselas).await;
                });
            }
            while tareas.join_next().await.is_some() {}
        } else {
            for o in origenes {
                if self.parar.load(Ordering::SeqCst) {
                    break;
                }
                let Some(teselas) = nuevas.get(o.id()) else { continue };
                self.un_origen(o, teselas).await;
            }
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
        // Estado persistido de cada tesela pedida: es lo único que distingue
        // "hecha", "abandonada" y "todavía pendiente" al reanudar — sin esto,
        // `!pendientes.contains(qk)` (que ahora excluye las dos primeras) no
        // podía decir cuál de las dos era, y una tesela dada por perdida se
        // pintaba en el mapa como si hubiera terminado bien.
        let estados_previos = self
            .almacen
            .descargas_estados(self.indice_id, o.id(), teselas)
            .unwrap_or_default();
        let abandonadas_ya = estados_previos.values().filter(|e| e.as_str() == "abandonada").count() as u32;
        {
            let mut p = self.progreso.lock().unwrap();
            p.teselas_total += pendientes.len() as u32 + hechas_ya + abandonadas_ya;
            p.teselas_hechas += hechas_ya;
            p.fallidas += abandonadas_ya;
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
                total: pendientes.len() as u32 + hechas_ya + abandonadas_ya,
                imagenes: imagenes_ya,
                // `fuera_de_tesela` NO se siembra desde `descargas`: la tabla
                // guarda `imagenes` (lo que entró) y `unidades` (lo que se
                // sirvió), pero de una ejecución anterior no se puede saber
                // cuánto de la diferencia fue recorte por tesela y cuánto
                // otra cosa. Empieza a cero y cuenta lo de ESTA ejecución.
                fuera_de_tesela: 0,
                fallidas: abandonadas_ya,
                coste_eur: coste_ya,
            });
            for qk in teselas {
                let estado = match estados_previos.get(qk).map(String::as_str) {
                    Some("hecho") => "hecha",
                    Some("abandonada") => "abandonada",
                    // 'en_curso' y 'error' siguen ofreciéndose vía
                    // `pendientes` — se pintan como pendientes, no como algo
                    // ya resuelto.
                    _ => "pendiente",
                };
                if estado != "pendiente" {
                    p.teselas.push(TeselaProgreso { quadkey: qk.clone(), fuente: o.id().to_string(), estado: estado.into() });
                }
            }
            for qk in &pendientes {
                p.teselas.push(TeselaProgreso { quadkey: qk.clone(), fuente: o.id().to_string(), estado: "pendiente".into() });
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
                    let mut descartadas = 0u32;
                    for c in &caps {
                        let qk_real = quadkey(c.lat, c.lng);
                        if qk_real != qk {
                            descartadas += 1;
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
                    p.fuera_de_tesela += descartadas;
                    p.gastado_eur = self.tope.gastado_eur();
                    sumar_a_origen(&mut p, o.id(), n, descartadas, gastado);
                    if sin_saldo {
                        p.sin_saldo = true;
                    } else {
                        p.teselas_hechas += 1;
                        if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == o.id()) {
                            l.hechas += 1;
                        }
                        if let Some(t) = p.teselas.iter_mut().find(|t| t.quadkey == qk && t.fuente == o.id()) {
                            t.estado = "hecha".into();
                        }
                    }
                    // Lo descartado se dice EN LA MISMA línea que lo guardado:
                    // «1.882 imágenes» a secas, cuando el origen sirvió 4.024,
                    // es un número correcto que cuenta media verdad.
                    apuntar_en(
                        &mut p,
                        if descartadas > 0 {
                            format!("{} {qk} · {n} imágenes ({descartadas} fuera de la tesela)", o.id())
                        } else {
                            format!("{} {qk} · {n} imágenes", o.id())
                        },
                    );
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
                    // 'abandonada' es TERMINAL: `descargas_pendientes` deja de
                    // ofrecerla en cualquier relanzamiento futuro. 'error'
                    // sigue siendo la avería normal, que esta misma ejecución
                    // ya no reintenta pero la siguiente sí.
                    let _ = self.almacen.descarga_marcar(
                        self.indice_id, o.id(), &qk, if definitivo { "abandonada" } else { "error" },
                        0, 0, Some(&motivo),
                    );
                    // Solo se cuenta como fallida cuando ya no se va a
                    // reintentar: una avería que vuelve todavía puede acabar
                    // bien, y contarla aquí inflaría el número en la pantalla
                    // para luego tener que bajarlo.
                    if definitivo {
                        let mut p = self.progreso.lock().unwrap();
                        p.fallidas += 1;
                        if let Some(l) = p.por_origen.iter_mut().find(|l| l.fuente == o.id()) {
                            l.fallidas += 1;
                        }
                        if let Some(t) = p.teselas.iter_mut().find(|t| t.quadkey == qk && t.fuente == o.id()) {
                            t.estado = "abandonada".into();
                        }
                    }
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

    /// Un origen que SIEMPRE falla al descargar — `Falso` no tiene forma de
    /// fallar (su guion solo dice cuántas sirve), así que esto es lo que hace
    /// falta para probar la avería que agota reintentos y termina en
    /// `abandonada`.
    struct SiempreFalla;

    #[async_trait::async_trait]
    impl crate::origins::OrigenDeRed for SiempreFalla {
        fn id(&self) -> &'static str { "siemprefalla" }
        fn tipo(&self) -> Tipo { Tipo::Suelta }
        fn tarifa(&self) -> Tarifa { Tarifa::Gratis }
        fn redistribucion(&self) -> lumi_index::network::Redistribucion {
            lumi_index::network::Redistribucion::Libre { licencia: "x".into() }
        }
        async fn sondear(&self, _tesela: &str) -> anyhow::Result<lumi_index::network::Disponibilidad> {
            anyhow::bail!("no importa, este test no sondea")
        }
        async fn descargar(&self, _tesela: &str, _tope: &Presupuesto) -> anyhow::Result<Vec<lumi_index::network::Captura>> {
            anyhow::bail!("avería, a propósito, para el test")
        }
    }

    #[tokio::test]
    async fn una_tesela_ya_hecha_no_se_vuelve_a_bajar_ni_a_pagar() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        // Quadkeys REALES, no "AAA"/"BBB": `Falso::descargar` sitúa cada
        // captura en el centro de la tesela pedida, y `un_origen` descarta
        // lo que no cae dentro de ella al recalcular el quadkey desde esa
        // coordenada — con un identificador que no es un quadkey de verdad,
        // ese recorte lo tira todo, sin que el guion tenga culpa.
        let aaa = lumi_index::tiles::quadkey(43.36, -8.41);
        let bbb = lumi_index::tiles::quadkey(43.10, -8.10);
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con(&aaa, 10)
                .con(&bbb, 10),
        );

        let d = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d.un_origen(&o, &[aaa.clone(), bbb.clone()]).await;
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
        d2.un_origen(&o, &[aaa.clone(), bbb.clone()]).await;
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

    /// El bug real reportado por el operador: relanzar sobre teselas que YA
    /// están `hecho` para todos los orígenes (mismo índice, sin sellar
    /// todavía) dejaba la pantalla congelada para siempre. La causa era que
    /// `trabajando` nacía en `false` y solo se ponía en `true` DENTRO de
    /// `correr()` — con nada pendiente que pedir, `correr()` termina en
    /// microsegundos, así que el frontend (que solo avisa "terminó" al ver
    /// `trabajando` pasar de `true` a `false`) podía no llegar a observar
    /// NUNCA el `true` intermedio, y se quedaba esperando una transición que
    /// ya había pasado. Esta prueba no puede reproducir el sondeo a 700 ms
    /// del frontend, así que comprueba la garantía que sí puede dar el
    /// backend: `trabajando` es `true` desde el instante de la construcción,
    /// ANTES de llamar a `correr()` — que es lo único que cierra la ventana.
    #[tokio::test]
    async fn trabajando_empieza_en_true_antes_de_correr_asi_no_haya_nada_pendiente() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let qk = lumi_index::tiles::quadkey(43.36, -8.41);
        let o: Origen = std::sync::Arc::new(Falso::nuevo("f", Tipo::Suelta, Tarifa::Gratis).con(&qk, 5));

        // Primera pasada: deja la tesela en `hecho`.
        Descarga::nueva(a.clone(), i, 100.0, &[]).un_origen(&o, &[qk.clone()]).await;
        assert_eq!(a.descarga_estado(i, "f", &qk).unwrap().as_deref(), Some("hecho"));

        // Segunda: nada pendiente para NINGÚN origen — el caso real del bug.
        // Si `trabajando` naciera en `false`, esta aserción pasaría igual
        // (el bug está en la VENTANA temporal, no en el valor final), pero
        // deja documentado el invariante que el arreglo garantiza: puede
        // comprobarse ANTES de que `correr()` haga nada.
        let d2 = std::sync::Arc::new(Descarga::nueva(a.clone(), i, 100.0, &[]));
        assert!(d2.progreso().trabajando, "trabajando debe ser true desde la construcción");
        d2.correr(&[o], &std::collections::BTreeMap::from([("f".to_string(), vec![qk])]), false).await;
        assert!(!d2.progreso().trabajando, "y correr() lo apaga al terminar, aunque no hiciera nada");
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
        let d = std::sync::Arc::new(Descarga::nueva(a.clone(), i, 100.0, &[]));
        let nuevas = std::collections::BTreeMap::from([
            ("uno".to_string(), vec!["AAA".to_string()]),
            ("dos".to_string(), vec!["BBB".to_string()]),
        ]);
        d.correr(&[o1, o2], &nuevas, false).await;
        assert!(!d.progreso().trabajando, "termina apagado");
        assert_eq!(d.progreso().teselas_hechas, 2, "los dos orígenes se procesan, no solo el primero");
    }

    /// El paralelismo cambia CUÁNDO se descarga cada cosa, no QUÉ: el
    /// resultado observable tiene que ser idéntico al del modo secuencial.
    #[tokio::test]
    async fn en_paralelo_baja_exactamente_lo_mismo_que_en_serie() {
        // Cada modo contra su propia base: sobre la misma, el segundo pase se
        // saltaría las teselas que el primero ya dejó `hecho`.
        async fn correr_con(paralelo: bool) -> Progreso {
            let (_d, a) = temporal();
            let i = a.crear_indice("x", "x", "x/x").unwrap();
            let qk1 = lumi_index::tiles::quadkey(43.36, -8.41);
            let qk2 = lumi_index::tiles::quadkey(40.42, -3.70);
            let o1: Origen =
                std::sync::Arc::new(Falso::nuevo("uno", Tipo::Suelta, Tarifa::Gratis).con(&qk1, 3));
            let o2: Origen =
                std::sync::Arc::new(Falso::nuevo("dos", Tipo::Suelta, Tarifa::Gratis).con(&qk2, 2));
            let d = std::sync::Arc::new(Descarga::nueva(a.clone(), i, 100.0, &[]));
            let nuevas = std::collections::BTreeMap::from([
                ("uno".to_string(), vec![qk1]),
                ("dos".to_string(), vec![qk2]),
            ]);
            d.correr(&[o1, o2], &nuevas, paralelo).await;
            d.progreso()
        }

        let serie = correr_con(false).await;
        let paralelo = correr_con(true).await;

        assert!(!paralelo.trabajando, "termina apagado igual que en serie");
        assert_eq!(paralelo.teselas_hechas, serie.teselas_hechas, "las mismas teselas");
        assert_eq!(paralelo.imagenes, serie.imagenes, "y las mismas imágenes");
        assert_eq!(paralelo.fallidas, serie.fallidas);
        assert_eq!(serie.teselas_hechas, 2, "y la referencia de verdad hizo las dos");
    }

    #[tokio::test]
    async fn el_presupuesto_agotado_para_la_descarga_y_lo_bajado_se_conserva() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        // Quadkeys reales — mismo motivo que en el test de arriba.
        let aaa = lumi_index::tiles::quadkey(43.36, -8.41);
        let bbb = lumi_index::tiles::quadkey(43.10, -8.10);
        let o: Origen = std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Suelta, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con(&aaa, 100)
                .con(&bbb, 100),
        );
        // 0,10 € da para ~15 imágenes: no llega ni a terminar AAA.
        let d = Descarga::nueva(a.clone(), i, 0.10, &[]);
        d.un_origen(&o, &[aaa.clone(), bbb.clone()]).await;

        let p = d.progreso();
        assert!(p.imagenes > 0 && p.imagenes < 200, "bajó {}", p.imagenes);
        assert!(p.sin_saldo, "tiene que quedar dicho que se quedó sin saldo");
        // Y una tesela que se quedó a medias NO queda como hecha: si no, al
        // retomar con más presupuesto se la saltaría para siempre.
        assert_ne!(a.descarga_estado(i, "caro", &aaa).unwrap().as_deref(), Some("hecho"));
    }

    /// El bug real que motivó `abandonada`: sin un estado terminal, una
    /// tesela que agota sus reintentos se marcaba `error` — indistinguible
    /// de una avería que todavía puede reintentarse — así que un
    /// relanzamiento futuro la volvía a pedir, fallaba otra vez, y así para
    /// siempre. Aquí se fuerzan DOS relanzamientos: el primero deja la
    /// tesela en `error` (avería, vuelve una vez); el segundo la agota y la
    /// marca `abandonada`; un TERCERO no debe ni pedirla.
    #[tokio::test]
    async fn una_tesela_que_agota_reintentos_queda_abandonada_y_no_se_vuelve_a_pedir() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(SiempreFalla);
        let qk = lumi_index::tiles::quadkey(43.36, -8.41);

        let d1 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d1.un_origen(&o, &[qk.clone()]).await;
        assert_eq!(a.descarga_estado(i, "siemprefalla", &qk).unwrap().as_deref(), Some("error"));
        assert_eq!(d1.progreso().fallidas, 0, "la primera avería todavía puede reintentarse");

        let d2 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d2.un_origen(&o, &[qk.clone()]).await;
        assert_eq!(
            a.descarga_estado(i, "siemprefalla", &qk).unwrap().as_deref(),
            Some("abandonada"),
            "agotados los reintentos, el estado es terminal"
        );
        assert_eq!(d2.progreso().fallidas, 1);

        // Tercer relanzamiento: `descargas_pendientes` ya no la ofrece, así
        // que `un_origen` no llega ni a intentarla — se comprueba con el
        // recuento SEMBRADO desde SQLite, que es lo único que puede subir si
        // no se pide nada nuevo.
        let d3 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d3.un_origen(&o, &[qk.clone()]).await;
        assert_eq!(d3.progreso().fallidas, 1, "sembrado desde SQLite, no se reintentó");
        assert_eq!(
            a.descarga_estado(i, "siemprefalla", &qk).unwrap().as_deref(),
            Some("abandonada"),
            "sigue abandonada: no se tocó"
        );
    }

    /// La única puerta de vuelta desde `abandonada` es manual.
    #[tokio::test]
    async fn reintentar_abandonadas_las_vuelve_a_poner_en_juego() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x", "x/x").unwrap();
        let o: Origen = std::sync::Arc::new(SiempreFalla);
        let qk = lumi_index::tiles::quadkey(43.36, -8.41);

        // Dos pasadas para agotar los reintentos, igual que arriba.
        Descarga::nueva(a.clone(), i, 100.0, &[]).un_origen(&o, &[qk.clone()]).await;
        Descarga::nueva(a.clone(), i, 100.0, &[]).un_origen(&o, &[qk.clone()]).await;
        assert_eq!(a.descarga_estado(i, "siemprefalla", &qk).unwrap().as_deref(), Some("abandonada"));

        let borradas = a.descargas_reintentar_abandonadas(i, None).unwrap();
        assert_eq!(borradas, 1);
        assert_eq!(a.descarga_estado(i, "siemprefalla", &qk).unwrap(), None, "vuelve a no existir, como si nunca se hubiera intentado");

        // Y `descargas_pendientes` la ofrece de nuevo.
        let pendientes = a.descargas_pendientes(i, "siemprefalla", &[qk.clone()]).unwrap();
        assert_eq!(pendientes, vec![qk]);
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
        let d = std::sync::Arc::new(Descarga::nueva(a.clone(), i, 100.0, &[]));
        let nuevas = std::collections::BTreeMap::from([("uno".to_string(), vec!["AAA".to_string()])]);

        d.correr(&[o], &nuevas, false).await;

        assert_eq!(a.leer_ajuste(CLAVE_PLAN_PENDIENTE).unwrap(), None);
    }
}
