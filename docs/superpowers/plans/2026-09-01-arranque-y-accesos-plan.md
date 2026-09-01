# Arranque y accesos: iconos, WSL, importar, instalador — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuatro arreglos independientes del arranque/setup del Indexer y del instalador: un
icono propio del Indexer que se lea bien a tamaño pequeño (barra de tareas/alt-tab), que
"Levantar en WSL" deje de parecer que falla siempre, que los diálogos de importar (legacy y
carpeta) se puedan cerrar sin querer completarlos, y que el instalador deje de parecer congelado
al arrancar.

**Architecture:** Cada tarea toca un subsistema distinto sin dependencias entre sí — se pueden
implementar y verificar en cualquier orden, pero se listan en orden de menor a mayor riesgo.

**Tech Stack:** Rust (`indexer/src-tauri`, `installer/src-tauri`, `crates/lumi-installer`),
React + TypeScript (`indexer/src`), SVG a mano, Tauri CLI (`npm run tauri icon`).

## Global Constraints

- No añadir tests salvo que se pida explícitamente.
- Español en comentarios, copy de UI y mensajes de commit.
- Un solo commit al final, tras compilar/verificar todo. No commits intermedios por tarea.
- Antes de editar, releer el archivo con la herramienta de lectura — no asumas que los números de
  línea de este documento siguen exactos.

---

## Task 1: Icono del Indexer — legible a tamaño pequeño, variante real "estrella con gafas"

**Files:**
- Modify: `indexer/src-tauri/icons/app-icon.svg`
- Modify: `indexer/src-tauri/tauri.conf.json`
- Regenerar (Tauri CLI): todo `indexer/src-tauri/icons/*.png`, `icon.ico`, `icon.icns`

El icono actual (una pila de servidores de trazo fino con una estrella diminuta en la esquina) se
vuelve un borrón a 16-32px (tamaño real de barra de tareas/alt-tab en Windows) porque los trazos
finos y el badge pequeño no sobreviven la reducción. Además no es la variante pedida
originalmente ("la estrella pero con unas gafas o algo así") — es un diseño distinto (pila de
servidores) que nadie pidió.

- [ ] **Paso 1: Nuevo `app-icon.svg`**

Sustituir el contenido completo de `indexer/src-tauri/icons/app-icon.svg` por:

```svg
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect width="1024" height="1024" rx="224" fill="#0e0f11"/>
  <!-- La MISMA estrella que el cliente (client/src-tauri/icons/app-icon.svg),
       para que las dos apps se reconozcan como de la misma familia — la
       variante del Indexer no cambia la forma base, le añade unas gafas. -->
  <path d="M512 176c30 188 116 274 300 300-184 26-270 112-300 300-30-188-116-274-300-300 184-26 270-112 300-300z"
        fill="#e8e8e6"/>
  <!-- Las gafas van RECORTADAS en negativo sobre la propia estrella (color de
       fondo por encima), no dibujadas con un trazo fino: un trazo se pierde
       a 16px, un hueco sólido no. -->
  <g fill="#0e0f11">
    <circle cx="382" cy="486" r="86"/>
    <circle cx="642" cy="486" r="86"/>
    <rect x="466" y="462" width="92" height="48" rx="24"/>
  </g>
</svg>
```

- [ ] **Paso 2: Verificar visualmente ANTES de regenerar los PNG/ICO**

El recorte de las gafas depende de que los dos círculos (r=86, centrados en y=486) caigan sobre
zona rellena de la estrella y no fuera de ella — la estrella es un rombo de 4 puntas cóncavo, no
un círculo, así que un desajuste de coordenadas se notaría como "un ojo de las gafas flotando en
el aire". Renderiza el SVG a un tamaño grande (por ejemplo, ábrelo en el navegador de la
herramienta de previsualización, o conviértelo a PNG con cualquier herramienta disponible) y
míralo con la herramienta de lectura de imágenes antes de continuar. Si un lente cae fuera de la
estrella o el puente queda descolgado, ajusta `cx`/`cy`/`r` de los círculos (mantén
`rect x=(cx_izq+r) ancho=(cx_der-cx_izq-2r)` centrado entre los dos) hasta que las gafas se lean
con claridad sobre la estrella, y vuelve a comprobar.

