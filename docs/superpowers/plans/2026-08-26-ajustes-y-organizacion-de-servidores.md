# Ajustes del cliente y organización de servidores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cliente gana un botón de ajustes (esquina inferior de la pantalla de entrada) con
estructura tipo panel de administración, dos secciones (Actualizaciones, Apariencia). El selector
de servidores invierte qué dato manda (etiqueta primero, dirección segundo), y gana carpetas
locales asignables por menú contextual más un icono por servidor cacheado desde el avatar que el
propio servidor ya publica.

**Architecture:** Todo vive en `client/src` (npm project aparte, no toca `client/src-tauri` ni
Rust). Reutiliza patrones ya existentes: la estructura de `ProfileSidebar.tsx`/`ProfileView.tsx`
para el panel de ajustes, el `ContextMenu.tsx` ya genérico para las carpetas, y `localStorage`
(mismo mecanismo que `lib/session.ts` ya usa) para todo lo nuevo — nada de esto toca `lumid` ni
sale del cliente.

**Tech Stack:** React + TypeScript, Tailwind, `localStorage`, Tauri v2 (solo para leer bytes del
avatar vía el esquema `lumi://` ya existente).

## Global Constraints

- Spec fuente: [2026-08-26-ajustes-y-organizacion-de-servidores-design.md](../specs/2026-08-26-ajustes-y-organizacion-de-servidores-design.md).
- Español en código, comentarios y copy de UI.
- **No escribir tests** (convención del proyecto — no hay excepción aquí, todo es `client/`, y la
  única excepción del repo es `lumi-proto`). Verificar con `tsc`/`lint`/`build`.
- Sin tema claro — DESIGN.md es dark-only, "Apariencia" no incluye ningún selector de tema.
- Un commit por tarea, mensaje en español, sin `--no-verify`.

---

### Task 1: Apariencia — "reducir movimiento" persistente

**Files:**
- Create: `client/src/lib/apariencia.ts`
- Modify: `client/src/index.css`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Produces: `leerReducirMovimiento(): boolean`, `setReducirMovimiento(activo: boolean): void`,
  `aplicarReducirMovimiento(activo: boolean): void` — los usa la Tarea 3 (`AjustesView`).

- [ ] **Paso 1: crear `lib/apariencia.ts`**

```typescript
const KEY = "lumi.reducir-movimiento";

/** Aplica/quita la clase que la regla CSS de `index.css` usa para apagar
 *  animaciones y transiciones de golpe — separada de `setReducirMovimiento`
 *  para poder aplicarla en `main.tsx` sin escribir en `localStorage` otra
 *  vez cada vez que arranca la app. */
export function aplicarReducirMovimiento(activo: boolean) {
  document.documentElement.classList.toggle("jg-reduce-motion", activo);
}

export function leerReducirMovimiento(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function setReducirMovimiento(activo: boolean) {
  localStorage.setItem(KEY, activo ? "1" : "0");
  aplicarReducirMovimiento(activo);
}
```

- [ ] **Paso 2: regla CSS**

En `client/src/index.css`, después de la línea `@media (prefers-reduced-motion: reduce) { .lumi-anim { animation: none !important; } }`
(línea 91), añade:

```css
/* Preferencia explícita del investigador (ver lib/apariencia.ts), no solo la
   del sistema operativo: las animaciones jg-* se aplican sobre todo por
   `style` inline (mayor especificidad que una clase normal), así que hace
   falta `!important` aquí para poder apagarlas de verdad. */
:root.jg-reduce-motion *, :root.jg-reduce-motion *::before, :root.jg-reduce-motion *::after {
  animation: none !important;
  transition: none !important;
}
```

- [ ] **Paso 3: aplicar al arrancar, antes del primer render**

En `client/src/main.tsx`, sustituye el archivo completo por:

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { aplicarReducirMovimiento, leerReducirMovimiento } from './lib/apariencia.ts'

aplicarReducirMovimiento(leerReducirMovimiento())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

- [ ] **Paso 4: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 5: commit**

```bash
git add client/src/lib/apariencia.ts client/src/index.css client/src/main.tsx
git commit -m "feat: preferencia local para reducir el movimiento de la interfaz"
```

---

### Task 2: extraer `ActualizacionesSeccion` (reusada por Perfil y por Ajustes)

**Files:**
- Create: `client/src/settings/ActualizacionesSeccion.tsx`
- Modify: `client/src/profile/ProfileView.tsx`

**Interfaces:**
- Consumes: `comprobarActualizacion`, `dispararActualizacionSilenciosa`, `EstadoActualizacion`
  (ya existen en `client/src/lib/actualizaciones.ts`).
