//! El cliente HTTP compartido, con timeout.
//!
//! Sin él, cualquier petición se queda esperando para siempre si la conexión
//! se atasca a mitad — indistinguible de "todavía no ha pasado nada". El de
//! conexión es corto porque un DNS o un TCP que no arranca en 15 s no va a
//! arrancar; el total es generoso porque subir un asset de hasta 1,8 GB en
//! una conexión discreta puede tardar minutos de verdad.
pub fn cliente_http() -> reqwest::Client {
    reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(15))
        .timeout(std::time::Duration::from_secs(20 * 60))
        .build()
        .expect("construir el cliente HTTP no debería fallar")
}
