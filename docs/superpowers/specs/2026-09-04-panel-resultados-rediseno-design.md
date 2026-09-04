# Rediseño del panel de resultados de análisis — spec

## Contexto

El cajón de resultados actual (`client/src/work/ResultsDrawer.tsx`, `Drawer.tsx`)
mide 250px y apila en una sola columna: miniatura de la imagen, la lista COMPLETA
de intentos de análisis de esa imagen (cada re-análisis añade una tarjeta), y solo
si hay uno seleccionado, su hipótesis/alternativas, agentes y EXIF. Con varios
intentos (frecuente al depurar o al repetir con otro modelo), la lista de intentos
empuja el detalle de verdad fuera de la vista y deja muy poco espacio para
enseñarlo bien.

La v1 (`E:\Lumi\apps\web\app\components\ResultsPanel.tsx`) resolvía esto con un
panel de 520px con una rejilla de widgets (foto de consulta, candidato comparado,
EXIF, hora estimada, clima, objetos detectados) — sin una lista de intentos
compitiendo por el mismo espacio.

## Objetivo

Separar "qué intentos hay" de "qué dice el intento seleccionado", y usar el
espacio ganado para mostrar mejor lo que subsistema 5b/5c ya calculan
(verificación geométrica, agentes) y lo que falta calcular (foto de referencia
del candidato).

## Arquitectura

Dos elementos nuevos reemplazan el `ResultsDrawer` actual:

1. **`AttemptsRail`** (nuevo) — carril angosto (~80px) pegado al borde derecho
   de la pantalla, a la derecha del mapa y a la izquierda de `DetailDrawer`.
   Un rectángulo por intento de análisis de la imagen seleccionada: modelo +
   icono de estado (✓ hecho, ⏳ en curso/pendiente, ✕ error). Clic para
   seleccionar. Mismo criterio de apertura que hoy tiene el cajón de resultados
   (`abiertoYa` en `CaseView.tsx`): se abre solo automáticamente la PRIMERA vez
   que hay más de un intento para la imagen seleccionada; a partir de ahí manda
   quien lo abrió o cerró — un botón/pestaña propio (mismo patrón que
   `DrawerTab`), independiente del automatismo.
2. **`DetailDrawer`** (reemplaza `ResultsDrawer`) — se ensancha a 360px, y se
   dedica ENTERO al intento seleccionado. Es una sola columna con scroll
   vertical; nada de la lista de intentos vive aquí.

`CaseView.tsx` pasa a montar ambos en vez de uno: `AttemptsRail` con su propio
estado de abierto/cerrado (mismo patrón `abiertoYa` + control manual que ya
usa `drawerId`), `DetailDrawer` sigue leyendo `shown` (el intento seleccionado)
exactamente como hoy.

## `DetailDrawer`: contenido, de arriba abajo

1. **Cabecera** — miniatura (44×36), nombre de fichero, modelo + "hace N min".
2. **Comparador de fotos** (Fase 2, ver más abajo) — tu foto vs. la foto del
   candidato ganador, con un divisor arrastrable horizontalmente (`pointerdown`
   /`pointermove`/`pointerup`, sin librería). A su izquierda tu foto, a su
   derecha la del candidato, superpuestas en el mismo recuadro. Oculto por
   completo si no hay foto de candidato que mostrar (ver Fase 2).
