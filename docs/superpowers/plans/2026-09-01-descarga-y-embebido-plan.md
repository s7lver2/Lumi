# Descarga y embebido, fusionados — plan de implementación

> Spec: [2026-09-01-descarga-y-embebido-design.md](../specs/2026-09-01-descarga-y-embebido-design.md).
> Proyecto: Lumi Indexer (`indexer/`, `indexer/src-tauri/`).

**Goal:** Descarga y embebido en una sola pantalla; poder cambiar el nivel de un índice después
de crearlo (no solo una vez); un modo de consumo alto/bajo que de verdad libera el ordenador
mientras embebe de fondo; ETA de descarga que no se queda mudo.

**Arquitectura:** `fijar_niveles_elegidos` ya soporta escribirse más de una vez (es una simple
`UPDATE`, pese al comentario que dice "una sola vez, al crear") — "portear a otro nivel" es
recalcular la composición del nivel nuevo, diffear contra lo que el índice ya tiene, y
`reembeber::encolar` lo que falte. El modo de consumo extiende `proceso::cmd_async` (ya fija
`creation_flags` en Windows) con prioridad de proceso, combinado con la concurrencia que ya
existe. La vista fusionada es sobre todo trabajo de frontend: dos componentes que ya funcionan,
compuestos en uno.

**Tech Stack:** Rust (Tauri backend), TypeScript/React (frontend).

## Global Constraints

- **No tests unless explicitly requested.**
- **`ponytail`**: reutilizar `reembeber::encolar`/`niveles::resolver_composicion`/
  `fijar_niveles_elegidos` tal cual — no crear una abstracción "migración de nivel" nueva si
  encolar la diferencia con lo que ya existe alcanza.
- Compilar/verificar tras cada tarea: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`
  y `cd indexer && npx tsc -b --noEmit && npm run lint`.
- Español en comentarios y mensajes de commit. Un solo commit al final.

---

### Tarea 1: Backend — portear a otro nivel

**Files:** Modify `indexer/src-tauri/src/lib.rs`, `indexer/src-tauri/src/store.rs`

- [ ] **Paso 1.1** — Leer `niveles_elegidos`/`fijar_niveles_elegidos` (`store.rs:380-399`) y
  `modelos_para`/la función que resuelve qué modelos exige un índice hoy (`lib.rs:347-360`,
  buscar el nombre exacto de la función que envuelve `niveles::modelos_de_niveles`) para
  confirmar la forma exacta de "qué modelos tiene hoy este índice" antes de escribir el diff.

- [ ] **Paso 1.2** — Nuevo comando Tauri, junto a `indice_crear` (`lib.rs:578`):
  ```rust
  #[tauri::command]
  fn indice_portear_nivel(estado: tauri::State<'_, Estado>, indice_id: i64, niveles: Vec<String>) -> Result<Vec<String>, String> {
      if niveles.is_empty() {
          return Err("elige al menos un nivel".into());
      }
      let modelos_antes: std::collections::HashSet<String> =
          modelos_para(&estado, indice_id).into_iter().collect(); // nombre exacto a confirmar contra el paso 1.1
      estado.almacen.fijar_niveles_elegidos(indice_id, &niveles).map_err(|e| e.to_string())?;
      let modelos_despues: std::collections::HashSet<String> =
          modelos_para(&estado, indice_id).into_iter().collect();
      let nuevos: Vec<String> = modelos_despues.difference(&modelos_antes).cloned().collect();
      for m in &nuevos {
          reembeber::encolar(&estado.almacen, indice_id, m).map_err(|e| e.to_string())?;
      }
      Ok(nuevos)
  }
  ```
  Registrar en `generate_handler!`. Devuelve los modelos nuevos encolados, para que el frontend
  pueda anunciar "se añadió X" en vez de un booleano mudo.

- [ ] **Paso 1.3** — Quitar/corregir el comentario de `fijar_niveles_elegidos`
  (`store.rs:390-391`, "Se fija una sola vez, al crear el índice...") — ya no es cierto, se llama
  también desde `indice_portear_nivel`. Reemplazar por algo como: "Se llama al crear el índice, y
  también al portearlo a otro nivel (`indice_portear_nivel`) — subir de nivel solo añade modelos,
  nunca invalida vectores ya embebidos bajo la elección anterior."

- [ ] **Paso 1.4 — Compilar**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`.

