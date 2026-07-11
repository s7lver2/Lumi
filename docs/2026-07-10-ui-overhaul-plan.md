# UI Overhaul — Aesthetic, Loading, Settings & Setup Wizard

**Fecha:** 2026-07-10
**Estado:** plan (no ejecutado)
**Supersede:** `2026-07-10-settings-menu.md` y `2026-07-10-setup-wizard-ui.md` (sus decisiones se integran aquí con la nueva estética). Complementa `2026-07-09-ui-refinement-onboarding-cost.md`.

Este plan cubre, en orden de ejecución:

0. Correcciones rápidas en Entrenamiento (dropzone de prueba, barra de herramientas).
1. Fundamentos de diseño: **quitar el verde**, acento **blanco**, sistema de animación (framer-motion), primitivos de "espacio/planeta", nombres de modelo.
2. Rediseño de la **pantalla de carga** (BootGate) con el planeta.
3. **Ajustes** verdaderamente funcionales: claves enmascaradas (solo 4 primeros caracteres), no copiables, candado → popup para sustituir.
4. **Asistente de setup**: 4 pasos únicos (Install → Base de datos → Credenciales → Confirmar), con planeta de fondo, cristal translúcido, animaciones y personalidad.

Los mockups aprobados en la conversación son la referencia visual canónica de cada pantalla.

---

## Decisiones de diseño (canónicas)

- **Acento principal = blanco** (`#f2f3f5` relleno, texto `#0b0d11`). El **verde `#5dcaa5` se elimina de toda la app**. Estados "ok/verificado" pasan a check blanco (`#e9ecf1`), ya no verde.
- **Se conservan** azul `#85b7eb`, púrpura `#a89fff`, ámbar `#f0c477` como matices de categoría, y rojo `#f09595` para error/obligatorio.
- **Cristal translúcido** en paneles del setup (`rgba(16,19,25,.66)` + `backdrop-blur(16px)`), "un poquito transparente, no mucho".
- **Fondo espacial con planeta gris girando** en setup y pantalla de carga; estrellas con parpadeo; satélite en órbita en la carga.
- **Animaciones fluidas con `framer-motion`** en toda la app (entradas con muelle, transiciones de layout, listas escalonadas, popups con escala), respetando `prefers-reduced-motion`.
- **Nombres de modelo (user-facing):** recuperación = **Lumi Preview** (motor MegaLoc); verificación = **Laila** (motor RoMa). Nunca mostrar solo el motor en la UI.

---

## Fase 0 — Correcciones en Entrenamiento (`(protected)/index/page.tsx`)

Bugs reportados: la tarjeta de prueba del dropzone sigue ahí, y la barra de herramientas de dibujo no se ve / se solapa con la notificación de áreas.

1. **Quitar la prueba del dropzone.** Eliminar el import `ImageDropzone` (línea 16) y el `<FloatingCard>` "Test: Image Dropzone" (bloque ~171-182). El contenedor lateral `right-4 top-20 w-72` se queda solo con el panel de indexación.
2. **Barra de herramientas visible y sin solaparse.** Causa: `DrawToolbar` trae su **propio** `absolute left-4 top-4 z-20`, pero la página ya lo envuelve en `absolute bottom-6 left-1/2 z-40`; los dos posicionamientos pelean y el `z-20` lo deja detrás de la tarjeta "Área dibujada" (también `left-4 top-4`).
   - En `components/DrawToolbar.tsx`: quitar `absolute left-4 top-4 z-20`; dejarlo como contenedor de layout (`inline-flex gap-1 rounded-card border border-white/10 bg-panel/80 p-1 backdrop-blur-md`). El posicionamiento (abajo-centro) lo pone la página.
   - Corregir el desajuste de props: la página pasa `onModeChange`, el componente declara `onMode`. Unificar en **`onModeChange`** (más descriptivo) en `DrawToolbar.tsx` y en el uso.
3. **`setEstimate(null)`** (error de tipo en `handleClearPolygon`): ampliar la firma en `stores/useIndexingStore.ts` a `setEstimate(e: Estimate | null)`. Limpiar el estimate al borrar el polígono es el comportamiento correcto.

Verificación: manual (mapa/WebGL). `pnpm typecheck` debe quedar limpio de estos tres.

---

## Fase 1 — Fundamentos de diseño

