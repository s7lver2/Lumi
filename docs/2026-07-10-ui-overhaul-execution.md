# UI Overhaul — Plan de ejecución paso a paso (archivo a archivo)

**Fecha:** 2026-07-10 · **Estado:** listo para ejecutar
**Diseño / porqué:** ver `2026-07-10-ui-overhaul-plan.md` (decisiones + mockups). Este documento es el **cómo**: cada paso indica archivo, cambio exacto, tests y verificación.

**Reglas transversales (aplican a todo):**
- `route.ts`/`layout.tsx`/`page.tsx` solo exportan handlers HTTP / `default` + config. Helpers → módulo hermano.
- Imports relativos (sin alias) en `apps/web`.
- TDD para lógica pura. Mapa/WebGL/SSE/formularios → verificación manual.
- Tras cada fase: `pnpm --filter @netryx/web typecheck` limpio. **No matar procesos node del usuario.**
- Toda animación nueva respeta `prefers-reduced-motion`.

Orden: **Fase 0 → 1 → 4.1–4.2 (arregla build) → 2 → 3 → 4.3–4.10**.

---

## FASE 0 — Correcciones en Entrenamiento

### Paso 0.1 — `apps/web/app/stores/useIndexingStore.ts`
En la interfaz `IndexingState`, ampliar la firma:
```ts
// antes
setEstimate: (estimate: Estimate) => void;
// después
setEstimate: (estimate: Estimate | null) => void;
```
La implementación `setEstimate: (estimate) => set({ estimate })` ya vale para `null`. Sin más cambios.

### Paso 0.2 — `apps/web/app/components/DrawToolbar.tsx` (reescribir)
Renombrar `onMode`→`onModeChange` y quitar el posicionamiento absoluto propio (lo posiciona la página). Contenido completo:
```tsx
// apps/web/app/components/DrawToolbar.tsx
"use client";
export function DrawToolbar({
  mode, onModeChange, onUndo, onRedo, onClear,
}: {
  mode: string;
  onModeChange: (m: "polygon" | "rectangle" | "circle") => void;
  onUndo: () => void; onRedo: () => void; onClear: () => void;
}) {
  const btn = (active: boolean) =>
    `rounded-md px-2.5 py-1.5 text-xs ${active ? "bg-accent text-black" : "text-fg hover:bg-white/10"}`;
  return (
    <div className="inline-flex gap-1 rounded-card border border-white/10 bg-panel/80 p-1 backdrop-blur-md shadow-lg shadow-black/40">
      <button className={btn(mode === "polygon")} onClick={() => onModeChange("polygon")}>Polígono</button>
      <button className={btn(mode === "rectangle")} onClick={() => onModeChange("rectangle")}>Rectángulo</button>
      <button className={btn(mode === "circle")} onClick={() => onModeChange("circle")}>Círculo</button>
      <span className="mx-1 w-px bg-white/10" />
      <button className={btn(false)} onClick={onUndo} aria-label="Deshacer">↶</button>
      <button className={btn(false)} onClick={onRedo} aria-label="Rehacer">↷</button>
      <button className={btn(false)} onClick={onClear}>Borrar</button>
    </div>
  );
}
```

### Paso 0.3 — `apps/web/app/(protected)/index/page.tsx`
1. Borrar el import de prueba (línea ~15-16):
   ```tsx
   // 🛠️ IMPORTACIÓN TEMPORAL PARA LA VERIFICACIÓN DE DROPZONE
   import { ImageDropzone } from "../../components/ImageDropzone";
   ```
2. Borrar el bloque `<FloatingCard>` "Test: Image Dropzone" completo (~171-182), dejando solo el `<FloatingCard>` "Indexar área" dentro del contenedor lateral.
3. La prop ya se pasa como `onModeChange={handleChangeMode}` (paso 0.2 la alinea). No tocar el wrapper `absolute bottom-6 left-1/2 -translate-x-1/2 z-40` — ahora la toolbar se renderiza ahí, visible y sin solaparse con `AreasNotification` (arriba-dcha) ni con la tarjeta "Área dibujada" (arriba-izq).
4. `handleClearPolygon` ya llama `setEstimate(null)` → válido tras 0.1.

