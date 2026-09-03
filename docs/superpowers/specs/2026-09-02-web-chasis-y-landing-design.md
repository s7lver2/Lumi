# Web de Lumi — chasis y landing (subsistema 9)

> Primera tanda del subsistema 9. Parte del concepto `lumi-landing-v6.html` que aportó
> el owner, corregido donde no decía la verdad. Las otras cinco páginas del sitio
> (`/meetmini`, `/meetpro`, `/meetvision`, `/index`, `/aboutme`) son páginas reales y
> tendrán sus propias tandas; aquí solo se dejan navegables.

## 1 · Qué se construye

`web/` es hoy una app Next.js 15 (App Router) que sirve tres rutas de API
—`/api/versiones`, `/api/desreclamos`, `/api/desreclamos/solicitar`— y una `page.tsx`
que dice que la web no existe. Esta tanda le da cuerpo:

- **El chasis compartido**: nav, pie, tokens, tipografía y el CSS de movimiento que
  usarán las seis páginas.
- **La landing completa**, con el concepto corregido.
- **Cinco esqueletos navegables** para que ningún enlace del nav dé 404.
- **`/install`**: un script de instalación real, servido por la propia web.

Las tres rutas de API existentes no se tocan.

## 2 · El concepto, y dónde mentía

El concepto es bueno —usa los tokens reales de las apps y su vocabulario visual— pero
afirma cosas que el producto no cumple. La corrección no es cosmética: esto es una
herramienta forense, y `PRODUCT.md` fija «precisión sobre entusiasmo» como tono.

| En el concepto | La realidad | Qué se hace |
|---|---|---|
| `curl -fsSL lumi.sh/install \| sh` | No existe ese script, ni ese dominio, ni forma publicada de obtener el CLI `lumi` | Se construye de verdad (§6) |
| «3 verificadores en línea» en nav y pie | Lumi es autoalojado: no hay flota central que contar | Se sustituye por la última versión publicada, leída del manifiesto |
| «1,2 s · 340 m · 18 % GPU, cifras de referencia sobre RTX 4090» | **No hay un solo benchmark en el repo** | Marcadores visibles (§4), nunca cifras plausibles |
| Mini 1 / Pro 3 / Vision 4 verificadores | `registros/niveles/`: geométricos **1 / 2 / 4**, recuperadores **1 / 4 / 8** | Cifras reales, leídas del registro |
| «cobertura global exacta 0,0000000000 %» | Nada alimentaba ese número | Se alimenta del catálogo real (§5) |

Y lo que faltaba: **los agentes** (12 reales: idioma, lado de conducción, clima, hora por
sombras, topónimos, matrícula, vegetación…), que según `PRODUCT.md` son de lo más
diferenciador frente a GeoSpy y Raven, y no aparecían en ninguna parte.

## 3 · Arquitectura

**Estilos.** Tailwind con los tokens del cliente y el Indexer para maquetar, más un
`globals.css` con el movimiento: keyframes, la curva `ease-expo`, y las transformaciones
3D. Es el mismo reparto que ya hacen las dos apps de escritorio (`jg-fade-rise`,
`jg-press`), no un idioma nuevo. Tailwind no expresa bien una escena 3D con scroll, y
forzarlo produce clases ilegibles.

**Rutas.**

```
app/
  layout.tsx            chasis: nav, pie, tokens, fuentes
  page.tsx              la landing
  install/route.ts      el script de instalación (§6)
  meetmini|meetpro|meetvision|index|aboutme/page.tsx   esqueletos navegables
  api/…                 sin cambios
lib/
  catalogo.ts           agregación del catálogo real (§5)
  niveles.ts            lectura de registros/niveles/
```

**Dos escenas animadas, nunca a la vez.** El concepto tenía tres lienzos animados
simultáneos (órbita del hero, galaxia de modelos, mapa mundial). Se conservan **dos**: la
órbita del hero y el sobrevuelo de la interfaz (§7). La galaxia de modelos y el mapa
mundial pasan a SVG —«la escalera» y el mapa de cobertura—, que además es lo que permite
alimentarlos con datos reales.