### 1.1 Paleta (quitar verde, acento blanco)
- `apps/web/tailwind.config.*`: cambiar el token `accent` a blanco y `accent-fg` a casi-negro; eliminar/retonar el token `draw`/verde. Añadir tokens `positive`/`ok` = neutro blanco si hace falta un semántico de éxito.
- Barrido de literales verdes: buscar `#5dcaa5`, `#1d9e75`, `text-accent-fg` usados como "éxito verde", clases `bg-accent` que asumían verde. Reemplazar por acento blanco o neutro. Puntos conocidos: botón "Indexar área", `AreasNotification` (badge `draw`), `ConfidenceCircleLayer`/`area-points-dots` (`#5dcaa5` → gris/blanco), estados "ok" en setup/ajustes.
- Revisar `map-buildings.ts` y capas del mapa por si usan el verde de acento.

### 1.2 Sistema de animación
- Añadir `framer-motion` a `apps/web`.
- `app/lib/motion.ts`: presets reutilizables — `fadeRise` (opacity+translateY, muelle suave), `popIn` (escala 0.96→1 para popups/modales), `stagger` (listas), `overlay` (fade del scrim). Todos leen `useReducedMotion()` y colapsan a sin-animación.
- Aplicar en: `FloatingCard` (entrada), popups (`UploadPopup`, `AreasPopup`, nuevo `OverwriteKeyModal`), listas de resultados/áreas (stagger), y transición de paso del wizard.

### 1.3 Primitivos de espacio
- `app/components/PlanetBackground.tsx` (client): capa a pantalla completa `-z-10` con:
  - Fondo `#05070a`, estrellas (puntos con parpadeo escalonado).
  - Planeta gris girando: esfera con sombreado (terminador) y textura que se desplaza en bucle (`translateX` de una tira 2×) para simular rotación; `will-change: transform`.
  - Opcional satélite en órbita (solo en la pantalla de carga).
  - `prefers-reduced-motion` → planeta estático.
- Nota técnica: la rotación se hace por CSS (transform en bucle), no WebGL; barato y suficiente. Un blob de textura repetible evita la costura visible.

### 1.4 Nombres de modelo
- Confirmar en `packages/shared-types/src/models.ts` que el `label` de recuperación es **"Lumi Preview"** y el de verificación **"Laila"** (ids `lumi-preview`/`laila`). Usar `label`, no el id/motor, en toda la UI (ajustes, install step, resultados).

---

## Fase 2 — Pantalla de carga (BootGate)

Archivo: `app/components/LoadingScreen.tsx` (exporta `BootGate`). Ref: mockup "pantalla de carga".

- Fondo con `PlanetBackground` (con satélite en órbita).
- Centro: wordmark **"Lumi"** grande, blanco, `letter-spacing` amplio; subtítulo rotativo ("Preparando tu espacio de trabajo…", y variaciones con personalidad).
- Barra de progreso indeterminada con brillo que barre (shimmer) en vez de spinner.
- Entrada con `fadeRise`.
- Mantener el contrato actual (fetch a `/api/map-config`, muestra hijos cuando listo). Solo cambia la capa visual del "splash".

---

## Fase 3 — Ajustes verdaderamente funcionales

Refs: mockup "ajustes" + popup "sustituir clave". Superseción de `2026-07-10-settings-menu.md` con la nueva estética y el flujo de secretos.

### 3.1 API: preview de secretos (`app/api/settings/route.ts`)
- Helper puro `app/settings/mask.ts`: `maskSecret(value: string): string` → primeros 4 chars + relleno de puntos (p.ej. `AIza••••••••••••`). Longitud del relleno fija (no filtrar longitud real). **Con test** (`mask.test.ts`): valor largo, valor < 4 chars, vacío.
- `GET`: para secretos **con** valor → devolver el string enmascarado por `maskSecret`. Para secretos **sin** valor → omitir la clave (ausencia = "sin definir"). No-secretos → valor real, igual que ahora.
- El cliente distingue secreto por `def.isSecret` (esquema), y "tiene valor" por presencia de la clave en la respuesta.
- `PATCH`: sin cambios de lógica; sigue validando y escribiendo. (El panel nunca reenvía el string enmascarado.)

