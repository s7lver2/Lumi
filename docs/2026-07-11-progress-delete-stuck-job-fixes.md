# Progreso en directo, borrar áreas y arreglo de trabajos atascados sin logs

**Fecha:** 2026-07-11 · **Estado:** plan (no ejecutado)

Tres pedidos, cubiertos en orden de dependencia (el 3 es la causa raíz de por qué nada de esto se ve funcionar bien ahora mismo, así que va primero):

---

## 1. Arreglar los trabajos que se quedan "pillados" sin ningún log

### Causa raíz confirmada
En `apps/worker/src/jobs/index-area.ts`, el único `try/catch` de toda la función envuelve **solo** la llamada a `embedImages` (líneas ~144-157). Todo lo demás — leer settings, `fetchStreetGeometry` (Overpass, servicio externo que ya sabemos que falla con 502/504 a veces), `samplePointsAlongStreets`, la comprobación de presupuesto, `downloadCaptures`, `insertIndexedImages`, `insertIndexedPoints`, `recordStreetViewUsage` — no está protegido. Si cualquiera de esas líneas lanza una excepción:
- La promesa de `runIndexAreaJob` se rechaza.
- Sube hasta el `await runIndexAreaJob(...)` dentro de `boss.work(...)` en `apps/worker/src/index.ts` — pg-boss la captura internamente y marca el job como fallido en sus propias tablas, **sin imprimir nada en la consola**.
- El área ya tenía `status = 'indexing'` (se puso al principio) y **nadie vuelve a escribir su estado** — se queda ahí para siempre. Coincide exactamente con "no hay progreso y no veo ningún log en los 3 procesos".

### Cambios

**`apps/worker/src/jobs/index-area.ts`**
- Envolver el cuerpo entero de la función (desde justo después del chequeo de cancelación inicial) en un único `try/catch` exterior.
- Añadir un log de arranque: `console.log(\`[index-area] iniciando área ${areaId} (${points.length} puntos)\`)` justo después de calcular `points` (para tener visibilidad de actividad, no solo de errores).
- Añadir un log de éxito al final: `console.log(\`[index-area] área ${areaId} indexada: ${inserts.length} imágenes\`)`.
- En el `catch` exterior:
  ```ts
  } catch (err) {
    console.error(`[index-area] el job del área ${areaId} falló inesperadamente:`, err);
    if (!(await deps.isCancelled(areaId))) {
      await deps.updateAreaProgress(areaId, { status: "failed" }).catch(() => {});
    }
    // No relanzar: el área ya queda marcada "failed"; relanzar solo haría que
    // pg-boss reintente un job que ya sabemos que falló, sin que el usuario lo pida.
  }
  ```
  (el `.catch(() => {})` extra es para que un fallo de DB al escribir el estado tampoco quede en silencio pero tampoco tumbe el proceso).
- El `catch` interno que ya existe alrededor de `embedImages` se mantiene igual (loguea con más detalle específico de esa fase).

**`apps/worker/src/jobs/index-area.test.ts`**
- Nuevo test: `getAreaPolygon` (o `fetchStreetGeometry`) rechaza con un Error → el área termina con `status: "failed"` en el último `updateAreaProgress`, y no se relanza la excepción fuera de `runIndexAreaJob` (usar `expect(runIndexAreaJob(...)).resolves.toBeUndefined()`).
- Nuevo test: si el área ya está cancelada, un error posterior NO la marca "failed" (no debe pisar el estado "cancelled").

**Verificación:** `pnpm --filter @netryx/worker test`. Manual: provocar un fallo (p. ej. parar el servicio de inferencia o Overpass) y confirmar que aparece un `console.error` claro en la terminal del worker y que el área pasa a `failed` en vez de quedarse en `indexing` para siempre.

---

## 2. Barra de "Puntos de captura" en directo (no todo de golpe)

### Causa raíz
`runIndexAreaJob` llama a `deps.updateAreaProgress(areaId, { pointsCaptured, pointsFailed })` **una sola vez**, después de que `downloadCaptures` termine con **todos** los puntos. La UI hace polling por SSE cada 1s (`/api/areas/[id]/progress`), así que ve `0/89` y luego `89/89` de un salto — nunca un valor intermedio.

### Cambios

**`apps/worker/src/street-view.ts`**
- Añadir a `DownloadOptions` un callback opcional: `onPointDone?: (done: number, total: number) => void`.
- Invocarlo dentro de cada tarea de punto (`limit(async () => {...})`), justo antes de `return { captures, failed, skipped: false }` — con un contador compartido (`let doneCount = 0` fuera del `.map`, incrementado con cada resultado). Como las tareas corren concurrentemente, el contador se incrementa de forma segura porque JS es de un solo hilo (no hay carrera real entre el incremento y la lectura).
- Los puntos `skipped` (cancelación) también cuentan como "procesados" para el contador de progreso, aunque no aporten capturas.