- [ ] **Paso 3: Regenerar los assets del icono**

Run: `cd indexer/src-tauri && npx tauri icon icons/app-icon.svg -o icons`

Expected: sobrescribe `32x32.png`, `128x128.png`, `128x128@2x.png`, `icon.ico`, `icon.icns` y el
resto del set — el mismo comando que generó el set anterior (comprueba que el comando existe
como `tauri icon`; si `tauri` no está en el PATH directamente usa `npx @tauri-apps/cli icon ...`).

- [ ] **Paso 4: Confirmar el resultado a tamaño real**

Abre `indexer/src-tauri/icons/32x32.png` y `indexer/src-tauri/icons/16x16.png` (si el comando los
genera; si no, recorta/redimensiona `32x32.png` a 16px con cualquier herramienta) con la
herramienta de lectura de imágenes. Confirma que las gafas siguen siendo reconocibles a ese
tamaño — si se vuelven un borrón, agranda el radio de los círculos (prueba `r="100"`) y repite
desde el Paso 3.

- [ ] **Paso 5: Completar el set del bundle en `tauri.conf.json`**

En `indexer/src-tauri/tauri.conf.json`, busca la lista `bundle.icon` (compárala contra
`client/src-tauri/tauri.conf.json`, que sí incluye `128x128@2x.png`). Añade la entrada que falte
si el Indexer no la tiene:

```json
"icon": [
  "icons/32x32.png",
  "icons/128x128.png",
  "icons/128x128@2x.png",
  "icons/icon.ico"
]
```

(Ajusta al array real existente — solo añade `128x128@2x.png` si falta, no reordenes ni quites
nada que ya esté.)

- [ ] **Paso 6: Compilar**

Run: `cd indexer/src-tauri && cargo build`.
Expected: compila sin errores (el icono se embebe en el `.exe` vía `build.rs`/`tauri_build`, así
que un `.ico` corrupto fallaría aquí).

---

## Task 2: "Levantar en WSL" deja de parecer que falla siempre

**Files:**
- Modify: `indexer/src/setup/ServicesPanel.tsx`
- Modify: `indexer/src/setup/ServicesBoot.tsx`
- Modify: `indexer/src/setup/ServicesFailDialog.tsx`
- Modify: `indexer/src/setup/ServicesStep.tsx`

**Root cause confirmado:** en `ServicesPanel.tsx`, tras pulsar "Levantar en WSL", si el sondeo de
32s (`TOPE_SONDEOS = 40` × 800ms) se agota antes de que los servicios respondan, se fija
`error = "Se lanzaron pero no llegaron a responder a tiempo..."`. Pero el panel sigue sondeando
`servicios_estado()` cada 2s en segundo plano (el `useEffect` de `refrescar` que ya corre siempre)
— si los servicios de verdad se levantan 5 o 10 segundos después (arranque en frío de WSL,
`qdrant` cargando su almacén), la fila de servicios pasa a "vivo" pero el mensaje de error se
queda fijo en pantalla para siempre, porque nada lo limpia automáticamente. Eso es lo que hace
que parezca que "siempre falla": el error no se borra solo aunque el problema ya se resolviera.

- [ ] **Paso 1: Limpiar el error solo cuando los servicios ya están vivos**

En `indexer/src/setup/ServicesPanel.tsx`, en el `useEffect` que ya hace polling de fondo (el que
llama `refrescar` cada 2000ms), añade la limpieza del error cuando corresponda. Sustituye:

```ts
  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), 2000);
    return () => clearInterval(t);
  }, []);
```

por:

```ts
  useEffect(() => {
    void refrescar();
    const t = setInterval(() => void refrescar(), 2000);
    return () => clearInterval(t);
  }, []);

  // El sondeo de fondo de arriba puede descubrir, segundos después de que el
  // sondeo corto de `accion()` se rindiera, que los servicios sí llegaron a
  // responder — sin esto el aviso de error se quedaba en pantalla para
  // siempre aunque el problema ya se hubiera resuelto solo, y eso era lo que
  // hacía parecer que "levantar en WSL" fallaba siempre.
  useEffect(() => {
    if (todos && error) setError(null);
  }, [todos, error]);
```

(`todos` ya existe como variable derivada más abajo en el componente — muévela, o la constante que
calcula `servicios.length > 0 && servicios.every((s) => s.vivo)`, a ANTES de este nuevo efecto si
hace falta reordenar; React no exige que las variables usadas en un efecto estén declaradas antes
en el código fuente siempre que estén en el mismo scope de función, así que solo hace falta que
`todos` exista en el componente antes de este `return`, no necesariamente textualmente arriba —
pero por claridad, colócalo cerca de donde ya se calcula.)

- [ ] **Paso 2: Más margen en el sondeo — en las 4 pantallas que lo hacen**

El WSL en frío (VM parada) más `qdrant` cargando su almacén puede tardar más de 32s en máquinas
lentas. Sube el tope en los 4 sitios que lo definen — mismo valor en los 4 para que el
comportamiento sea consistente:

En `indexer/src/setup/ServicesPanel.tsx`, `indexer/src/setup/ServicesBoot.tsx`,
`indexer/src/setup/ServicesFailDialog.tsx` e `indexer/src/setup/ServicesStep.tsx`, busca en cada
uno `const TOPE_SONDEOS = 40;` y cámbialo a:

```ts
// 90 × 800ms ≈ 72s: el arranque en frío de WSL (VM parada) más qdrant
// cargando su almacén puede superar el medio minuto anterior en máquinas
// lentas — el margen sube, el sondeo sigue siendo el mismo mecanismo.
const TOPE_SONDEOS = 90;
```

Actualiza también los comentarios que citan "32s"/"medio minuto" en esos mismos archivos si los
hay (búscalos con el mismo patrón textual), para que no queden desactualizados.

- [ ] **Paso 3: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: ambos limpios.

---

## Task 3: Cancelar los diálogos de importar (legacy y carpeta)

**Files:**
- Modify: `indexer/src/ingest/LegacyImportDialog.tsx`
- Modify: `indexer/src/ingest/FolderImportDialog.tsx`
- Modify: `indexer/src/catalog/IndexDetail.tsx`

Ninguno de los dos diálogos tiene forma de cerrarse sin completar la importación — ni botón, ni
`Overlay` con click-fuera. Se añade un botón "Cancelar" a los dos, deshabilitado mientras hay una
importación EN CURSO (para no abandonar un proceso a mitad), siguiendo el mismo nombre de prop
(`onCancelar`) que ya usan `PortearNivelDialog`/`IndexMapDialog` en el mismo archivo que los abre.

- [ ] **Paso 1: `LegacyImportDialog.tsx`**

Relee el archivo completo primero. Añade `onCancelar: () => void` a las props del componente
(junto a `indiceId`/`onHecho`). En la cabecera del diálogo (el bloque con el título — busca dónde
empieza el JSX del `<div>` raíz con la clase `w-[552px]`), añade un botón de cerrar junto al
título, siguiendo el patrón visual de cabecera con botón-X que ya usa algún otro diálogo del
proyecto (por ejemplo `IndexMapDialog.tsx`, si tiene uno — cópialo si existe; si ningún diálogo de
esta carpeta tiene uno, usa este patrón mínimo):

```tsx
<div className="flex items-center justify-between">
  <p className="text-[13px] text-fg">Importar desde legado</p>
  <button onClick={onCancelar} disabled={progreso !== null && !progreso.terminado}
    className="jg-press text-subtle hover:text-fg disabled:opacity-30">
    <Icon name="x" size={14} />
  </button>
</div>
```

