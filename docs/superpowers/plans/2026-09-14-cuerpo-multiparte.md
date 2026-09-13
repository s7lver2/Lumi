# Publicar un cuerpo más pesado que el tope del proveedor — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que una tesela cuyo cuerpo cifrado supere el tope de GitHub (2 GiB por asset) se pueda publicar de todos modos, partiéndolo en varios ficheros físicos que el lado que instala reensambla antes de descifrar — sin tocar `cifrado.rs`, `troceado.rs`, `filas/`, `fragmentos/` ni el manifiesto.

**Architecture:** `Asset` gana un campo `partes: Vec<ParteAsset>` compatible hacia atrás (vacío reproduce el JSON de hoy). `publicar()` parte el blob cifrado en trozos de `TOPE_ASSET_BYTES` solo cuando hace falta, reutilizando `subir_asset`/`publicacion_apuntar`/`publicacion_marcar_subido` sin escribir subida nueva. `traer_y_abrir` se divide en "reunir el blob" (nuevo, multi-parte) y "descifrar y desplegar" (sin tocar).

**Tech Stack:** Rust en `crates/lumi-index/src/ficha.rs`, `indexer/src-tauri/src/{publicar,store}.rs`, `crates/lumid/src/indices/{mod,paquete}.rs`. Sin dependencias nuevas.

## Global Constraints

- Spec de referencia: `docs/superpowers/specs/2026-09-14-cuerpo-multiparte-design.md`. Toda duda de comportamiento se resuelve ahí.
- **Ninguna ficha ya publicada puede dejar de instalar.** `partes: []` debe ser indistinguible del JSON de hoy — verificarlo con un test de deserialización de una ficha real ya firmada, sin el campo.
- La firma de la ficha (`Ficha::firmar`/`comprobar`, canónica) no cambia de mecanismo — solo cambia qué campos tiene `Asset`, que ya forma parte de lo firmado por incluirse en `canonico()`.
- `cifrado.rs` no se toca en absoluto. Si una tarea cree que necesita tocarlo, releer el spec: no hace falta.
- Español en comentarios, nombres de función y mensajes de log/error.
- **No tests unless explicitly requested** — excepción ya en vigor en `ficha.rs`, `publicar.rs`, `troceado.rs`, `store.rs`: siguen llevando `#[cfg(test)] mod tests`, y esta feature en concreto SÍ pide tests explícitos en varias tareas (backward-compat de formato, split/reensamblado). Seguir el patrón existente, no añadir un runner nuevo.
- Un commit por tarea terminada, terminando con:
  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
- Antes de cerrar cada tarea: `cargo test` desde la raíz (workspace completo, ya que esta feature cruza `lumi-index`, `indexer-app` y `lumid`) limpio.
- Antes de cerrar el plan entero: además de los tests, `cd indexer && npm run build && npm run lint` limpio (Task 4 toca `PublishDialog.tsx`/`api.ts`).

---

## File Structure

**Modificados:**
- `crates/lumi-index/src/ficha.rs` — `Asset.partes`, `ParteAsset`.
- `crates/lumi-index/src/troceado.rs` — función de partir bytes en trozos de tamaño fijo (nueva, de propósito general).
- `indexer/src-tauri/src/publicar.rs` — split al subir, reutilización al reconstruir.
- `indexer/src-tauri/src/store.rs` — columna `partes_json` en `publicaciones`, lectura/escritura.
- `crates/lumid/src/indices/paquete.rs` — `traer_y_abrir` dividido en reunir + descifrar/desplegar.
- `crates/lumid/src/indices/mod.rs` — `instalar_uno` llama a la variante multi-parte cuando `a.partes` no está vacío.
- `indexer/src/lib/api.ts`, `indexer/src/publish/PublishDialog.tsx` — el aviso de `no_caben` deja de bloquear.

---

### Task 1: El formato — `Asset.partes` compatible hacia atrás

**Files:**
- Modify: `crates/lumi-index/src/ficha.rs`

**Interfaces:**
```rust
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ParteAsset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Asset {
    pub nombre: String,
    pub sha256: String,
    pub bytes: u64,
    pub quadkeys: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub partes: Vec<ParteAsset>,
}
```

- [x] **Step 1: Añadir `ParteAsset` y el campo `partes` a `Asset`**

