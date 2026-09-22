# Darkroom 2 · 1 — Temas

Parte de Darkroom 2 (ver `2026-09-22-darkroom2-00-indice-design.md`). Es lo primero que se
construye, para que el espacio Darkroom (spec 2) nazca directamente sobre los tokens del tema
nuevo en vez de hacerse con colores fijos y reescribirse después.

## Resumen

El cliente Lumi pasa a tener **dos temas**:

- **Raven**: una piel nueva, más cercana a la de Raven (Graylark). Es el tema **por defecto
  para todos**, también para quien ya usaba la app.
- **Legacy**: el aspecto de hoy, valor por valor, incluida la herencia de la v1 en el wizard
  y el mapa.

El investigador elige tema en **Ajustes → Apariencia**. La preferencia es **por
dispositivo**, igual que el tamaño de interfaz y «reducir movimiento».

**Solo cambia la piel**: colores, radios, sombras y el tratamiento de los estados. La
estructura, la navegación y los componentes son los mismos en los dos temas. El armazón con
barra de iconos queda aplazado (índice §3).

**Alcance:** todo el cliente Lumi (`client/`), incluidas las pantallas de entrada y el
wizard. **El Indexer no cambia**: aunque comparte `client/src/ui`, solo verá el tema Legacy,
que para él es el único.

---

## 1. El problema de hoy

Cambiar de tema en caliente exige que los colores vivan en un solo sitio que se pueda
sustituir. Hoy no es así:

- Los tokens están escritos como **hex fijos** en `client/tailwind.config.ts`
  (`bg: "#0e0f11"`, …). Tailwind los incrusta en cada clase al compilar, así que no hay nada
  que cambiar en tiempo de ejecución.
- Hay **96 hex sueltos en 40 componentes `.tsx`** (`MapCanvas.tsx` 11, `WavesBackground.tsx`
  7, `DoctorView.tsx` 6, `PlanetBackground.tsx` 5, `CurvaEditable.tsx` 5, …) que se saltan los
  tokens por completo.
- `client/src/index.css` fija `body { background: #0e0f11; color: #e8e8e6 }` y varios
  `rgba(255,255,255,…)` / `rgba(242,243,245,…)` en keyframes y en la barra de scroll.
- El estilo del mapa (MapLibre, `mapEngine.ts` / `MapCanvas.tsx`) define sus propios colores
  de capa.

---

## 2. La decisión: tokens como variables CSS con canales RGB

Cada token pasa a ser una **variable CSS con sus canales RGB**, y Tailwind la lee con el
patrón que admite opacidad:

```css
/* index.css */
:root, :root[data-tema="raven"] { --c-bg: 10 12 15; --c-fg: 231 233 236; /* … */ }
:root[data-tema="legacy"]      { --c-bg: 14 15 17; --c-fg: 232 232 230; /* … */ }
```

```ts
// tailwind.config.ts
colors: { bg: "rgb(var(--c-bg) / <alpha-value>)", fg: "rgb(var(--c-fg) / <alpha-value>)", /* … */ }
```

- Las clases de Tailwind que ya existen (`bg-bg`, `text-muted`, `border-border`,
  `bg-fg/10`…) **siguen funcionando sin tocar un componente**, incluidas las de opacidad.
- Cambiar de tema es cambiar el atributo `data-tema` del `<html>`: no hay que recargar ni
  volver a montar nada.
- `:root` sin atributo cae en Raven, así que el primer pintado antes de leer la preferencia
  ya es el tema por defecto y no hay destello.

### Por qué no otras vías

- **Dos hojas de Tailwind compiladas.** Duplica el CSS, y el cambio en caliente pasa a ser
  sustituir hojas.
- **Un contexto de React con los colores.** Obligaría a reescribir cada componente para
  leerlos, y deja fuera todo lo que se pinta con Tailwind.

---

## 3. Los tokens

Los nombres de hoy se conservan, y se añaden los mínimos que Raven necesita. **Legacy lleva
exactamente los valores actuales**; lo que en Legacy no existía se asigna al valor de hoy
que cumplía esa función, para que Legacy se vea idéntico.