- Produces: `ActualizacionesSeccion` (componente sin props) — lo usa también la Tarea 3
  (`AjustesView`).

- [ ] **Paso 1: crear el componente, con el bloque "Lumi" que hoy vive dentro de `PerfilPanel`**

Crea `client/src/settings/ActualizacionesSeccion.tsx`:

```tsx
import { useState } from "react";
import { comprobarActualizacion, dispararActualizacionSilenciosa, type EstadoActualizacion } from "../lib/actualizaciones";

/** El bloque de "comprobar actualizaciones" — antes vivía solo dentro de
 *  `ProfileView.tsx` (con sesión). Ahora lo reusa también `AjustesView.tsx`
 *  (sin sesión, la comprobación no la necesita: es una llamada aparte a
 *  Vercel, no a `lumid`). Misma lógica, dos sitios donde vivir. */
export function ActualizacionesSeccion() {
  const [estado, setEstado] = useState<EstadoActualizacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [comprobando, setComprobando] = useState(false);

  async function comprobarAhora() {
    setComprobando(true);
    setError(null);
    try {
      setEstado(await comprobarActualizacion());
    } catch (e) {
      setEstado(null);
      setError(String(e));
    } finally {
      setComprobando(false);
    }
  }

  return (
    <div className="rounded-card border border-border bg-panel p-[13px_16px]">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi</span>
      </div>
      {estado?.tipo === "disponible" && (
        <p className="text-[11px] text-draw-fg">Versión {estado.version} disponible — {estado.notas}</p>
      )}
      {estado?.tipo === "retirada" && (
        <p className="text-[11px] text-warning-fg">Tu versión fue retirada. Actualiza en cuanto puedas.</p>
      )}
      {!estado && !error && !comprobando && (
        <p className="text-[11px] text-muted">Sin comprobar en esta sesión.</p>
      )}
      {error && <p className="text-[11px] text-subtle">No se pudo comprobar: {error}</p>}
      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={() => void comprobarAhora()} disabled={comprobando}
          className="jg-press rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
          {comprobando ? "Comprobando…" : "Comprobar ahora"}
        </button>
        {estado?.tipo === "disponible" && (
          <button onClick={() => void dispararActualizacionSilenciosa(estado.version)}
            className="jg-press rounded-lg bg-accent px-2.5 py-1 text-[10.5px] font-medium text-black">
            Actualizar ahora
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Paso 2: `ProfileView.tsx` usa el componente en vez de su copia local**

En `client/src/profile/ProfileView.tsx`, cambia el import (línea 12) de:

```typescript
import { comprobarActualizacion, type EstadoActualizacion } from "../lib/actualizaciones";
```

a:

```typescript
import { ActualizacionesSeccion } from "../settings/ActualizacionesSeccion";
```

Dentro de `PerfilPanel`, elimina estos tres `useState` (parte de las líneas 49-51):

```typescript
  const [actEstado, setActEstado] = useState<EstadoActualizacion | null>(null);
  const [actError, setActError] = useState<string | null>(null);
  const [actComprobando, setActComprobando] = useState(false);
```

y elimina la función `comprobarAhora` completa (líneas 55-66):

```typescript
  async function comprobarAhora() {
    setActComprobando(true);
    setActError(null);
    try {
      setActEstado(await comprobarActualizacion());
    } catch (e) {
      setActEstado(null);
      setActError(String(e));
    } finally {
      setActComprobando(false);
    }
  }
```

y sustituye el bloque de renderizado "Lumi" (líneas 127-145):

```tsx
      <div className="mt-4 rounded-card border border-border bg-panel p-[13px_16px]">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[8.5px] uppercase tracking-[.15em] text-subtle">Lumi</span>
        </div>
        {actEstado?.tipo === "disponible" && (
          <p className="text-[11px] text-draw-fg">Versión {actEstado.version} disponible — {actEstado.notas}</p>
        )}
        {actEstado?.tipo === "retirada" && (
          <p className="text-[11px] text-warning-fg">Tu versión fue retirada. Actualiza en cuanto puedas.</p>
        )}
        {!actEstado && !actError && !actComprobando && (
          <p className="text-[11px] text-muted">Sin comprobar en esta sesión.</p>
        )}
        {actError && <p className="text-[11px] text-subtle">No se pudo comprobar: {actError}</p>}
        <button onClick={() => void comprobarAhora()} disabled={actComprobando}
          className="jg-press mt-2.5 rounded-lg border border-white/15 px-2.5 py-1 text-[10.5px] text-fg disabled:opacity-40">
          {actComprobando ? "Comprobando…" : "Comprobar ahora"}
        </button>
      </div>