**Verificar:** `pnpm --filter @netryx/web typecheck` (deben desaparecer los 3 errores conocidos). Prueba manual del mapa.

---

## FASE 1 — Fundamentos de diseño

### Paso 1.1 — `apps/web/tailwind.config.ts` (acento blanco, quitar verde)
```ts
// antes
accent: { DEFAULT: "#1d9e75", fg: "#5dcaa5" },
// después
accent: { DEFAULT: "#f2f3f5", fg: "#e8e8e6" },
```
`draw`/`warning`/`danger` se conservan. `accent` era el único verde de la paleta; con esto los botones `bg-accent text-black` pasan a blanco y `text-accent-fg` a neutro.

### Paso 1.2 — Barrido de verde literal
Ejecutar y revisar: `rg "#5dcaa5|#1d9e75" apps/web`. Cambios:
- `apps/web/app/components/ConfidenceCircleLayer.tsx`: sustituir los `#5dcaa5` por `#e8e8e6` en `fill-color`, `line-color` y el stroke `selected` (`["case", ["get","selected"], "#e8e8e6", "#4a4c50"]`). Mantener `#4a4c50` y `#15171a`.
- `apps/web/app/(protected)/index/page.tsx` → `renderAreaOnMap`: `area-points-dots` `circle-color` `#5dcaa5` → `#e8e8e6`. Dejar la línea `#85b7eb` (azul permitido).
- Cualquier otro hit → neutro/blanco.
- QA visual (sin cambio de código): sitios con `text-accent-fg`/`bg-accent` ahora son blancos; comprobar contraste (p.ej. no poner texto blanco sobre `bg-accent`).

### Paso 1.3 — Añadir framer-motion
`apps/web/package.json` → dependencies: `"framer-motion": "^11.11.0"`. Luego `pnpm install` (desde raíz o `--filter @netryx/web`). No requiere reiniciar el dev-server del usuario para typecheck.

### Paso 1.4 — `apps/web/app/lib/motion.ts` (nuevo)
```ts
// apps/web/app/lib/motion.ts
import type { Variants } from "framer-motion";

export const fadeRise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 26 } },
  exit: { opacity: 0, y: 8, transition: { duration: 0.15 } },
};
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.96, y: 6 },
  show: { opacity: 1, scale: 1, y: 0, transition: { type: "spring", stiffness: 320, damping: 28 } },
  exit: { opacity: 0, scale: 0.97, transition: { duration: 0.12 } },
};
export const overlay: Variants = {
  hidden: { opacity: 0 }, show: { opacity: 1, transition: { duration: 0.18 } }, exit: { opacity: 0, transition: { duration: 0.12 } },
};
export const staggerContainer: Variants = {
  hidden: {}, show: { transition: { staggerChildren: 0.05 } },
};
export const staggerItem: Variants = fadeRise;
```
Nota: los componentes usan `<motion.div variants={...} initial="hidden" animate="show" exit="exit">`. Para reducir movimiento, envolver con `const reduce = useReducedMotion()` y pasar `initial={reduce ? false : "hidden"}` donde aplique (framer-motion ya congela transforms si el usuario lo pide, pero lo hacemos explícito en entradas grandes).

### Paso 1.5 — `apps/web/app/globals.css` (keyframes de espacio)
Añadir al final:
```css
@keyframes lumi-planet-spin { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@keyframes lumi-orbit { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes lumi-twinkle { 0%,100% { opacity: .2; } 50% { opacity: .9; } }
@keyframes lumi-shimmer { 0% { transform: translateX(-140%); } 100% { transform: translateX(360%); } }
@media (prefers-reduced-motion: reduce) {
  .lumi-anim { animation: none !important; }
}
```
(Los elementos animados llevan además la clase `lumi-anim` para que el media-query los detenga.)

