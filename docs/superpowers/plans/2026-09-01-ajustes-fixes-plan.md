# Ajustes: sección Rendimiento, gasto animado, limpieza y Actualizaciones — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this
> plan task-by-task, in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuatro cambios en la pantalla de Ajustes del Indexer: una sección nueva "Rendimiento"
que se queda con el selector de consumo que hoy vive dentro de "Servicios locales", la barra de
gasto mensual anima el cambio de tope en vez de saltar de golpe, se quita el bloque de texto
"Dónde va la clave" de Orígenes de red, y Actualizaciones pasa a ser su propia sección con
historial y la posibilidad de instalar una versión anterior — mismo patrón que ya tiene el
cliente.

**Architecture:** `App.tsx` ya tiene un router de pestañas de Ajustes por `pestana` (union type +
`.map` + render condicional) — las dos secciones nuevas (Rendimiento, Actualizaciones) se añaden
ahí siguiendo exactamente ese patrón. El backend de Actualizaciones para el Indexer se extiende
mirando al pie de la letra lo que ya existe en `client/src-tauri/src/main.rs` para el mismo fin
(`historial_actualizaciones`, `disparar_actualizacion_a_version`) — no se inventa un mecanismo
nuevo, se replica el ya usado y probado.

**Tech Stack:** Rust (`indexer/src-tauri`), React 19 + TypeScript (`indexer/src`).

## Global Constraints

- No añadir tests salvo que se pida explícitamente.
- Español en comentarios, copy de UI y mensajes de commit.
- Un solo commit al final. No commits intermedios por tarea.
- Antes de editar, releer el archivo — no asumas que los números de línea de este documento
  siguen exactos tras ediciones previas del propio plan.

---

## Task 1: Backend de Actualizaciones del Indexer — historial y versión concreta

**Files:**
- Modify: `indexer/src-tauri/src/actualizacion.rs`
- Modify: `indexer/src-tauri/src/lib.rs`

Replica exacta de lo que ya existe en `client/src-tauri/src/main.rs` (`historial_actualizaciones`,
`disparar_actualizacion_a_version`, la ayuda `ruta_instalador`) para el mismo producto pero del
lado del Indexer.

- [ ] **Paso 1: Extraer `manifiesto_verificado()` reusable**

En `indexer/src-tauri/src/actualizacion.rs`, sustituir el principio de `comprobar()`:

```rust
pub async fn comprobar() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;

    let version_actual = env!("CARGO_PKG_VERSION");
```

por:

```rust
/// El manifiesto ya descargado y con la firma comprobada — lo usan tanto
/// `comprobar()` (solo "¿hay algo nuevo?") como `historial()` (todo lo
/// publicado), para no repetir la descarga+verificación en los dos sitios.
async fn manifiesto_verificado() -> Result<Manifiesto, String> {
    let manifiesto: Manifiesto = reqwest::Client::new()
        .get(VERSIONES_URL)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;
    manifiesto.comprobar().map_err(|e| e.to_string())?;
    Ok(manifiesto)
}

pub async fn comprobar() -> Result<Option<EstadoActualizacion>, String> {
    let manifiesto = manifiesto_verificado().await?;
    let version_actual = env!("CARGO_PKG_VERSION");
```

(el resto del cuerpo de `comprobar()`, después de esa línea, no cambia).

- [ ] **Paso 2: `PublicacionInfo` e `historial()`**

En el mismo archivo, junto a `EstadoActualizacion`, añade:

```rust
#[derive(serde::Serialize)]
pub struct PublicacionInfo {
    pub version: String,
    pub publicado: String,
    pub notas: String,
    pub retirada: bool,
}

/// Historial completo de publicaciones del Indexer, más recientes primero —
/// a diferencia de `comprobar()` (solo "¿hay algo nuevo?"), esto es para la
/// sección de Actualizaciones de Ajustes, donde tiene sentido ver qué
/// cambió en cada versión, no solo la última.
pub async fn historial() -> Result<Vec<PublicacionInfo>, String> {
    let manifiesto = manifiesto_verificado().await?;
    let mut publicaciones: Vec<PublicacionInfo> = manifiesto
        .publicaciones
        .iter()
        .filter(|p| p.producto == Producto::Indexer)
        .map(|p| PublicacionInfo {
            version: p.version.clone(),
            publicado: p.publicado.clone(),
            notas: p.notas.clone(),
            retirada: p.retirada,
        })
        .collect();
    publicaciones.sort_by(|a, b| b.publicado.cmp(&a.publicado));
    Ok(publicaciones)
}
```