Con la documentación del spec §2 como comentario (por qué `partes` vacío es el caso normal, qué significan `sha256`/`bytes` del `Asset` exterior cuando `partes` no está vacío).

- [x] **Step 2: Test de compatibilidad — el corazón de esta tarea**

En `ficha.rs::tests`, extender `ficha_de_prueba()` o añadir un test dedicado:

```rust
#[test]
fn una_ficha_sin_partes_deserializa_como_vacio_y_no_cambia_el_json() {
    let f = ficha_de_prueba(); // su Asset (si lleva alguno) no usa partes
    let j = serde_json::to_string(&f).unwrap();
    assert!(!j.contains("\"partes\""), "un Asset sin partes no debe añadir la clave al JSON");
}

#[test]
fn una_ficha_publicada_antes_de_partes_sigue_verificando() {
    // Firma una ficha con un Asset SIN el campo `partes` en absoluto —
    // simulando el JSON real que ya existe publicado — y comprueba que
    // sigue deserializando y su firma sigue validando.
    let mut f = ficha_de_prueba();
    f.firmar(&[7u8; 32]).unwrap();
    let mut j: serde_json::Value = serde_json::to_value(&f).unwrap();
    // Quitar `partes` de cada asset en `cuerpos`, si lo hubiera, simulando
    // el formato anterior a este cambio.
    if let Some(cuerpos) = j.get_mut("cuerpos").and_then(|c| c.as_array_mut()) {
        for c in cuerpos { c.as_object_mut().unwrap().remove("partes"); }
    }
    let recibida: Ficha = serde_json::from_value(j).unwrap();
    assert!(recibida.comprobar().is_ok());
}
```

Ajustar `ficha_de_prueba()` si hace falta que lleve al menos un `Asset` en `cuerpos` para que este test tenga algo que comprobar (hoy `cuerpos: vec![]` — puede que haga falta añadir un `Asset` de ejemplo a ese fixture, revisando que no rompa los tests existentes que ya usan `ficha_de_prueba()`).

- [x] **Step 3: Verificar**

`cargo test -p lumi-index`.

- [x] **Commit:** `feat(lumi-index): Asset admite partes multiples, compatible con fichas ya publicadas`

---

### Task 2: Partir bytes en trozos de tamaño fijo

**Files:**
- Modify: `crates/lumi-index/src/troceado.rs`

**Interfaces:**
```rust
/// Divide `bytes` en trozos de como mucho `tope` bytes cada uno, en orden.
/// De propósito general — no sabe nada de quadkeys ni de assets, solo corta
/// un buffer. Usado cuando el CUERPO CIFRADO de una tesela (ya troceado por
/// geografía en `trocear`, y aun así de un tamaño que no cabe en un asset
/// del proveedor) necesita partirse por transporte.
pub fn partir_en_trozos(bytes: &[u8], tope: usize) -> Vec<&[u8]>
```

- [x] **Step 1: Implementar**

```rust
pub fn partir_en_trozos(bytes: &[u8], tope: usize) -> Vec<&[u8]> {
    if bytes.is_empty() { return Vec::new(); }
    bytes.chunks(tope.max(1)).collect()
}
```

(`chunks` de la stdlib ya hace exactamente esto — la función existe para darle un nombre del dominio y un sitio donde documentar el porqué, no para reimplementar nada.)

- [x] **Step 2: Tests**

```rust
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
```

- [x] **Step 3: Verificar**

`cargo test -p lumi-index`.

- [x] **Commit:** `feat(lumi-index): partir_en_trozos, de proposito general`

---

### Task 3: Publicar — dividir, subir, y reutilizar sin red

**Files:**
- Modify: `indexer/src-tauri/src/publicar.rs`
- Modify: `indexer/src-tauri/src/store.rs`

**Interfaces:**
- `Almacen::publicacion_apuntar` gana un parámetro `partes_json: Option<&str>` (o una función hermana `publicacion_apuntar_con_partes`, decidir por lo que quede más legible en el punto de llamada — probablemente una función nueva es más simple que tocar la firma de la que ya usan cuerpos/capas/ficha sin partes).
- `Almacen::publicacion_igual_a` devuelve ahora `(sha256, bytes, Option<String> /* partes_json */)` en vez de `(sha256, bytes)`.