### Paso 1.6 — `apps/web/app/components/PlanetBackground.tsx` (nuevo)
```tsx
// apps/web/app/components/PlanetBackground.tsx
"use client";
const STARS = [
  { t: "8%", l: "12%", d: "0s" }, { t: "16%", l: "76%", d: ".6s" }, { t: "26%", l: "40%", d: "1.2s" },
  { t: "12%", l: "58%", d: "1.8s" }, { t: "70%", l: "8%", d: ".4s" }, { t: "82%", l: "30%", d: "2.1s" },
  { t: "60%", l: "88%", d: "1.5s" }, { t: "40%", l: "92%", d: ".9s" },
];
export function PlanetBackground({ satellite = false }: { satellite?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {STARS.map((s, i) => (
        <span key={i} className="lumi-anim absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ top: s.t, left: s.l, animation: `lumi-twinkle 3s ease-in-out ${s.d} infinite` }} />
      ))}
      <div className="absolute -right-40 -bottom-52 h-[520px] w-[520px] overflow-hidden rounded-full"
        style={{ background: "#33383f", boxShadow: "0 0 130px 24px rgba(150,160,175,.10), inset -34px -22px 90px rgba(0,0,0,.65)" }}>
        <div className="lumi-anim absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: "lumi-planet-spin 70s linear infinite",
            background: "radial-gradient(70px 46px at 8% 32%,rgba(255,255,255,.06),transparent 70%),radial-gradient(90px 56px at 26% 64%,rgba(0,0,0,.28),transparent 70%),radial-gradient(56px 44px at 44% 40%,rgba(255,255,255,.05),transparent 70%),radial-gradient(100px 66px at 62% 72%,rgba(0,0,0,.24),transparent 70%),radial-gradient(70px 46px at 58% 32%,rgba(255,255,255,.06),transparent 70%),#3a3f47" }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 28%,transparent 42%,rgba(0,0,0,.55) 100%)" }} />
      </div>
      {satellite && (
        <div className="lumi-anim absolute -bottom-32 left-1/2 h-[520px] w-[520px] -ml-[260px]"
          style={{ animation: "lumi-orbit 14s linear infinite" }}>
          <div className="absolute -top-1 left-1/2 h-[7px] w-[7px] -ml-[3px] rounded-full bg-[#f4f6f9]"
            style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,.6)" }} />
        </div>
      )}
    </div>
  );
}
```
(Nota: `radial-gradient` aquí es contenido de la ilustración del planeta, no decoración de chrome; es correcto.)

---

## FASE 2 — Pantalla de carga

### Paso 2.1 — `apps/web/app/components/LoadingScreen.tsx` (reescribir el splash)
Mantiene el contrato `BootGate` (fetch a `/api/map-config`, muestra hijos cuando `ready`). Solo cambia el bloque `!ready`:
```tsx
// apps/web/app/components/LoadingScreen.tsx
"use client";
import { useEffect, useState } from "react";
import { PlanetBackground } from "./PlanetBackground";

export function BootGate({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    fetch("/api/map-config").catch(() => {}).finally(() => setReady(true));
  }, []);
  if (!ready) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center overflow-hidden">
        <PlanetBackground satellite />
        <div className="relative text-center" style={{ marginBottom: 120 }}>
          <div className="text-5xl font-medium tracking-[6px] text-fg">Lumi</div>
          <p className="mt-2 text-sm text-muted">Preparando tu espacio de trabajo…</p>
          <div className="relative mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
            <div className="lumi-anim absolute left-0 top-0 h-full w-2/5 rounded-full"
              style={{ background: "linear-gradient(90deg,transparent,#f4f6f9,transparent)", animation: "lumi-shimmer 1.6s ease-in-out infinite" }} />
          </div>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
```
**Verificar:** manual (recargar la app; se ve el planeta + shimmer y luego el contenido).

---

## FASE 3 — Ajustes verdaderamente funcionales

### Paso 3.1 — `apps/web/app/settings/mask.ts` (+ test)
```ts
// apps/web/app/settings/mask.ts
const DOTS = "•".repeat(12);
/** Muestra los primeros 4 caracteres del secreto; el resto se enmascara. */
export function maskSecret(value: string): string {
  if (!value) return "";
  const head = value.slice(0, 4);
  return head + DOTS;
}
```
`apps/web/app/settings/mask.test.ts`: valor largo → `"AIza"+DOTS`; valor de 2 chars → `"AI"+DOTS`; `""` → `""`.