- [ ] **Paso 3: `disparar_a_version()` y `ruta_instalador()`**

En el mismo archivo, sustituir `disparar_silenciosa` (que hoy descarta el parámetro
`version_nueva` sin usarlo) dejándolo tal cual para el camino "más nueva", y añadir el camino de
versión concreta junto a él:

```rust
/// `installer.exe` solo vive junto al ejecutable en una instalación real —
/// en un build de desarrollo no lo hay. Mismo aviso que el cliente
/// (`client/src-tauri/src/main.rs::ruta_instalador`).
fn ruta_instalador(carpeta: &std::path::Path) -> Result<std::path::PathBuf, String> {
    let instalador = carpeta.join("installer.exe");
    if !instalador.exists() {
        return Err(format!(
            "no se encontró installer.exe junto a esta app ({}) — en un build de desarrollo no \
             lo hay; hace falta instalar desde el installer.exe real para que esto funcione",
            carpeta.display()
        ));
    }
    Ok(instalador)
}

pub fn disparar_silenciosa(app: tauri::AppHandle, version_nueva: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = ruta_instalador(carpeta)?;
    let pid = std::process::id();
    let version_actual = env!("CARGO_PKG_VERSION");

    std::process::Command::new(instalador)
        .arg("--producto=indexer")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-actual={version_actual}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    let _ = version_nueva;
    app.exit(0);
    Ok(())
}

/// Mismo camino que `disparar_silenciosa`, pero para igualar una versión
/// concreta (downgrade, o simplemente "esta, no la última") en vez de "la
/// más nueva".
pub fn disparar_a_version(app: tauri::AppHandle, version_objetivo: String) -> Result<(), String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let carpeta = exe.parent().ok_or("sin carpeta padre")?;
    let instalador = ruta_instalador(carpeta)?;
    let pid = std::process::id();

    std::process::Command::new(instalador)
        .arg("--producto=indexer")
        .arg(format!("--pid={pid}"))
        .arg(format!("--version-objetivo={version_objetivo}"))
        .arg("--silencioso")
        .spawn()
        .map_err(|e| e.to_string())?;

    app.exit(0);
    Ok(())
}
```

(Sustituye la función `disparar_silenciosa` existente por esta versión, que ahora usa
`ruta_instalador` en vez de construir la ruta inline — mismo comportamiento, mensaje de error más
claro en build de desarrollo, igual que el cliente.)

- [ ] **Paso 4: Comandos Tauri**

En `indexer/src-tauri/src/lib.rs`, junto a `comprobar_actualizacion`/
`disparar_actualizacion_silenciosa` (sobre la línea 141-152), añade:

```rust
#[tauri::command]
async fn historial_actualizaciones() -> Result<Vec<actualizacion::PublicacionInfo>, String> {
    actualizacion::historial().await
}

#[tauri::command]
fn disparar_actualizacion_a_version(app: tauri::AppHandle, version_objetivo: String) -> Result<(), String> {
    actualizacion::disparar_a_version(app, version_objetivo)
}
```

Y en la lista de `generate_handler!`, junto a `disparar_actualizacion_silenciosa,`:

```rust
            historial_actualizaciones,
            disparar_actualizacion_a_version,
```

- [ ] **Paso 5: Compilar**

Run: `cd indexer/src-tauri && cargo build`.
Expected: sin errores.

---

## Task 2: `api.ts` y `ActualizacionesPanel.tsx` del Indexer — mismo componente que el cliente