```

por:

```tsx
      <div className="mt-4">
        <ActualizacionesSeccion />
      </div>
```

- [ ] **Paso 3: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos (en particular, ningún import sin usar de `actualizaciones.ts`
en `ProfileView.tsx`).

- [ ] **Paso 4: commit**

```bash
git add client/src/settings/ActualizacionesSeccion.tsx client/src/profile/ProfileView.tsx
git commit -m "refactor: extraer ActualizacionesSeccion para reusarla fuera del perfil"
```

---

### Task 3: panel de Ajustes (`AjustesSidebar` + `AjustesView`)

**Files:**
- Create: `client/src/settings/AjustesSidebar.tsx`
- Create: `client/src/settings/AjustesView.tsx`

**Interfaces:**
- Consumes: `ActualizacionesSeccion` (Tarea 2), `leerReducirMovimiento`/`setReducirMovimiento`
  (Tarea 1), `Seccion` (ya existe, exportado de `client/src/admin/AdminPanel.tsx`).
- Produces: `AjustesView({ onBack })` — lo consume la Tarea 4 (`EntryScreen.tsx`).

- [ ] **Paso 1: `AjustesSidebar.tsx`, mismo patrón que `ProfileSidebar.tsx` sin cuenta detrás**

Crea `client/src/settings/AjustesSidebar.tsx`:

```tsx
import { useLayoutEffect, useRef, useState } from "react";
import { Icon, type IconName } from "../ui/Icon";

export type AjustesSeccion = "actualizaciones" | "apariencia";

const ITEMS: { id: AjustesSeccion; label: string; icon: IconName }[] = [
  { id: "actualizaciones", label: "Actualizaciones", icon: "boxes" },
  { id: "apariencia", label: "Apariencia", icon: "image" },
];

/** Mismo patrón visual que `profile/ProfileSidebar.tsx` (marcador
 *  deslizante, mismo ancho de riel) pero sin cabecera de cuenta: estos son
 *  ajustes de la app en sí, visibles con o sin sesión. */