### Paso 3.2 — `apps/web/app/api/settings/route.ts`
En `GET`, sustituir el enmascarado fijo por `maskSecret`:
```ts
import { maskSecret } from "../../settings/mask";
// ...
for (const def of SETTINGS_SCHEMA) {
  const value = await repo.getSetting(def.key);
  if (value === null) continue;              // secreto/valor ausente => no aparece
  result[def.key] = def.isSecret ? maskSecret(value) : value;
}
```
Quitar la constante `MASK` si queda sin uso. `PATCH` sin cambios.
Actualizar `route.test.ts`: donde esperaba `"••••••••"` para un secreto, ahora espera `maskSecret(valorMock)` (primeros 4 + 12 puntos).

### Paso 3.3 — `apps/web/app/settings/sections.ts`
Añadir icono por sección (Tabler name, string):
```ts
export interface SettingsSection { id: string; title: string; icon: string; keys: string[] }
```
Iconos: street-view `map-pin`, map `map-2`, limits-cost `coin`, models `cpu`. `groupSettings()` sin cambios de lógica. `sections.test.ts`: sigue verificando cobertura total; añadir aserción de que cada sección tiene `icon` no vacío.

### Paso 3.4 — `apps/web/app/components/OverwriteKeyModal.tsx` (nuevo)
Props: `{ def: SettingDefinition; onClose: () => void; onSaved: (preview: string) => void }`.
Estructura y lógica:
- Estado: `value`, `reveal`, `testing`, `result: {ok:boolean;msg:string}|null`, `saving`.
- **Probar** (`async test()`):
  - `def.key === "GOOGLE_MAPS_API_KEY"` → `POST /api/setup/test-key` con `{ key: value }`; `ok` del JSON → `{ok:true,msg:"Clave válida"}` / error.
  - `def.key === "MAPBOX_TOKEN"` → validación de formato en cliente: `/^(pk|sk)\./.test(value)`; sin red.
- **Guardar** (`async save()`): `PATCH /api/settings` con `{ [def.key]: value }` (usa `fetchJson`). Si `def.required`, exigir `result?.ok` antes de habilitar. Al ok → `onSaved(maskSecret(value))` y `onClose()`.
- **UI**: overlay (`motion.div variants={overlay}`) + tarjeta (`motion.div variants={popIn}`), input password con toggle `ti-eye`/`ti-eye-off`, botón "Probar" (secundario blanco-outline), estado con check blanco / texto rojo, footer "Cancelar" / "Guardar clave" (blanco). Cerrar con Esc y click en overlay. `useReducedMotion`.
- Iconos Tabler vía el mismo método que ya use la app (si no hay webfont Tabler en la app, usar un SVG inline de candado/ojo; **verificar** si Tabler está disponible — si no, no introducir dependencia: usar caracteres/lucide sólo si ya existe. Por defecto, SVG inline mínimo).

### Paso 3.5 — `apps/web/app/components/SettingsPanel.tsx` (reescribir el render)
Mantiene carga (`GET /api/settings`), `dirty`, `save()` (solo envía cambiados y nunca el enmascarado). Cambios:
- Estado extra: `editing: SettingDefinition | null` (qué secreto se está sustituyendo).
- Al mapear `defs`:
  - **Secreto** (`def.isSecret`): fila no editable. Si `values[def.key]` existe → caja `user-select-none` con el string (ya enmascarado por el GET) + chip "verificada" (check blanco) + botón candado (`onClick={() => setEditing(def)}`). Si no existe → caja "Sin definir" + botón `+` (`onClick={() => setEditing(def)}`).
  - **No secreto**: como ahora (input number / `Menu` enum).
- Sección con icono (usar `section.icon`).
- Envolver cada `FloatingCard` de sección en `motion.div variants={staggerItem}` dentro de un `motion.div variants={staggerContainer} initial="hidden" animate="show"`.
- Botón "Guardar cambios" (blanco, ya lo es por token).
- Render del modal: `{editing && <OverwriteKeyModal def={editing} onClose={() => setEditing(null)} onSaved={(preview) => { setValues(v => ({...v,[editing.key]:preview})); setEditing(null); }} />}` (envuelto en `<AnimatePresence>`).

### Paso 3.6 — `apps/web/app/settings/page.tsx`
Sin cambios funcionales. Opcional: fondo oscuro coherente (ya lo da el body). No añadir planeta aquí (ajustes es página normal, no setup).