- [x] **Step 1: Migración — columna `partes_json`**

En `store.rs`, añadir a la lista de `ALTER TABLE` idempotentes (junto a `identidad` en `publicaciones`):

```rust
"ALTER TABLE publicaciones ADD COLUMN partes_json TEXT",
```

- [x] **Step 2: `publicacion_apuntar` guarda `partes_json`**

Extender la firma (o añadir una variante) para aceptar `Option<&str>` con el JSON de `Vec<ParteAsset>` ya serializado, `NULL` cuando el trozo no se dividió:

```rust
pub fn publicacion_apuntar(
    &self, indice_id: i64, asset: &str, identidad: Option<&str>,
    sha256: &str, bytes: u64, partes_json: Option<&str>,
) -> Result<()> {
    let c = self.escritura.lock().unwrap();
    c.execute(
        "INSERT INTO publicaciones (indice_id, asset, identidad, sha256, bytes, partes_json)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(indice_id, asset) DO UPDATE SET
           identidad = excluded.identidad, sha256 = excluded.sha256, bytes = excluded.bytes,
           partes_json = excluded.partes_json",
        params![indice_id, asset, identidad, sha256, bytes as i64, partes_json],
    )?;
    Ok(())
}
```

Revisar TODOS los llamadores existentes (`publicar_capa`, la ficha, las capas) y pasarles `None` explícito — no cambia su comportamiento.

- [x] **Step 3: `publicacion_igual_a` devuelve también `partes_json`**

```rust
pub fn publicacion_igual_a(
    &self, indice_id: i64, asset: &str, identidad: &str,
) -> Result<Option<(String, u64, Option<String>)>> {
    Ok(self.escritura.lock().unwrap().query_row(
        "SELECT sha256, bytes, partes_json FROM publicaciones
          WHERE indice_id = ?1 AND asset = ?2 AND identidad = ?3 AND subido = 1 AND url IS NOT NULL",
        params![indice_id, asset, identidad],
        |r| Ok((r.get(0)?, r.get::<_, i64>(1)? as u64, r.get(2)?)),
    ).optional()?)
}
```

Ajustar el único llamador actual en `publicar.rs` (las capas y el cuerpo) al nuevo tipo de retorno.

- [x] **Step 4: El split en `publicar()`**

Tras `cifrar_asset_async` (donde hoy se calcula `sha`/`bytes` y se sube tal cual), sustituir el tramo:

```rust
let sellado = cifrar_asset_async(prog.clone(), &nombre, claro, clave).await?;
let sha = sha256_hex(&sellado);
let bytes = sellado.len() as u64;

if bytes <= TOPE_ASSET_BYTES {
    // Camino de hoy, sin cambios de comportamiento.
    almacen.publicacion_apuntar(indice_id, &nombre, Some(&identidad), &sha, bytes, None)?;
    prog.anotar(format!("subiendo {nombre}"));
    let url = subir_asset(&cliente, &testigo, &repo, release, &nombre, sellado, &prog).await?;
    almacen.publicacion_marcar_subido(indice_id, &nombre, &url)?;
    prog.terminar_asset(bytes);
    cuerpos.push(Asset { nombre, sha256: sha, bytes, quadkeys: t.quadkeys.clone(), partes: vec![] });
} else {
    // Partir, subir cada parte reutilizando exactamente subir_asset/apuntar/marcar_subido.
    let trozos = lumi_index::troceado::partir_en_trozos(&sellado, TOPE_ASSET_BYTES as usize);
    let mut partes = Vec::new();
    for (i, trozo) in trozos.iter().enumerate() {
        let nombre_parte = format!("{nombre}.part{:03}", i + 1);
        let sha_parte = sha256_hex(trozo);
        let bytes_parte = trozo.len() as u64;
        almacen.publicacion_apuntar(indice_id, &nombre_parte, None, &sha_parte, bytes_parte, None)?;
        prog.anotar(format!("subiendo {nombre_parte} ({}/{})", i + 1, trozos.len()));
        let url = subir_asset(&cliente, &testigo, &repo, release, &nombre_parte, trozo.to_vec(), &prog).await?;
        almacen.publicacion_marcar_subido(indice_id, &nombre_parte, &url)?;
        prog.terminar_asset(bytes_parte);
        partes.push(lumi_index::ficha::ParteAsset { nombre: nombre_parte, sha256: sha_parte, bytes: bytes_parte });
    }
    let partes_json = serde_json::to_string(&partes)?;
    almacen.publicacion_apuntar(indice_id, &nombre, Some(&identidad), &sha, bytes, Some(&partes_json))?;
    cuerpos.push(Asset { nombre, sha256: sha, bytes, quadkeys: t.quadkeys.clone(), partes });
}
```

