//! Los vectores de un fragmento, cuantizados.
//!
//! El elefante del tamaño son los vectores: con lumi-2 a 12288 dimensiones,
//! 200 000 imágenes son ~9.8 GB en float32, ~2.5 GB en int8 y ~0.3 GB en
//! binario. El paquete lleva binario e int8 dentro de cada fragmento, y el
//! float32 como extra opcional.
//!
//! PRECONDICIÓN: los vectores llegan normalizados a L2, así que sus
//! componentes están en [-1, 1] y la escala del int8 es fija (127). Sin esa
//! precondición habría que guardar una escala por fichero, y el formato
//! dejaría de leerse con cinco líneas de código.
//!
//! El ORDEN es el contrato: la fila N del fichero es la imagen N según
//! `indice.db`. Nada más ata un vector a su imagen.

use std::io::{Read, Write};

use anyhow::{bail, Result};

const MAGIA: &[u8; 8] = b"LUMIVEC1";
pub const CABECERA_BYTES: usize = 32;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Forma {
    /// Un bit por dimensión: solo el signo. Es sobre lo que se busca.
    Binario,
    /// int8 escalar con escala fija 127. Es lo que reescala al binario.
    Int8,
}

impl Forma {
    fn byte(self) -> u8 {
        match self {
            Forma::Binario => 1,
            Forma::Int8 => 2,
        }
    }
    fn de_byte(b: u8) -> Result<Forma> {
        Ok(match b {
            1 => Forma::Binario,
            2 => Forma::Int8,
            otro => bail!("forma de vector desconocida: {otro}"),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cabecera {
    pub dims: u32,
    pub cuenta: u32,
    pub forma: Forma,
}

fn escribir_cabecera(w: &mut impl Write, c: Cabecera) -> Result<()> {
    let mut b = [0u8; CABECERA_BYTES];
    b[0..8].copy_from_slice(MAGIA);
    b[8..12].copy_from_slice(&c.dims.to_le_bytes());
    b[12..16].copy_from_slice(&c.cuenta.to_le_bytes());
    b[16] = c.forma.byte();
    w.write_all(&b)?;
    Ok(())
}

pub fn leer_cabecera(r: &mut impl Read) -> Result<Cabecera> {
    let mut b = [0u8; CABECERA_BYTES];
    r.read_exact(&mut b)?;
    if &b[0..8] != MAGIA {
        bail!("esto no es un fragmento de vectores de Lumi");
    }
    Ok(Cabecera {
        dims: u32::from_le_bytes(b[8..12].try_into().unwrap()),
        cuenta: u32::from_le_bytes(b[12..16].try_into().unwrap()),
        forma: Forma::de_byte(b[16])?,
    })
}

fn dims_de(vs: &[Vec<f32>]) -> Result<u32> {
    let Some(primero) = vs.first() else { return Ok(0) };
    let d = primero.len();
    if d == 0 {
        bail!("un vector de cero dimensiones no es un vector");
    }
    if vs.iter().any(|v| v.len() != d) {
        bail!("todos los vectores del fragmento deben tener las mismas dimensiones");
    }
    Ok(d as u32)
}

pub fn escribir_i8(w: &mut impl Write, vs: &[Vec<f32>]) -> Result<()> {
    let dims = dims_de(vs)?;
    escribir_cabecera(w, Cabecera { dims, cuenta: vs.len() as u32, forma: Forma::Int8 })?;
    for v in vs {
        let fila: Vec<u8> =
            v.iter().map(|x| ((x.clamp(-1.0, 1.0) * 127.0).round() as i8) as u8).collect();
        w.write_all(&fila)?;
    }
    Ok(())
}

pub fn leer_i8(r: &mut impl Read) -> Result<Vec<Vec<f32>>> {
    let c = leer_cabecera(r)?;
    if c.forma != Forma::Int8 {
        bail!("se esperaba un fragmento int8");
    }
    let mut fuera = Vec::with_capacity(c.cuenta as usize);
    let mut fila = vec![0u8; c.dims as usize];
    for _ in 0..c.cuenta {
        r.read_exact(&mut fila)?;
        fuera.push(fila.iter().map(|b| (*b as i8) as f32 / 127.0).collect());
    }
    Ok(fuera)
}

pub fn escribir_b1(w: &mut impl Write, vs: &[Vec<f32>]) -> Result<()> {
    let dims = dims_de(vs)?;
    escribir_cabecera(w, Cabecera { dims, cuenta: vs.len() as u32, forma: Forma::Binario })?;
    let bytes_por_vector = (dims as usize).div_ceil(8);
    for v in vs {
        let mut fila = vec![0u8; bytes_por_vector];
        for (i, x) in v.iter().enumerate() {
            if *x > 0.0 {
                fila[i / 8] |= 1 << (7 - (i % 8));
            }
        }
        w.write_all(&fila)?;
    }
    Ok(())
}

pub fn leer_b1(r: &mut impl Read) -> Result<Vec<Vec<bool>>> {
    let c = leer_cabecera(r)?;
    if c.forma != Forma::Binario {
        bail!("se esperaba un fragmento binario");
    }
    let bytes_por_vector = (c.dims as usize).div_ceil(8);
    let mut fuera = Vec::with_capacity(c.cuenta as usize);
    let mut fila = vec![0u8; bytes_por_vector];
    for _ in 0..c.cuenta {
        r.read_exact(&mut fila)?;
        fuera.push(
            (0..c.dims as usize).map(|i| fila[i / 8] & (1 << (7 - (i % 8))) != 0).collect(),
        );
    }
    Ok(fuera)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Vectores normalizados a L2, que es la precondición del formato.
    fn normalizar(mut v: Vec<f32>) -> Vec<f32> {
        let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        if n > 0.0 {
            for x in &mut v {
                *x /= n;
            }
        }
        v
    }

    #[test]
    fn el_fragmento_va_y_vuelve_conservando_el_orden() {
        let vs: Vec<Vec<f32>> = vec![
            normalizar(vec![1.0, 0.0, -1.0, 0.5]),
            normalizar(vec![-0.25, 0.75, 0.1, -0.9]),
            normalizar(vec![0.3, 0.3, 0.3, 0.3]),
        ];

        // int8: vuelve casi igual. El error máximo de una escala de 127 sobre
        // un vector normalizado es medio paso, 1/254.
        let mut buf = Vec::new();
        escribir_i8(&mut buf, &vs).unwrap();
        let vuelta = leer_i8(&mut buf.as_slice()).unwrap();
        assert_eq!(vuelta.len(), vs.len(), "mismo número de vectores");
        for (i, (a, b)) in vs.iter().zip(&vuelta).enumerate() {
            for (j, (x, y)) in a.iter().zip(b).enumerate() {
                assert!((x - y).abs() <= 1.0 / 254.0 + 1e-6, "v{i}[{j}]: {x} vs {y}");
            }
        }
        // El orden es el contrato: la fila N del fichero es la imagen N de
        // indice.db. Si se permutara, cada vector quedaría pegado a la imagen
        // equivocada y nadie se enteraría.
        assert!(vuelta[0][0] > vuelta[1][0], "el primero sigue siendo el primero");

        // binario: solo el signo, 1 bit por dimensión.
        let mut buf = Vec::new();
        escribir_b1(&mut buf, &vs).unwrap();
        assert_eq!(
            buf.len(),
            CABECERA_BYTES + 3,
            "4 dimensiones caben en 1 byte por vector"
        );
        let bits = leer_b1(&mut buf.as_slice()).unwrap();
        assert_eq!(bits.len(), 3);
        assert_eq!(bits[0], vec![true, false, false, true], "signos de v0");
        assert_eq!(bits[1], vec![false, true, true, false], "signos de v1");

        // Una cabecera de otro formato no se traga: es lo que evita leer
        // basura como si fueran vectores.
        let mut roto = buf.clone();
        roto[0] = b'X';
        assert!(leer_b1(&mut roto.as_slice()).is_err());
    }
}