**Verificar:** `typecheck`; `pnpm --filter @netryx/web test` (mask + settings route); prueba manual del candado/popup.

---

## FASE 4 — Asistente de setup (4 pasos únicos)

### Paso 4.1 — `apps/web/app/setup/wizard-steps.ts` (+ test)
```ts
export const WIZARD_STEPS = [
  { id: "install", title: "Instalación" },
  { id: "database", title: "Base de datos" },
  { id: "credentials", title: "Credenciales" },
  { id: "confirm", title: "Confirmación" },
] as const;
export type StepId = (typeof WIZARD_STEPS)[number]["id"];
// next/prev/isComplete igual; isComplete => id === "confirm".
```
Actualizar `wizard-steps.test.ts` a los nuevos ids/orden.

### Paso 4.2 — `apps/web/app/api/setup/run/[step]/route.ts` (consolas separadas de modelos)
En el mapa `STEPS`, sustituir el único `inference-weights` por dos, para que Lumi Preview y Laila tengan consola propia:
```ts
"weights-retrieval": {
  cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
  args: ["-c", "import torch; torch.hub.load('gmberton/MegaLoc','get_trained_model')"],
  cwd: INFER,
},
"weights-verification": {
  cmd: resolve(INFER, "venv", "Scripts", "python.exe"),
  args: ["-c", "import romatch; romatch.roma_outdoor(device='cpu')"],
  cwd: INFER,
},
```
(Se puede conservar `inference-weights` por compatibilidad o eliminarlo; el wizard nuevo no lo usa.)

### Paso 4.3 — `apps/web/app/setup/steps/InstallItem.tsx` (nuevo)
Una fila = un comando; encapsula su propio `useCommandRun` (por eso es componente separado, no un loop de hooks).
Props: `{ stepId: string; label: string; engine?: string; active: boolean; onDone: (ok: boolean) => void }`.
Lógica:
- `const { lines, running, done, code, run } = useCommandRun();`
- `useEffect`: cuando `active && !running && !done` → `run(stepId)`.
- `useEffect`: cuando `done` → `onDone(code === 0)`.
- Estado visual: en cola (atenuado, círculo hueco) si `!active && !done`; en curso (spinner) si `running`; hecho (check blanco) si `done && code===0`; error (rojo + botón "reintentar" → `run(stepId, true)`) si `done && code!==0`.
- **Consola expandible**: cuando `running || (done && code!==0)`, render `<RunConsole lines={lines} />` dentro de un `motion.div` con `initial={{height:0,opacity:0}} animate={{height:"auto",opacity:1}}` (respetar reduced-motion). Cuando `done && code===0`, colapsar (no mostrar consola).

### Paso 4.4 — `apps/web/app/setup/steps/InstallStep.tsx` (nuevo)
Props: `{ onComplete: () => void }`.
- Estado: `started`, `prereqsOk: boolean|null`, `activeIdx: number`.
- Items (orden): `[{id:"inference-venv",label:"Entorno Python",engine:"venv"},{id:"inference-deps",label:"Dependencias PyTorch + CUDA",engine:"pip install"},{id:"weights-retrieval",label:"Modelo de recuperación",engine:"Lumi Preview"},{id:"weights-verification",label:"Modelo de verificación",engine:"Laila"}]`.
- **Inicial** (`!started`): tarjeta centrada + botón **Install** (blanco). `onClick`: `setStarted(true)` y disparar el chequeo de prerequisitos.
- **Prerequisitos**: `GET /api/setup/prereqs`; mostrar banda superior con Postgres/Python (`ti-circle-check`). Si el check `postgres.ok===false`, mostrar error y no arrancar la lista (botón "reintentar").
- **Lista**: render de `InstallItem` para cada item; `active={i === activeIdx}`. `onDone(ok)`: si `ok`, `activeIdx++`; si es el último, `onComplete()`. Si `!ok`, parar (el propio item ofrece reintentar).
- Cabecera "Instalando… · {activeIdx}/{items.length} completado".
- Fondo: el planeta lo pone `SetupWizard`; aquí solo el contenido.