**Ojo con el contador `prog` (total de assets/bytes para la barra de progreso)**: `Publicacion::nueva(total, bytes_total)` se construye ANTES de saber cuántas partes tendrá un cuerpo grande. Revisar dónde se calcula `total`/`bytes_total` hoy (antes de entrar al bucle de `trozos`) y, si hace falta, recalcular `total` sumando `desbordados(...)` particionado en partes esperadas — o, más simple: dejar que `total` siga contando TROZOS lógicos (no partes físicas) como hace hoy, y que la barra de "hechos/total" se mantenga a nivel de trozo (cada trozo grande solo incrementa `hechos` una vez al terminar TODAS sus partes) mientras que el detalle de bytes (`avance_subida`) ya refleja el progreso real dentro de la subida — comprobar cuál de las dos lecturas es más simple de implementar sin romper la semántica ya documentada de `ProgresoPublicacion` y preferir esa.

- [x] **Step 5: Reutilización cuando el contenido no cambió**

En el chequeo de identidad que ya existe (antes de `cifrar_asset_async`), al recibir `Some((sha, bytes, partes_json))` de `publicacion_igual_a`:

```rust
if let Some((sha, bytes, partes_json)) = almacen.publicacion_igual_a(indice_id, &nombre, &identidad)? {
    prog.anotar(format!("{nombre} no cambió, se reutiliza lo ya subido"));
    prog.terminar_asset(bytes);
    let partes: Vec<lumi_index::ficha::ParteAsset> = partes_json
        .and_then(|j| serde_json::from_str(&j).ok())
        .unwrap_or_default();
    cuerpos.push(Asset { nombre, sha256: sha, bytes, quadkeys: t.quadkeys.clone(), partes });
    continue;
}
```

- [x] **Step 6: Retirar el bloqueo de `no_caben`**

En `publicar()`, quitar el `bail!` que hoy corta antes de empaquetar cuando `desbordados(...)` no está vacío (el comentario que lo acompaña queda obsoleto — actualizarlo o quitarlo, no dejarlo mintiendo). `previsualizar()` puede seguir calculando `no_caben` para informar en el diálogo (ver Task 4), pero deja de ser motivo de fallo.

- [x] **Step 7: Test — split y reensamblado a nivel de bytes**

En `publicar.rs::tests` (o `troceado.rs` si encaja mejor), un test que:
1. Genera un `Vec<u8>` de prueba (unos pocos MB, no GB — usar un tope pequeño para el test, no `TOPE_ASSET_BYTES` real).
2. Lo parte con `partir_en_trozos`.
3. Verifica que concatenar las partes en orden reproduce el original byte a byte.
4. Verifica que `sha256` de cada parte por separado es estable (mismo input, mismo hash).

(El test de extremo a extremo real — cifrar, partir, subir a GitHub, bajar, reensamblar, descifrar — es la prueba de aceptación del spec, Task 6, no un test unitario.)

- [x] **Step 8: Verificar**

`cargo test` desde la raíz (toca `lumi-index`, `indexer-app`).

- [x] **Commit:** `feat(indexer): partir el cuerpo cifrado en varios assets cuando supera el tope del proveedor`

---

### Task 4: El diálogo deja de bloquear, y avisa

**Files:**
- Modify: `indexer/src/lib/api.ts`
- Modify: `indexer/src/publish/PublishDialog.tsx`

**Interfaces:**
- `Previsualizacion.no_caben` sigue existiendo (ya lo calcula `previsualizar()`, sin cambios ahí) pero deja de deshabilitar el botón de publicar.

- [x] **Step 1: `PublishDialog.tsx` — de bloqueo a aviso**

