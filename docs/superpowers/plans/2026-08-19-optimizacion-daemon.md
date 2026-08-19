# Optimización del daemon (lumid) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** eliminar la familia de bugs ya diagnosticada hoy (trabajo síncrono
bloqueante dentro de handlers `async fn`, capaz de saturar el runtime de
tokio con solo 2 hilos) allí donde la auditoría la encontró, y arreglar la
transacción que faltaba en la instalación de índices — sin tocar el
planificador de la cola, que la auditoría confirmó que ya reparte bien.

**Architecture:** cada punto se arregla con la misma técnica ya aplicada
hoy a las lecturas de hardware: mover el trabajo síncrono a
`tokio::task::spawn_blocking`, o (para la instalación de índices) envolver
el bucle de inserciones en una única transacción de SQLite en vez de miles
de commits individuales.

**Tech Stack:** Rust (tokio, rusqlite, nvml_wrapper, image).

## Global Constraints

- **Spec de referencia:** `docs/superpowers/specs/2026-08-19-optimizacion-daemon-design.md`.
- **No tests salvo en `lumi-proto`** (convención del proyecto).
- **Un commit por tarea terminada.**
- Ningún cambio de comportamiento observable para quien usa la app — estas
  son correcciones de concurrencia/rendimiento, las respuestas HTTP deben
  seguir siendo las mismas ante la misma entrada.

---

### Task 1: Transacción en la instalación de índices (crítico)

**Files:**
- Modify: `crates/lumid/src/indices/volcar.rs:30-49`

- [ ] **Step 1: Envolver el bucle de inserciones en una transacción**

Sustituir:

```rust
    let mut ids = Vec::with_capacity(filas.len());
    {
        let c = app.store.conn();
        for (ruta, lat, lng, quadkey, fuente) in &filas {
            let abs = raiz.join("imagenes").join(ruta);
            c.execute(
                "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &ficha.paquete,
                    abs.to_string_lossy(),
                    lat,
                    lng,
                    quadkey,
                    fuente
                ],
            )?;
            ids.push(c.last_insert_rowid());
        }
    }
```

por:

```rust
    let mut ids = Vec::with_capacity(filas.len());
    {
        // Una sola transacción para todo el paquete: antes cada INSERT era
        // su propio commit/fsync, y mientras duraba (miles de filas en un
        // índice grande) el mutex único de `Store::conn()` dejaba a TODO
        // el daemon con la base de datos bloqueada — mismo síntoma que el
        // freeze de hoy, aquí disparado por instalar un índice.
        let mut c = app.store.conn();
        let tx = c.transaction()?;
        for (ruta, lat, lng, quadkey, fuente) in &filas {
            let abs = raiz.join("imagenes").join(ruta);
            tx.execute(
                "INSERT INTO reference_images (paquete, ruta, lat, lng, quadkey, fuente)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                rusqlite::params![
                    &ficha.paquete,
                    abs.to_string_lossy(),
                    lat,
                    lng,
                    quadkey,
                    fuente
                ],
            )?;
            ids.push(tx.last_insert_rowid());
        }
        tx.commit()?;
    }
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`rusqlite::Connection::transaction(&mut self)` ya es
parte de la dependencia existente, no hace falta ningún feature nuevo.)

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/indices/volcar.rs
git commit -m "fix: instalar un índice usa una sola transacción en vez de miles de commits individuales"
```

---

### Task 2: `spawn_blocking` en la subida de imágenes

**Files:**
- Modify: `crates/lumid/src/routes/images.rs:180-277`

- [ ] **Step 1: Extraer el trabajo de CPU a una función pura**

Añadir, antes de `pub async fn upload(...)` (tras la constante `COLS` en la
línea 20):