| Token | Raven | Legacy | Uso |
|---|---|---|---|
| `bg` | `#0a0c0f` | `#0e0f11` | fondo de aplicación |
| `surface` | `#0f1216` | `#15171a` | paneles laterales, barras |
| `panel` | `#13161b` | `#1a1b1e` | campos, botones secundarios |
| `elevated` | `#1a1e24` | `#202226` | popovers, menús, fichas sobre el mapa |
| `border` | `#232830` | `#26282c` | bordes |
| `border-soft` *(nuevo)* | `#1a1e25` | `#202226` | separadores de fila |
| `fg` | `#e7e9ec` | `#e8e8e6` | texto, trazo de iconos |
| `muted` | `#8d939c` | `#9a9a95` | texto secundario |
| `subtle` | `#5c626b` | `#6a6c70` | terciario, inactivo |
| `accent` | `#e7e9ec` | `#f2f3f5` | botón primario |
| `ok` *(nuevo)* | `#3ecf8e` | `#f2f3f5` | confirmado, completado, similitud alta |
| `sel` *(nuevo)* | `#5b7cfa` | `#378add` | selección (fila activa, miniatura elegida) |
| `draw` / `draw-fg` | `#4aa3ff` / `#8cc4ff` | `#378add` / `#85b7eb` | dibujo en mapa, en curso |
| `warning` / `warning-fg` | `#f5a524` / `#f7c46a` | `#ef9f27` / `#efb968` | atención, pistas de región |
| `danger` / `danger-fg` | `#e5484d` / `#f0898c` | `#aa3333` / `#e88f8f` | error, «probable IA» |
| `map-bg`, `map-road`, `map-road-2`, `map-label` *(nuevos)* | fríos, más negros | los de hoy | capas del mapa base |

La regla que distingue los temas es una sola: **en Legacy `ok` es blanco** (no hay verde,
como hoy), y **en Raven es verde**. Todo lo que hoy es «hecho en blanco» pasa a usar `ok`, y
así cada tema lo pinta a su manera sin condiciones en el código.

**Radios:** se añade `--r-card` (Raven `8px`, Legacy `12px`) detrás de `rounded-card`, y
`--r-control` (Raven `6px`, Legacy `8px`) para inputs y botones. Las sombras de popover pasan
a `--sombra-pop`.

**Tipografía:** la misma en los dos temas (Inter + mono del sistema), con la misma escala. La
regla del mono para todo dato de máquina no cambia.

---

## 4. Limpiar los hex sueltos

Cada uno de los 96 hex de los `.tsx` se clasifica en una de tres categorías:

1. **Es un token con otro nombre** (por ejemplo, `#e8e8e6` en un `style` es `fg`). Se
   sustituye por `rgb(var(--c-fg))` o por la clase de Tailwind equivalente. Es la inmensa
   mayoría.
2. **Es propio de un dibujo que el tema no debe tocar**: `PlanetBackground` (DESIGN.md exige
   conservarlo valor por valor), las texturas de `WavesBackground` y `AsciiWavesBackground`,
   y los degradados de las curvas del admin. Se deja tal cual, con un comentario
   `// tema: fijo, <motivo>`. Estos fondos son la identidad de la entrada en los dos temas.
3. **Es un color de mapa.** Pasa a los tokens `map-*`, y `mapEngine.ts` los lee con
   `getComputedStyle` al construir el estilo y al cambiar de tema, llamando a `setPaintProperty`
   sobre las capas que ya existen, sin recrear el mapa.

`index.css` se trata igual: `body` usa los tokens, y los `rgba` de la barra de scroll y de los
keyframes (`jg-done-flash`) pasan a `rgb(var(--c-fg) / .1)` y similares.

La regla que queda para el futuro va a DESIGN.md: **ningún color nuevo fuera de los tokens**,
salvo la categoría 2 con su comentario. Un `grep` de `#[0-9a-f]{6}` en `client/src/**/*.tsx`
debe devolver solo líneas marcadas con `// tema: fijo`.

---

## 5. El selector

En **Ajustes → Apariencia** (`AjustesView`), encima del tamaño de interfaz:

```
Tema        [ Raven | Legacy ]
            Legacy es el aspecto anterior de Lumi.
```

Es un control segmentado, como los que ya existen en el admin (`ColaView`, `UsersView`).

`lib/apariencia.ts` gana las mismas cuatro piezas que las demás preferencias:

```ts
const KEY_TEMA = "lumi.tema";
export const TEMAS = ["raven", "legacy"] as const;
export type Tema = (typeof TEMAS)[number];
export function aplicarTema(t: Tema) { document.documentElement.dataset.tema = t; }
export function leerTema(): Tema { /* try/catch, por defecto "raven" */ }
export function setTema(t: Tema) { localStorage.setItem(KEY_TEMA, t); aplicarTema(t); }
```

`main.tsx` llama a `aplicarTema(leerTema())` junto a `aplicarReducirMovimiento` y
`aplicarEscalaInterfaz`, antes del primer render.

- **Raven es el valor por defecto** cuando no hay nada guardado, así que quien ya usaba la
  app lo ve al actualizar (decisión del dueño). No hay aviso ni pantalla de bienvenida.
- La preferencia se guarda en el dispositivo y **no viaja con la cuenta**: Lumi guarda
  así todas sus preferencias de apariencia, y el tema no afecta a nada del servidor.

---

## 6. Lo que el tema Raven levanta y lo que no

DESIGN.md pasa a tener una sección **«Temas»**:

- **Se levanta solo la prohibición del verde**, y solo en Raven, a través del token `ok`.
- **Siguen vigentes en los dos temas**: iconos a mano (`viewBox 24`, trazo `currentColor`);
  nada de iconos en cajitas de color; nada de gradientes morado-azul ni botones pastilla con
  glow; nada de tarjetas apiladas o anidadas; **nada de bordes laterales de color como
  acento** (la fila seleccionada se marca con fondo `sel/14`, no con una raya a la
  izquierda); ningún color fuera de la tabla de tokens.
- La nota «los valores están fijados por decisión del owner, el `/setup` y el mapa se
  conservan prácticamente idénticos» pasa a aplicarse **al tema Legacy**. El tema Raven
  conserva la composición del wizard y del mapa (misma disposición, mismos tamaños, mismo
  movimiento) y cambia solo sus colores.

---

## 7. Superficie a tocar

| Fichero | Cambio |
|---|---|
| `client/tailwind.config.ts` | colores como `rgb(var(--c-*) / <alpha-value>)`; tokens nuevos `border-soft`, `ok`, `sel`, `map-*`; radios desde variables |
| `client/src/index.css` | bloques `:root[data-tema=…]` con los canales; `body` y `rgba` sueltos a tokens |
| `client/src/lib/apariencia.ts` | `Tema`, `leerTema`, `setTema`, `aplicarTema` |
| `client/src/main.tsx` | `aplicarTema(leerTema())` antes del render |
| `AjustesView` | control segmentado Raven / Legacy |
| `client/src/work/mapEngine.ts`, `MapCanvas.tsx` | colores de capa desde `map-*`; repintado al cambiar de tema |
| los 40 `.tsx` con hex | sustituir o marcar `// tema: fijo` (§4) |
| `DESIGN.md` | sección «Temas», tabla de tokens con las dos columnas, alcance de la nota del owner |

**Indexer:** su `tailwind.config` y su CSS no se tocan. Como comparte `client/src/ui`, cuando
esos componentes pasen a usar variables el Indexer tiene que definirlas. Su `index.css` gana
el bloque `:root` con los valores Legacy, y nada más: no hay selector, ni `data-tema`, ni
preferencia.

---

## 8. Verificación

Sin tests nuevos (convención del repo). El cierre es:

- `npm run build` y `npm run lint` limpios en `client/` y en `indexer/`.
- El `grep` de hex del §4 solo devuelve líneas `// tema: fijo`.
- Recorrido a mano en los dos temas: entrada y wizard, selector de proyectos, proyecto, caso
  normal con el mapa, admin, Ajustes. **Cambiar de tema con un caso abierto** repinta mapa y
  paneles sin recargar.
- Legacy comparado contra una captura de antes del cambio: tiene que ser indistinguible.