La condición para que las dos convivan es que **nunca animen a la vez**: cada escena se
suspende cuando su sección sale del viewport, vía `IntersectionObserver`, y solo entonces
la otra puede correr. No es una optimización opcional; es lo que hace viable tener dos.
En móvil ambas degradan a estático.

## 4 · La landing, sección por sección

**Nav.** Igual que el concepto, con el desplegable de Modelos (que ahora lleva a páginas
reales). El indicador de estado dice la última versión publicada, no verificadores
inventados.

**Hero.** Conserva su escena 3D orbital, suspendida en cuanto sale de pantalla (§3). El
comando de instalación es real y ejecutable.

**Interfaz — el sobrevuelo.** Reemplaza a la «ventana viva» del concepto. Especificado
aparte en §7 porque tiene trampas geométricas concretas.

**Modelos — «la escalera».** Tres columnas comparadas donde cada punto es un modelo real
corriendo dentro, leído de `registros/niveles/`: recuperadores, verificadores geométricos,
agentes, y a qué nivel cae si al servidor le faltan capas (`cae_a`). Se ve de un vistazo
que Vision no es «mejor», es **más**.

Las cifras de rendimiento (latencia, radio, carga de GPU) se muestran como **marcador
visible** —`—`, «pendiente de medir»— y nunca como número plausible. Un `340 m` inventado
es indistinguible de uno medido; con `—` no hay forma de confundirlos. Se rellenan cuando
existan los benchmarks (§8).

**Agentes — «lo que dice la imagen».** Sección nueva. Los 12 agentes de
`registros/agentes/`, con la idea que los gobierna: un agente que no vio suficiente
aparece diciéndolo, no desaparece. Es la misma regla que el cliente aplica en el panel de
hipótesis.

**Cobertura.** Mapa SVG alimentado por el catálogo real (§5), no un canvas con balizas
decorativas.

**Pie.** Enlaces, atribuciones obligatorias y el enlace al código fuente (§9).

## 5 · Los datos del catálogo

El mapa de cobertura y el contador dejan de ser adorno. `lib/catalogo.ts`:

1. Consulta GitHub por repos con el topic **`lumi-index`** (el mismo que fija
   `catalogo::ETIQUETA` en el Indexer).
2. Descarga la `ficha.json` publicada de cada uno.
3. Agrega los quadkeys y aplica `desreclamos.json`, que la web ya posee.

Con **ISR revalidando cada hora** y reutilizando `GITHUB_LIBERACIONES_TOKEN` —ya
configurado para `/api/desreclamos/solicitar`— para no chocar con el límite de 60
peticiones/hora del acceso anónimo, que en Vercel se comparte por IP saliente.

**Si GitHub falla, la sección lo dice.** «Catálogo no disponible», nunca un número
inventado ni una sección que desaparece. Es la misma regla que la matriz de capacidades
del daemon: nada se degrada en silencio.

## 6 · `/install`

El comando del hero anunciaba una vía de distribución inexistente. En vez de suavizar el
texto, se construye la vía: `app/install/route.ts` sirve un script que descarga el binario
`lumi` publicado en GitHub Releases y lo instala en `/usr/local/bin`. A partir de ahí,
`sudo lumi install --version latest` ya funciona hoy.

Esto **cierra un hueco real del producto**, no solo de la web: hoy el CLI `lumi` solo se
obtiene compilando el repo. Depende de un prerrequisito (§8).

## 7 · El sobrevuelo de la interfaz

Validado con maqueta interactiva antes de escribir este spec. Tres tiempos:

1. **Asoma desde abajo.** La interfaz aparece por el borde inferior, tumbada sobre el
   terreno, enorme y en escorzo.
2. **Se aleja.** Recorre el terreno a **velocidad constante** —es un vuelo, no un
   acercamiento con frenada— hasta media distancia.
3. **Se levanta.** Se despega del suelo y gira hasta quedar **de plano y legible**.