```rust
struct ImagenProcesada {
    mime: String,
    w: i64,
    h: i64,
    ex: crate::exif::ExifRead,
    sha: String,
    thumb: Option<Vec<u8>>,
}

/// Todo el trabajo de CPU de una subida: detectar formato, decodificar,
/// generar la miniatura, leer EXIF y calcular el hash. Nada de esto es
/// async de verdad — se llama desde `upload` a través de
/// `tokio::task::spawn_blocking`, no inline en el hilo del runtime.
fn procesar_imagen(data: &[u8], filename: &str) -> Result<ImagenProcesada, String> {
    let fmt = image::guess_format(data).map_err(|_| format!("{filename} no es una imagen"))?;
    let decoded = image::load_from_memory_with_format(data, fmt)
        .map_err(|e| format!("{filename}: {e}"))?;
    let (w, h) = (decoded.width() as i64, decoded.height() as i64);
    let mime = fmt.to_mime_type().to_string();
    let ex = crate::exif::read(data);
    let sha = format!("{:x}", Sha256::digest(data));
    let thumb = {
        let t = decoded.thumbnail(THUMB, THUMB);
        let mut buf = std::io::Cursor::new(Vec::new());
        if t.to_rgb8().write_to(&mut buf, image::ImageFormat::Jpeg).is_ok() {
            Some(buf.into_inner())
        } else {
            None
        }
    };
    Ok(ImagenProcesada { mime, w, h, ex, sha, thumb })
}
```

- [ ] **Step 2: Usarla en `upload()` a través de `spawn_blocking`**

Sustituir el cuerpo de `upload()` (línea 180-277) entero:

```rust
pub async fn upload(
    State(app): State<App>,
    Path(case_id): Path<i64>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<Json<Vec<Image>>, Fail> {
    let (uid, pid, _) = guard_case(&app, &headers, case_id)?;
    let is_admin = require_session(&app, &bearer(&headers)).map(|(_, a)| a).unwrap_or(false);
    let dir = dir_for(&app, pid);
    std::fs::create_dir_all(&dir)
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;

    let mut out = Vec::new();
    while let Some(field) = mp
        .next_field()
        .await
        .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?
    {
        let filename = field.file_name().unwrap_or("sin-nombre").to_string();
        let data = field
            .bytes()
            .await
            .map_err(|e| err(StatusCode::BAD_REQUEST, &e.to_string()))?;
        if data.len() > MAX_BYTES {
            return Err(err(StatusCode::PAYLOAD_TOO_LARGE, "esa imagen pasa de 64 MB"));
        }

        // La cuota se comprueba por archivo y no por lote: así el primero de
        // diez entra aunque el décimo no quepa, en vez de perderse todos.
        if !is_admin {
            let u = usage(&app, uid);
            let cap = u.limit_gb * 1024 * 1024 * 1024;
            if u.used_bytes + data.len() as i64 > cap {
                let faltan = (u.used_bytes + data.len() as i64 - cap) as f64 / 1024.0 / 1024.0;
                let origen = if u.overridden {
                    format!("tu límite es de {} GB, anulado para tu cuenta", u.limit_gb)
                } else {
                    format!("tu límite es de {} GB, heredado del global", u.limit_gb)
                };
                return Err(err(
                    StatusCode::INSUFFICIENT_STORAGE,
                    &format!("no caben {faltan:.0} MB más: {origen}"),
                ));
            }
        }

        // Decodificar, recortar la miniatura, leer EXIF y calcular el hash
        // son CPU pura, no red — van al pool de `spawn_blocking` para no
        // acaparar los pocos hilos del runtime asíncrono.
        let data_proc = data.clone();
        let filename_proc = filename.clone();
        let procesada = tokio::task::spawn_blocking(move || procesar_imagen(&data_proc, &filename_proc))
            .await
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
            .map_err(|msg| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &msg))?;

        let id = {
            let c = app.store.conn();
            c.execute(
                "INSERT INTO images
                 (case_id, uploader_id, filename, bytes, sha256, width, height, mime,
                  exif_json, exif_lat, exif_lng, created_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
                rusqlite::params![
                    case_id, uid, filename, data.len() as i64, procesada.sha, procesada.w, procesada.h,
                    procesada.mime, procesada.ex.json, procesada.ex.lat, procesada.ex.lng, now()
                ],
            )
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
            c.last_insert_rowid()
        };

        // El original, byte a byte, sin recomprimir ni quitarle el EXIF.
        std::fs::write(dir.join(id.to_string()), &data)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        // Y la miniatura al lado, siempre JPEG: la tira no necesita más.
        if let Some(thumb) = procesada.thumb {
            let _ = std::fs::write(dir.join(format!("{id}.thumb")), thumb);
        }

        let img = app
            .store
            .conn()
            .query_row(&format!("SELECT {COLS} FROM images WHERE id = ?1"), [id], row_to_image)
            .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
        out.push(img);
    }

    let _ = app.store.conn().execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        rusqlite::params![now(), pid],
    );
    Ok(Json(out))
}
```

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`Bytes::clone()` es barato — solo incrementa un
contador de referencias, no copia el buffer; `data` original se sigue
usando después para `std::fs::write`.)

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/routes/images.rs
git commit -m "fix: decodificar/recortar/hashear una imagen subida corre en spawn_blocking"
```

---

### Task 3: `spawn_blocking` en avatar/banner de perfil

**Files:**
- Modify: `crates/lumid/src/routes/perfil.rs:37-96`

- [ ] **Step 1: `subir_mi_avatar`**

Sustituir:

```rust
pub async fn subir_mi_avatar(
    State(app): State<App>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| err(c, "sesión inválida"))?;
    let data = primer_campo(&mut mp).await?;
    perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &perfil::ruta_avatar_usuario(&app.dir, uid))
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    app.store
        .conn()
        .execute("UPDATE users SET avatar_updated_at = ?1 WHERE id = ?2", rusqlite::params![now(), uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

por:

```rust
pub async fn subir_mi_avatar(
    State(app): State<App>,
    headers: HeaderMap,
    mut mp: Multipart,
) -> Result<StatusCode, Fail> {
    let (uid, _) = require_session(&app, &bearer(&headers)).map_err(|c| err(c, "sesión inválida"))?;
    let data = primer_campo(&mut mp).await?;
    // Decodificar y recortar (Lanczos3, el filtro más caro) es CPU pura —
    // se manda al pool de `spawn_blocking`, mismo motivo que la subida de
    // imágenes de caso.
    let ruta = perfil::ruta_avatar_usuario(&app.dir, uid);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    app.store
        .conn()
        .execute("UPDATE users SET avatar_updated_at = ?1 WHERE id = ?2", rusqlite::params![now(), uid])
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 2: `subir_avatar_servidor`**

Sustituir:

```rust
pub async fn subir_avatar_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &perfil::ruta_avatar_servidor(&app.dir))
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}
```

por:

```rust
pub async fn subir_avatar_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    let ruta = perfil::ruta_avatar_servidor(&app.dir);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::AVATAR_SIDE, perfil::AVATAR_SIDE, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 3: `subir_banner_servidor`**

