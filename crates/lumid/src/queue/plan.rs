//! Quién corre ahora y en qué dispositivo.
//!
//! Es una función pura a propósito. Toda la política —prioridades, conectado
//! contra segundo plano, cupos, bloqueos— es donde más fácil es equivocarse y
//! donde más caro sale depurar contra hardware real. Aquí entra una lista y
//! sale otra: sin base de datos, sin procesos y sin reloj.

use std::collections::HashMap;

/// Un trabajo esperando.
#[derive(Debug, Clone, PartialEq)]
pub struct Candidato {
    pub analysis_id: i64,
    pub user_id: i64,
    pub modelo: String,
    pub created_at: i64,
}

/// Lo que se sabe del dueño de un trabajo en el instante de repartir.
///
/// «Pausado» no es un estado del trabajo sino una propiedad de su dueño mirada
/// aquí. Por eso bloqueado, desconectado y con el cupo lleno son la misma cosa:
/// filtros. Como no se guardan en ninguna parte, no pueden atascarse.
#[derive(Debug, Clone, Copy)]
pub struct Dueno {
    pub bloqueado: bool,
    pub conectado: bool,
    pub segundo_plano: bool,
    pub max_concurrent: i64,
    pub prioridad: i64,
    /// Cuántos tiene ya corriendo, antes de este reparto.
    pub en_curso: i64,
}

