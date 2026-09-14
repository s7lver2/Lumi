//! Repartir las quadkeys de un paquete en trozos que quepan en un asset.

use serde::{Deserialize, Serialize};

/// Por debajo del límite de 2 GiB por asset de release de GitHub, con margen
/// para la cabecera de cifrado y para que un redondeo no tire una subida de
/// dos horas.
pub const TOPE_TROZO_BYTES: u64 = 1_800_000_000;

/// El límite DURO del proveedor: 2 GiB por asset de release en GitHub. Es
/// distinto de `TOPE_TROZO_BYTES` a propósito — aquel es el objetivo al
/// agrupar, este es la pared contra la que se estrella una subida.
pub const TOPE_ASSET_BYTES: u64 = 2 * 1024 * 1024 * 1024;

/// Los trozos que NO caben en un asset del proveedor.
///
/// `trocear` agrupa quadkeys hasta `tope`, pero una quadkey SOLA más pesada
/// que el tope no se puede partir más (media tesela no es una unidad
/// instalable), así que va sola en su trozo aunque lo desborde. Eso está
/// asumido desde el principio; lo que faltaba era DECIRLO a tiempo.
///
/// Sin esto, el desbordamiento solo se descubría subiendo: el paquete se
/// empaquetaba en memoria, se cifraba, se intentaba subir tres veces y el
/// operador acababa viendo «no se pudo subir tras tres intentos» después de
/// horas, sin ninguna pista de que la causa era el tamaño y de que reintentar
/// no iba a arreglarlo nunca. Caso real: la tesela del centro de León con
/// 2.910 imágenes pesaba 5,6 GB, casi el triple del límite.
///
/// Ya NO es motivo de fallo: desde el spec del cuerpo multi-parte, un trozo
/// desbordado se publica partiendo su cuerpo CIFRADO en varios ficheros
/// físicos (ver `partir_en_trozos`). Esto sigue existiendo para avisar de
/// que esa publicación va a subir partida, que es información útil, no una
/// lista de "esto va a fallar".
pub fn desbordados(trozos: &[Trozo], tope_asset: u64) -> Vec<&Trozo> {
    trozos.iter().filter(|t| t.bytes > tope_asset).collect()
}