Sustituir:

```rust
pub async fn subir_banner_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    perfil::guardar_recortada(&data, perfil::BANNER_W, perfil::BANNER_H, &perfil::ruta_banner_servidor(&app.dir))
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}
```

por:

```rust
pub async fn subir_banner_servidor(State(app): State<App>, headers: HeaderMap, mut mp: Multipart) -> Result<StatusCode, Fail> {
    require_admin(&app, &bearer(&headers)).map_err(|c| err(c, "hace falta ser administrador"))?;
    let data = primer_campo(&mut mp).await?;
    let ruta = perfil::ruta_banner_servidor(&app.dir);
    tokio::task::spawn_blocking(move || perfil::guardar_recortada(&data, perfil::BANNER_W, perfil::BANNER_H, &ruta))
        .await
        .map_err(|e| err(StatusCode::INTERNAL_SERVER_ERROR, &e.to_string()))?
        .map_err(|e| err(StatusCode::UNSUPPORTED_MEDIA_TYPE, &format!("no es una imagen válida: {e}")))?;
    Ok(StatusCode::NO_CONTENT)
}
```

- [ ] **Step 4: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`perfil::ruta_avatar_usuario`/`ruta_avatar_servidor`/
`ruta_banner_servidor` devuelven `PathBuf` por valor, así que `ruta` ya es
propiedad de la closure — no hace falta clonar nada más que `data`, que
`primer_campo` ya entrega como `Vec<u8>` propio.)

- [ ] **Step 5: Commit**

```bash
git add crates/lumid/src/routes/perfil.rs
git commit -m "fix: recortar avatar/banner de perfil corre en spawn_blocking"
```

---

### Task 4: `spawn_blocking` en escritura de hardware GPU

**Files:**
- Modify: `crates/lumid/src/hardware.rs:219-263`