3. **Resultado principal** — coordenada en 18-19px mono, radio y confianza como
   par de estadísticas (no una línea de texto corrida). Insignia de
   verificación: check + "verificado por `<verificador>`" + inliers en mono,
   en **blanco** (`fg`), NUNCA verde — `DESIGN.md` lo prohíbe explícitamente
   ("No hay verde. Completado se representa en blanco"). Si no hay
   `verificador`, la línea de siempre ("sin verificación geométrica ·
   coordenada de recuperación").
4. **Agentes** (`AgentesPanel`, reescrito) — una tarjeta por agente, no una
   rejilla ni una lista apretada. Cada tarjeta lleva:
   - Un icono SVG propio y específico de qué mira ese agente (ver tabla más
     abajo), siguiendo las reglas de `DESIGN.md` §Iconos (`viewBox 24 24`,
     `stroke currentColor`, `strokeWidth 1.6-2.0`, trazo en `fg`).
   - Etiqueta + confianza (mono) en la misma línea.
   - El valor (`etiqueta`) en cuerpo.
   - `detalle` (ya existe en `DichoDeAgente`, hoy se concatena todo al final
     del panel) como frase propia de esa tarjeta.
   - Un agente abstenido (`etiqueta === "abstiene"`) se ve con opacidad
     reducida, nunca desaparece — mismo criterio que ya rige hoy.
5. **EXIF** — igual que hoy, tarjeta ámbar aparte, al final.

Todo dentro de un contenedor con `overflow-y: auto`: al hacer scroll se
recorren los agentes uno a uno, no se listan en una rejilla apretada.

### Iconos de agente (dibujados a mano, sin librería)

| Agente | Icono | Nota |
|---|---|---|
| `idioma` | bocadillo de habla con dos rayas de texto dentro | forma fija |
| `lado-conduccion` | vía discontinua vertical + un coche a un lado | el lado del coche NO cambia según el resultado — es una forma fija, el texto dice "izquierda"/"derecha" |
| `clima-aparente` | nube | apagada (opacidad reducida, trazo `subtle`) cuando se abstiene |
| `hora-sombras` | reloj de sol: círculo + aguja | la aguja rota al ángulo real estimado (`transform: rotate(<grados> 12 12)`, calculado a partir de la hora estimada) — es el único icono cuyo dibujo es DATO, no decoración |
| resto de agentes de Pro (`toponimos`, `estacion`, `escena`, `senalizacion`, `matricula`, `dimensiones`) | fuera de alcance de este spec | se diseñan cuando Pro esté implementado (ver conversación aparte sobre Lumi Pro) |

Ningún icono lleva color de fondo ni caja coloreada (prohibido en
`DESIGN.md` — "Iconos dentro de cajitas de color"). Ninguna tarjeta usa un
borde lateral de acento (también prohibido). Las cuatro tarjetas de agente NO
son una rejilla idéntica icono+título+texto pese a compartir estructura: el
icono de cada una es un dibujo distinto y con sentido, no una plantilla
repetida con el icono cambiado — es la diferencia entre lo que `DESIGN.md`
prohíbe ("rejillas de tarjetas idénticas") y lo que se pide aquí.

## Fases

**Fase 1 (este plan de implementación)**: todo lo de arriba EXCEPTO el
comparador de fotos, que depende de datos que hoy no existen. Sin cambios de
backend: es una redistribución del layout y una reescritura de los
componentes de presentación sobre los datos que `Analysis`/`Hipotesis`/
`DichoDeAgente` ya traen hoy.

**Fase 2 (aparte, no en este plan)**: foto de referencia del candidato
ganador. Requiere:
- `Hipotesis` (y el resultado principal — recordar que `result_inliers`/
  `result_verificador` ya se añadieron a `analyses` en esta misma sesión, el
  mismo patrón aplicaría a una futura `result_foto`/`Hipotesis.foto`) lleve
  una URL de foto del candidato que ganó la verificación.
- Resolver qué imagen del índice instalado corresponde a ese candidato (el
  `indice`+`autor`+coordenada ya viajan; hace falta encontrar el fichero real
  en `imagenes/` del paquete instalado y servirlo por una ruta nueva, con el
  mismo cuidado de autenticación que ya tiene `/v1/images/:id/thumb`).
- El comparador en sí (el HTML/JS del divisor) ya está validado en el
  compañero visual de esta sesión — es la parte de front que NO necesita
  redecidirse cuando llegue el momento.

## Fuera de alcance

- Migrar a Lumi Pro o implementar sus verificadores/modelos — conversación y
  trabajo aparte, ya en marcha (URLs de descarga preparadas en
  `registros/modelos/megaloc.json`, `boq-dinov2.json`, `mixvpr.json`,
  `registros/verificadores/roma.json`, `lightglue-aliked.json`).
- Iconos para los agentes exclusivos de Pro.
- Cualquier cambio de esquema en `analyses`/`analysis_hypotheses` más allá de
  lo que Fase 2 necesitará (no se toca en este plan).

## Testing

- Sin backend nuevo en Fase 1: no hay pruebas de Rust que añadir.
- El comparador deslizante (cuando llegue Fase 2) es la única lógica no
  trivial nueva del lado cliente — candidato a una prueba de interacción si
  el proyecto empieza a testear componentes de React (hoy no lo hace, ver
  `PROJECT-CONVENTIONS.md`: "no tests unless explicitly requested").
- Verificación manual: abrir un caso con 3+ intentos de análisis sobre la
  misma imagen, confirmar que el carril se abre solo la primera vez y que se
  puede cerrar/abrir a mano después: confirmar que un agente abstenido se ve
  apagado pero legible, y que la insignia de verificación nunca sale en
  verde.