/// Divide `bytes` en trozos de como mucho `tope` bytes cada uno, en orden.
///
/// De propósito general — no sabe nada de quadkeys ni de assets, solo corta
/// un buffer. Se usa cuando el CUERPO CIFRADO de una tesela (ya troceado por
/// geografía en `trocear`, y aun así de un tamaño que no cabe en un asset del
/// proveedor) necesita partirse por transporte: lo que se parte es el viaje
/// de un blob que sigue siendo una sola unidad lógica, no el contenido.
///
/// `chunks` de la stdlib ya hace exactamente esto; la función existe para
/// darle un nombre del dominio y un sitio donde documentar el porqué, no
/// para reimplementar nada.
pub fn partir_en_trozos(bytes: &[u8], tope: usize) -> Vec<&[u8]> {
    if bytes.is_empty() {
        return Vec::new();
    }
    // `max(1)` porque `chunks(0)` entra en pánico; un tope de cero no tiene
    // significado en el dominio, así que se trata como "de uno en uno".
    bytes.chunks(tope.max(1)).collect()
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Trozo {
    /// Nombra el asset — es lo que hace que un trozo se pueda describir por
    /// su zona en vez de por un número de orden que no significa nada.
    /// Normalmente ES la quadkey más corta que contiene a todas las de
    /// dentro (`prefijo_comun`); cuando dos trozos DISTINTOS de la misma
    /// llamada calculan el mismo valor (ver `desambiguar_prefijos`), este
    /// campo lleva un sufijo que rompe el empate — deja de ser literalmente
    /// un prefijo compartido, pero sigue siendo la identidad del asset, que
    /// es lo único que a quien llama le hace falta que sea única.
    pub prefijo: String,
    pub quadkeys: Vec<String>,
    pub bytes: u64,
}

/// Las quadkeys ordenadas alfabéticamente están ordenadas espacialmente —son
/// una curva Z—, así que acumular en orden ya produce trozos vecinos entre sí
/// sin tener que calcular ninguna distancia.
pub fn trocear(pesos: &[(String, u64)], tope: u64) -> Vec<Trozo> {
    let mut ordenadas: Vec<&(String, u64)> = pesos.iter().collect();
    ordenadas.sort_by(|a, b| a.0.cmp(&b.0));

    let mut trozos: Vec<Trozo> = Vec::new();
    let mut actual: Vec<String> = Vec::new();
    let mut bytes = 0u64;

    for (qk, b) in ordenadas {
        if !actual.is_empty() && bytes + b > tope {
            trozos.push(cerrar(std::mem::take(&mut actual), bytes));
            bytes = 0;
        }
        actual.push(qk.clone());
        bytes += b;
    }
    if !actual.is_empty() {
        trozos.push(cerrar(actual, bytes));
    }
    desambiguar_prefijos(trozos)
}

/// `prefijo_comun` solo mira DENTRO de un trozo — nada le impide coincidir
/// con el de otro. Una zona urbana lo bastante densa se parte en varios
/// trozos por tamaño (`tope`) mucho antes de que sus quadkeys dejen de
/// compartir el mismo padre, así que dos trozos VECINOS y DISTINTOS pueden
/// calcular el mismo prefijo sin que nada en `trocear` lo note.
///
/// Sin desambiguar, `publicar()` construye el mismo nombre de fichero para
/// los dos (`cuerpo-{prefijo}.lumidx.enc`): el segundo pisa al primero en
/// GitHub al subir, y la ficha se queda con dos entradas para el mismo
/// nombre — una apuntando a contenido que ya no existe. Caso real,
/// 2026-09-14: el centro de León (`03133320022*`) es denso de sobra para
/// que dos trozos distintos calcularan ambos el prefijo `03133320022`.
///
/// El desempate es estable: SOLO se toca a los que colisionan (la inmensa
/// mayoría de índices, sin zonas tan densas, no cambia ni un nombre), y el
/// sufijo es su posición dentro del grupo de colisión, en el mismo orden
/// determinista en que `trocear` ya los produce.
fn desambiguar_prefijos(mut trozos: Vec<Trozo>) -> Vec<Trozo> {
    // Dueño de sus propias `String`, no prestado de `trozos`: se necesita
    // seguir leyendo estos recuentos mientras se muta `trozos` más abajo, y
    // un mapa de `&str` prestados de ahí mismo se lo impediría.
    let mut apariciones: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for t in &trozos {
        *apariciones.entry(t.prefijo.clone()).or_insert(0) += 1;
    }
    let mut visto: std::collections::HashMap<String, u32> = std::collections::HashMap::new();
    for t in &mut trozos {
        if apariciones[&t.prefijo] > 1 {
            let n = visto.entry(t.prefijo.clone()).or_insert(0);
            *n += 1;
            t.prefijo = format!("{}-{n}", t.prefijo);
        }
    }
    trozos
}

fn cerrar(quadkeys: Vec<String>, bytes: u64) -> Trozo {
    Trozo { prefijo: prefijo_comun(&quadkeys), quadkeys, bytes }
}

fn prefijo_comun(qs: &[String]) -> String {
    let Some(primera) = qs.first() else { return String::new() };
    let mut largo = primera.len();
    for q in &qs[1..] {
        largo = largo.min(
            primera.chars().zip(q.chars()).take_while(|(a, b)| a == b).count(),
        );
    }
    primera[..largo].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pesos(v: &[(&str, u64)]) -> Vec<(String, u64)> {
        v.iter().map(|(q, b)| (q.to_string(), *b)).collect()
    }

    #[test]
    fn ningun_trozo_pasa_del_tope() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600), ("0313110", 600)]);
        for t in trocear(&p, 1_000) {
            assert!(t.bytes <= 1_000, "trozo de {} bytes", t.bytes);
        }
    }

    #[test]
    fn cada_quadkey_aparece_exactamente_una_vez() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        let mut vistas: Vec<String> =
            trocear(&p, 1_000).into_iter().flat_map(|t| t.quadkeys).collect();
        vistas.sort();
        assert_eq!(vistas, vec!["0313101", "0313102", "0313103"]);
    }

    /// El caso real que costó una publicación entera: una zona tan densa
    /// que hace falta partirla en dos trozos POR TAMAÑO, pero las quadkeys
    /// de los dos siguen compartiendo el mismo padre — `prefijo_comun`
    /// calcula el mismo valor para ambos porque solo mira dentro de cada
    /// trozo. Sin desambiguar, los dos cuerpos se llamarían igual y el
    /// segundo pisaría al primero al publicar.
    #[test]
    fn dos_trozos_con_el_mismo_prefijo_comun_no_colisionan() {
        // Seis quadkeys, todas bajo "0313332002", partidas en tres trozos de
        // dos por el tope — las tres calcularían "0313332002" a secas si
        // nada las distinguiera.
        let p = pesos(&[
            ("03133320020", 600), ("03133320021", 600),
            ("03133320022", 600), ("03133320023", 600),
            ("03133320024", 600), ("03133320025", 600),
        ]);
        let trozos = trocear(&p, 1_200);
        assert_eq!(trozos.len(), 3, "seis quadkeys de 600 con tope 1200 dan tres trozos");

        let prefijos: Vec<&str> = trozos.iter().map(|t| t.prefijo.as_str()).collect();
        let mut unicos = prefijos.clone();
        unicos.sort();
        unicos.dedup();
        assert_eq!(unicos.len(), prefijos.len(), "cada trozo debe tener un nombre distinto: {prefijos:?}");

        // Y el desempate es legible, no un hash opaco: sigue empezando por
        // el prefijo real, con un sufijo que solo distingue.
        for p in &prefijos {
            assert!(p.starts_with("0313332002"), "«{p}» perdió el prefijo real al desambiguar");
        }
    }

    /// El caso normal —sin colisión— no debe cambiar ni un nombre: la
    /// desambiguación solo toca lo que de verdad colisiona.
    #[test]
    fn sin_colision_los_prefijos_no_llevan_sufijo() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        for t in trocear(&p, 1_000) {
            assert!(!t.prefijo.contains('-'), "«{}» no debería llevar sufijo sin colisión", t.prefijo);
        }
    }

    // Una tesela sola más grande que el tope no se puede partir más: el
    // troceado es por geografía, y media tesela no es una unidad instalable.
    // Va sola en su trozo aunque lo desborde. Que eso pase sigue siendo
    // legítimo; lo que NO puede pasar es que se descubra subiendo — para eso
    // está `desbordados`, ver el test de abajo.
    #[test]
    fn una_tesela_mas_grande_que_el_tope_va_sola() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let gorda = ts.iter().find(|t| t.bytes == 5_000).expect("falta el trozo gordo");
        assert_eq!(gorda.quadkeys, vec!["0313102"]);
    }

    /// El caso real que costó una publicación entera: la tesela del centro de
    /// León pesaba 5,6 GB y el límite de GitHub son 2 GiB. `trocear` la deja
    /// sola (no puede hacer otra cosa) y `desbordados` es quien lo señala
    /// ANTES de empaquetar 5,6 GB en memoria y subirlos tres veces.
    #[test]
    fn una_tesela_que_no_cabe_en_un_asset_se_señala() {
        let p = pesos(&[("0313101", 100), ("0313102", 5_000), ("0313103", 100)]);
        let ts = trocear(&p, 1_000);
        let fuera = desbordados(&ts, 2_000);
        assert_eq!(fuera.len(), 1);
        assert_eq!(fuera[0].quadkeys, vec!["0313102"]);
    }

    /// Y lo que sí cabe no se señala: un trozo agrupado hasta el tope normal
    /// está por debajo del límite duro por construcción.
    #[test]
    fn lo_que_cabe_no_se_señala() {
        let p = pesos(&[("0313101", 600), ("0313102", 600), ("0313103", 600)]);
        assert!(desbordados(&trocear(&p, 1_000), 2_000).is_empty());
    }

    #[test]
    fn el_prefijo_nombra_la_zona_comun() {
        let p = pesos(&[("03131010", 10), ("03131011", 10)]);
        assert_eq!(trocear(&p, 1_000)[0].prefijo, "0313101");
    }

    #[test]
    fn sin_quadkeys_no_hay_trozos() {
        assert!(trocear(&[], 1_000).is_empty());
    }

    #[test]
    fn partir_en_trozos_respeta_el_tope_y_no_pierde_bytes() {
        let datos: Vec<u8> = (0..250u32).map(|i| (i % 256) as u8).collect();
        let trozos = partir_en_trozos(&datos, 100);
        assert_eq!(trozos.len(), 3);
        assert_eq!(trozos[0].len(), 100);
        assert_eq!(trozos[1].len(), 100);
        assert_eq!(trozos[2].len(), 50);
        let reunido: Vec<u8> = trozos.concat();
        assert_eq!(reunido, datos);
    }

    #[test]
    fn lo_que_cabe_en_un_tope_da_un_solo_trozo() {
        let datos = vec![1u8, 2, 3];
        assert_eq!(partir_en_trozos(&datos, 100).len(), 1);
    }

    #[test]
    fn vacio_no_da_trozos() {
        assert!(partir_en_trozos(&[], 100).is_empty());
    }
}