---

### Tarea 2: Backend — modo de consumo (prioridad de proceso + concurrencia)

**Files:** Modify `indexer/src-tauri/src/proceso.rs`, `indexer/src-tauri/src/queue.rs`,
`indexer/src-tauri/src/lib.rs`

- [ ] **Paso 2.1** — `proceso.rs:35-41` (`cmd_async`): añadir un parámetro o una variante que
  también fije prioridad baja en Windows. `creation_flags` acepta un OR de flags — buscar la
  constante ya usada (`SIN_CONSOLA`) y su valor, y añadir `BELOW_NORMAL_PRIORITY_CLASS`
  (`0x00004000`) al conjunto cuando corresponda:
  ```rust
  pub fn cmd_async(programa: impl AsRef<OsStr>, prioridad_baja: bool) -> tokio::process::Command {
      #[allow(unused_mut)]
      let mut c = tokio::process::Command::new(programa);
      #[cfg(windows)]
      {
          const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x00004000;
          let flags = if prioridad_baja { SIN_CONSOLA | BELOW_NORMAL_PRIORITY_CLASS } else { SIN_CONSOLA };
          c.creation_flags(flags);
      }
      c
  }
  ```
  Confirmar el nombre/valor real de `SIN_CONSOLA` contra el fichero antes de escribir el OR —
  puede que ya sea una constante `u32` con un nombre distinto.

  En Unix, dejarlo como no-op por ahora (parámetro ignorado) — anotar con un comentario `//
  ponytail:` el techo: el uso principal de este producto es Windows con los servicios en WSL, no
  el Indexer en sí en Linux; nice/setpriority en Unix queda para cuando haga falta de verdad.

  Todo llamante existente de `cmd_async` (buscar con grep — `queue.rs` al menos) gana el nuevo
  argumento; usar `false` donde no aplica (procesos que no son el trabajador de embebido, si los
  hay).

- [ ] **Paso 2.2** — `queue.rs::arrancar` (línea ~151-178): pasar si el modo actual es "bajo" al
  `cmd_async`. Necesita leer el modo desde `Cola` — añadir un campo (mismo patrón que
  `concurrencia`, buscar cómo se almacena y se lee/escribe con `cola_concurrencia_leer`/
  `fijar_concurrencia` para replicar la forma exacta: `Mutex<usize>`, atómico, lo que sea que
  ya use) para `prioridad_baja: bool` (o un enum `Consumo { Alto, Bajo }`, si encaja mejor con
  el resto del código — decidir contra el estilo real de `Cola`).

- [ ] **Paso 2.3** — Dos comandos Tauri nuevos, junto a `cola_concurrencia_leer`/
  `cola_concurrencia_fijar` (`lib.rs:337-345`):
  ```rust
  #[tauri::command]
  fn cola_consumo_leer(estado: tauri::State<'_, Estado>) -> bool {
      estado.cola.prioridad_baja() // nombre exacto a decidir junto al campo del paso 2.2
  }

  #[tauri::command]
  fn cola_consumo_fijar(estado: tauri::State<'_, Estado>, bajo: bool) {
      estado.cola.fijar_prioridad_baja(bajo);
      // Un solo control cubre las dos cosas: bajo consumo sin la concurrencia
      // a 1 no cumple el objetivo (dejar la máquina libre) — separar los dos
      // ajustes deja combinaciones sin sentido.
      estado.cola.fijar_concurrencia(if bajo { 1 } else { 2 });
  }
  ```
  Registrar en `generate_handler!`. El proceso de embebido YA en marcha no cambia de prioridad
  retroactivamente (`creation_flags` solo aplica al lanzar) — esto es aceptable: el cambio se
  aplica al siguiente trabajador que arranque, no hace falta matar uno en marcha para esta
  primera pasada.

