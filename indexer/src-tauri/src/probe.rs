//! Sondear un área y decir lo que costaría bajarla.
//!
//! El sondeo alimenta DOS cosas con la misma llamada: los puntitos del mapa y
//! la estimación en euros. Por eso confirmar el gasto antes de bajar sale casi
//! gratis: el trabajo ya estaba hecho.
//!
//! Y solo se sondea lo que se pide, cuando se pide. Nunca al mover el mapa.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};

use lumi_index::budget::{cabe, previsto, LineaPrevista};
use lumi_index::network::Tarifa;
use serde::Serialize;

use crate::origins::Origen;
use crate::spend;
use crate::store::Almacen;

/// La cobertura cambia despacio y volver a sondear cada vez es tirar cuota.
pub const CADUCIDAD_DIAS: i64 = 30;

#[derive(Debug, Clone, Serialize)]
pub struct SondeoTesela {
    pub quadkey: String,
    pub fuente: String,
    pub nivel: String,
    pub estimadas: u32,
    /// Para que la interfaz pueda decir «sondeado hace 2 d» en vez de fingir
    /// que acaba de preguntar.
    pub del_cache: bool,
}

/// Lo que ve el operador mientras se sondea un área grande: cada origen sondea
/// sus teselas a su propio ritmo (su `Limitador`), así que sin esto la
/// interfaz esperaba a que TODOS terminaran para pintar un solo punto —
/// minutos de mapa gris en un área como Londres, con Mapillary (rápido) y
/// Google/KartaView (lento porque comparten el limitador de Overpass, ver
/// `calles.rs`) mezclados en la misma espera.
#[derive(Default)]
pub struct Sondeo {
    resultados: Mutex<Vec<SondeoTesela>>,
    hechos: AtomicU32,
    total: u32,
    terminado: AtomicBool,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct ProgresoSondeo {
    pub resultados: Vec<SondeoTesela>,
    pub hechos: u32,
    pub total: u32,
    pub terminado: bool,
}

impl Sondeo {
    pub fn nuevo(total: u32) -> Self {
        Self { total, ..Default::default() }
    }

    fn empujar(&self, s: SondeoTesela) {
        self.resultados.lock().unwrap().push(s);
        self.hechos.fetch_add(1, Ordering::SeqCst);
    }

    fn terminar(&self) {
        self.terminado.store(true, Ordering::SeqCst);
    }

