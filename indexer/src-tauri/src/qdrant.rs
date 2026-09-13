//! Cliente HTTP mínimo de Qdrant.
//!
//! No se usa el crate oficial: hacen falta cuatro operaciones (crear
//! colección, subir puntos, leer puntos con vector, borrar colección) y el
//! crate arrastra gRPC y su generación de código para eso.
//!
//! Una colección por (modelo, versión). Qdrant NO permite añadir un vector con
//! nombre nuevo a una colección existente —habría que recrearla y reindexar—,
//! así que instalar un modelo es crear una colección y desinstalarlo es
//! borrarla, sin tocar nada más.

use anyhow::{bail, Result};
use serde_json::json;

use crate::services::QDRANT_PUERTO;

/// `lumi-2` + `1.0` → `lumi_img__lumi_2_1_0`. Todo lo que no sea alfanumérico
/// pasa a `_` porque el nombre acaba en una URL.
pub fn coleccion_de(modelo: &str, version: &str) -> String {
    let limpio = |s: &str| {
        s.chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '_' }).collect::<String>()
    };
    format!("lumi_img__{}_{}", limpio(modelo), limpio(version))
}

pub struct Cliente {
    base: String,
    http: reqwest::Client,
}

impl Cliente {
    pub fn nuevo() -> Self {
        Self {
            base: format!("http://127.0.0.1:{QDRANT_PUERTO}"),
            http: reqwest::Client::new(),
        }
    }