**Files:**
- Modify: `indexer/src/lib/actualizaciones.ts` (ya existe con `comprobarActualizacion`/
  `abrirDescarga`/`errorActualizacionPendiente`/`dispararActualizacionSilenciosa`)
- Create: `indexer/src/settings/ActualizacionesPanel.tsx`
- Modify: `indexer/src/App.tsx`
- Modify: `indexer/src/settings/DebugPanel.tsx`

- [ ] **Paso 1: Wrappers de API**

En `indexer/src/lib/actualizaciones.ts`, añade (mismo patrón que
`client/src/lib/actualizaciones.ts`):

```ts
export interface PublicacionInfo {
  version: string;
  publicado: string;
  notas: string;
  retirada: boolean;
}

export function historialActualizaciones(): Promise<PublicacionInfo[]> {
  return invoke<PublicacionInfo[]>("historial_actualizaciones");
}

export function dispararActualizacionAVersion(versionObjetivo: string): Promise<void> {
  return invoke("disparar_actualizacion_a_version", { versionObjetivo });
}
```

No hace falta ningún comando/wrapper de versión nuevo: el Indexer ya tiene su versión disponible
en el objeto `saludo` que se pide una vez al arrancar (`saludo()` en `lib.rs`, campo `"version"` —
comprueba cómo se llama ese campo tras `serde_json::json!({...})` y cómo `App.tsx` ya distribuye
`saludo` a otras pantallas, p. ej. `so` a `ServicesPanel`). Pasa esa misma versión a
`ActualizacionesPanel` como prop en vez de pedirla con un comando aparte.

- [ ] **Paso 2: `ActualizacionesPanel.tsx`**

Crea `indexer/src/settings/ActualizacionesPanel.tsx` con el mismo contenido que
`client/src/settings/ActualizacionesSeccion.tsx` (léelo primero, es autocontenido), adaptado en:
- El nombre del componente (`ActualizacionesPanel` en vez de `ActualizacionesSeccion`), que ahora
  acepta una prop `{ version: string }` (la del Indexer, pasada desde `App.tsx` a partir de
  `saludo`).
- Los imports (`comprobarActualizacion`, `dispararActualizacionAVersion`,
  `dispararActualizacionSilenciosa`, `historialActualizaciones`, `type EstadoActualizacion`,
  `type PublicacionInfo` desde `../lib/actualizaciones`).
- Donde el original llama `versionCliente()` dentro de `Historial()` (en el `Promise.all([...])`
  del `alternar()`), sustituir por la `version` recibida por prop — no hace falta pedirla por
  invoke, ya la tiene quien renderiza el panel.
- La etiqueta `<span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi</span>`
  → `Lumi Indexer`.

No reinventes el layout ni la lógica — es una copia fiel con esos tres cambios, para que el
comportamiento (comprobar, aplicar, historial colapsable, botón "Descargar esta versión" por
fila) sea idéntico al del cliente.

- [ ] **Paso 3: Registrar la pestaña en `App.tsx`**

Relee `App.tsx` completo antes de editar. Busca el union type de `pestana` (sobre la línea 42) y
la lista de pestañas (sobre la línea 264-274). Añade `"actualizaciones"` al union, una entrada en
el `.map` de etiquetas (`"Actualizaciones"`), y el render condicional
`{pestana === "actualizaciones" && <ActualizacionesPanel version={saludo.version} />}` junto a los
demás (usa el nombre real del campo de versión dentro de `saludo` tal como lo dejó el Paso 1 —
confírmalo en `lib.rs`/`api.ts` antes de escribir esta línea). Importa el componente nuevo.

- [ ] **Paso 4: Quitar el bloque de Actualizaciones de Debug**

En `indexer/src/settings/DebugPanel.tsx`, quita el bloque de "Actualizaciones" (busca el texto
"Actualizaciones" / "Comprobar ahora" en este archivo — sobre las líneas 78-95 según la
investigación previa) ya que ahora tiene su propia pestaña — no lo dupliques en dos sitios.

- [ ] **Paso 5: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores.

---

## Task 3: Sección "Rendimiento" — mueve el selector de consumo desde Servicios locales