    pub fn progreso(&self) -> ProgresoSondeo {
        ProgresoSondeo {
            resultados: self.resultados.lock().unwrap().clone(),
            hechos: self.hechos.load(Ordering::SeqCst),
            total: self.total,
            terminado: self.terminado.load(Ordering::SeqCst),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Estimacion {
    pub lineas: Vec<LineaPrevista>,
    pub total_eur: f64,
    pub gastado_eur: f64,
    pub tope_eur: f64,
    pub cabe: bool,
    pub exceso_eur: f64,
}

/// Sondea cada tesela contra cada origen, reutilizando lo que esté vigente en
/// la caché, y empujando cada resultado a `sondeo` EN CUANTO llega — no al
/// final. Todas las combinaciones origen×tesela salen a la vez; el ritmo real
/// de cada una lo pone el `Limitador` de su propio origen (o el de Overpass
/// compartido, para las que muestrean calles), no un bucle secuencial de aquí.
///
/// Mapillary también pasa por aquí aunque el mapa pinte sus puntos por su
/// cuenta: la estimación necesita su número igual que el de los demás.
pub async fn sondear_area(
    almacen: Arc<Almacen>,
    origenes: Vec<Origen>,
    teselas: Vec<String>,
    sondeo: Arc<Sondeo>,
) {
    let mut tareas = tokio::task::JoinSet::new();
    for o in &origenes {
        for qk in &teselas {
            let o = o.clone();
            let qk = qk.clone();
            let almacen = almacen.clone();
            let sondeo = sondeo.clone();
            tareas.spawn(async move {
                if let Ok(Some((nivel, estimadas))) = almacen.sondeo_leer(o.id(), &qk, CADUCIDAD_DIAS) {
                    sondeo.empujar(SondeoTesela {
                        quadkey: qk,
                        fuente: o.id().to_string(),
                        nivel,
                        estimadas,
                        del_cache: true,
                    });
                    return;
                }
                // Un origen que falla al sondear no tumba el área: se anota
                // como «nada» sin guardarlo en caché, para que el siguiente
                // intento vuelva a preguntar en vez de heredar el fallo
                // durante 30 días.
                let Ok(d) = o.sondear(&qk).await else {
                    log::warn!("{} no pudo sondear {qk}", o.id());
                    sondeo.empujar(SondeoTesela {
                        quadkey: qk,
                        fuente: o.id().to_string(),
                        nivel: "nada".into(),
                        estimadas: 0,
                        del_cache: false,
                    });
                    return;
                };
                let nivel = format!("{:?}", d.nivel()).to_lowercase();
                let _ = almacen.sondeo_guardar(o.id(), &qk, &nivel, d.unidades());
                sondeo.empujar(SondeoTesela {
                    quadkey: qk,
                    fuente: o.id().to_string(),
                    nivel,
                    estimadas: d.unidades(),
                    del_cache: false,
                });
            });
        }
    }
    while tareas.join_next().await.is_some() {}
    sondeo.terminar();
}

/// Lo que costaría bajar `nuevas`, que es un mapa `fuente → teselas que ESE
/// origen no tiene cubiertas`. Las cubiertas no entran: ya están pagadas.
pub async fn estimar(
    almacen: &Almacen,
    origenes: &[Origen],
    nuevas: &BTreeMap<String, Vec<String>>,
    tope_eur: f64,
) -> Estimacion {
    let mut lineas = Vec::new();
    for o in origenes {
        let Some(teselas) = nuevas.get(o.id()) else { continue };
        if teselas.is_empty() {
            continue;
        }
        let mut unidades = 0u32;
        for qk in teselas {
            // De la caché si está; si no, se pregunta y se guarda.
            unidades += match almacen.sondeo_leer(o.id(), qk, CADUCIDAD_DIAS) {
                Ok(Some((_, n))) => n,
                _ => match o.sondear(qk).await {
                    Ok(d) => {
                        let nivel = format!("{:?}", d.nivel()).to_lowercase();
                        let _ = almacen.sondeo_guardar(o.id(), qk, &nivel, d.unidades());
                        d.unidades()
                    }
                    Err(_) => 0,
                },
            };
        }
        // Lo gratuito TAMBIÉN se lista aunque sume cero: hace falta para
        // entender de dónde va a salir cada imagen.
        lineas.push(LineaPrevista::nueva(o.id(), teselas.len() as u32, unidades, o.tarifa()));
    }
    lineas.sort_by(|a, b| b.coste_eur.total_cmp(&a.coste_eur));

    let total_eur = previsto(&lineas);
    let gastado_eur = almacen.gasto_del_mes(&spend::mes_iso()).unwrap_or(0.0);
    match cabe(gastado_eur, total_eur, tope_eur) {
        Ok(()) => Estimacion { lineas, total_eur, gastado_eur, tope_eur, cabe: true, exceso_eur: 0.0 },
        Err(e) => Estimacion {
            lineas,
            total_eur,
            gastado_eur,
            tope_eur,
            cabe: false,
            exceso_eur: e.exceso_eur,
        },
    }
}

/// Lo que la interfaz necesita saber de cada origen para pintar los
/// interruptores y la leyenda sin conocer nada del backend.
#[derive(Debug, Clone, Serialize)]
pub struct FichaOrigen {
    pub id: String,
    pub tipo: String,
    pub puntos_exactos: bool,
    pub gratis: bool,
    pub usd_por_mil: f64,
    pub redistribuye: bool,
}

pub fn fichas(origenes: &[Origen]) -> Vec<FichaOrigen> {
    origenes
        .iter()
        .map(|o| FichaOrigen {
            id: o.id().to_string(),
            tipo: format!("{:?}", o.tipo()).to_lowercase(),
            puntos_exactos: o.puntos_exactos(),
            gratis: o.tarifa().es_gratis(),
            usd_por_mil: match o.tarifa() {
                Tarifa::Gratis => 0.0,
                Tarifa::PorUnidad { usd_por_mil } => usd_por_mil,
            },
            redistribuye: !matches!(
                o.redistribucion(),
                lumi_index::network::Redistribucion::SoloLocal
            ),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use lumi_index::manifest::Tipo;
    use lumi_index::network::Tarifa;
    use crate::origins::Falso;

    fn temporal() -> (tempfile::TempDir, Almacen) {
        let d = tempfile::tempdir().unwrap();
        let a = Almacen::abrir(d.path()).unwrap();
        (d, a)
    }

    #[tokio::test]
    async fn el_segundo_sondeo_sale_del_cache_y_no_toca_el_origen() {
        let (_d, a) = temporal();
        let a = Arc::new(a);
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("falso", Tipo::Suelta, Tarifa::Gratis).con("AAA", 80).con("BBB", 0),
        )];
        let teselas = vec!["AAA".to_string(), "BBB".to_string()];

        let s1 = Arc::new(Sondeo::nuevo((o.len() * teselas.len()) as u32));
        sondear_area(a.clone(), o.clone(), teselas.clone(), s1.clone()).await;
        let uno = s1.progreso();
        assert!(uno.terminado);
        assert_eq!(uno.resultados.len(), 2);
        assert!(uno.resultados.iter().all(|s| !s.del_cache), "la primera vez se pregunta");
        assert_eq!(uno.resultados.iter().find(|s| s.quadkey == "AAA").unwrap().estimadas, 80);

        let s2 = Arc::new(Sondeo::nuevo((o.len() * teselas.len()) as u32));
        sondear_area(a, o, teselas, s2.clone()).await;
        let dos = s2.progreso();
        assert!(dos.resultados.iter().all(|s| s.del_cache), "la segunda sale de la caché");
        assert_eq!(dos.resultados.iter().find(|s| s.quadkey == "AAA").unwrap().estimadas, 80);
    }

    #[tokio::test]
    async fn la_estimacion_cuenta_solo_lo_nuevo_y_aplica_el_tope() {
        let (_d, a) = temporal();
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Calle, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 1_000)
                .con("BBB", 1_000),
        )];
        // Solo AAA es nueva: BBB ya está cubierta y no debe contar.
        let nuevas = std::collections::BTreeMap::from([(
            "caro".to_string(),
            vec!["AAA".to_string()],
        )]);

        let e = estimar(&a, &o, &nuevas, 400.0).await;
        // 1000 · 7 $/1000 · 0,93 = 6,51 €
        assert!((e.total_eur - 6.51).abs() < 1e-6, "{}", e.total_eur);
        assert_eq!(e.lineas.len(), 1);
        assert_eq!(e.lineas[0].teselas, 1, "BBB no cuenta: ya estaba cubierta");
        assert!(e.cabe);

        // Con un tope ridículo, no cabe y se dice cuánto sobra.
        let e = estimar(&a, &o, &nuevas, 1.0).await;
        assert!(!e.cabe);
        assert!((e.exceso_eur - 5.51).abs() < 1e-6, "{}", e.exceso_eur);
    }

    #[tokio::test]
    async fn el_gasto_ya_hecho_cuenta_contra_el_tope() {
        let (_d, a) = temporal();
        a.gasto_apuntar(&spend::hoy_iso(), "caro", 60_000, 396.0).unwrap();
        let o: Vec<Origen> = vec![std::sync::Arc::new(
            Falso::nuevo("caro", Tipo::Calle, Tarifa::PorUnidad { usd_por_mil: 7.00 })
                .con("AAA", 1_000),
        )];
        let nuevas =
            std::collections::BTreeMap::from([("caro".to_string(), vec!["AAA".to_string()])]);
        let e = estimar(&a, &o, &nuevas, 400.0).await;
        assert!((e.gastado_eur - 396.0).abs() < 1e-9);
        assert!(!e.cabe, "396 + 6,51 pasa de 400");
    }
}