### 3.2 Panel (`app/components/SettingsPanel.tsx`)
- Secciones con icono y layout en grid para números (ref mockup): Street View, Mapa, Límites y coste, Modelos. `sections.ts` gana un campo opcional `icon`; el test de cobertura total se mantiene.
- **Fila de secreto** (no editable inline):
  - Si tiene valor: caja no copiable (`user-select:none`) mostrando el string enmascarado + chip "verificada" (check **blanco**) + botón **candado** (`ti-lock`) a la derecha.
  - Si no tiene valor: caja "Sin definir" + botón `+` para añadir. Ambos abren el modal.
- **No-secretos**: inputs normales (número/enum) como ahora.
- Botón "Guardar cambios" en **blanco**. Animaciones: entrada de tarjetas, feedback de guardado.

### 3.3 Modal de sustitución (`app/components/OverwriteKeyModal.tsx`)
Ref: popup "sustituir clave".
- Props: `def: SettingDefinition`, `onClose()`, `onSaved(preview: string)`.
- Contenido: campo tipo password (con `ti-eye-off` para revelar mientras se escribe), botón **"Probar"**, estado de validación, y "Cancelar" / "Guardar clave" (blanco, deshabilitado hasta validar en el caso obligatorio).
- **Probar**:
  - `GOOGLE_MAPS_API_KEY` → `POST /api/setup/test-key` (ya existe; devuelve `{ok,status,error}`). Éxito → check blanco "Clave válida".
  - `MAPBOX_TOKEN` (opcional) → validación de formato ligera en cliente (prefijo `pk.`/`sk.`); sin llamada de red obligatoria. Se puede guardar sin probar.
- **Guardar** → `PATCH /api/settings` con `{ [def.key]: nuevoValor }`; al ok, `onSaved(maskSecret(nuevoValor))` actualiza la fila sin recargar.
- Animación `popIn` + overlay con scrim; cierre con Esc / click fuera; `prefers-reduced-motion` respetado.

---

## Fase 4 — Asistente de setup (4 pasos únicos)

Refs: mockups "setup credenciales", "install", "base de datos". Superseción de `2026-07-10-setup-wizard-ui.md`. **Nota:** el `SetupWizard` actual importa `CredentialsStep`, `InferenceStep`, `ConfirmStep` que **no existen** → la build está rota hasta crear los pasos. Este es también el arreglo de esa build.

### 4.0 Reestructura de pasos
- `wizard-steps.ts`: nuevos pasos e ids → `install`, `database`, `credentials`, `confirm` (se elimina `prereqs` e `inference` como pasos separados; prereqs se fusiona en `install`, e `inference` se absorbe en `install`).
- Actualizar `wizard-steps.test.ts` (next/prev/orden).

### 4.1 Chrome compartido (`SetupWizard.tsx`)
- `PlanetBackground` de fondo (planeta gris girando, estrellas), sin satélite.
- Cabecera con personalidad ("Vamos a preparar Lumi", `ti-sparkles` con pulso) y subtítulo por paso ("Paso N de 4 · …").
- **Stepper horizontal** con línea de progreso animada (ancho con transición), círculos: hecho = relleno blanco + check; activo = aro blanco con pulso; pendiente = gris.
- Panel de contenido en **cristal translúcido**; transición entre pasos con `framer-motion` (`AnimatePresence`, deslizamiento/fade). Navegación Atrás/Siguiente (Siguiente en blanco).
- Estado del asistente en memoria (credenciales/límites recogidos) para escribir todo al final.

### 4.2 Paso Install (`steps/InstallStep.tsx`) — carácter "consola"
Ref mockup "install".
- Estado inicial: tarjeta centrada con icono, texto (~2.5 GB, se guarda local) y **botón `Install`** central (blanco).
- Al pulsar: primero un **chequeo de prerequisitos** (banda superior) — `GET /api/setup/prereqs` (Postgres alcanzable, Python detectado). Si Postgres falla, se detiene con mensaje claro.
- Luego una **lista de descargas**, cada ítem con su estado: en cola (atenuado, círculo hueco), en curso (spinner `ti-loader-2` + **consola expandida**), hecho (check blanco + tiempo).
  - Ítems y comandos (endpoints ya existentes en `api/setup/run/[step]/route.ts`): `inference-venv` (Entorno Python · venv), `inference-deps` (Dependencias PyTorch + CUDA · pip), `inference-weights` dividido conceptualmente en **Lumi Preview** y **Laila** (o un solo paso `inference-weights` mostrado como esos dos ítems; ver nota).
  - **Consola por ítem**: reutilizar `useCommandRun` + `RunConsole`, pero **una instancia por ítem** (hook parametrizado por step id). El ítem en curso expande su consola verticalmente (animación de altura) mostrando el stream SSE; los demás la mantienen colapsada.
  - Ejecutar los ítems **en secuencia** (venv → deps → weights); avanzar al siguiente al recibir `done` con `code 0`. `onComplete()` cuando todos terminan en 0.
  - Nota: `inference-weights` hoy es un solo comando que carga MegaLoc **y** RoMa. Opciones: (a) mostrarlo como un ítem "Modelos (Lumi Preview + Laila)"; (b) partirlo en dos endpoints `weights-retrieval`/`weights-verification` para consolas separadas (mejor UX, cambio pequeño en el `STEPS` del route). Recomendado (b).

