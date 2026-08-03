# Pulido de la pantalla de entrada

**Fecha:** 2026-08-03
**Estado:** aprobado
**Alcance:** tres huecos de navegación detectados al probar el subsistema 2, y un fondo nuevo solo para las pantallas de entrada.

---

## 1. Contexto

Al probar el subsistema 2 en `npm run tauri dev` aparecieron tres problemas de navegación
y una petición de estética. Se decidieron por brainstorming rápido (preguntas cerradas +
companion visual para el fondo), sin necesitar spec larga: es pulido acotado sobre pantallas
que ya existen, no una pieza nueva del sistema.

## 2. Navegación

| Problema | Decisión |
|---|---|
| "Añadir un servidor" sin servidores guardados mostraba "Atrás", que llevaba a un login vacío e inútil | Confirmado: el comportamiento correcto es justo el que ya se implementó — sin servidores, no hay "Atrás" |
| "Acceso aprobado" (crear cuenta con el ticket) no tenía forma de salir sin crear la cuenta | Añadir "Más tarde": vuelve al login. El ticket **no se toca** — sigue vivo sus 48 h, así que la próxima apertura aterriza otra vez aquí si sigue aprobado |
| El cambio de contraseña forzado no tenía salida | Añadir "Cancelar": descarta el token de esta sesión (no cambia la contraseña) y vuelve al login. No contradice que el cambio sea obligatorio para *operar* con esa cuenta — solo permite abandonar el intento y loguear con otra cosa |

Ninguna de las dos huidas consume ni invalida nada en el servidor: son puramente del lado
del cliente, deshaciendo solo lo que el cliente había empezado a mostrar.

## 3. Fondo de las pantallas de entrada

**Decisión:** un fondo de ondas animadas, **solo detrás del `Pane` de `EntryScreen`**. El
`PlanetBackground` sigue siendo el fondo del wizard del owner y de la app ya logueada — no
se toca, sigue protegido por `DESIGN.md`.

Variante elegida en el companion visual: **B2+**. Cinco capas de líneas onduladas en SVG,
duplicadas y desplazadas con `translateX` en bucle (mismo patrón que una animación CSS
convencional de "olas"), a velocidades y sentidos distintos para que no se sincronicen.
Fondo casi negro (`#08090a`) con una viñeta radial que oscurece más los bordes que el
centro. Una sexta línea, más fina, en `draw-fg`/`draw` (el azul que ya usa `DESIGN.md` para
"en curso"), con una animación de opacidad tipo latido cada 3.4 s — es el único color que no
es `border`/`subtle`, y ya está en la tabla de tokens: no es un color nuevo.

Motion: `linear infinite` para el desplazamiento de las capas (igual que el sweep del radar
de la tarea 12 del subsistema 2, que ya es el precedente de "bucle ambiental, no
`ease-out`"), `ease-in-out infinite` para el latido (igual que `jg-core-pulse`, que ya
existe en `index.css`).

## 4. Fuera de alcance

Nada de esto toca el modelo de datos, la API, ni ninguna de las 16 tareas ya mergeadas del
subsistema 2. Es una capa visual y tres condicionales de navegación sobre componentes que
ya existen: `AddServerForm`, `ResolvedScreen`, `ChangePasswordForm`, `EntryScreen`.