- [ ] **Step 1: Sustituir `aplicar()`**

Sustituir la función completa (línea 219-263):

```rust
pub async fn aplicar(
    app: &App,
    index: u32,
    req: &PatchHardwareReq,
) -> Result<HardwareDevice, AplicarError> {
    let existente = perfil_guardado(app, index);
    let nuevo = HardwareProfile {
        potencia_w: req.potencia_w.unwrap_or_else(|| existente.as_ref().map(|p| p.potencia_w).unwrap_or(0)),
        offset_nucleo_mhz: req
            .offset_nucleo_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_nucleo_mhz).unwrap_or(0)),
        offset_memoria_mhz: req
            .offset_memoria_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_memoria_mhz).unwrap_or(0)),
        curva_ventilador: req
            .curva_ventilador
            .clone()
            .unwrap_or_else(|| existente.as_ref().map(|p| p.curva_ventilador.clone()).unwrap_or_default()),
    };

    let nvml = Nvml::init().map_err(|e| AplicarError::Nvml(e.to_string()))?;
    let rango = rango_de(&nvml, index).ok_or_else(|| AplicarError::Nvml("no se pudo leer el rango de fábrica".into()))?;

    if !req.confirmado {
        if let Some(motivo) = fuera_de_rango(&nuevo, &rango) {
            return Err(AplicarError::FueraDeRango(motivo));
        }
    }

    if req.potencia_w.is_some() {
        let mut d = nvml.device_by_index(index).map_err(|e| AplicarError::Nvml(e.to_string()))?;
        d.set_power_management_limit(nuevo.potencia_w * 1000)
            .map_err(|e| AplicarError::Nvml(e.to_string()))?;
    }

    if req.offset_nucleo_mhz.is_some() || req.offset_memoria_mhz.is_some() || req.curva_ventilador.is_some() {
        aplicar_curvas(index, &nuevo).await.map_err(AplicarError::Curvas)?;
    }

    guardar_perfil(app, index, &nuevo).map_err(|e| AplicarError::Nvml(e.to_string()))?;

    let sample = muestra_de(&nvml, index).ok_or_else(|| AplicarError::Nvml("no se pudo releer la tarjeta".into()))?;
    let name = app.gpus.get(index as usize).map(|g| g.name.clone()).unwrap_or_default();
    Ok(HardwareDevice { index, name, sample, rango, perfil: Some(nuevo) })
}
```

por:

```rust
pub async fn aplicar(
    app: &App,
    index: u32,
    req: &PatchHardwareReq,
) -> Result<HardwareDevice, AplicarError> {
    let existente = perfil_guardado(app, index);
    let nuevo = HardwareProfile {
        potencia_w: req.potencia_w.unwrap_or_else(|| existente.as_ref().map(|p| p.potencia_w).unwrap_or(0)),
        offset_nucleo_mhz: req
            .offset_nucleo_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_nucleo_mhz).unwrap_or(0)),
        offset_memoria_mhz: req
            .offset_memoria_mhz
            .unwrap_or_else(|| existente.as_ref().map(|p| p.offset_memoria_mhz).unwrap_or(0)),
        curva_ventilador: req
            .curva_ventilador
            .clone()
            .unwrap_or_else(|| existente.as_ref().map(|p| p.curva_ventilador.clone()).unwrap_or_default()),
    };

    // Inicializar NVML, leer el rango de fábrica y (si toca) escribir el
    // límite de potencia son llamadas nativas síncronas — van a
    // spawn_blocking, igual que ya se hizo con la lectura (GET) de esta
    // misma sección.
    let nuevo_c = nuevo.clone();
    let confirmado = req.confirmado;
    let quiere_potencia = req.potencia_w.is_some();
    let rango = tokio::task::spawn_blocking(move || -> Result<RangoFabrica, AplicarError> {
        let nvml = Nvml::init().map_err(|e| AplicarError::Nvml(e.to_string()))?;
        let rango = rango_de(&nvml, index).ok_or_else(|| AplicarError::Nvml("no se pudo leer el rango de fábrica".into()))?;
        if !confirmado {
            if let Some(motivo) = fuera_de_rango(&nuevo_c, &rango) {
                return Err(AplicarError::FueraDeRango(motivo));
            }
        }
        if quiere_potencia {
            let mut d = nvml.device_by_index(index).map_err(|e| AplicarError::Nvml(e.to_string()))?;
            d.set_power_management_limit(nuevo_c.potencia_w * 1000)
                .map_err(|e| AplicarError::Nvml(e.to_string()))?;
        }
        Ok(rango)
    })
    .await
    .map_err(|e| AplicarError::Nvml(e.to_string()))??;

    if req.offset_nucleo_mhz.is_some() || req.offset_memoria_mhz.is_some() || req.curva_ventilador.is_some() {
        aplicar_curvas(index, &nuevo).await.map_err(AplicarError::Curvas)?;
    }

    guardar_perfil(app, index, &nuevo).map_err(|e| AplicarError::Nvml(e.to_string()))?;

    // Releer el estado final también es NVML síncrono.
    let name = app.gpus.get(index as usize).map(|g| g.name.clone()).unwrap_or_default();
    let sample = tokio::task::spawn_blocking(move || -> Option<GpuSample> {
        let nvml = Nvml::init().ok()?;
        muestra_de(&nvml, index)
    })
    .await
    .map_err(|e| AplicarError::Nvml(e.to_string()))?
    .ok_or_else(|| AplicarError::Nvml("no se pudo releer la tarjeta".into()))?;

    Ok(HardwareDevice { index, name, sample, rango, perfil: Some(nuevo) })
}
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`HardwareProfile` ya deriva `Clone` en
`lumi-proto::api`, y `RangoFabrica`/`GpuSample` ya están en el `use` del
archivo — se usan tal cual en el resto de funciones de este mismo
fichero.)

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/hardware.rs
git commit -m "fix: aplicar perfil de GPU corre su trabajo NVML en spawn_blocking"
```