(Ajusta el texto del título al que ya tenga el diálogo — no lo cambies, solo envuélvelo en este
`flex justify-between` y añade el botón. Ajusta el nombre real del estado de progreso al que
exista en el archivo — el research previo lo llama `progreso`; confírmalo releyendo el archivo. Si
`Icon` no está importado en este archivo, añade el import.)

- [ ] **Paso 2: `FolderImportDialog.tsx`**

Mismo cambio: añadir `onCancelar: () => void` a las props, mismo botón-X en la cabecera (este
diálogo no tiene progreso asíncrono largo como el legacy, así que el botón no necesita
`disabled` salvo que el archivo ya tenga algún estado de "importando" — en ese caso, deshabilítalo
igual mientras esté en curso).

- [ ] **Paso 3: `IndexDetail.tsx`**

Relee el bloque que renderiza `importando` (`{importando === "carpeta" ? <FolderImportDialog .../> : <LegacyImportDialog .../>}`
dentro de `<Overlay>`). Pasa `onCancelar={() => setImportando(null)}` a las dos.

- [ ] **Paso 4: Verificar**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: ambos limpios.

---

## Task 4: El instalador deja de parecer congelado al arrancar

**Files:**
- Modify: `crates/lumi-installer/src/manifiesto.rs`
- Modify: `installer/src-tauri/src/comandos.rs`

`detectar_instalados()` y `listar_versiones_disponibles()` son comandos Tauri SÍNCRONOS que hacen
una petición de red bloqueante (`reqwest::blocking::get`, sin timeout) dentro del propio handler —
`detectar_instalados()` se llama nada más arrancar la pantalla de Productos. Aunque no se pueda
confirmar sin reproducirlo si Tauri bloquea el hilo de UI con esto, es la causa más probable del
"no responde" de 1-2s, y el arreglo (mover el bloqueo a un hilo aparte + poner un tope de tiempo a
la petición) no tiene efectos secundarios: no cambia la firma pública de
`lumi_installer::manifiesto::obtener_verificado`, así que no afecta a sus otros llamadores
(`installer/src-tauri/src/silencioso.rs`, `crates/lumi-cli/src/install.rs`), que se quedan tal
cual.

- [ ] **Paso 1: Timeout explícito en la petición**

En `crates/lumi-installer/src/manifiesto.rs`, sustituir:

```rust
pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    let manifiesto: Manifiesto = reqwest::blocking::get(VERSIONES_URL)
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .json()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
```

por:

```rust
pub fn obtener_verificado() -> Result<Manifiesto, InstaladorError> {
    // Sin tope, una red lenta o caída a medias podía dejar esta llamada
    // colgada indefinidamente — 5s es de sobra para una respuesta JSON de
    // unos pocos KB, y falla rápido y con un motivo claro si no llega.
    let cliente = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    let manifiesto: Manifiesto = cliente
        .get(VERSIONES_URL)
        .send()
        .map_err(|e| InstaladorError::Red(e.to_string()))?
        .json()
        .map_err(|e| InstaladorError::Red(e.to_string()))?;
    manifiesto
        .comprobar()
        .map_err(|e| InstaladorError::Manifiesto(e.to_string()))?;
    Ok(manifiesto)
}
```

- [ ] **Paso 2: Sacar la petición del hilo de comandos de Tauri**

En `installer/src-tauri/src/comandos.rs`, cambia las dos funciones a `async fn` y envuelve la
llamada bloqueante en `tokio::task::spawn_blocking` — mismo patrón que
`indexer/src-tauri/src/lib.rs` ya usa en `rendimiento_leer`
(`tokio::task::spawn_blocking(perf::leer).await.map_err(|e| e.to_string())`).

Sustituir:

```rust
#[tauri::command]
pub fn detectar_instalados() -> Vec<InfoProducto> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().ok();
    ["cliente", "indexer"]
        .into_iter()
        .map(|p| {
            let version_disponible = manifiesto.as_ref().and_then(|m| {
                m.mas_nueva(producto_enum(p), "0.0.0", "windows-x86_64")
                    .map(|publi| publi.version.clone())
            });
            match marca::leer(p) {
                Some(m) => InfoProducto {
                    producto: p.to_string(), ya_instalado: true, version: Some(m.version), version_disponible,
                },
                None => InfoProducto {
                    producto: p.to_string(), ya_instalado: false, version: None, version_disponible,
                },
            }
        })
        .collect()
}
```