    /// Crea la colección si no existe. Cuantización binaria con reescalado
    /// contra los vectores guardados: es la configuración normal de Qdrant para
    /// dimensionalidades altas, no un apaño.
    pub async fn asegurar_coleccion(&self, nombre: &str, dims: u32) -> Result<()> {
        let url = format!("{}/collections/{nombre}", self.base);
        if self.http.get(&url).send().await?.status().is_success() {
            return Ok(());
        }
        // `on_disk` en los vectores y en el grafo HNSW. Sin esto, Qdrant carga
        // enteros los vectores en precisión completa (12288-d × 4 B) y el
        // grafo: nueve colecciones, 292.000 puntos, 9,0 GB en disco y 9,9 GB
        // de RSS — se paga lo caro sin aprovechar lo barato, porque la
        // cuantización binaria que ya sirve la búsqueda ocupa ~32× menos y los
        // originales solo se tocan al reordenar candidatos.
        let cuerpo = json!({
            "vectors": { "size": dims, "distance": "Cosine", "on_disk": true },
            "hnsw_config": { "on_disk": true },
            "quantization_config": { "binary": { "always_ram": true } }
        });
        let r = self.http.put(&url).json(&cuerpo).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó crear «{nombre}»: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Pasa una colección YA EXISTENTE a `on_disk`. No se recrea: reindexar
    /// 292.000 vectores desde cero costaría horas de GPU ya pagadas. Qdrant
    /// aplica el cambio en su siguiente optimización, de fondo.
    pub async fn migrar_a_on_disk(&self, nombre: &str) -> Result<()> {
        let url = format!("{}/collections/{nombre}", self.base);
        // OJO con la forma del `vectors`: al CREAR (`PUT`) se admite la
        // configuración del vector sin nombre directamente, pero al PARCHEAR
        // (`PATCH`) Qdrant espera un mapa de nombre → cambios, y el vector por
        // defecto se llama "". Con `{"vectors": {"on_disk": true}}` responde
        // «invalid type: boolean `true`, expected struct VectorParamsDiff» —
        // comprobado contra la instancia real (Qdrant 1.19.0).
        let cuerpo = json!({
            "vectors": { "": { "on_disk": true } },
            "hnsw_config": { "on_disk": true },
        });
        let r = self.http.patch(&url).json(&cuerpo).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó migrar «{nombre}» a on_disk: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Todas las colecciones que haya, migradas. Es seguro repetirlo: poner
    /// `on_disk` en algo que ya lo tiene no hace nada.
    pub async fn migrar_todas_a_on_disk(&self) -> Result<Vec<String>> {
        let r = self.http.get(format!("{}/collections", self.base)).send().await?;
        let cuerpo: serde_json::Value = r.json().await?;
        let nombres: Vec<String> = cuerpo["result"]["collections"]
            .as_array()
            .map(|a| a.iter().filter_map(|c| c["name"].as_str().map(String::from)).collect())
            .unwrap_or_default();
        let mut hechas = Vec::new();
        for n in &nombres {
            self.migrar_a_on_disk(n).await?;
            hechas.push(n.clone());
        }
        Ok(hechas)
    }

    /// Sube un bloque de puntos, troceado en lotes que quepan bajo el límite
    /// de cuerpo HTTP de Qdrant (32 MiB por defecto). `ids` son los
    /// `imagenes.id` de SQLite, que es lo que ata cada vector a su fila.
    ///
    /// El tamaño del lote se calcula a partir de la dimensión REAL del
    /// vector, no de un número fijo: 5173 imágenes de una importación legacy
    /// con un vector de 8448 floats pesan 944 MB como JSON —cada float es
    /// texto, no 4 bytes binarios— y de un golpe Qdrant lo rechazaba entero.
    /// Con `lumi-2` (12288-d) un lote fijo que valiera hoy reventaría igual.
    pub async fn subir(
        &self,
        nombre: &str,
        ids: &[i64],
        vectores: &[Vec<f32>],
        quadkeys: &[String],
    ) -> Result<()> {
        if ids.len() != vectores.len() || ids.len() != quadkeys.len() {
            bail!("subir: ids, vectores y quadkeys tienen que venir en paralelo");
        }
        if ids.is_empty() {
            return Ok(());
        }
        // El primer cálculo (16 bytes/float, tope en 24 MiB) todavía reventó
        // el límite real: un lote de 186 puntos de 8448-d midió 33 951 060
        // bytes, 182 533 por punto — 21,6 bytes por float, no 16. `serde_json`
        // no serializa un `f32` con su propia precisión corta: lo promueve a
        // `f64` y escribe el decimal más corto que redondea a ESE `f64`, que
        // para un `f32` no exacto suele ser mucho más largo que sus 7-8
        // cifras significativas. De ahí el margen grande, medido contra el
        // fallo real y no adivinado.
        const TOPE_BYTES: usize = 16 << 20;
        const BYTES_POR_FLOAT_JSON: usize = 32;
        let dims = vectores[0].len().max(1);
        let por_lote = (TOPE_BYTES / (dims * BYTES_POR_FLOAT_JSON)).max(1);

        for desde in (0..ids.len()).step_by(por_lote) {
            let hasta = (desde + por_lote).min(ids.len());
            self.subir_lote(nombre, &ids[desde..hasta], &vectores[desde..hasta], &quadkeys[desde..hasta])
                .await?;
        }
        Ok(())
    }

    async fn subir_lote(
        &self,
        nombre: &str,
        ids: &[i64],
        vectores: &[Vec<f32>],
        quadkeys: &[String],
    ) -> Result<()> {
        let puntos: Vec<_> = ids
            .iter()
            .zip(vectores)
            .zip(quadkeys)
            .map(|((id, v), qk)| json!({ "id": id, "vector": v, "payload": { "qk": qk } }))
            .collect();
        let url = format!("{}/collections/{nombre}/points?wait=true", self.base);
        let r = self.http.put(&url).json(&json!({ "points": puntos })).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó los puntos: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Borra puntos por id. Se usa al borrar un índice: los puntos de otros
    /// índices en la misma colección no se tocan, porque `id` es el
    /// `imagenes.id` de SQLite y es único en toda la aplicación, no por
    /// índice.
    pub async fn borrar(&self, nombre: &str, ids: &[i64]) -> Result<()> {
        let url = format!("{}/collections/{nombre}/points/delete?wait=true", self.base);
        let r = self.http.post(&url).json(&json!({ "points": ids })).send().await?;
        if !r.status().is_success() {
            bail!("Qdrant rechazó el borrado: {}", r.text().await.unwrap_or_default());
        }
        Ok(())
    }

    /// Lee los vectores de una lista de ids, EN EL ORDEN PEDIDO. Es lo que usa
    /// el sellado, y el orden es el contrato del fragmento.
    pub async fn leer(&self, nombre: &str, ids: &[i64]) -> Result<Vec<Vec<f32>>> {
        let url = format!("{}/collections/{nombre}/points", self.base);
        let r = self
            .http
            .post(&url)
            .json(&json!({ "ids": ids, "with_vector": true, "with_payload": false }))
            .send()
            .await?;
        if !r.status().is_success() {
            bail!("Qdrant no devolvió los puntos: {}", r.text().await.unwrap_or_default());
        }
        let v: serde_json::Value = r.json().await?;
        let lista = v["result"].as_array().cloned().unwrap_or_default();
        let mut por_id = std::collections::HashMap::new();
        for p in lista {
            let id = p["id"].as_i64().unwrap_or(-1);
            let vec: Vec<f32> = p["vector"]
                .as_array()
                .map(|a| a.iter().filter_map(|x| x.as_f64().map(|f| f as f32)).collect())
                .unwrap_or_default();
            por_id.insert(id, vec);
        }
        ids.iter()
            .map(|id| {
                por_id
                    .remove(id)
                    .ok_or_else(|| anyhow::anyhow!("Qdrant no tiene vector para la imagen {id}"))
            })
            .collect()
    }
}
