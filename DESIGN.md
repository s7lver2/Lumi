# Lumi Station — sistema de diseño

Heredado de Lumi v1 (`apps/web/tailwind.config.ts`, `app/globals.css`,
`components/PlanetBackground.tsx`). Los valores están fijados por decisión del owner: el
`/setup` y el mapa se conservan prácticamente idénticos. No introducir tokens nuevos sin
motivo explícito.

## Color

Tema oscuro, único. No hay modo claro. Neutros fríos, sin gradientes, sin glassmorfismo
decorativo (el desenfoque existe solo en paneles sobre el mapa, donde tiene función).

| Token | Valor | Uso |
|---|---|---|
| `bg` | `#0e0f11` | fondo de aplicación |
| `surface` | `#15171a` | telón del mapa, franja de telemetría |
| `panel` | `#1a1b1e` | paneles laterales |
| `elevated` | `#202226` | tarjetas internas |
| `border` | `#26282c` | todos los bordes |
| `fg` | `#e8e8e6` | texto principal, **trazo de iconos** |
| `muted` | `#9a9a95` | texto secundario |
| `subtle` | `#6a6c70` | texto terciario, estado inactivo |
| `accent` | `#f2f3f5` | botón primario (texto negro encima) |
| `draw` / `draw-fg` | `#378add` / `#85b7eb` | dibujo en mapa, **en curso** |
| `warning` / `warning-fg` | `#ef9f27` / `#efb968` | **atención, sellado, cifrado** |
| `danger` / `danger-fg` | `#a33` / `#e88f8f` | **error** |

**No hay verde.** "Completado" se representa en blanco, como el paso `done` del stepper.

Fondo de espacio: `#05070a` (solo `PlanetBackground`).

## Tipografía

`--font-sans` para interfaz, `--font-mono` para todo dato de máquina: IPs, puertos, huellas,
rutas, bytes, timestamps, claves, logs. La regla es dura: si lo produjo una máquina, va en
mono.

Escala: 17px título de wizard · 14px cuerpo · 12.5px cuerpo de tarjeta · 12px botones y
etiquetas de estado · 11px etiquetas de campo · 10.5px pie de stepper · 9.5px encabezado de
telemetría (mayúsculas, `letter-spacing: .1em`).

## Forma

`border-radius`: 12px tarjetas (`rounded-card`) · 8px inputs, botones y bloques de log ·
50% burbujas del stepper y puntos de estado.

Panel de cristal (solo sobre mapa o sobre el fondo de planeta):
`border border-white/[.13] bg-[rgba(16,19,25,.66)] backdrop-blur-xl shadow-lg shadow-black/40`

Ancho del wizard: `max-w-xl` (552px), centrado. Mismo valor que la v1: el desbordamiento
del stepper ("Vincular" pisando "Admin") no era un problema de ancho, era que Inter nunca se
cargaba de verdad — caía a la fuente del sistema, más ancha — y por eso el ancho por sí solo
nunca lo habría arreglado. Ver "Tipografía" más abajo.

## Iconos

Sin librería. SVG a mano, siguiendo el patrón extraído de la v1:

- `viewBox="0 0 24 24"` **siempre**. El tamaño va en `width`/`height`.
- `fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round"`.
- `strokeWidth` **1.6–2.0**, y **no adelgaza al crecer**: el icono de 32px sigue en 1.6.
- Tamaños en uso: 9, 10, 11, 12, 13, 14, 15, 17, **32 (máximo)**.
- Detalles rellenos: círculo diminuto con `r=".4"`–`.6"`, `fill="currentColor" stroke="none"`.
- Trazo en `fg` por defecto. El color solo entra cuando significa estado.

**Iconos canónicos ya existentes** (reutilizar, no rediseñar):

```
candado   <rect x="5" y="11" width="14" height="9" rx="1.5"/>
          <path d="M8 11V7a4 4 0 0 1 8 0v4"/>            strokeWidth 1.8
check     <path d="M20 6L9 17l-5-5"/>                     strokeWidth 2
chevron   <path d="M6 9l6 6 6-6"/>                        strokeWidth 2
info      <circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5"/>
          <circle cx="12" cy="7.5" r=".6" fill="currentColor" stroke="none"/>
```

### Icono grande de estado

32px, centrado sobre el contenido de la tarjeta, con un halo del mismo color detrás
(`blur(18px)`, opacidad 0.13–0.15). Va **entero** en su color:

| Estado | Icono | Color |
|---|---|---|
| En curso / reiniciando | flecha circular | `draw-fg` |
| Error | triángulo con `!` | `danger-fg` |
| Sellado / cifrado | candado | `warning` |
| Sin conexión | señal tachada | `subtle` |

## Movimiento

Solo `ease-out` exponencial: `cubic-bezier(.16,1,.3,1)` y `cubic-bezier(.22,1,.36,1)`.
Nada de rebote ni elástico. No animar propiedades de layout. Respetar
`prefers-reduced-motion`.

Keyframes de la v1, reutilizar por nombre:

```
jg-fade-rise      entrada de contenido, 4px hacia arriba
jg-lock-breathe   opacidad .7→1, escala 1→1.06, 2.6s   (candado)
lumi-spin         rotación continua                     (spinners)
lumi-twinkle      parpadeo de estrellas, 3s
lumi-planet-spin  giro del planeta, 70s
lumi-orbit        satélite, 14s
lumi-tumble-fall  restos cayendo en estado degradado
```

Añadidos de la v2: `jg-alert-pulse` (opacidad .5→1, 2.2s, solo el `!` del triángulo),
`jg-scan` (arcos de señal en secuencia, desfase 0.18s).

Apertura del candado: el arco sube 2.2px y gira −17° sobre su base izquierda en 0.75s
`ease-out-expo`, deja de respirar y su color transiciona de `warning` a `fg` en 0.5s.

## Fondo de planeta

`PlanetBackground` se conserva **valor por valor**. Ocho estrellas en posiciones fijas con
sus retardos, planeta de 520px en `right:-160px bottom:-208px` girando en 70s, satélite en
órbita de 14s, textura de cinco gradientes radiales.

Estado `dead` (reutilizado para servidor degradado): `saturate(.55) brightness(.75)`, giro a
220s, estrellas a 5s, órbita punteada ámbar recortada y tres restos cayendo.

Prohibido añadir nebulosas, paralaje, polvo estelar, estrellas fugaces o luces de ciudad.
Se probó y se descartó: rompe la esencia del original.

## Composición de estado

Los popups de estado **no son un componente nuevo**. Reutilizan la composición del wizard:
misma `pane` de 552px, misma brandline con `✦`, misma tarjeta de cristal, misma fila de
botones. Solo desaparece el stepper y se atenúa el wizard detrás (`opacity .28`, `blur 1px`)
sobre un velo de `rgba(5,7,10,.55)` con `backdrop-blur(3px)`.

Cada popup: título de 1-3 palabras · una línea de contexto corta · máximo dos líneas de
estado con icono de 13px · el bloque de log crudo cuando hay error · fila de botones.

## Prohibiciones

Heredadas de `PROJECT-CONVENTIONS.md` y confirmadas en revisión:

- Iconos dentro de cajitas de color.
- Gradientes morado-azul, texto con gradiente, botones pastilla con glow.
- Tarjetas con todo apilado dentro, tarjetas anidadas.
- Rejillas de tarjetas idénticas icono + título + texto.
- Bordes laterales de color como acento.
- Colores fuera de la tabla de arriba.