En el bloque que hoy pinta `noCaben` (líneas ~97-117 de la lectura previa), cambiar:
- El texto de *"Esta zona no cabe en un release de GitHub... hay que aligerarla"* a algo como *"Esta zona pesa más que el límite de GitHub por fichero: se subirá partida en varios ficheros."* — informativo, no una advertencia de fallo.
- Quitar `disabled={noCaben.length > 0}` y su `title` del botón de publicar.
- Mantener el resto del bloque (la lista de zonas con sus tamaños) — sigue siendo información útil, ya no es una lista de "esto va a fallar".

- [x] **Step 2: Revisar si `api.ts` necesita cambios**

`Previsualizacion` en `api.ts` ya debe tener `no_caben: TrozoPrevisto[]` reflejando el tipo de Rust — comprobar que sigue cuadrando (no debería hacer falta tocarlo, `TrozoPrevisto` no cambia).

- [x] **Step 3: Verificar**

`cd indexer && npm run build && npm run lint`.

- [x] **Commit:** `feat(indexer): publicar una zona pesada ya no esta bloqueado, solo avisa`

---

### Task 5: Instalar — reunir las partes antes de descifrar

**Files:**
- Modify: `crates/lumid/src/indices/paquete.rs`
- Modify: `crates/lumid/src/indices/mod.rs`

**Interfaces:**
- `paquete::traer_y_abrir` se mantiene para el caso de un asset sin partes (firma sin cambios, o casi — ver Step 1).
- Nueva `paquete::traer_y_abrir_multiparte(http, ficha_url, asset: &Asset, clave, destino, progreso) -> Result<()>` que reúne todas las partes y reutiliza la cola de descifrado/despliegue.

- [x] **Step 1: Extraer la cola común (descifrar + desplegar)**

En `paquete.rs`, separar el cuerpo de `traer_y_abrir` en dos funciones: la que ya existe se queda como el camino "un solo fichero, ya en `destino_temporal`", y se extrae una función privada `descifrar_y_desplegar(sellado_temporal: &Path, clave: &[u8; 32], destino: &Path) -> Result<()>` con exactamente el código de las líneas 108-163 de hoy (leer el fichero, descifrar, comprobar tope de descompresión, desplegar el zip) — sin cambiar ni una línea de esa lógica, solo moviéndola.

- [x] **Step 2: Descargar-y-verificar una URL a un fichero, reutilizable**

Extraer también el tramo de streaming+hash (líneas 46-106 de hoy) a una función `bajar_verificando(http, url, sha256_esperado, destino_fichero: &Path, progreso, bytes_ya_contados: u64) -> Result<u64>` que devuelve el total de bytes recibidos (para que el llamador multi-parte pueda acumular el contador entre partes) — el parámetro `bytes_ya_contados` es el offset a partir del cual seguir sumando en `progreso.asset_bytes_hechos`, para que la barra no se reinicie a 0 en cada parte.

`traer_y_abrir` (el camino de un solo fichero) pasa a ser una función delgada que llama a `bajar_verificando` una vez y luego a `descifrar_y_desplegar`.

- [x] **Step 3: `traer_y_abrir_multiparte`**

```rust
pub async fn traer_y_abrir_multiparte(
    http: &reqwest::Client,
    ficha_url: &str,
    asset: &lumi_index::ficha::Asset,
    clave: &[u8; 32],
    destino: &Path,
    progreso: &crate::indices::EnCurso,
) -> Result<()> {
    std::fs::create_dir_all(destino)?;
    let temporal = destino.join(format!(".{}.parcial", asset.sha256));

    let bytes_total: u64 = asset.partes.iter().map(|p| p.bytes).sum();
    if let Some(p) = progreso.lock().unwrap().as_mut() {
        p.asset_bytes_total = bytes_total;
        p.asset_bytes_hechos = 0;
    }

    // Un solo fichero de salida, las partes se ANEXAN en orden — igual que
    // reensamblar un `.zip.001/.002` de toda la vida.
    {
        let mut destino_fichero = tokio::fs::File::create(&temporal).await?;
        let mut acumulado = 0u64;
        for parte in &asset.partes {
            let url_parte = crate::indices::url_de(ficha_url, &parte.nombre);
            acumulado = bajar_verificando_y_anexar(
                http, &url_parte, &parte.sha256, &mut destino_fichero, progreso, acumulado,
            ).await.map_err(|e| {
                let _ = std::fs::remove_file(&temporal);
                anyhow!("bajando {}: {e}", parte.nombre)
            })?;
        }
    }

    descifrar_y_desplegar(&temporal, clave, destino).await
}
```