### Paso 4.5 — `apps/web/app/lib/migrate-progress.ts` (nuevo, puro) + test
```ts
// Cuenta migraciones aplicadas a partir del stream de node-pg-migrate.
const MIGRATION_RE = /(\d{13}_[\w-]+)/g;
export function appliedMigrations(lines: string[]): string[] {
  const seen = new Set<string>();
  for (const l of lines) {
    // Solo líneas que indican aplicación (evitar el listado inicial):
    if (!/MIGRATION|Migrated|\(UP\)/i.test(l)) continue;
    for (const m of l.matchAll(MIGRATION_RE)) seen.add(m[1]);
  }
  return [...seen];
}
export function migrateProgress(lines: string[], total: number): { applied: number; total: number; fraction: number } {
  const applied = Math.min(appliedMigrations(lines).length, total);
  return { applied, total, fraction: total ? applied / total : 0 };
}
```
`migrate-progress.test.ts`: alimentar líneas de ejemplo (con y sin `(UP)`), verificar conteo y dedupe. **Nota de robustez:** el formato exacto de node-pg-migrate puede variar; si tras probar no casa, ajustar el regex/predicado — por eso está aislado y testeado. `total` = nº de ficheros en `db/migrations` (hoy **5**).

### Paso 4.6 — `apps/web/app/setup/steps/DatabaseStep.tsx` (nuevo) — "plano que se materializa"
Props: `{ onComplete: () => void }`. Ref: mockup "base de datos".
- `useCommandRun()`; al montar (o con un botón "Crear base de datos") → `run("migrate")`.
- `const { applied, total, fraction } = migrateProgress(lines, 5)`.
- **Visual**: fondo blueprint (grid tenue con dos `repeating-linear-gradient`); chips de extensiones `pgvector` y `PostGIS` que pasan a "encajadas" (check) cuando `applied >= 1` (la migración init las crea); rejilla de **tablas reales** `["areas","indexed_images","searches","search_regions","search_candidates","api_usage","system_settings"]` reveladas proporcionalmente: `revealed = Math.round(fraction * tables.length)` (las primeras `revealed` con check, la siguiente "creando…" con latido, el resto en discontinuo). Barra "{applied} / {total} migraciones".
- Al `done && code===0`: pulso "listo" + `onComplete()`. Si `code!==0`: mensaje de error + enlace "ver log" que despliega `<RunConsole lines={lines} />` (fallback de depuración; no es el foco).
- Es explícito que el reveal de tablas es **proporcional al progreso de migraciones**, no un evento por-DDL.

### Paso 4.7 — `apps/web/app/setup/steps/CredentialsStep.tsx` (nuevo) — "formulario de cristal"
Props: `{ values: Record<string,string>; onChange: (k: string, v: string) => void; onComplete: () => void }`.
- Campos: `GOOGLE_MAPS_API_KEY` (input + **Probar** → `POST /api/setup/test-key`, check blanco al validar), `MAPBOX_TOKEN` (opcional, dashed), y límites `MAX_AREA_KM2`, `MAX_MONTHLY_BUDGET_USD`, `GOOGLE_FREE_MONTHLY_CREDIT_USD`, `GOOGLE_FREE_MONTHLY_IMAGES` (grid).
- Cada cambio → `onChange(key, value)` (sube al estado del wizard). Estado local solo para el resultado de "Probar".
- `onComplete()` cuando la Google key valida OK (habilita "Siguiente" en el wizard).
- Panel en cristal translúcido (ya lo da el contenedor del wizard); animación de entrada `fadeRise`.

### Paso 4.8 — `apps/web/app/setup/steps/ConfirmStep.tsx` (nuevo)
Props: `{ values: Record<string,string> }`.
- Resumen: llaves secretas mostradas con `maskSecret(values[k])`; límites en claro.
- Botón **"Finalizar setup"** dentro de un `<form action={submitSetupAction}>` con `<input type="hidden" name={k} value={v}>` por cada valor recogido (así reutiliza la server action existente `submitSetupAction`, que valida, hace `completeSetup` en transacción y `redirect("/")`). Los ausentes caen a `defaultValue` vía `resolveValue`.
- Estado "guardando" con `useFormStatus` (o un `pending` simple).

