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
use serde::Serialize;

use crate::origins::Origen;
use crate::spend;
use crate::store::Almacen;

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

#[derive(Debug, Clone, Default, Serialize)]
pub struct Progreso {
    pub trabajando: bool,
    pub teselas_hechas: u32,
    pub teselas_total: u32,
    pub imagenes: u32,
    pub gastado_eur: f64,
    pub sin_saldo: bool,
    pub por_origen: Vec<LineaOrigen>,
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

    /// Un origen contra su lista de teselas. Lo que ya está `hecho` ni se pide.
    pub async fn un_origen(&self, o: &Origen, teselas: &[String]) {
        let pendientes = self
            .almacen
            .descargas_pendientes(self.indice_id, o.id(), teselas)
            .unwrap_or_default();
        {
            let mut p = self.progreso.lock().unwrap();
            p.trabajando = true;
            p.teselas_total += pendientes.len() as u32;
            p.por_origen.push(LineaOrigen {
                fuente: o.id().to_string(),
                hechas: 0,
                total: pendientes.len() as u32,
                imagenes: 0,
                coste_eur: 0.0,
            });
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

            match o.descargar(&qk, &self.tope).await {
                Ok(caps) => {
                    let gastado = self.tope.gastado_eur() - antes;
                    let unidades: u32 = caps.iter().map(|c| c.unidades).sum();
                    let n = caps.len() as u32;
                    for c in &caps {
                        // El quadkey se recalcula de las coordenadas REALES de
                        // la foto: Overpass devuelve vías enteras, así que una
                        // captura puede caer en la tesela de al lado y tiene
                        // que contarse allí.
                        let qk_real = quadkey(c.lat, c.lng);
                        let _ = self.almacen.insertar_imagen_de_red(
                            self.indice_id,
                            lote_id,
                            c,
                            &qk_real,
                            &self.modelos,
                        );
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
        self.progreso.lock().unwrap().trabajando = false;
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
        let i = a.crear_indice("x", "x").unwrap();
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
        let d2 = Descarga::nueva(a.clone(), i, 100.0, &[]);
        d2.un_origen(&o, &["AAA".into(), "BBB".into()]).await;
        assert_eq!(d2.progreso().gastado_eur, 0.0, "no se paga dos veces");
        assert_eq!(d2.progreso().teselas_hechas, 0, "no había nada que hacer");
    }

    #[tokio::test]
    async fn el_presupuesto_agotado_para_la_descarga_y_lo_bajado_se_conserva() {
        let (_d, a) = temporal();
        let i = a.crear_indice("x", "x").unwrap();
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
        let i = a.crear_indice("x", "x").unwrap();
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
}