**`apps/worker/src/street-view.test.ts`**
- Nuevo test: con 4 puntos y `onPointDone` como mock, verificar que se llama 4 veces, con el segundo argumento (`total`) siempre `4` y el primero (`done`) creciendo de 1 a 4 (sin asumir orden exacto de finalización entre tareas concurrentes, solo que el último valor es igual a `total`).

**`apps/worker/src/jobs/index-area.ts`**
- Pasar `onPointDone` a `downloadCaptures`, con un throttle simple para no saturar Postgres en áreas grandes (cientos de puntos): actualizar la DB como máximo ~50 veces en total, sea cual sea el tamaño del área.
  ```ts
  const progressEveryN = Math.max(1, Math.floor(points.length / 50));
  const { captures, failedPoints, cancelled } = await deps.downloadCaptures(points, STREET_VIEW_HEADINGS, {
    apiKey, maxConcurrent, existingPanoHeadings,
    shouldCancel: () => deps.isCancelled(areaId),
    onPointDone: (done, total) => {
      if (done % progressEveryN === 0 || done === total) {
        // fire-and-forget: no bloquear el bucle de descarga esperando la escritura
        deps.updateAreaProgress(areaId, { pointsCaptured: done }).catch(() => {});
      }
    },
  });
  ```
  Nota: esto escribe un número *provisional* de "puntos procesados" (no distingue aún capturados vs. fallidos punto a punto); el desglose final `pointsCaptured`/`pointsFailed` exacto se sigue escribiendo igual que ahora justo después de que `downloadCaptures` termine, sobrescribiendo el valor provisional con el real.
- Añadir `onPointDone` a la interfaz `IndexAreaJobDeps.downloadCaptures` (el tipo de `opts`).

**`apps/worker/src/jobs/index-area.test.ts`**
- Nuevo test: mockear `downloadCaptures` para que invoque `opts.onPointDone` un par de veces durante la ejecución, y comprobar que `deps.updateAreaProgress` recibe al menos una llamada intermedia con `pointsCaptured` distinto de 0 y del total final (antes de la actualización final).

**Verificación:** `pnpm --filter @netryx/worker test`. Manual: indexar un área con bastantes puntos y observar que "Puntos de captura" sube gradualmente en vez de saltar de `0` a `N`.

---

## 3. Poder quitar áreas desde el desplegable

### Cambios

El backend ya existe: `DELETE /api/areas/[id]` en `apps/web/app/api/areas/[id]/route.ts` (borra el área; `indexed_images` cae en cascada por FK). Solo falta la UI.

**`apps/web/app/components/AreasPopup.tsx`**
- Añadir un botón de papelera (icono `✕`/`🗑` en SVG inline, sin webfont) en cada fila, junto al botón "Cancelar" existente.
- Nueva función `async function deleteArea(id: string)`:
  ```ts
  async function deleteArea(id: string) {
    setDeletingId(id);
    const { ok } = await fetchJson(`/api/areas/${id}`, { method: "DELETE" });
    setDeletingId(null);
    if (ok) {
      setAreas((prev) => prev.filter((a) => a.id !== id));
      onChanged?.();
    }
  }
  ```
- Nuevo estado local `deletingId: string | null` (igual que `cancellingId`).
- El botón de borrar está siempre visible (no solo en estados terminales) — si el área está `indexing`, se permite borrarla igualmente; el worker, gracias al arreglo del punto 1, ya no revienta en silencio si el área desaparece a mitad de proceso (las escrituras a una fila que ya no existe simplemente no afectan filas, `UPDATE ... WHERE id = $1` con 0 filas no es un error).
- Añadir prop opcional `onChanged?: () => void` a `AreasPopup`, invocada tras borrar o cancelar, para que el padre pueda refrescar los contadores.

**`apps/web/app/(protected)/index/page.tsx`**
- Pasar `onChanged={() => refetchAreaCounts()}` a `<AreasPopup />`, extrayendo la lógica de `fetch("/api/areas")...setAreasCount/setAreasIndexing` (ya existe en el `useEffect` inicial) a una función nombrada `refetchAreaCounts` reutilizable, para no duplicar el fetch.

**Verificación:** manual — abrir el desplegable de áreas, borrar una, comprobar que desaparece de la lista y que el contador "N áreas" del botón de notificación se actualiza.

---

## Resumen de archivos

**Editados:** `apps/worker/src/jobs/index-area.ts`, `apps/worker/src/jobs/index-area.test.ts`, `apps/worker/src/street-view.ts`, `apps/worker/src/street-view.test.ts`, `apps/web/app/components/AreasPopup.tsx`, `apps/web/app/(protected)/index/page.tsx`.
**Sin cambios necesarios:** endpoint `DELETE /api/areas/[id]` (ya existe y sirve tal cual).

## Orden sugerido
1 (arregla la visibilidad de errores, necesario para depurar todo lo demás con confianza) → 2 (progreso en directo) → 3 (borrar áreas, independiente del resto).