- [ ] **Paso 2.4 — Compilar**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml`.

---

### Tarea 3: Frontend — modo de consumo en Ajustes

**Files:** Modify `indexer/src/setup/ServicesPanel.tsx`, `indexer/src/lib/api.ts`

- [ ] **Paso 3.1** — `api.ts`: añadir junto a `colaConcurrenciaLeer`/`colaConcurrenciaFijar`
  (línea ~337-338):
  ```ts
  colaConsumoLeer: () => invoke<boolean>("cola_consumo_leer"),
  colaConsumoFijar: (bajo: boolean) => invoke<void>("cola_consumo_fijar", { bajo }),
  ```

- [ ] **Paso 3.2** — `ServicesPanel.tsx`: sustituir el bloque "Concurrencia de embebido"
  (líneas 132-152 de la lectura de referencia — confirmar contra el estado real del fichero tras
  la Tarea 2) por un único selector Alto/Bajo que llame a `colaConsumoFijar`, con la misma copy
  que ya tenía la sección de concurrencia pero explicando la relación con prioridad de proceso:
  ```tsx
  <p className="text-sm text-fg">Consumo al embeber</p>
  <p className="mt-[5px] text-[11px] leading-relaxed text-muted">
    Alto reparte más VRAM y usa prioridad normal de proceso — más rápido, pero nota el
    ordenador ocupado. Bajo usa un solo modelo a la vez con prioridad baja — más lento, pero
    puedes seguir trabajando con normalidad mientras corre.
  </p>
  <div className="mt-3 flex gap-2">
    {/* botones Alto/Bajo, mismo patrón visual que el selector de concurrencia que sustituye */}
  </div>
  ```
  Leer el estado inicial con `colaConsumoLeer` en el mismo `useEffect` que ya lee
  `colaConcurrenciaLeer` (o sustituirlo, si el backend ya no expone la concurrencia por
  separado tras el paso 2.3 — confirmar si `cola_concurrencia_fijar`/`_leer` se quedan
  registrados igualmente para otros llamantes antes de decidir si se quitan de aquí).

- [ ] **Paso 3.3 — Verificar**: `cd indexer && npx tsc -b --noEmit`.

---

### Tarea 4: Frontend — ETA de descarga por imágenes, siempre

**Files:** Modify `indexer/src/download/DownloadView.tsx`

- [ ] **Paso 4.1** — Reescribir el bloque de cálculo de ETA (líneas 29-55 de la lectura de
  referencia): quitar la rama por teselas por completo. El total de imágenes a usar es
  `imagenesEstimadas` si existe y es `> 0`; si no, se deriva sobre la marcha:
  ```ts
  const totalImagenes = imagenesEstimadas && imagenesEstimadas > 0
    ? imagenesEstimadas
    : x.teselas_hechas > 0
      ? Math.round((x.imagenes / x.teselas_hechas) * x.teselas_total)
      : null;
  if (totalImagenes) {
    const ritmo = x.imagenes / Math.max(1, transcurrido);
    const restantes = Math.max(0, totalImagenes - x.imagenes);
    setEta(ritmo > 0 ? formatoEta(restantes / ritmo) : null);
  } else {
    setEta(null);
  }
  ```
  Guardar `totalImagenes` también en un estado (o derivarlo de nuevo al renderizar) para el
  encabezado del paso 4.2 — decidir en el momento si conviene un segundo `useState` o recalcular
  inline con los mismos datos que ya están en `p`.

- [ ] **Paso 4.2** — Encabezado (línea ~63-71 de la lectura de referencia): junto a
  `{p.teselas_hechas} de {p.teselas_total} teselas`, añadir en la misma línea o justo debajo
  `{p.imagenes} de {totalImagenes} imágenes` cuando `totalImagenes` no sea `null` — mismo
  tratamiento tipográfico (`font-mono text-[11px] text-muted`).

- [ ] **Paso 4.3 — Verificar**: `cd indexer && npx tsc -b --noEmit`.

---

### Tarea 5: Frontend — pantalla fusionada

**Files:**
- Create: `indexer/src/embed/DescargaYEmbebidoView.tsx`
- Modify: `indexer/src/App.tsx`, `indexer/src/ui/Rail.tsx`
- Delete o reducir a implementación interna: el `DownloadView`/`EmbedQueueView` originales se
  fusionan — decidir si uno de los dos ficheros se queda como el componente combinado
  (renombrado) o si de verdad conviene un fichero nuevo que compone los dos existentes sin
  tocarlos por dentro; lo segundo es menos invasivo y más fácil de revisar.

- [ ] **Paso 5.1** — Leer `App.tsx` completo para entender cómo se decide hoy qué destino
  mostrar tras crear/abrir un índice (`indiceAbierto`, el `Destino` que apunta a descarga vs.
  embebido) antes de tocar nada — el plan de la spec de Proyectos ya renombró `"indices"` a
  `"proyectos"`; este cambio toca el MISMO fichero de nuevo, así que confirmar el estado actual
  en vez de asumir las líneas de sesiones anteriores.

- [ ] **Paso 5.2** — `DescargaYEmbebidoView.tsx`: compone `DownloadView` (o su contenido) arriba
  y, debajo, la sección de filas de `EmbedQueueView` — visible en cuanto
  `api.indiceProgresoEmbebido(indiceId)` trae alguna fila con `total > 0`, no solo cuando la
  descarga termina. El botón "+ Nuevo proyecto"/navegación de vuelta y el resto de contexto
  (`onCambiarIndice`, etc.) se conservan de `EmbedQueueView` tal cual.

- [ ] **Paso 5.3** — `App.tsx`/`Rail.tsx`: el destino de embebido separado desaparece; abrir un
  índice con trabajo pendiente (descarga o embebido) lleva a `DescargaYEmbebidoView` en vez de
  decidir entre dos pantallas.

- [ ] **Paso 5.4 — Verificar**: `cd indexer && npx tsc -b --noEmit && npm run lint`.

---

### Tarea 6: Frontend — botón "Portear a otro nivel"

**Files:** Modify `indexer/src/catalog/IndexDetail.tsx` (o donde quede la cabecera del índice
tras la Tarea 5 — confirmar contra el estado real del árbol de componentes en ese punto)

- [ ] **Paso 6.1** — Botón junto al nombre del índice, deshabilitado si el índice está sellado
  Y no admite más capas (confirmar la regla real — probablemente sellado no bloquea añadir
  capas, dado que `reembeber::encolar` ya se usa hoy sobre índices sellados según su propio
  comentario). Abre el mismo selector visual de niveles que `NewIndexDialog.tsx` (extraer a un
  componente compartido si el código se presta, o duplicar el bloque si es pequeño — decidir en
  el momento, `ponytail`: no crear una abstracción para un solo caso de reuso si duplicar 20
  líneas es más simple).

- [ ] **Paso 6.2** — Al confirmar, llama a `api.indicePortearNivel(indiceId, niveles)` (nueva
  entrada en `api.ts`, mismo patrón que `indiceCrear`), muestra los modelos nuevos que se
  encolaron (la respuesta del comando) y navega a `DescargaYEmbebidoView` para que el operador
  vea el nuevo trabajo arrancar.

- [ ] **Paso 6.3 — Verificar**: `cd indexer && npx tsc -b --noEmit && npm run lint`.

---

### Tarea 7: Verificación final y commit

- [ ] **Paso 7.1**: `cargo build --manifest-path indexer/src-tauri/Cargo.toml` y
  `cd indexer && npx tsc -b --noEmit && npm run lint` — ambos limpios.

- [ ] **Paso 7.2**: un solo commit, mensaje:
  ```
  feat: descarga y embebido en una pantalla, portear nivel, consumo bajo

  Descarga y embebido eran dos pantallas separadas con navegación propia
  — terminar de descargar no llevaba a embeber. Ahora es una sola vista:
  descarga arriba, embebido debajo en cuanto hay algo que embeber.

  El nivel de un índice (mini/pro/vision) se fijaba una sola vez al
  crearlo pese a que fijar_niveles_elegidos ya soportaba escribirse de
  nuevo — "portear a otro nivel" calcula qué modelos exige el nivel
  nuevo, diffea contra lo que el índice ya tiene, y encola solo lo que
  falta con reembeber::encolar (ya existía, por modelo).

  Modo de consumo alto/bajo en Ajustes: bajo baja la prioridad del
  proceso de embebido (Windows) y fuerza concurrencia 1, para poder
  seguir usando el ordenador con normalidad mientras corre de fondo —
  un solo control en vez de dos ajustes independientes que podían
  combinarse sin sentido.

  El ETA de descarga dejaba de calcularse en cuanto la estimación
  inicial no llegaba (caso real, no raro) y caía a un cálculo por
  teselas que el propio comentario del código admitía que se quedaba
  mudo. Ahora siempre se deriva de imágenes, estimadas de antemano o
  recalculadas sobre la marcha con lo ya visto.

  Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
  ```