**Files:**
- Create: `indexer/src/settings/RendimientoPanel.tsx`
- Modify: `indexer/src/setup/ServicesPanel.tsx`
- Modify: `indexer/src/App.tsx`

- [ ] **Paso 1: `RendimientoPanel.tsx`**

Relee `indexer/src/setup/ServicesPanel.tsx` completo primero. Crea
`indexer/src/settings/RendimientoPanel.tsx` moviendo ahí el bloque completo de "Consumo al
embeber" (el `useState<boolean | null>` de `consumoBajo`, el `useEffect` que lo lee con
`api.colaConsumoLeer()`, la función `cambiarConsumo`, y el bloque JSX bajo el título "Consumo al
embeber" — todo el `<div className="mt-7 border-t border-border pt-5">...</div>` del archivo
original), como un componente de pantalla completa siguiendo el mismo patrón visual que
`indexer/src/settings/OriginsPanel.tsx`/`StoragePanel.tsx` (cabecera con título de sección,
`h-full overflow-y-auto p-8`, contenido en `mx-auto max-w-xl`):

```tsx
import { useEffect, useState } from "react";

import { api } from "../lib/api";

export function RendimientoPanel() {
  const [consumoBajo, setConsumoBajo] = useState<boolean | null>(null);

  useEffect(() => { void api.colaConsumoLeer().then(setConsumoBajo); }, []);

  async function cambiarConsumo(bajo: boolean) {
    setConsumoBajo(bajo);
    await api.colaConsumoFijar(bajo);
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mx-auto max-w-xl">
        <p className="text-sm text-fg">Rendimiento</p>
        <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
          Cómo de agresivo es el Indexer con los recursos del equipo mientras trabaja de fondo.
        </p>

        <div className="mt-6">
          <p className="text-sm text-fg">Consumo al embeber</p>
          <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
            Alto reparte más VRAM y usa prioridad normal de proceso — más rápido, pero nota el
            ordenador ocupado. Bajo usa un solo modelo a la vez con prioridad baja — más lento,
            pero puedes seguir trabajando con normalidad mientras corre.
          </p>
          <div className="mt-3 flex gap-2">
            {[
              { bajo: false, etiqueta: "Alto" },
              { bajo: true, etiqueta: "Bajo" },
            ].map(({ bajo, etiqueta }) => (
              <button
                key={etiqueta}
                onClick={() => void cambiarConsumo(bajo)}
                disabled={consumoBajo === null}
                className={`jg-press rounded-lg border px-3.5 py-2 text-[11.5px] disabled:opacity-40 ${
                  consumoBajo === bajo ? "border-white/30 bg-white/[.08] text-fg" : "border-border text-fg"
                }`}
              >
                {etiqueta}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: Quitar el bloque de `ServicesPanel.tsx`**

En `indexer/src/setup/ServicesPanel.tsx`, quita: el estado `consumoBajo`/`useEffect` que lo lee/
`cambiarConsumo` (ya no se usan ahí), y el bloque JSX `<div className="mt-7 border-t ...">Consumo
al embeber...</div>`. "Servicios locales" se queda solo con arrancar/parar/estado + el log.

- [ ] **Paso 3: Registrar la pestaña**

En `App.tsx`, añade `"rendimiento"` al union de `pestana`, una entrada de etiqueta
("Rendimiento"), y `{pestana === "rendimiento" && <RendimientoPanel />}`. Importa el componente.

- [ ] **Paso 4: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores.

---

## Task 4: Animación suave en la barra de gasto mensual

**Files:**
- Modify: `indexer/src/settings/OriginsPanel.tsx`

- [ ] **Paso 1: Transición CSS en la barra**

Busca (sobre la línea 209-212):

```tsx
            <div className="mt-[11px] h-1.5 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full bg-fg"
                style={{ width: `${tope ? Math.min(100, (gastado / tope) * 100) : 0}%` }} />
            </div>
```

Sustituir por:

```tsx
            <div className="mt-[11px] h-1.5 overflow-hidden rounded-[3px] bg-elevated">
              <i className="block h-full bg-fg transition-[width] duration-500 ease-expo"
                style={{ width: `${tope ? Math.min(100, (gastado / tope) * 100) : 0}%` }} />
            </div>