/// Un trabajador que ha dicho `listo` y no tiene trabajo en la mano.
#[derive(Debug, Clone, PartialEq)]
pub struct Libre {
    pub dispositivo: String,
    /// El modelo que ya tiene cargado. `None` recién arrancado.
    pub modelo: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Asignacion {
    pub analysis_id: i64,
    pub dispositivo: String,
}

pub fn repartir(
    candidatos: &[Candidato],
    duenos: &HashMap<i64, Dueno>,
    libres: &[Libre],
) -> Vec<Asignacion> {
    // 1. Descarta lo que no puede correr ahora mismo. Un candidato sin dueño
    //    conocido se cae solo con el `?`: es un usuario borrado y su trabajo no
    //    tiene a quién pertenecer.
    let mut cola: Vec<(&Candidato, &Dueno)> = candidatos
        .iter()
        .filter_map(|c| Some((c, duenos.get(&c.user_id)?)))
        .filter(|(_, d)| !d.bloqueado)
        .filter(|(_, d)| d.conectado || d.segundo_plano)
        .filter(|(_, d)| d.en_curso < d.max_concurrent)
        .collect();

    // 2. Ordena: conectado antes que segundo plano, luego prioridad de mayor a
    //    menor, y a igualdad el que lleva más esperando. `sort_by` es estable,
    //    así que un empate total respeta el orden en que vinieron.
    cola.sort_by(|(ca, da), (cb, db)| {
        db.conectado
            .cmp(&da.conectado)
            .then(db.prioridad.cmp(&da.prioridad))
            .then(ca.created_at.cmp(&cb.created_at))
    });

    // 3. Asigna. `comprometidos` cuenta lo que ESTE reparto ya dio: sin eso, un
    //    usuario con cupo 2 y cinco trabajos se llevaría los cinco de una
    //    tacada, porque `en_curso` es la foto de antes de empezar a repartir.
    let mut comprometidos: HashMap<i64, i64> = HashMap::new();
    let mut disponibles: Vec<Libre> = libres.to_vec();
    let mut out = Vec::new();

    for (c, d) in cola {
        if disponibles.is_empty() {
            break;
        }
        let ya = comprometidos.get(&c.user_id).copied().unwrap_or(0);
        if d.en_curso + ya >= d.max_concurrent {
            continue;
        }

        // Cambiar de modelo cuesta cargar pesos, así que entre dos libres gana
        // el que ya lo tiene puesto. Con varias GPUs esto hace que los
        // dispositivos se especialicen solos en el modelo que más les toca, sin
        // que nadie lo configure: no es un mecanismo aparte, es lo que emerge.
        let i = disponibles
            .iter()
            .position(|l| l.modelo.as_deref() == Some(c.modelo.as_str()))
            .unwrap_or(0);
        let elegido = disponibles.remove(i);
        out.push(Asignacion { analysis_id: c.analysis_id, dispositivo: elegido.dispositivo });
        *comprometidos.entry(c.user_id).or_insert(0) += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dueno(
        bloqueado: bool, conectado: bool, segundo_plano: bool,
        max_concurrent: i64, prioridad: i64, en_curso: i64,
    ) -> Dueno {
        Dueno { bloqueado, conectado, segundo_plano, max_concurrent, prioridad, en_curso }
    }
    fn cand(analysis_id: i64, user_id: i64, created_at: i64) -> Candidato {
        Candidato { analysis_id, user_id, modelo: "mini".into(), created_at }
    }
    fn libre(dispositivo: &str, modelo: Option<&str>) -> Libre {
        Libre { dispositivo: dispositivo.into(), modelo: modelo.map(String::from) }
    }

    #[test]
    fn la_politica_de_reparto() {
        let uno = [libre("cuda:0", None)];

        // Un bloqueado no corre aunque esté conectado y sea el único.
        let d = HashMap::from([(1, dueno(true, true, false, 2, 0, 0))]);
        assert!(repartir(&[cand(10, 1, 100)], &d, &uno).is_empty());

        // Un desconectado sin segundo plano tampoco.
        let d = HashMap::from([(1, dueno(false, false, false, 2, 0, 0))]);
        assert!(repartir(&[cand(10, 1, 100)], &d, &uno).is_empty());

        // Con segundo plano sí corre, pero detrás del conectado aunque pidiera
        // mucho antes: esa es toda la diferencia entre las dos categorías.
        let d = HashMap::from([
            (1, dueno(false, false, true, 2, 0, 0)),
            (2, dueno(false, true, false, 2, 0, 0)),
        ]);
        let r = repartir(&[cand(10, 1, 100), cand(20, 2, 900)], &d, &uno);
        assert_eq!(r.len(), 1);
        assert_eq!(r[0].analysis_id, 20, "el conectado va primero");

        // A igualdad de conexión manda la prioridad, y luego la llegada.
        let d = HashMap::from([
            (1, dueno(false, true, false, 5, 0, 0)),
            (2, dueno(false, true, false, 5, 3, 0)),
        ]);
        let tres = [libre("a", None), libre("b", None), libre("c", None)];
        let r = repartir(&[cand(10, 1, 100), cand(20, 2, 200), cand(30, 1, 50)], &d, &tres);
        assert_eq!(r.iter().map(|a| a.analysis_id).collect::<Vec<_>>(), vec![20, 30, 10]);

        // El cupo corta DENTRO del mismo reparto, no solo contra la foto previa.
        let cinco: Vec<Candidato> = (0..5).map(|i| cand(i, 1, i)).collect();
        let cuatro =
            [libre("a", None), libre("b", None), libre("c", None), libre("d", None)];
        let d = HashMap::from([(1, dueno(false, true, false, 2, 0, 0))]);
        assert_eq!(repartir(&cinco, &d, &cuatro).len(), 2);

        // Y con uno ya corriendo, solo cabe uno más.
        let d = HashMap::from([(1, dueno(false, true, false, 2, 0, 1))]);
        assert_eq!(repartir(&cinco, &d, &cuatro).len(), 1);

        // Entre dos libres gana el que ya tiene ese modelo cargado.
        let d = HashMap::from([(1, dueno(false, true, false, 5, 0, 0))]);
        let r = repartir(
            &[cand(10, 1, 100)],
            &d,
            &[libre("frio", Some("vision")), libre("caliente", Some("mini"))],
        );
        assert_eq!(r[0].dispositivo, "caliente");

        // Sin trabajadores no se reparte nada, y no revienta.
        assert!(repartir(&cinco, &d, &[]).is_empty());
    }
}