por:

```rust
#[tauri::command]
pub async fn detectar_instalados() -> Vec<InfoProducto> {
    // La petición de red es bloqueante (`reqwest::blocking`) — sacarla del
    // hilo de comandos de Tauri con `spawn_blocking` es lo que evita que la
    // ventana se vea "no responde" mientras tarda.
    let manifiesto = tokio::task::spawn_blocking(lumi_installer::manifiesto::obtener_verificado)
        .await
        .ok()
        .and_then(|r| r.ok());

    ["cliente", "indexer"]
        .into_iter()
        .map(|p| {
            let version_disponible = manifiesto.as_ref().and_then(|m| {
                m.mas_nueva(producto_enum(p), "0.0.0", "windows-x86_64")
                    .map(|publi| publi.version.clone())
            });
            match marca::leer(p) {
                Some(m) => InfoProducto {
                    producto: p.to_string(), ya_instalado: true, version: Some(m.version), version_disponible,
                },
                None => InfoProducto {
                    producto: p.to_string(), ya_instalado: false, version: None, version_disponible,
                },
            }
        })
        .collect()
}
```

Y sustituir:

```rust
#[tauri::command]
pub fn listar_versiones_disponibles() -> Result<Vec<VersionDisponible>, String> {
    let manifiesto = lumi_installer::manifiesto::obtener_verificado().map_err(|e| e.to_string())?;
```

por:

```rust
#[tauri::command]
pub async fn listar_versiones_disponibles() -> Result<Vec<VersionDisponible>, String> {
    let manifiesto = tokio::task::spawn_blocking(lumi_installer::manifiesto::obtener_verificado)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
```

(el resto del cuerpo de `listar_versiones_disponibles`, después de esa línea, no cambia).

- [ ] **Paso 3: Compilar**

Run: `cd installer/src-tauri && cargo build`.
Expected: compila sin errores. Si algún llamador del frontend (`installer/instalador.js`) invoca
estos comandos esperando una respuesta síncrona en algún sentido especial (no debería — `invoke`
de Tauri ya es siempre una promesa desde JS), no hace falta tocar el JS.

---

## Task 5: Verificación final y commit

- [ ] **Paso 1: Compilar todo**

Run: `cd indexer/src-tauri && cargo build` y `cd installer/src-tauri && cargo build`.
Expected: sin errores.

- [ ] **Paso 2: Typecheck y lint del Indexer**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: limpio.

- [ ] **Paso 3: Sanity check de git**

Run: `git status --short && git log --oneline -3`. No incluyas en el commit ningún archivo que
este plan no haya tocado — en especial, si `BUG_BOUNTY.txt` tiene cambios de otra sesión, déjalo
fuera.

- [ ] **Paso 4: Commit único**

Run (ajusta la lista de archivos a los que de verdad tocaste — incluye los PNG/ICO regenerados en
`indexer/src-tauri/icons/`):

```bash
git add indexer/src-tauri/icons/ indexer/src-tauri/tauri.conf.json \
  indexer/src/setup/ServicesPanel.tsx indexer/src/setup/ServicesBoot.tsx \
  indexer/src/setup/ServicesFailDialog.tsx indexer/src/setup/ServicesStep.tsx \
  indexer/src/ingest/LegacyImportDialog.tsx indexer/src/ingest/FolderImportDialog.tsx \
  indexer/src/catalog/IndexDetail.tsx \
  crates/lumi-installer/src/manifiesto.rs installer/src-tauri/src/comandos.rs \
  docs/superpowers/plans/2026-09-01-arranque-y-accesos-plan.md
git commit -m "$(cat <<'EOF'
fix: icono del Indexer legible a tamaño pequeño, WSL ya no se queda en error fantasma, importar se puede cancelar, instalador ya no se congela

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