export function AjustesSidebar({ actual, onIr, onBack }: {
  actual: AjustesSeccion; onIr: (s: AjustesSeccion) => void; onBack: () => void;
}) {
  const nav = useRef<HTMLElement>(null);
  const [marca, setMarca] = useState<{ top: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const b = nav.current?.querySelector<HTMLElement>(`[data-s="${actual}"]`);
    if (b) setMarca({ top: b.offsetTop + 6, height: b.offsetHeight - 12 });
  }, [actual]);

  return (
    <aside className="flex flex-col border-r border-border bg-surface px-[9px] pb-[11px] pt-[13px]">
      <button onClick={onBack} className="mb-3 rounded-[7px] px-2 py-1 text-left text-[10.5px] text-subtle hover:text-fg">
        ← Volver
      </button>
      <div className="flex items-center gap-2.5 px-2 pb-3">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-[8px]
          border border-border bg-elevated text-muted">
          <Icon name="ajustes" size={13} />
        </span>
        <span className="text-[11.5px] leading-tight text-fg">
          Ajustes
          <small className="block text-[9px] tracking-[.03em] text-subtle">de esta app</small>
        </span>
      </div>

      <nav ref={nav} className="relative flex flex-col gap-px">
        {marca && (
          <span aria-hidden className="absolute -left-[9px] w-0.5 rounded-r-sm bg-fg
            transition-[top,height] duration-[520ms] ease-expo"
            style={{ top: marca.top, height: marca.height }} />
        )}
        {ITEMS.map((it) => {
          const on = it.id === actual;
          return (
            <button key={it.id} data-s={it.id} onClick={() => onIr(it.id)}
              className={`flex w-full items-center gap-2 rounded-[7px] px-2 py-[6.5px] text-left
                text-[11.5px] transition-[background-color,color,padding-left] duration-[360ms]
                ease-expo hover:bg-white/[.04] hover:pl-[11px] hover:text-fg
                ${on ? "bg-white/[.06] text-fg" : "text-muted"}`}>
              <Icon name={it.icon} size={13} className={on ? "opacity-100" : "opacity-70"} />
              {it.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Paso 2: `AjustesView.tsx`, mismo esqueleto que `ProfileView.tsx`**

Crea `client/src/settings/AjustesView.tsx`:

```tsx
import { useState } from "react";
import { Seccion } from "../admin/AdminPanel";
import { leerReducirMovimiento, setReducirMovimiento } from "../lib/apariencia";
import { AjustesSidebar, type AjustesSeccion } from "./AjustesSidebar";
import { ActualizacionesSeccion } from "./ActualizacionesSeccion";

/** Ajustes de la app, no de la cuenta — por eso vive fuera de
 *  `profile/ProfileView.tsx` y no exige sesión. Mismo esqueleto de grid que
 *  ProfileView/AdminPanel. */
export function AjustesView({ onBack }: { onBack: () => void }) {
  const [seccion, setSeccion] = useState<AjustesSeccion>("actualizaciones");

  return (
    <div className="grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <AjustesSidebar actual={seccion} onIr={setSeccion} onBack={onBack} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        {seccion === "actualizaciones" ? (
          <Seccion titulo="Actualizaciones" grupo="Ajustes">
            <p className="text-[11px] text-muted">Comprueba si hay una versión nueva de Lumi.</p>
            <div className="mt-4">
              <ActualizacionesSeccion />
            </div>
          </Seccion>
        ) : (
          <AparienciaPanel />
        )}
      </div>
    </div>
  );
}

function AparienciaPanel() {
  const [activo, setActivo] = useState(leerReducirMovimiento());

  return (
    <Seccion titulo="Apariencia" grupo="Ajustes">
      <label className="flex items-center justify-between gap-3 rounded-card border border-border bg-panel p-[13px_16px]">
        <span className="text-[11.5px] text-fg">
          Reducir movimiento
          <small className="mt-0.5 block text-[10px] text-subtle">Desactiva las animaciones de la interfaz.</small>
        </span>
        <button role="switch" aria-checked={activo}
          onClick={() => { const v = !activo; setActivo(v); setReducirMovimiento(v); }}
          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors duration-300 ease-expo ${activo ? "bg-accent" : "bg-white/15"}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-black transition-transform duration-300 ease-expo ${activo ? "translate-x-[18px]" : "translate-x-0.5"}`} />
        </button>
      </label>
    </Seccion>
  );
}
```

- [ ] **Paso 3: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 4: commit**

```bash
git add client/src/settings/AjustesSidebar.tsx client/src/settings/AjustesView.tsx
git commit -m "feat: panel de ajustes del cliente con Actualizaciones y Apariencia"
```

---

### Task 4: botón de ajustes en la pantalla de entrada

**Files:**
- Modify: `client/src/entry/EntryScreen.tsx`

**Interfaces:**
- Consumes: `AjustesView` (Tarea 3).

- [ ] **Paso 1: nuevo `EntryView` y atajo de salida temprana**

En `client/src/entry/EntryScreen.tsx`, cambia el import (línea 10, junto a los demás) y añade:

```typescript
import type { AccessStatus } from "../lib/api";
import { AjustesView } from "../settings/AjustesView";
import { Icon } from "../ui/Icon";
```

Cambia la línea 12:

```typescript
export type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password";
```

a:

```typescript
export type EntryView = "login" | "add" | "request" | "waiting" | "resolved" | "password" | "ajustes";
```

Dentro de `EntryScreen`, justo después de la línea `const [resolved, setResolved] = useState<AccessStatus | null>(null);` (línea 44), añade un retorno temprano — `AjustesView` es una pantalla de página completa (grid `[206px_1fr]`), no una tarjeta centrada como el resto de vistas, así que no pasa por `Pane`/`WavesBackground`:

```tsx
  if (view === "ajustes") {
    return <AjustesView onBack={() => setView("login")} />;
  }
```

- [ ] **Paso 2: el botón, siempre visible en el resto de vistas**

Al final del archivo, sustituye la línea de retorno:

```tsx
  return <><WavesBackground />{pane}</>;
```

por:

```tsx
  return (
    <>
      <WavesBackground />
      {pane}
      <button onClick={() => setView("ajustes")}
        className="fixed bottom-4 left-4 z-10 grid h-8 w-8 place-items-center rounded-full
          border border-white/15 bg-[rgba(16,19,25,.66)] text-subtle backdrop-blur-xl
          transition-colors duration-300 ease-expo hover:text-fg"
        title="Ajustes">
        <Icon name="ajustes" size={14} />
      </button>
    </>
  );
```

- [ ] **Paso 3: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 4: commit**

```bash
git add client/src/entry/EntryScreen.tsx
git commit -m "feat: boton de ajustes en la esquina inferior de la pantalla de entrada"
```

---

### Task 5: modelo de datos — carpetas y avatar cacheado en `session.ts`

**Files:**
- Modify: `client/src/lib/session.ts`

**Interfaces:**
- Produces: `Server.folderId`/`Server.avatarDataUrl`, `ServerFolder`, `loadServerFolders`,
  `createServerFolder`, `deleteServerFolder`, `moveServerToFolder`, `updateServerAvatar`,
  `loadCarpetasColapsadas`, `toggleCarpetaColapsada` — los usa la Tarea 6 (caché del avatar) y la
  Tarea 7 (`ServerSelect.tsx`).

- [ ] **Paso 1: extender `Server` y añadir `ServerFolder`**

Sustituye la interfaz `Server` (líneas 22-27) por:

```typescript
/** Servidor recordado. `folderId`/`avatarDataUrl` son organización PERSONAL
 *  de este cliente — el servidor no sabe nada de esto ni lo transporta. */
export interface Server {
  addr: string;
  fingerprint: string;
  label: string;
  folderId?: string;
  /** Caché local del avatar que el servidor publica en
   *  `/v1/server-profile/avatar` — nunca se sube nada desde el cliente. Se
   *  guarda al añadir el servidor y se refresca en cada reconexión
   *  correcta (ver `lib/bridge.ts::fetchLumiAvatarDataUrl`). */
  avatarDataUrl?: string;
}

/** Carpeta local para organizar la lista de servidores guardados. */
export interface ServerFolder {
  id: string;
  nombre: string;
}
```

- [ ] **Paso 2: claves de almacenamiento nuevas**

Junto a las constantes existentes (línea 30, después de `const SERVERS = "lumi.servers";`),
añade:

```typescript
const SERVER_FOLDERS = "lumi.server-folders";
const SERVER_FOLDERS_COLAPSADAS = "lumi.server-folders.colapsadas";
```

- [ ] **Paso 3: funciones de carpetas y avatar**

Al final del archivo (después de `deviceName`), añade:

```typescript
export function loadServerFolders(): ServerFolder[] {
  try {
    return JSON.parse(localStorage.getItem(nsKey(SERVER_FOLDERS)) ?? "[]") as ServerFolder[];
  } catch {
    return [];
  }
}

export function createServerFolder(nombre: string): ServerFolder {
  const folder: ServerFolder = { id: crypto.randomUUID(), nombre };
  localStorage.setItem(nsKey(SERVER_FOLDERS), JSON.stringify([...loadServerFolders(), folder]));
  return folder;
}

/** No borra si todavía tiene servidores dentro — la UI ya deshabilita el
 *  botón en ese caso (ver `ServerSelect.tsx`), esto es la red de seguridad
 *  contra dejar servidores con un `folderId` que ya no existe. */
export function deleteServerFolder(id: string) {
  if (loadServers().some((s) => s.folderId === id)) return;
  localStorage.setItem(nsKey(SERVER_FOLDERS), JSON.stringify(loadServerFolders().filter((f) => f.id !== id)));
}

export function moveServerToFolder(addr: string, folderId: string | undefined) {
  const servers = loadServers().map((s) => (s.addr === addr ? { ...s, folderId } : s));
  localStorage.setItem(nsKey(SERVERS), JSON.stringify(servers));
}

/** Se llama tras pedir el avatar de verdad (`fetchLumiAvatarDataUrl` en
 *  `lib/bridge.ts`) — nunca borra la caché anterior si la petición falla,
 *  solo la reemplaza cuando hay un dato nuevo que guardar. */
export function updateServerAvatar(addr: string, avatarDataUrl: string) {
  const servers = loadServers().map((s) => (s.addr === addr ? { ...s, avatarDataUrl } : s));
  localStorage.setItem(nsKey(SERVERS), JSON.stringify(servers));
}

export function loadCarpetasColapsadas(): Record<string, boolean> {
  try {
    return JSON.parse(localStorage.getItem(nsKey(SERVER_FOLDERS_COLAPSADAS)) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function toggleCarpetaColapsada(id: string): Record<string, boolean> {
  const cur = loadCarpetasColapsadas();
  cur[id] = !cur[id];
  localStorage.setItem(nsKey(SERVER_FOLDERS_COLAPSADAS), JSON.stringify(cur));
  return cur;
}
```

- [ ] **Paso 4: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores (nada las usa todavía, pero deben compilar solas).

- [ ] **Paso 5: commit**

```bash
git add client/src/lib/session.ts
git commit -m "feat: session.ts gana carpetas y avatar cacheado por servidor"
```

---

### Task 6: cachear el avatar del servidor al añadirlo y al reconectar

**Files:**
- Modify: `client/src/lib/bridge.ts`
- Modify: `client/src/entry/AddServerForm.tsx`
- Modify: `client/src/entry/LoginForm.tsx`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `updateServerAvatar` (Tarea 5).
- Produces: `fetchLumiAvatarDataUrl(): Promise<string | null>` (en `lib/bridge.ts`) — lo consumen
  los otros tres archivos de esta tarea, y opcionalmente cualquier sitio futuro.

- [ ] **Paso 1: helper en `bridge.ts`**

En `client/src/lib/bridge.ts`, después de `blobToBase64` (que termina en la línea 82, antes de
`pickPaths`), añade:

```typescript
/** Convierte a `data:` URL los bytes del avatar público del servidor
 *  CONECTADO AHORA MISMO — `lumiUrl(...)` sale por el cliente TLS anclado
 *  del lado Rust, que es un singleton (`state.base`/`state.client`), así
 *  que esto solo puede pedirse justo tras un `pair`/`pairCard`/`reconnect`
 *  con éxito contra ESE servidor, nunca para uno cualquiera de la lista
 *  guardada. Por eso se cachea en `Server.avatarDataUrl` (ver
 *  `lib/session.ts`) en vez de pedirse en cada render de la lista. `null`
 *  si el servidor no tiene avatar o si falla la petición — nunca lanza. */
export async function fetchLumiAvatarDataUrl(): Promise<string | null> {
  try {
    const res = await fetch(lumiUrl("/v1/server-profile/avatar"));
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
```

- [ ] **Paso 2: cachear al añadir un servidor**

En `client/src/entry/AddServerForm.tsx`, cambia el import (línea 2-3) de:

```typescript
import { addrFromCard, api, fingerprintFromCard, isCard, parseVersionMismatch, type Hello, type ServerProfileSettings } from "../lib/api";
import { addServer } from "../lib/session";
```

a:

```typescript
import { addrFromCard, api, fingerprintFromCard, isCard, parseVersionMismatch, type Hello, type ServerProfileSettings } from "../lib/api";
import { fetchLumiAvatarDataUrl } from "../lib/bridge";
import { addServer } from "../lib/session";
```

Añade el estado (junto a `perfil`, línea 14):

```typescript
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
```

En `verify()`, sustituye:

```typescript
      try {
        setPerfil(await api.serverProfilePublic());
      } catch {
        setPerfil(null);
      }
```

por:

```typescript
      try {
        const p = await api.serverProfilePublic();
        setPerfil(p);
        setAvatarDataUrl(p.has_avatar ? await fetchLumiAvatarDataUrl() : null);
      } catch {
        setPerfil(null);
        setAvatarDataUrl(null);
      }
```

Y en `save()`, sustituye:

```typescript
  function save() {
    const addr = addrFromCard(text);
    addServer({ addr, fingerprint: fingerprintFromCard(text), label: label.trim() || addr });
    onAdded(addr);
  }
```

por:

```typescript
  function save() {
    const addr = addrFromCard(text);
    addServer({
      addr, fingerprint: fingerprintFromCard(text), label: label.trim() || addr,
      avatarDataUrl: avatarDataUrl ?? undefined,
    });
    onAdded(addr);
  }
```

- [ ] **Paso 3: refrescar al iniciar sesión (`LoginForm.tsx`)**

En `client/src/entry/LoginForm.tsx`, cambia el import (línea 2-4) añadiendo:

```typescript
import { fetchLumiAvatarDataUrl } from "../lib/bridge";
import { updateServerAvatar } from "../lib/session";
```

En `submit()`, justo después de `useServer.getState().setHello(h);` (línea 28), añade:

```typescript
      // En segundo plano — un avatar desactualizado no debe retrasar el
      // login, y un fallo aquí (servidor sin avatar, sin red un instante)
      // no es un error de inicio de sesión.
      void fetchLumiAvatarDataUrl().then((d) => { if (d) updateServerAvatar(server.addr, d); });
```

- [ ] **Paso 4: refrescar al retomar sesión (`App.tsx`)**

En `client/src/App.tsx`, cambia las líneas de import 23-24:

```typescript
import { announcePresence, setAuth } from "./lib/bridge";
import { loadSession, updateSession } from "./lib/session";
```

a:

```typescript
import { announcePresence, fetchLumiAvatarDataUrl, setAuth } from "./lib/bridge";
import { loadSession, updateServerAvatar, updateSession } from "./lib/session";
```

Dentro del efecto de retomar sesión, justo después de `useServer.getState().setAddr(session.addr);`
(línea 100), añade:

```typescript
        void fetchLumiAvatarDataUrl().then((d) => { if (d) updateServerAvatar(session.addr, d); });
```

- [ ] **Paso 5: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 6: commit**

```bash
git add client/src/lib/bridge.ts client/src/entry/AddServerForm.tsx client/src/entry/LoginForm.tsx client/src/App.tsx
git commit -m "feat: cachear el avatar publico del servidor al anadirlo y al reconectar"
```

---

### Task 7: `ServerSelect.tsx` — orden invertido, avatar, carpetas y menú contextual

**Files:**
- Modify: `client/src/entry/ServerSelect.tsx`

**Interfaces:**
- Consumes: `loadServerFolders`, `createServerFolder`, `deleteServerFolder`,
  `moveServerToFolder`, `loadCarpetasColapsadas`, `toggleCarpetaColapsada` (Tarea 5);
  `ContextMenu`/`menuAt`/`MenuState` (ya existen, `client/src/ui/ContextMenu.tsx`).

- [ ] **Paso 1: reescribir el archivo completo**

Sustituye `client/src/entry/ServerSelect.tsx` entero por:

```tsx
import { useEffect, useRef, useState } from "react";
import {
  createServerFolder, deleteServerFolder, loadCarpetasColapsadas, loadServerFolders,
  loadServers, moveServerToFolder, toggleCarpetaColapsada,
  type Server, type ServerFolder,
} from "../lib/session";
import { ContextMenu, menuAt, type MenuEntry, type MenuState } from "../ui/ContextMenu";
import { Icon } from "../ui/Icon";

export function ServerSelect({ value, onChange, onAdd }: {
  value: Server | null; onChange: (s: Server) => void; onAdd: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [servers, setServers] = useState<Server[]>(loadServers());
  const [folders, setFolders] = useState<ServerFolder[]>(loadServerFolders());
  const [colapsadas, setColapsadas] = useState(loadCarpetasColapsadas());
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [creandoCarpetaPara, setCreandoCarpetaPara] = useState<string | null>(null);
  const [nombreCarpeta, setNombreCarpeta] = useState("");
  const box = useRef<HTMLDivElement>(null);

  // La lista puede haber cambiado por fuera (AddServerForm, otra pestaña) —
  // se relee cada vez que se abre en vez de una sola vez al montar.
  useEffect(() => {
    if (!open) return;
    setServers(loadServers());
    setFolders(loadServerFolders());
    setColapsadas(loadCarpetasColapsadas());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [open]);

  // stopPropagation en cada disparador: sin él, el mismo clic que abre el menú
  // llega al listener del documento y lo cierra en el mismo fotograma.
  const stop = (e: React.MouseEvent, fn: () => void) => { e.stopPropagation(); fn(); };

  function refrescar() {
    setServers(loadServers());
    setFolders(loadServerFolders());
  }

  function abrirMenuServidor(e: React.MouseEvent, s: Server) {
    const items: MenuEntry[] = [
      ...folders.filter((f) => f.id !== s.folderId).map((f) => ({
        label: `Mover a «${f.nombre}»`,
        onClick: () => { moveServerToFolder(s.addr, f.id); refrescar(); },
      })),
      s.folderId ? {
        label: "Quitar de la carpeta",
        onClick: () => { moveServerToFolder(s.addr, undefined); refrescar(); },
      } : null,
      { label: "Nueva carpeta…", onClick: () => { setCreandoCarpetaPara(s.addr); setNombreCarpeta(""); } },
    ];
    menuAt(e, s.label || s.addr, items, setMenu);
  }

  function abrirMenuCarpeta(e: React.MouseEvent, f: ServerFolder, vacia: boolean) {
    menuAt(e, f.nombre, [
      { label: "Borrar carpeta", disabled: !vacia, onClick: () => { deleteServerFolder(f.id); refrescar(); } },
    ], setMenu);
  }

  function confirmarNuevaCarpeta() {
    const nombre = nombreCarpeta.trim();
    if (nombre && creandoCarpetaPara) {
      const folder = createServerFolder(nombre);
      moveServerToFolder(creandoCarpetaPara, folder.id);
      refrescar();
    }
    setCreandoCarpetaPara(null);
  }

  function alternarColapso(id: string) {
    setColapsadas(toggleCarpetaColapsada(id));
  }

  function Fila({ s }: { s: Server }) {
    return (
      <button onContextMenu={(e) => abrirMenuServidor(e, s)}
        onClick={(e) => stop(e, () => { onChange(s); setOpen(false); })}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
        <span className="flex w-[13px] shrink-0 justify-center">
          {s.addr === value?.addr ? <Icon name="check" /> : null}
        </span>
        {s.avatarDataUrl ? (
          <img src={s.avatarDataUrl} alt="" className="h-[18px] w-[18px] shrink-0 rounded-full object-cover" />
        ) : (
          <span className="grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full bg-elevated text-subtle">
            <Icon name="device" size={10} />
          </span>
        )}
        <span className="truncate">{s.label}</span>
        {s.label !== s.addr && (
          <span className="ml-auto shrink-0 font-mono text-[11px] text-subtle">{s.addr}</span>
        )}
      </button>
    );
  }

  const sueltos = servers.filter((s) => !s.folderId || !folders.some((f) => f.id === s.folderId));

  return (
    <div ref={box} className="relative">
      <button onClick={(e) => stop(e, () => setOpen((o) => !o))}
        className="flex w-full items-center justify-between rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 text-left text-[12.5px] text-fg outline-none transition-[border-color] duration-300 ease-expo hover:border-white/30">
        <span>{value?.label ?? "sin servidores"}</span>
        <Icon name="chevron" className={`transition-transform duration-300 ease-expo ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-[280px] overflow-y-auto rounded-lg border border-border bg-[#0d0f12] shadow-lg shadow-black/50"
          style={{ animation: "jg-fade-rise .28s both" }}>
          {creandoCarpetaPara && (
            <div className="flex items-center gap-1.5 border-b border-border p-2" onClick={(e) => e.stopPropagation()}>
              <input autoFocus value={nombreCarpeta} onChange={(e) => setNombreCarpeta(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") confirmarNuevaCarpeta();
                  if (e.key === "Escape") setCreandoCarpetaPara(null);
                }}
                placeholder="Nombre de la carpeta"
                className="w-full rounded border border-border bg-transparent px-2 py-1 text-[11px] text-fg outline-none" />
              <button onClick={(e) => stop(e, confirmarNuevaCarpeta)} className="text-[11px] text-fg">✓</button>
            </div>
          )}

          {folders.map((f) => {
            const deEsta = servers.filter((s) => s.folderId === f.id);
            const colapsada = !!colapsadas[f.id];
            return (
              <div key={f.id}>
                <button onClick={(e) => stop(e, () => alternarColapso(f.id))}
                  onContextMenu={(e) => abrirMenuCarpeta(e, f, deEsta.length === 0)}
                  className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-[10px] uppercase tracking-[.08em] text-subtle hover:text-fg">
                  <Icon name="chevron" size={10} className={`transition-transform duration-300 ease-expo ${colapsada ? "-rotate-90" : ""}`} />
                  <Icon name="folder" size={11} />
                  {f.nombre}
                </button>
                {!colapsada && deEsta.map((s) => <Fila key={s.addr} s={s} />)}
              </div>
            );
          })}

          {sueltos.map((s) => <Fila key={s.addr} s={s} />)}

          {servers.length > 0 && <div className="h-px bg-border" />}
          <button onClick={(e) => stop(e, () => { onAdd(); setOpen(false); })}
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] text-fg hover:bg-white/[.05]">
            <Icon name="plus" /> Configurar un servidor nuevo
          </button>
        </div>
      )}
      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}
```

- [ ] **Paso 2: verificar**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores de tipos.

- [ ] **Paso 3: commit**

```bash
git add client/src/entry/ServerSelect.tsx
git commit -m "feat: ServerSelect muestra etiqueta primero, avatar y carpetas de servidores"
```

---

### Task 8: verificación final de extremo a extremo

**Files:** ninguno (solo verificación).

- [ ] **Paso 1: tipos**

Run: `cd client && npx tsc -b --noEmit`
Expected: sin errores en todo el proyecto.

- [ ] **Paso 2: lint**

Run: `cd client && npm run lint`
Expected: sin warnings/errores nuevos respecto a los ya preexistentes (revisa que ninguno
mencione los archivos tocados en este plan: `apariencia.ts`, `main.tsx`, `index.css` no aplica,
`ActualizacionesSeccion.tsx`, `ProfileView.tsx`, `AjustesSidebar.tsx`, `AjustesView.tsx`,
`EntryScreen.tsx`, `session.ts`, `bridge.ts`, `AddServerForm.tsx`, `LoginForm.tsx`, `App.tsx`,
`ServerSelect.tsx`).

- [ ] **Paso 3: build completo**

Run: `cd client && npm run build`
Expected: `tsc -b && vite build` termina sin errores.

- [ ] **Paso 4: commit final si algo quedó sin comitear**

```bash
git status --short
```

Si hay cambios sin commitear, añádelos y comitéalos:

```bash
git add -A
git commit -m "chore: ajustes finales tras verificacion de ajustes y organizacion de servidores"
```