Ajustar `url_de` en `mod.rs` a `pub(crate)` si hace falta llamarla desde `paquete.rs` (comprobar visibilidad actual).

`bajar_verificando_y_anexar` es una pequeña variante de `bajar_verificando` que escribe sobre un `&mut File` ya abierto en vez de crear uno propio (para poder anexar sucesivamente) — factorizar el streaming en una función de más bajo nivel que ambas (`traer_y_abrir` de un solo fichero, y esta) llamen, en vez de duplicar el bucle de `flujo.next()`.

- [x] **Step 4: `instalar_uno` elige el camino según `a.partes`**

```rust
if a.partes.is_empty() {
    bajar_con_vigilante(http, &url_de(ficha_url, &a.nombre), &a.sha256, &clave, &raiz, &app.indices_en_curso).await?;
} else {
    bajar_multiparte_con_vigilante(http, ficha_url, a, &clave, &raiz, &app.indices_en_curso).await?;
}
```

`bajar_multiparte_con_vigilante` sigue el mismo patrón que `bajar_con_vigilante` (vigilar desde fuera con su propio `select!`, ver el comentario ya existente sobre por qué vive en una tarea aparte) pero llamando a `paquete::traer_y_abrir_multiparte` en vez de `traer_y_abrir`. Revisar si el vigilante puede factorizarse para aceptar CUALQUIER future en vez de duplicar el `tokio::select!` — si la señal de progreso (`asset_bytes_hechos`/`asset_bytes_total`) ya es genérica (lo es, vive en `EnCurso` sin saber nada de partes), probablemente sí sin tocar la lógica de vigilancia en sí.

- [x] **Step 5: Tests**

Si `paquete.rs` no tiene tests hoy (comprobar), añadir al menos uno que ejercite `traer_y_abrir_multiparte` contra un servidor HTTP de prueba local (o ficheros `file://` si `reqwest` lo permite en este contexto — si no, un test que solo prueba el reensamblado en disco sin red real, inyectando las partes ya escritas, es aceptable y más simple). Seguir el patrón de test que ya use este módulo o el hermano más cercano en `crates/lumid/src/indices/`.

- [x] **Step 6: Verificar**

`cargo test -p lumid` (o el nombre real del paquete).

- [x] **Commit:** `feat(lumid): instalar un cuerpo publicado en varias partes, reensamblando antes de descifrar`

---

### Task 6: Prueba de aceptación de extremo a extremo

**Files:** ninguno (verificación, no código)

- [ ] **Step 1: Publicar de verdad la tesela real**

Con permiso del operador y contra un repositorio de prueba (no el de producción, salvo que el operador prefiera lo contrario): publicar el índice que contiene `03133320022212` (5,594 GB). Confirmar en el registro de la publicación que sube en varios assets con nombres `.partNNN`, y que la ficha resultante (leer el `ficha.json` subido) lleva el campo `partes` con las entradas esperadas.

- [ ] **Step 2: Instalar de verdad**

Con `lumi-cli`/`lumid` (o el flujo real del cliente), instalar esa ficha. Confirmar que las 2.910 imágenes y sus filas terminan en disco, correctas.

- [ ] **Step 3: Publicar una segunda vez sin cambios**

Confirmar que NO vuelve a subir las partes (el registro dice "no cambió, se reutiliza lo ya subido") y que tarda segundos, no minutos.

- [ ] **Step 4: Publicar una ficha vieja (de antes de este cambio) sigue instalando**

Si hay una ficha real ya publicada antes de esta feature, instalarla de nuevo (o reinstalar) y confirmar que no hay regresión — `partes: []` implícito no rompe nada.

---

## Validación final del plan completo

- [ ] `cargo test` desde la raíz, limpio.
- [ ] `cd indexer && npm run build && npm run lint`, limpio.
- [ ] Task 6 completa, con confirmación real del operador de que la tesela de León se publicó e instaló.
- [ ] Repasar que ningún commit dejó una nota de "esto no se puede publicar" obsoleta en el código o en `docs/superpowers/plans/2026-09-13-indexer-rendimiento.md`/specs anteriores que mencionen esta limitación como si siguiera vigente.
