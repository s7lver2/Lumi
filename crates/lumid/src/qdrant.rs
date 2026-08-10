//! Qdrant, del lado de Station. El Indexer escribe vectores; aquí se leen.
//!
//! Una colección por `(modelo, versión)`: los modelos van de 8448 a 12288
//! dimensiones y un vector de uno no significa nada en el espacio de otro.
//!
//! ponytail: este módulo llega completo en la Tarea 1 pero sus llamantes
//! (instalar, volcar, recuperar, la capacidad `indices`) son tareas
//! posteriores del mismo plan; hasta que existan, algo de esto está sin usar.
#![allow(dead_code)]

use anyhow::{anyhow, Result};
use serde::Deserialize;

const BASE: &str = "http://127.0.0.1:6333";

pub fn coleccion_de(modelo: &str, version: &str) -> String {
    format!("lumi_{}_{}", modelo.replace('-', "_"), version.replace('.', "_"))
}

/// Un candidato tal como sale de Qdrant: el `id` es la fila de
/// `reference_images` en SQLite, que es lo que le da procedencia.
#[derive(Debug, Clone)]
pub struct Vecino {
    pub id: i64,
    pub similitud: f32,
}

pub struct Cliente {
    http: reqwest::Client,
}

impl Default for Cliente {
    fn default() -> Self {
        Self::nuevo()
    }
}

impl Cliente {
    pub fn nuevo() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(120))
                .build()
                .expect("construir el cliente HTTP no debería fallar"),
        }
    }

    pub async fn asegurar_coleccion(&self, nombre: &str, dims: u32) -> Result<()> {
        let existe = self
            .http
            .get(format!("{BASE}/collections/{nombre}"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false);
        if existe {
            return Ok(());
        }
        let r = self
            .http
            .put(format!("{BASE}/collections/{nombre}"))
            .json(&serde_json::json!({
                "vectors": { "size": dims, "distance": "Cosine" }
            }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("crear la colección {nombre}: {}", r.status()));
        }
        Ok(())
    }

    /// Los `ids` son filas de `reference_images`. El troceado sale del tamaño
    /// REAL del vector y no de un número fijo: cada float viaja como texto en
    /// JSON, así que un lote que vale para 8448 dimensiones revienta con
    /// 12288. Misma lección que costó una tarde en el Indexer.
    pub async fn subir(&self, nombre: &str, ids: &[i64], vectores: &[Vec<f32>]) -> Result<()> {
        const TOPE_BYTES: usize = 16 << 20;
        const BYTES_POR_FLOAT_JSON: usize = 32;
        let dims = vectores.first().map(|v| v.len()).unwrap_or(0).max(1);
        let por_lote = (TOPE_BYTES / (dims * BYTES_POR_FLOAT_JSON)).max(1);

        for trozo in 0..ids.len().div_ceil(por_lote) {
            let desde = trozo * por_lote;
            let hasta = (desde + por_lote).min(ids.len());
            let puntos: Vec<serde_json::Value> = (desde..hasta)
                .map(|i| serde_json::json!({ "id": ids[i], "vector": vectores[i] }))
                .collect();
            let r = self
                .http
                .put(format!("{BASE}/collections/{nombre}/points?wait=true"))
                .json(&serde_json::json!({ "points": puntos }))
                .send()
                .await?;
            if !r.status().is_success() {
                return Err(anyhow!("subir puntos a {nombre}: {}", r.status()));
            }
        }
        Ok(())
    }

    /// Los `limite` vecinos más próximos. Devuelve ids de SQLite, no vectores:
    /// lo que hace falta después es la procedencia, no los números.
    pub async fn buscar(&self, nombre: &str, vector: &[f32], limite: usize) -> Result<Vec<Vecino>> {
        #[derive(Deserialize)]
        struct Punto {
            id: i64,
            score: f32,
        }
        #[derive(Deserialize)]
        struct Respuesta {
            result: Vec<Punto>,
        }
        let r = self
            .http
            .post(format!("{BASE}/collections/{nombre}/points/search"))
            .json(&serde_json::json!({
                "vector": vector, "limit": limite, "with_payload": false
            }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("buscar en {nombre}: {}", r.status()));
        }
        let cuerpo: Respuesta = r.json().await?;
        Ok(cuerpo
            .result
            .into_iter()
            .map(|p| Vecino { id: p.id, similitud: p.score })
            .collect())
    }

    /// Al desinstalar un índice. Los puntos de otros índices no se tocan
    /// porque el `id` es la fila de SQLite y es único en toda la aplicación.
    pub async fn borrar(&self, nombre: &str, ids: &[i64]) -> Result<()> {
        let r = self
            .http
            .post(format!("{BASE}/collections/{nombre}/points/delete?wait=true"))
            .json(&serde_json::json!({ "points": ids }))
            .send()
            .await?;
        if !r.status().is_success() {
            return Err(anyhow!("borrar puntos de {nombre}: {}", r.status()));
        }
        Ok(())
    }

    /// Si Qdrant no responde en el plazo corto, la capacidad `indices` se ve
    /// deshabilitada con el motivo. Un timeout largo aquí colgaría `/v1/hello`,
    /// que es lo primero que el cliente pide y no puede esperar a una red caída.
    pub async fn vivo(&self) -> bool {
        let cliente = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_millis(300))
            .timeout(std::time::Duration::from_millis(500))
            .build();
        let Ok(cliente) = cliente else { return false };
        cliente
            .get(format!("{BASE}/collections"))
            .send()
            .await
            .map(|r| r.status().is_success())
            .unwrap_or(false)
    }
}
