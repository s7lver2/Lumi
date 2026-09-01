# Cliente — Toggle de reducir movimiento, arreglo real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** El toggle de "reducir movimiento" sigue viéndose roto (BUG_BOUNTY #98) pese al fix de #86 (commit `5f54af0`, ya publicado en v2.0.7). Causa real, distinta de la de #86: la propia regla CSS que reduce movimiento globalmente mata la transición del interruptor en el instante en que lo activas, antes de que la animación de deslizamiento llegue a jugar.

**Architecture:** Solo `client/src/index.css` (y posiblemente `client/src/lib/apariencia.ts` si hace falta reordenar cuándo se aplica la clase). No tocar `installer/`, `indexer/`, ni el resto de `client/` — otros planes cubren esos árboles en paralelo.

## Global Constraints

- No tests unless explicitly requested.
- Un commit al terminar, mensaje en español.
- `ponytail`: la solución más simple que funcione.
- Antes de comitear: `git status --short`, stage solo `client/src/index.css` (+ `apariencia.ts` si se tocó).

---

### Task 1: La regla de reducir movimiento no debe matar la animación del propio interruptor (#98)

**Root cause confirmado:** `client/src/index.css:116-119`:
```css
:root.jg-reduce-motion *, :root.jg-reduce-motion *::before, :root.jg-reduce-motion *::after {
  animation: none !important;
  transition: none !important;
}
```
`aplicarReducirMovimiento` (`client/src/lib/apariencia.ts:51-54`) añade la clase `jg-reduce-motion` a `<html>` de forma síncrona, dentro del mismo click que activa el toggle, ANTES de que React re-renderice el knob con su nueva posición. El selector universal con `!important` elimina la transición del propio `<button>`/`<span>` del interruptor junto con todo lo demás — el knob salta en vez de deslizarse, lo cual se percibe como "roto" aunque la posición final (arreglada en #86) sea correcta.

**Files:** Modify `client/src/index.css` (la regla de `.jg-reduce-motion`).

**Steps:**
- [ ] Localizar la regla exacta en `index.css:116-119`.
- [ ] Excluir el propio interruptor de reducir movimiento de esta regla: cambiar el selector para que no aplique a `[role="switch"]` ni a sus descendientes, p.ej.:
  ```css
  :root.jg-reduce-motion *:not([role="switch"], [role="switch"] *),
  :root.jg-reduce-motion *::before:not([role="switch"] *),
  :root.jg-reduce-motion *::after:not([role="switch"] *) {
    animation: none !important;
    transition: none !important;
  }
  ```
  (ajustar la sintaxis exacta de `:not()` con múltiples argumentos según el nivel de soporte de selectores ya usado en el resto del CSS del proyecto — si `:not()` con lista de selectores no es fiable, usar dos reglas separadas en su lugar, una para excluir `[role="switch"]` y otra para sus descendientes).
- [ ] Verificar manualmente: con "reducir movimiento" apagado, activarlo — confirmar que el propio interruptor SÍ desliza su bolita al activarse (última interacción visible antes de que el resto de la interfaz deje de animar), y que el resto de animaciones de la app quedan correctamente desactivadas.
- [ ] Verificar también el caso inverso: con "reducir movimiento" ya activado, desactivarlo — el interruptor debe deslizar de vuelta con normalidad (ya no tiene la clase `jg-reduce-motion` puesta en ese momento, así que esto ya debería funcionar, pero confirmarlo).
- [ ] Commit: `git add client/src/index.css` + `git commit -m "fix: el toggle de reducir movimiento ya no pierde su propia animacion de deslizamiento al activarse"`.

---

## Verificación final

- [ ] `cd client && npx tsc -b && npm run lint` sin errores (cambio es CSS puro, no debería afectar tipos, pero verificar igualmente).
- [ ] `git status --short` vacío tras el commit.
- [ ] Reportar cualquier desviación del plan al final.