**Parámetros que funcionan** (medidos, no estimados): plano a `rotateX(75deg)`, altura de
vuelo 92 px, `perspective: 820px` con origen `50% 42%`. La pieza viaja en el eje local del
plano de `+420` a `−355`; ese `−355` **centra la ventana por geometría**
(`92 + Y·cos75° ≈ 0`), no por ajuste a ojo. El levantamiento ocupa el último 34 % del
scroll. El recorrido total son ~5 200 px de scroll para un marco de 600 px.

**Cuatro trampas que costaron cuatro iteraciones.** Están aquí para que quien implemente
no las repita:

- **Suelo y ventana son planos hermanos con la misma rotación.** Si la ventana cuelga del
  suelo, la máscara del horizonte se la come antes de que llegue.
- **Nada de `rotateZ` de cámara.** El alabeo simula vuelo pilotado, pero ladea la UI, y
  con la ventana acabando de frente se nota de inmediato.
- **Nunca `will-change: opacity` en un ancestro 3D.** Basta declararlo para que el
  navegador trate el elemento como grupo y **anule el `preserve-3d`** de sus hijos: la
  contrarrotación deja de aplicarse y la ventana se queda tumbada.
- **El despegue final es simbólico (26 px).** En un plano a 75°, subir en `translateZ` se
  traduce casi entero en subir *en pantalla*: 210 px sacaban la ventana del cuadro.

**Suavidad.** El valor pintado persigue al del scroll con amortiguación exponencial
(factor 0,062) en un bucle de `requestAnimationFrame`, en vez de mapearse directamente.
Es lo que convierte los escalones de la rueda del ratón en un planeo, y es el cambio que
más se nota de todos.

**`prefers-reduced-motion`.** Se desactiva la amortiguación y la escena queda en un
fotograma estático legible. Ojo: el bloque de `prefers-reduced-motion` del concepto solo
mataba animaciones CSS, y las escenas dirigidas por JS seguían corriendo — el mismo fallo
que el bug #98 del cliente.

## 8 · Prerrequisitos fuera del alcance de la web

1. **Publicar el binario `lumi`.** El pipeline sube `app.exe`, `indexer-app.exe`, `lumid`
   e `installer.exe`; el CLI no. Sin él, `/install` no tiene qué descargar. Es un cambio
   en `tools/release_flow.py`.
2. **Benchmarks** sobre hardware conocido, para sustituir los marcadores de §4 antes de la
   salida oficial.
3. **Limpiar `FUTURO.md`**: sigue diciendo que el repo no tiene `LICENSE` y que eso
   bloquea publicar la web. Es falso desde `68a1997` — el proyecto es AGPL-3.0-or-later.
   Una nota obsoleta que marca como bloqueante algo ya resuelto es peor que ninguna nota.

## 9 · Atribuciones y licencia

En el pie y en la sección de modelos, **obligatorias**:

- **«Built with DINOv3»** — lo exige su licencia, vía RoMa v2. No es opcional.
- **Beck et al. 2018** (mapa de Köppen) — CC BY 4.0, obliga.
- **Natural Earth** — dominio público; se cita por cortesía.

Y **el enlace al código fuente**: la AGPL-3.0 §13 obliga a ofrecerlo a quien interactúe
con el programa por red, y la web es código AGPL del mismo repo.

## 10 · Techos conocidos

- **El catálogo se lee de GitHub, no de un índice propio.** Con muchos repos publicados
  esto se vuelve lento aunque haya ISR. La salida, si duele, es un índice materializado;
  no tiene sentido diseñarlo antes de que el catálogo tenga tamaño.
- **Las cinco páginas internas quedan como esqueletos.** Navegables y con chasis, pero sin
  contenido. Cada una es su propia tanda.
- **El árbol de dependencias dibujado, los perfiles ricos y el criterio de calidad para
  desreclamar** —lo que `FUTURO.md` deja explícitamente para el 9— no entran aquí.
  Dependen de páginas que aún no existen.