### Paso 4.9 — `apps/web/app/setup/SetupWizard.tsx` (reescribir)
- Importar `PlanetBackground`, los 4 pasos nuevos, `AnimatePresence`/`motion`, `WIZARD_STEPS`, `nextStep`, `prevStep`.
- **Quitar** imports de `PrereqsStep`, `MigrateStep`, `InferenceStep` (ya no existen esos pasos).
- Estado: `current: StepId`, `done: Record<string,boolean>`, y **`collected: Record<string,string>`** (valores de credenciales/límites) con `setField(k,v)`.
- Render:
  - `<PlanetBackground />` de fondo (contenedor `relative min-h-screen overflow-hidden`).
  - Cabecera con personalidad ("Vamos a preparar Lumi", icono con pulso) + subtítulo "Paso {i+1} de {WIZARD_STEPS.length} · …".
  - **Stepper horizontal** (línea de progreso con ancho animado; círculos hecho/activo/pendiente como en el mockup).
  - Panel de **cristal**: `rounded-card border border-white/13 bg-[rgba(16,19,25,.66)] backdrop-blur-xl shadow-...`.
  - Contenido por paso dentro de `<AnimatePresence mode="wait">` + `motion.div key={current} variants={fadeRise}`:
    - `install`: `<InstallStep onComplete={() => mark("install")} />`
    - `database`: `<DatabaseStep onComplete={() => mark("database")} />`
    - `credentials`: `<CredentialsStep values={collected} onChange={setField} onComplete={() => mark("credentials")} />`
    - `confirm`: `<ConfirmStep values={collected} />`
  - Navegación Atrás/Siguiente (Siguiente deshabilitado hasta `done[current]`; en `confirm` no hay "Siguiente", el CTA es "Finalizar" dentro del paso).

### Paso 4.10 — Limpieza y página
- **Borrar** `apps/web/app/setup/steps/PrereqsStep.tsx` y `apps/web/app/setup/steps/MigrateStep.tsx` (absorbidos por Install/Database). Verificar que nada más los importe (`rg "PrereqsStep|MigrateStep" apps/web`).
- `apps/web/app/setup/page.tsx`: asegurar que monta `<SetupWizard />` en un contenedor a pantalla completa (`min-h-screen`) para que el planeta llene el fondo.
- Si `InferenceStep` estaba referenciado en algún sitio (no existe archivo), confirmar que el import desaparece con el SetupWizard reescrito → **arregla la build rota**.

**Verificar Fase 4:** `typecheck` limpio (incluye el arreglo de la build); `pnpm --filter @netryx/web test` (wizard-steps, migrate-progress); prueba manual del flujo completo (Install con consolas, DB materializándose, credenciales con Probar, confirmar → entra a `/`).

---

## Resumen de archivos

**Nuevos:** `app/lib/motion.ts`, `app/components/PlanetBackground.tsx`, `app/settings/mask.ts` (+test), `app/components/OverwriteKeyModal.tsx`, `app/lib/migrate-progress.ts` (+test), `app/setup/steps/InstallItem.tsx`, `app/setup/steps/InstallStep.tsx`, `app/setup/steps/DatabaseStep.tsx`, `app/setup/steps/CredentialsStep.tsx`, `app/setup/steps/ConfirmStep.tsx`.
**Editados:** `tailwind.config.ts`, `globals.css`, `package.json`, `stores/useIndexingStore.ts`, `components/DrawToolbar.tsx`, `(protected)/index/page.tsx`, `components/ConfidenceCircleLayer.tsx`, `components/LoadingScreen.tsx`, `api/settings/route.ts` (+test), `settings/sections.ts` (+test), `components/SettingsPanel.tsx`, `setup/wizard-steps.ts` (+test), `api/setup/run/[step]/route.ts`, `setup/SetupWizard.tsx`, `setup/page.tsx`.
**Borrados:** `setup/steps/PrereqsStep.tsx`, `setup/steps/MigrateStep.tsx`.

## Tests
Unit (vitest): `mask.test.ts`, `wizard-steps.test.ts`, `migrate-progress.test.ts`, `sections.test.ts` (icono), `api/settings/route.test.ts` (enmascarado). Manual: mapa/toolbar, pantalla de carga, candado→popup de ajustes, y el flujo de setup (Install/DB/Credenciales/Confirmar).