---

### Task 5: `spawn_blocking` en escritura de hardware CPU

**Files:**
- Modify: `crates/lumid/src/hardware_cpu.rs:164-186`

- [ ] **Step 1: Sustituir `aplicar()`**

Sustituir la función completa (línea 164-186):

```rust
pub async fn aplicar(app: &App, req: &PatchCpuReq) -> Result<CpuDevice, AplicarCpuError> {
    let fab = fabricante();
    let existente = perfil_guardado(app);
    let nuevo = CpuProfile {
        pl1_w: req.pl1_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl1_w).unwrap_or(0.0)),
        pl2_w: req.pl2_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl2_w).unwrap_or(0.0)),
    };
    let rango_actual = rango(&fab);
    if !req.confirmado {
        if let Some(motivo) = fuera_de_rango(&nuevo, &rango_actual) {
            return Err(AplicarCpuError::FueraDeRango(motivo));
        }
    }

    match fab.as_str() {
        "intel" => escribir_rapl(&nuevo).map_err(AplicarCpuError::Escritura)?,
        "amd" => escribir_ryzenadj(&nuevo).await.map_err(AplicarCpuError::Escritura)?,
        _ => return Err(AplicarCpuError::Escritura("fabricante de CPU no reconocido".into())),
    }

    guardar_perfil(app, &nuevo).map_err(|e| AplicarCpuError::Escritura(e.to_string()))?;
    Ok(dispositivo(app))
}
```

por:

```rust
pub async fn aplicar(app: &App, req: &PatchCpuReq) -> Result<CpuDevice, AplicarCpuError> {
    let fab = fabricante();
    let existente = perfil_guardado(app);
    let nuevo = CpuProfile {
        pl1_w: req.pl1_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl1_w).unwrap_or(0.0)),
        pl2_w: req.pl2_w.unwrap_or_else(|| existente.as_ref().map(|p| p.pl2_w).unwrap_or(0.0)),
    };
    let rango_actual = rango(&fab);
    if !req.confirmado {
        if let Some(motivo) = fuera_de_rango(&nuevo, &rango_actual) {
            return Err(AplicarCpuError::FueraDeRango(motivo));
        }
    }

    match fab.as_str() {
        "intel" => {
            // Escritura síncrona a sysfs — mismo motivo que el resto de
            // este barrido: va a spawn_blocking en vez de correr inline.
            let nuevo_c = nuevo.clone();
            tokio::task::spawn_blocking(move || escribir_rapl(&nuevo_c))
                .await
                .map_err(|e| AplicarCpuError::Escritura(e.to_string()))?
                .map_err(AplicarCpuError::Escritura)?;
        }
        "amd" => escribir_ryzenadj(&nuevo).await.map_err(AplicarCpuError::Escritura)?,
        _ => return Err(AplicarCpuError::Escritura("fabricante de CPU no reconocido".into())),
    }

    guardar_perfil(app, &nuevo).map_err(|e| AplicarCpuError::Escritura(e.to_string()))?;

    // `dispositivo` también bloquea (sysinfo, sysfs, intento de ejecutar
    // `ryzenadj`) — mismo motivo que ya se aplicó a su GET hoy.
    let app_c = app.clone();
    tokio::task::spawn_blocking(move || dispositivo(&app_c))
        .await
        .map_err(|e| AplicarCpuError::Escritura(e.to_string()))
}
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumid`
Expected: compila. (`CpuProfile` ya deriva `Clone`; `App` ya deriva
`Clone` en `main.rs` — se clona igual en varios sitios del daemon.)

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/hardware_cpu.rs
git commit -m "fix: aplicar perfil de CPU corre su trabajo bloqueante en spawn_blocking"
```

---

### Task 6: Configuración explícita del runtime de tokio

**Files:**
- Modify: `crates/lumid/src/main.rs:67`

- [ ] **Step 1: Fijar el flavor y el número de hilos**

Sustituir:

```rust
#[tokio::main]
async fn main() -> anyhow::Result<()> {
```

por:

```rust
// Explícito y no el valor por defecto de la macro: en la VM de producción
// hay 2 CPUs, así que tokio ya arrancaría con 2 hilos de trabajo por su
// cuenta — se deja escrito como decisión, no como casualidad, y es el
// único sitio a tocar si el host algún día tiene más núcleos. El trabajo
// que de verdad bloquea (NVML, sysinfo, decodificar imágenes, sysfs) no
// compite por estos hilos: corre en el pool de `spawn_blocking`, aparte.
#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> anyhow::Result<()> {
```

- [ ] **Step 2: Compilar**

Run: `cargo build -p lumid`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add crates/lumid/src/main.rs
git commit -m "fix: fija explícitamente el número de hilos del runtime de tokio"
```

---

### Task 7: Limpieza de consultas repetidas en la cola

**Files:**
- Modify: `crates/lumid/src/queue/mod.rs:996-1037` (`duenos`)
- Modify: `crates/lumid/src/queue/mod.rs:606-613` (`para_aplicar`, variable local dentro de un método más grande)

- [ ] **Step 1: `duenos()` agrupa sus dos consultas bajo un solo `conn()`**

Sustituir:

```rust
    fn duenos(&self, candidatos: &[Candidato]) -> HashMap<i64, Dueno> {
        let presentes = self
            .estado
            .lock()
            .map(|e| e.presentes.keys().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        let mut out = HashMap::new();
        for uid in candidatos.iter().map(|c| c.user_id).collect::<std::collections::HashSet<_>>() {
            // `limits::effective` y no la tabla: la precedencia de dos niveles
            // vive ahí y en un solo sitio.
            let l = limits::effective(&self.store, uid);
            let bloqueado: bool = self
                .store
                .conn()
                .query_row("SELECT blocked FROM users WHERE id = ?1", [uid], |r| {
                    r.get::<_, i64>(0)
                })
                .map(|b| b == 1)
                .unwrap_or(true);
            let en_curso: i64 = self
                .store
                .conn()
                .query_row(
                    "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND state = 'en_curso'",
                    [uid],
                    |r| r.get(0),
                )
                .unwrap_or(0);
            out.insert(
                uid,
                Dueno {
                    bloqueado,
                    conectado: presentes.contains(&uid),
                    segundo_plano: l.background_jobs,
                    max_concurrent: l.max_concurrent,
                    prioridad: l.queue_priority,
                    en_curso,
                },
            );
        }
        out
    }
```

por:

```rust
    fn duenos(&self, candidatos: &[Candidato]) -> HashMap<i64, Dueno> {
        let presentes = self
            .estado
            .lock()
            .map(|e| e.presentes.keys().copied().collect::<Vec<_>>())
            .unwrap_or_default();
        let mut out = HashMap::new();
        for uid in candidatos.iter().map(|c| c.user_id).collect::<std::collections::HashSet<_>>() {
            // `limits::effective` y no la tabla: la precedencia de dos niveles
            // vive ahí y en un solo sitio.
            let l = limits::effective(&self.store, uid);
            // Antes eran dos adquisiciones separadas de `store.conn()` por
            // usuario — se agrupan bajo una sola.
            let (bloqueado, en_curso): (bool, i64) = {
                let c = self.store.conn();
                let bloqueado = c
                    .query_row("SELECT blocked FROM users WHERE id = ?1", [uid], |r| r.get::<_, i64>(0))
                    .map(|b| b == 1)
                    .unwrap_or(true);
                let en_curso = c
                    .query_row(
                        "SELECT COUNT(*) FROM analyses WHERE requested_by = ?1 AND state = 'en_curso'",
                        [uid],
                        |r| r.get(0),
                    )
                    .unwrap_or(0);
                (bloqueado, en_curso)
            };
            out.insert(
                uid,
                Dueno {
                    bloqueado,
                    conectado: presentes.contains(&uid),
                    segundo_plano: l.background_jobs,
                    max_concurrent: l.max_concurrent,
                    prioridad: l.queue_priority,
                    en_curso,
                },
            );
        }
        out
    }
```

- [ ] **Step 2: `para_aplicar` bloquea `self.geo` una sola vez**

Localizar (dentro del método más grande donde vive esta variable local,
identificado por el comentario "Lo que los agentes tengan que decir de
cada candidato"):

```rust
                        let para_aplicar: Vec<_> = usar
                            .iter()
                            .map(|c| {
                                let at = self.geo.lock().unwrap().atributos(c.lat, c.lng);
                                let inliers = respaldo_de.get(&clave(c.lat, c.lng)).map(|(i, _)| *i);
                                (at, inliers)
                            })
                            .collect();
```

por:

```rust
                        // Antes relockeaba `self.geo` una vez POR CANDIDATO
                        // dentro del `.map()` — se agarra una sola vez fuera.
                        let geo = self.geo.lock().unwrap();
                        let para_aplicar: Vec<_> = usar
                            .iter()
                            .map(|c| {
                                let at = geo.atributos(c.lat, c.lng);
                                let inliers = respaldo_de.get(&clave(c.lat, c.lng)).map(|(i, _)| *i);
                                (at, inliers)
                            })
                            .collect();
                        drop(geo);
```

(El `drop(geo)` explícito es porque unas líneas más abajo, en el mismo
bloque, se bloquea `self.agentes` — un mutex distinto, así que no hay
interbloqueo posible, pero soltar `geo` en cuanto se termina de usar deja
claro que no hace falta más allá de este punto.)

- [ ] **Step 3: Compilar**

Run: `cargo build -p lumid`
Expected: compila.

- [ ] **Step 4: Commit**

```bash
git add crates/lumid/src/queue/mod.rs
git commit -m "refactor: menos adquisiciones de conn()/mutex repetidas en el reparto de la cola"
```

---

## Self-Review

**Cobertura de la spec:**
- §1 (transacción de índices) → Task 1.
- §2 (spawn_blocking en imágenes) → Task 2.
- §2 (spawn_blocking en perfil) → Task 3.
- §3 (spawn_blocking en escritura de hardware, GPU y CPU) → Tasks 4, 5.
- §4 (config de tokio) → Task 6.
- §5 (limpieza menor) → Task 7.
- Fuera de alcance → respetado; ninguna tarea toca el planificador de la
  cola, ni las lecturas/escrituras de disco de bajo volumen señaladas
  como fuera de alcance en la spec.

**Placeholders:** ninguno — cada paso trae el código completo, antes y
después.

**Consistencia de tipos:** `ImagenProcesada` (Task 2) se construye y se
consume dentro de la misma tarea, sin fugas a otros archivos.
`RangoFabrica`/`GpuSample` (Task 4) y `CpuProfile`/`App` (Task 5) ya
existían en sus respectivos archivos antes de este plan — no se inventa
ningún tipo nuevo que no estuviera ya en uso en el resto del fichero.