### 4.3 Paso Base de datos (`steps/DatabaseStep.tsx`) — carácter "plano que se materializa"
Ref mockup "base de datos". **La sorpresa**: nada de consola.
- Fondo de plano/blueprint (grid tenue).
- Ejecuta migraciones vía `POST /api/setup/run/migrate` (SSE, ya existe) con `useCommandRun`.
- Visual dirigido por progreso: chips de extensiones (`pgvector`, `PostGIS`) que "encajan" con check; rejilla de tablas que se materializan una a una bajo una **barra de escaneo**; la tabla en creación late, las pendientes en línea discontinua; barra "N / total migraciones".
- El progreso se puede derivar de las líneas del stream (contar migraciones aplicadas) o, si es frágil, de un endpoint que liste migraciones pendientes/aplicadas. Mapear nombres de tabla desde los ficheros de migración de `db/`.
- Al terminar (`code 0`): pulso de "listo" y `onComplete()`.
- Fallback accesible: un enlace "ver log" que despliega la salida cruda por si algo falla (no es el foco, pero debe existir para depurar).

### 4.4 Paso Credenciales (`steps/CredentialsStep.tsx`) — carácter "formulario de cristal"
Ref mockup "setup credenciales".
- Campo **Google Street View key** (obligatoria) + **Probar** (`POST /api/setup/test-key`) → check blanco "Clave válida · Street View respondió OK".
- **Mapbox token** (opcional, dashed "déjalo vacío para MapLibre + tiles gratis").
- Divisor "Límites y coste" + grid: Área máx (km²), Presupuesto mensual (USD), Crédito gratis Google (USD), Imágenes gratis Google.
- Recoge todo en el estado del asistente (no escribe todavía). `onComplete()` cuando la Google key valida OK.

### 4.5 Paso Confirmar (`steps/ConfirmStep.tsx`)
- Resumen de lo recogido (llaves enmascaradas con `maskSecret`, límites).
- **"Finalizar setup"** → construye un `FormData` con los valores recogidos y llama a la server action existente `submitSetupAction` (que valida, hace `completeSetup(writes)` — escribe todos los `system_settings` + `__setup_completed__` en una transacción — y `redirect("/")`).
- Los valores ausentes caen a su `defaultValue` (ya lo hace `resolveValue`). Animación de entrada + estado de "guardando".

---

## Notas de implementación / calidad

- **Convención Next.js:** `route.ts`/`layout.tsx`/`page.tsx` solo exportan handlers/`default`+config. Helpers (p.ej. `maskSecret`) van en módulos hermanos.
- **Imports relativos** (sin alias) en todo `apps/web`.
- **TDD** para lógica pura: `maskSecret`, `wizard-steps` (next/prev), agrupación de `sections`, y cualquier parser de progreso de migraciones. Mapa/WebGL/SSE/formularios → verificación manual (el usuario prueba la app).
- **SSE en Windows:** los comandos ya usan `spawn(..., { shell:true })` (pnpm/python resolubles). No tocar esa parte.
- **`prefers-reduced-motion`** obligatorio en todas las animaciones nuevas.
- **No matar procesos node** del usuario para verificar; usar `pnpm typecheck`.

## Orden sugerido de ejecución
Fase 0 (desbloquea Entrenamiento) → Fase 1 (base para todo lo demás) → Fase 4.0 (crea los 3 pasos que faltan y arregla la build) → Fase 2 (carga) → Fase 3 (ajustes) → Fase 4.1-4.5 (pasos del setup, pulido).