```

(`ease-expo` ya es una clase de transición usada en el proyecto — confírmalo con una búsqueda de
texto en `tailwind.config`/otros componentes; si no existe como utilidad configurada, usa
`duration-500 ease-out` en su lugar.)

- [ ] **Paso 2: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores (es un cambio puramente visual, no debería tocar tipos).

---

## Task 5: Quitar el bloque "Dónde va la clave"

**Files:**
- Modify: `indexer/src/settings/OriginsPanel.tsx`

**Nota de alcance:** el pedido original ("quita el bloque de texto de donde va la clave") es
ambiguo entre varios bloques de texto candidatos cerca de las claves — el más probable por
coincidencia literal de título es la tarjeta completa "Dónde va la clave" (líneas 237-250), que es
la que se quita aquí. Si tras verlo en pantalla no es el bloque que se pedía, es un ajuste de una
línea deshacer este paso.

- [ ] **Paso 1: Quitar la tarjeta y des-flexear el contenedor**

Busca el bloque (sobre las líneas 201-251):

```tsx
        <div className="mt-6 flex gap-3.5">
          <div className="flex-1 rounded-[10px] border border-border p-[15px_16px]">
            <div className="flex items-center">
              <span className="flex-1 text-[8.5px] uppercase tracking-[.13em] text-subtle">
                Tope mensual
              </span>
              <span className="font-mono text-[11px] text-fg">{eur(tope)}</span>
            </div>
            ...
          </div>

          <div className="flex-1 rounded-[10px] border border-border p-[15px_16px]">
            <p className="text-[8.5px] uppercase tracking-[.13em] text-subtle">Dónde va la clave</p>
            ...
          </div>
        </div>
```

Quita el segundo `<div className="flex-1 ...">Dónde va la clave...</div>` completo, y simplifica
el contenedor que los envolvía (ya no hace falta que sea `flex` con dos columnas — con una sola
tarjeta dentro, cambia `<div className="mt-6 flex gap-3.5">` por `<div className="mt-6">` y deja
la tarjeta de "Tope mensual" tal cual dentro, sin `flex-1` (ya no compite por espacio con nada):
sustituye `<div className="flex-1 rounded-[10px] border border-border p-[15px_16px]">` (la de
Tope mensual) por `<div className="max-w-sm rounded-[10px] border border-border p-[15px_16px]">`
para que no se estire a todo el ancho ahora que está sola.

- [ ] **Paso 2: Verificar**

Run: `cd indexer && npx tsc -b --noEmit`.
Expected: sin errores.

---

## Task 6: Verificación final y commit

- [ ] **Paso 1: Compilar el backend**

Run: `cd indexer/src-tauri && cargo build`.
Expected: sin errores.

- [ ] **Paso 2: Typecheck y lint del frontend**

Run: `cd indexer && npx tsc -b --noEmit && npm run lint`.
Expected: ambos limpios.

- [ ] **Paso 3: Sanity check de git**

Run: `git status --short && git log --oneline -3`. Incluye solo archivos que este plan tocó — si
hay cambios de otra fuente en el árbol (p. ej. `BUG_BOUNTY.txt`), déjalos fuera del `git add`.

- [ ] **Paso 4: Commit único**

```bash
git add indexer/src-tauri/src/actualizacion.rs indexer/src-tauri/src/lib.rs \
  indexer/src/lib/api.ts indexer/src/settings/ActualizacionesPanel.tsx \
  indexer/src/settings/RendimientoPanel.tsx indexer/src/settings/OriginsPanel.tsx \
  indexer/src/settings/DebugPanel.tsx indexer/src/setup/ServicesPanel.tsx indexer/src/App.tsx \
  docs/superpowers/plans/2026-09-01-ajustes-fixes-plan.md
git commit -m "$(cat <<'EOF'
feat: sección Rendimiento, Actualizaciones con historial y versión anterior, gasto animado, limpieza de Orígenes de red

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
