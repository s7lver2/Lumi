# Web de Lumi — chasis y landing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar cuerpo a `web/` — hoy una app Next.js con tres rutas de API y una página que dice que la web no existe — con el chasis compartido, la landing completa y cinco esqueletos navegables, según `docs/superpowers/specs/2026-09-02-web-chasis-y-landing-design.md`.

**Architecture:** Next.js 15 App Router. Tailwind con los tokens del cliente para maquetar, más un `globals.css` con el movimiento (keyframes, `ease-expo`, transformaciones 3D) — el mismo reparto que ya hacen las dos apps de escritorio. Dos escenas 3D (órbita del hero y sobrevuelo de la interfaz) que **nunca animan a la vez**, coordinadas por un `IntersectionObserver` compartido. Los datos que la página enseña salen de fuentes reales: `registros/niveles/`, `registros/agentes/`, `web/releases/versiones.json` y el catálogo publicado en GitHub.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS 3, CSS 3D transforms, GitHub REST API.

**El concepto de partida** está commiteado en `docs/superpowers/specs/2026-09-02-concepto-landing-v6.html` (2 045 líneas, HTML+CSS+JS en un solo fichero). Varias tareas piden portar secciones suyas y citan números de línea de ESE fichero. Es el punto de partida visual, no la verdad: donde el concepto y el spec discrepen, **manda el spec**.

## Global Constraints

- **Sin tests.** `CLAUDE.md`: «No tests unless explicitly requested». Las tareas se verifican con `npm run build`, comprobación de tipos y verificación visual en el navegador. No escribas tests.
- **Español** para copy de interfaz, comentarios de código y mensajes de commit.
- **Tokens exactos** de `client/tailwind.config.ts`: `bg #0e0f11`, `surface #15171a`, `panel #1a1b1e`, `elevated #202226`, `border #26282c`, `muted #9a9a95`, `subtle #6a6c70`, `fg #e8e8e6`, `accent #f2f3f5`, `draw #378add` / `draw-fg #85b7eb`, `warning #ef9f27` / `warning-fg #efb968`, `danger #a33` / `danger-fg #e88f8f`. Radio de tarjeta `12px`. Curva `expo: cubic-bezier(.16,1,.3,1)`.
- **DESIGN.md manda**: solo tema oscuro, nada de verde, tipografía mono para todo lo que produce una máquina (versiones, coordenadas, comandos, quadkeys), iconos SVG dibujados a mano, sin librería de iconos.
- **Ninguna cifra inventada.** Las de rendimiento van como marcador visible (`—`, «pendiente de medir»), nunca como número plausible.
- **Nada desaparece en silencio**: si una fuente de datos falla, la sección lo dice; nunca se oculta ni se rellena con un valor por defecto.
- Un commit por tarea terminada.

---

## Estructura de ficheros

```
web/
  package.json                MOD  + tailwindcss, postcss, autoprefixer
  tailwind.config.ts          NEW  tokens del cliente
  postcss.config.mjs          NEW
  app/
    globals.css               NEW  base, keyframes, ease-expo, utilidades 3D
    layout.tsx                MOD  chasis: nav, pie, fuente, metadatos
    page.tsx                  MOD  la landing
    install/route.ts          NEW  el script de instalación
    meetmini/page.tsx         NEW  esqueleto
    meetpro/page.tsx          NEW  esqueleto
    meetvision/page.tsx       NEW  esqueleto
    index/page.tsx            NEW  esqueleto (indexado)
    aboutme/page.tsx          NEW  esqueleto
    api/                      sin cambios
  components/
    Nav.tsx                   NEW
    Pie.tsx                   NEW
    Esqueleto.tsx             NEW  cuerpo compartido de las 5 páginas pendientes
    HeroOrbita.tsx            NEW  escena 3D 1
    Sobrevuelo.tsx            NEW  escena 3D 2
    Escalera.tsx              NEW  modelos
    Agentes.tsx               NEW
    Cobertura.tsx             NEW  mapa SVG
    usarEscenaViva.ts         NEW  IntersectionObserver + prefers-reduced-motion
  lib/
    version.ts                NEW  última versión publicada
    niveles.ts                NEW  lee registros/niveles/
    agentes.ts                NEW  lee registros/agentes/
    catalogo.ts               NEW  agrega el catálogo publicado
```

**Nota sobre rutas fuera de `web/`:** `lib/niveles.ts` y `lib/agentes.ts` importan JSON de `../../registros/`. Funciona porque Vercel clona el repo entero y el «Root Directory» solo fija el directorio de trabajo; además son importaciones estáticas, así que quedan incrustadas en el bundle en tiempo de compilación. Si alguna vez fallara, el arreglo es un script que copie los registros a `web/generado/`, no duplicarlos a mano.

---

### Task 1 · Chasis de estilos: Tailwind, tokens y CSS de movimiento

**Files:**
- Modify: `web/package.json`
- Create: `web/tailwind.config.ts`
- Create: `web/postcss.config.mjs`
- Create: `web/app/globals.css`
- Modify: `web/app/layout.tsx`

**Produces:** las clases de Tailwind con los tokens de Lumi, la utilidad `ease-expo`, las animaciones `jg-fade-rise` / `jg-core-pulse`, y `globals.css` importado desde el layout.

- [ ] **Paso 1: Añadir dependencias**

```bash
cd web && npm install -D tailwindcss@^3 postcss autoprefixer
```

- [ ] **Paso 2: `web/tailwind.config.ts`**

Copia literal de `client/tailwind.config.ts` cambiando solo `content`:

```ts
import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0e0f11", surface: "#15171a", panel: "#1a1b1e", elevated: "#202226",
        border: "#26282c", muted: "#9a9a95", subtle: "#6a6c70", fg: "#e8e8e6",
        accent: { DEFAULT: "#f2f3f5", fg: "#e8e8e6" },
        draw: { DEFAULT: "#378add", fg: "#85b7eb" },
        warning: { DEFAULT: "#ef9f27", fg: "#efb968" },
        danger: { DEFAULT: "#a33", fg: "#e88f8f" },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { card: "12px" },
      transitionTimingFunction: { expo: "cubic-bezier(.16,1,.3,1)" },
    },
  },
  plugins: [],
};
export default config;
```

- [ ] **Paso 3: `web/postcss.config.mjs`**

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
```

- [ ] **Paso 4: `web/app/globals.css`**

Base más lo que Tailwind no expresa bien. El bloque de movimiento reducido **debe cubrir también las escenas de JS**, no solo CSS — ver Task 9.

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  html { scroll-behavior: smooth; }
  body { @apply bg-bg text-fg font-sans; -webkit-font-smoothing: antialiased; }
  ::selection { background: rgba(255,255,255,.16); }
}

@layer utilities {
  /* Las escenas 3D necesitan esto y Tailwind no lo trae */
  .preserva-3d { transform-style: preserve-3d; }
  .sin-perspectiva-origen { perspective-origin: 50% 42%; }
}

@keyframes jg-fade-rise { from { opacity:0; transform: translateY(18px) } to { opacity:1; transform:none } }
@keyframes jg-core-pulse { 0%,100% { opacity:.45 } 50% { opacity:1 } }
@keyframes jg-mark-spin { to { transform: rotate(360deg) } }

.jg-fade-rise { animation: jg-fade-rise .7s cubic-bezier(.16,1,.3,1) both; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration:.001ms !important; transition-duration:.001ms !important; }
}
```

- [ ] **Paso 5: `web/app/layout.tsx`**

```tsx
import "./globals.css";
import { Nav } from "../components/Nav";
import { Pie } from "../components/Pie";

export const metadata = {
  title: "Lumi Station · geolocalización de imágenes por inferencia",
  description:
    "Herramienta de geolocalización de imágenes por inferencia, de código abierto y autoalojada. Tus imágenes y tus GPUs no salen de tu servidor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <Nav />
        {children}
        <Pie />
      </body>
    </html>
  );
}
```

Esto no compila hasta la Task 2 (`Nav`/`Pie` aún no existen): es correcto, se cierra ahí.

- [ ] **Paso 6: Commit**

```bash
git add web/package.json web/package-lock.json web/tailwind.config.ts web/postcss.config.mjs web/app/globals.css web/app/layout.tsx
git commit -m "feat(web): chasis de estilos con los tokens de las apps y el css de movimiento"
```

---

### Task 2 · Nav, pie y los cinco esqueletos navegables

**Files:**
- Create: `web/lib/version.ts`
- Create: `web/components/Nav.tsx`
- Create: `web/components/Pie.tsx`
- Create: `web/components/Esqueleto.tsx`
- Create: `web/app/{meetmini,meetpro,meetvision,index,aboutme}/page.tsx`

**Consumes:** los tokens y `globals.css` de la Task 1.
**Produces:** `ultimaVersion(): { version: string; publicado: string } | null`, los componentes `<Nav/>`, `<Pie/>` y `<Esqueleto titulo="" nota=""/>`.

- [ ] **Paso 1: `web/lib/version.ts`**

El indicador del nav sustituye al «3 verificadores en línea» del concepto, que implicaba una flota central inexistente. Esto sí es cierto: sale del manifiesto firmado que la web ya sirve.

```ts
import manifiesto from "../releases/versiones.json";

type Publicacion = { producto: string; version: string; publicado: string; retirada?: boolean };

/** La publicación de `cliente` más reciente y no retirada. `null` si no hay
 *  ninguna — en ese caso el nav no enseña indicador, no enseña un cero. */
export function ultimaVersion(): { version: string; publicado: string } | null {
  const pubs = (manifiesto.publicaciones ?? []) as Publicacion[];
  const validas = pubs.filter((p) => p.producto === "cliente" && !p.retirada);
  if (validas.length === 0) return null;
  const ultima = validas.reduce((a, b) => (a.publicado > b.publicado ? a : b));
  return { version: ultima.version, publicado: ultima.publicado };
}
```

- [ ] **Paso 2: `web/components/Nav.tsx`**

Porta el nav del concepto (`lumi-landing-v6.html`, líneas 612-646): marca giratoria, desplegable de Modelos con los tres anillos SVG, y barra de progreso de scroll. Cambios obligatorios respecto al concepto:

- El indicador pasa a `v{version} · publicada` en tipografía mono, desde `ultimaVersion()`. Si es `null`, no se renderiza el indicador.
- El desplegable enlaza a `/meetmini`, `/meetpro`, `/meetvision`, que ahora existen.
- Los anillos concéntricos del desplegable son la firma visual de los tres niveles: Mini un anillo (`#378add`), Pro dos (`#efb968`), Vision tres (`#f2f3f5`). Reutiliza los SVG del concepto tal cual.

Es un componente de cliente (`"use client"`) por el scroll y el desplegable.

- [ ] **Paso 3: `web/components/Pie.tsx`**

Porta el pie del concepto (líneas 916-937) y **añade el bloque legal**, que es obligatorio:

```tsx
<div className="mt-8 border-t border-border pt-6 text-[11px] leading-relaxed text-subtle">
  <p>Built with DINOv3.</p>
  <p>
    Mapa de Köppen a partir de Beck et al. 2018,{" "}
    <a className="text-muted hover:text-fg" href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>.
    Fronteras de Natural Earth (dominio público).
  </p>
  <p>
    Lumi es software libre bajo{" "}
    <a className="text-muted hover:text-fg" href="https://github.com/s7lver2/Lumi/blob/main/LICENSE">AGPL-3.0-or-later</a>.{" "}
    <a className="text-muted hover:text-fg" href="https://github.com/s7lver2/Lumi">Código fuente</a>.
  </p>
</div>
```

Las dos primeras líneas las **exigen** las licencias de DINOv3 y de Köppen; la tercera la exige la AGPL §13, porque la propia web es código AGPL servido por red.

- [ ] **Paso 4: `web/components/Esqueleto.tsx`**

```tsx
export function Esqueleto({ titulo, nota }: { titulo: string; nota: string }) {
  return (
    <main className="mx-auto max-w-[1180px] px-7 pb-24 pt-32">
      <h1 className="text-[clamp(26px,3.4vw,38px)] font-semibold tracking-tight">{titulo}</h1>
      <p className="mt-3 max-w-[62ch] leading-relaxed text-muted">{nota}</p>
      <p className="mt-8 font-mono text-[11px] text-subtle">esta página todavía no tiene contenido</p>
    </main>
  );
}
```

Dice que está vacía en vez de fingir que no lo está — misma regla que la matriz de capacidades del daemon.

- [ ] **Paso 5: Las cinco páginas**

Cada una es tres líneas. Ejemplo de `web/app/meetmini/page.tsx`:

```tsx
import { Esqueleto } from "../../components/Esqueleto";

export default function Page() {
  return <Esqueleto titulo="Lumi Mini" nota="Un recuperador y un verificador geométrico. El primero en responder, no el más exigente." />;
}
```

Las otras cuatro, con los mismos títulos y notas que usa el nav del concepto: `meetpro` («Lumi Pro»), `meetvision` («Lumi Vision»), `index` («Indexado»), `aboutme` («Sobre mí»).

- [ ] **Paso 6: Verificar**

```bash
cd web && npm run build
```
Esperado: compila sin errores y lista las 6 rutas más las 3 de API.

- [ ] **Paso 7: Commit**

```bash
git add web/lib/version.ts web/components web/app/meetmini web/app/meetpro web/app/meetvision web/app/index web/app/aboutme
git commit -m "feat(web): nav con la version publicada real, pie con las atribuciones obligatorias y esqueletos navegables"
```

---

### Task 3 · `/install`, la vía de distribución que faltaba

**Files:**
- Create: `web/app/install/route.ts`

**Produces:** `GET /install` devolviendo un script `sh` ejecutable.

El comando del hero anunciaba `curl -fsSL lumi.sh/install | sh`, que no existía: ni script, ni dominio, ni forma publicada de obtener el CLI `lumi`. Esta tarea lo construye de verdad.

- [ ] **Paso 1: `web/app/install/route.ts`**

```ts
const REPO = "s7lver2/Lumi";

/** Script de instalación del CLI `lumi`. Se sirve como texto plano para que
 *  `curl … | sh` funcione. No instala el daemon: eso lo hace después
 *  `sudo lumi install --version latest`, que ya existe. */
const SCRIPT = `#!/bin/sh
set -eu

REPO="${REPO}"
DESTINO="\${DESTINO:-/usr/local/bin}"

echo "Descargando el CLI de Lumi…"
URL="https://github.com/\${REPO}/releases/latest/download/lumi"
TMP="$(mktemp)"
curl -fsSL "\$URL" -o "\$TMP"
chmod +x "\$TMP"

if [ -w "\$DESTINO" ]; then
  mv "\$TMP" "\$DESTINO/lumi"
else
  echo "Hace falta sudo para escribir en \$DESTINO"
  sudo mv "\$TMP" "\$DESTINO/lumi"
fi

echo "Listo: \$(\$DESTINO/lumi --version)"
echo
echo "Ahora, para instalar el servidor:"
echo "  sudo lumi install --version latest -y"
`;

export async function GET() {
  return new Response(SCRIPT, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}
```

- [ ] **Paso 2: Verificar**

```bash
cd web && npm run dev &
sleep 6 && curl -fsS http://localhost:3000/install | head -5
```
Esperado: las primeras líneas del script, empezando por `#!/bin/sh`.

- [ ] **Paso 3: Commit**

```bash
git add web/app/install/route.ts
git commit -m "feat(web): /install sirve el script de instalacion del CLI, la via de distribucion que faltaba"
```

**Prerrequisito conocido:** el binario `lumi` **no se publica hoy** en las releases (`tools/release_flow.py` sube `app.exe`, `indexer-app.exe`, `lumid` e `installer.exe`). Hasta que se añada, este script descargará un 404. Está anotado en §8 del spec; no es trabajo de esta tanda.

---

### Task 4 · El coordinador de escenas y el hero

**Files:**
- Create: `web/components/usarEscenaViva.ts`
- Create: `web/components/HeroOrbita.tsx`
- Modify: `web/app/page.tsx`

**Consumes:** tokens de la Task 1.
**Produces:** `usarEscenaViva(ref): { viva: boolean; reducido: boolean }` — usado también por la Task 5.

Las dos escenas 3D **nunca animan a la vez**. Esto no es una optimización opcional: es la condición que hace viable tener dos.

- [ ] **Paso 1: `web/components/usarEscenaViva.ts`**

```ts
"use client";
import { useEffect, useState, type RefObject } from "react";

/** `viva` = la sección está en pantalla y toca animar. `reducido` = el usuario
 *  pidió menos movimiento, así que la escena debe quedarse en un fotograma
 *  legible en vez de correr su bucle. Ojo: el bloque CSS de
 *  prefers-reduced-motion NO detiene un bucle de requestAnimationFrame — hay
 *  que mirarlo aquí a mano (mismo fallo que el bug #98 del cliente). */
export function usarEscenaViva(ref: RefObject<HTMLElement | null>) {
  const [viva, setViva] = useState(false);
  const [reducido, setReducido] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const sinc = () => setReducido(mq.matches);
    sinc();
    mq.addEventListener("change", sinc);
    return () => mq.removeEventListener("change", sinc);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([e]) => setViva(e.isIntersecting),
      { rootMargin: "10% 0px" },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [ref]);

  return { viva, reducido };
}
```

- [ ] **Paso 2: `web/components/HeroOrbita.tsx`**

Porta la escena `hero3d` del concepto (canvas + HUD, líneas 649-690). Requisitos:

- El bucle de `requestAnimationFrame` **solo corre si `viva && !reducido`**. Con `reducido`, pinta un fotograma y para.
- El HUD en mono, sin el «MODELOS EN ÓRBITA 3» del concepto si no corresponde a nada real: enseña el estado de la escena, no una cifra de producto.
- En pantallas `< 768px`, no arranca el canvas: pinta el fotograma estático.

- [ ] **Paso 3: El hero en `web/app/page.tsx`**

Titular y entradilla del concepto (líneas 658-667), y el bloque del comando con el **comando real**:

```tsx
<code className="font-mono text-[13px]">curl -fsSL lumi.s7lver.xyz/install<span className="text-subtle"> | sh</span></code>
```

Con el botón de copiar del concepto. El pie del bloque mantiene «se autoaloja en tu propio servidor — sin cuentas, sin nube de terceros», que sí es cierto.

- [ ] **Paso 4: Verificar**

```bash
cd web && npm run build
```
Y en el navegador: la órbita anima al cargar, y deja de animar al hacer scroll hasta sacarla de pantalla (compruébalo poniendo un `console.count` temporal en el bucle, y quítalo después).

- [ ] **Paso 5: Commit**

```bash
git add web/components/usarEscenaViva.ts web/components/HeroOrbita.tsx web/app/page.tsx
git commit -m "feat(web): hero con la orbita 3d, suspendida cuando su seccion sale de pantalla"
```

---

### Task 5 · El sobrevuelo de la interfaz

**Files:**
- Create: `web/components/Sobrevuelo.tsx`
- Modify: `web/app/page.tsx`

**Consumes:** `usarEscenaViva` de la Task 4.

Validado con maqueta interactiva antes de escribir el spec. **Los parámetros de abajo están medidos, no estimados: úsalos tal cual.** Las cuatro trampas costaron cuatro iteraciones — leerlas antes de escribir código ahorra repetirlas.

- [ ] **Paso 1: Leer las cuatro trampas**

1. **Suelo y ventana son planos hermanos con la misma rotación.** Si la ventana cuelga del suelo, la máscara del horizonte se la come antes de que llegue a verse.
2. **Nada de `rotateZ` de cámara.** Ladea la UI, y con la ventana acabando de frente se nota de inmediato.
3. **Nunca `will-change: opacity` en un ancestro 3D.** Basta declararlo para que el navegador trate el elemento como grupo y **anule el `preserve-3d`** de sus hijos: la contrarrotación deja de aplicarse y la ventana se queda tumbada.
4. **El despegue final es simbólico (26 px).** En un plano a 75°, subir en `translateZ` se traduce casi entero en subir en pantalla: 210 px sacaban la ventana del cuadro.

- [ ] **Paso 2: La estructura**

```
.mundo            perspective: 820px; perspective-origin: 50% 42%
  .camara         solo translateX (deriva). preserve-3d. NUNCA rotateZ
    .suelo        translateY(92px) rotateX(75deg). Lleva la máscara del horizonte
    .carril       translateY(92px) rotateX(75deg). preserve-3d. SIN máscara
      .pieza      translateY(Y) translateZ(alza). preserve-3d
        .sombra   se queda tumbada: no entra en .giro
        .giro     rotateX(rot). transform-origin: 50% 50%
          .ventana
```

- [ ] **Paso 3: La animación**

```ts
const TUMBE = 75, DESDE = 420, HASTA = -355, FIN_VIAJE = 0.66;

function pintar(p: number) {
  let y: number, alza: number, rot: number, opSombra: number, opSuelo: number;
  if (p < FIN_VIAJE) {
    const v = p / FIN_VIAJE;                    // velocidad constante: es un vuelo
    y = DESDE + (HASTA - DESDE) * v;
    alza = 0; rot = 0;
    opSombra = Math.min(1, v * 3); opSuelo = 1;
  } else {
    const s = 1 - Math.pow(1 - (p - FIN_VIAJE) / (1 - FIN_VIAJE), 3);  // ease-out
    y = HASTA;
    alza = 26 * s;                              // simbólico: ver trampa 4
    rot = -TUMBE * s;                           // contrarrota el tumbe → de frente
    opSombra = 1 - s; opSuelo = 1 - s * 0.85;
  }
  // …aplicar a los nodos
}
```

`HASTA = -355` **centra la ventana por geometría** (`92 + Y·cos75° ≈ 0`), no por ajuste a ojo. No lo toques sin recalcular.

- [ ] **Paso 4: La suavidad**

El valor pintado persigue al del scroll con amortiguación exponencial en un bucle de `requestAnimationFrame`, en vez de mapearse directamente. Es lo que convierte los escalones de la rueda del ratón en un planeo, y es el cambio que más se nota:

```ts
function bucle() {
  const d = objetivo - suave;
  if (Math.abs(d) < 0.00025) { suave = objetivo; pintar(suave); vivo = false; return; }
  suave += d * 0.062;
  pintar(suave);
  requestAnimationFrame(bucle);
}
```

Con `reducido`, salta la amortiguación: `suave = objetivo` y pinta directo.

- [ ] **Paso 5: El contenido de la ventana**

Una maqueta de la interfaz real de Lumi: barra de título con la estrella, barra lateral de proyectos, mapa con un círculo de resultado y su ficha de coordenadas en mono, y tira de miniaturas con estados (resuelta / en curso / en cola). Es una ilustración, no una captura: no debe afirmar cifras que no sean verosímiles como ejemplo.

- [ ] **Paso 6: Verificar en el navegador**

Comprueba los tres momentos: (a) asoma por abajo tumbada, (b) a media distancia sobre el terreno, (c) al final **de plano y legible**. La comprobación fiable de (c) es que la proporción en pantalla coincida con la nativa — si está aplastada, has caído en la trampa 3.

- [ ] **Paso 7: Commit**

```bash
git add web/components/Sobrevuelo.tsx web/app/page.tsx
git commit -m "feat(web): sobrevuelo de la interfaz, con los parametros medidos en la maqueta"
```

---

### Task 6 · Modelos: «la escalera»

**Files:**
- Create: `web/lib/niveles.ts`
- Create: `web/components/Escalera.tsx`
- Modify: `web/app/page.tsx`

**Produces:** `niveles(): Nivel[]` con `{ id, nombre, recuperacion: string[], geometricos: string[], agentes: string[], cae_a: string | null }`.

- [ ] **Paso 1: `web/lib/niveles.ts`**

```ts
import mini from "../../registros/niveles/mini.json";
import pro from "../../registros/niveles/pro.json";
import vision from "../../registros/niveles/vision.json";

export type Nivel = {
  id: string; nombre: string;
  recuperacion: string[]; geometricos: string[]; agentes: string[];
  cae_a: string | null;
};

/** Los tres niveles, en orden de menos a más. Salen del registro, así que la
 *  página no puede desincronizarse de lo que el servidor ejecuta de verdad. */
export function niveles(): Nivel[] {
  return [mini, pro, vision] as Nivel[];
}
```

- [ ] **Paso 2: `web/components/Escalera.tsx`**

Tres columnas comparadas. Cada punto es un modelo real:

| fila | Mini | Pro | Vision |
|---|---|---|---|
| recuperan | 1 | 4 | 8 |
| verifican | 1 | 2 | 4 |
| agentes | 4 | 10 | hereda los de Pro |
| si faltan capas | no cae | → Mini | → Pro |

Los conteos salen de `niveles()`, **nunca escritos a mano**. Vision tiene `agentes: []` en el registro y `cae_a: "pro"`: eso se enseña como «hereda los de Pro», que es lo que significa, no como un cero.

Colores por nivel: Mini `draw` (`#378add`), Pro `warning-fg` (`#efb968`), Vision `accent` (`#f2f3f5`).

Y las cifras de rendimiento, **como marcador visible**:

```tsx
<div className="font-mono text-[11px] text-subtle">—</div>
<div className="text-[9.5px] text-subtle">latencia · pendiente de medir</div>
```

Un `340 m` inventado es indistinguible de uno medido; con `—` no hay forma de confundirlos.

- [ ] **Paso 3: Verificar**

En el navegador: los conteos coinciden con `registros/niveles/*.json` (1/1, 4/2, 8/4) y no hay ninguna cifra de rendimiento con aspecto de real.

- [ ] **Paso 4: Commit**

```bash
git add web/lib/niveles.ts web/components/Escalera.tsx web/app/page.tsx
git commit -m "feat(web): seccion de modelos con la composicion real de cada nivel y marcadores en vez de cifras inventadas"
```

---

### Task 7 · Agentes: «lo que dice la imagen»

**Files:**
- Create: `web/lib/agentes.ts`
- Create: `web/components/Agentes.tsx`
- Modify: `web/app/page.tsx`

**Produces:** `agentes(): Agente[]` con `{ id, nombre, tipo, restriccion }`.

Sección nueva: no estaba en el concepto, y según `PRODUCT.md` es de lo más diferenciador frente a GeoSpy y Raven.

- [ ] **Paso 1: `web/lib/agentes.ts`**

Importa los doce JSON de `../../registros/agentes/`: `clima-aparente`, `dimensiones`, `escena`, `estacion`, `hora-sombras`, `idioma`, `lado-conduccion`, `matricula`, `meteorologia`, `senalizacion`, `toponimos`, `vegetacion`.

```ts
export type Agente = { id: string; nombre: string; tipo: string; restriccion?: string };
export function agentes(): Agente[] { /* devuelve los doce, ordenados por nombre */ }
```

- [ ] **Paso 2: `web/components/Agentes.tsx`**

Rejilla con los doce, cada uno con su `nombre` y una marca de si **filtra** o solo **describe** (campo `tipo`). Y el principio que los gobierna, que es la parte que de verdad diferencia:

> Un agente que no vio suficiente aparece diciéndolo, no desaparece — hay que poder distinguir «no hay carteles» de «no se lo preguntamos».

- [ ] **Paso 3: Verificar** — los doce aparecen y los nombres coinciden con el registro.

- [ ] **Paso 4: Commit**

```bash
git add web/lib/agentes.ts web/components/Agentes.tsx web/app/page.tsx
git commit -m "feat(web): seccion de agentes, lo que dice la imagen"
```

---

### Task 8 · Cobertura con el catálogo real

**Files:**
- Create: `web/lib/catalogo.ts`
- Create: `web/components/Cobertura.tsx`
- Modify: `web/app/page.tsx`

**Produces:** `cobertura(): Promise<{ quadkeys: string[]; paquetes: number; autores: number } | null>`.

El mapa deja de ser adorno: enseña lo que de verdad hay publicado.

- [ ] **Paso 1: `web/lib/catalogo.ts`**

```ts
import desreclamos from "../releases/desreclamos.json";

const ETIQUETA = "lumi-index";   // el mismo topic que fija catalogo::ETIQUETA en el Indexer

type Resumen = { quadkeys: string[]; paquetes: number; autores: number };

/** Agrega el catálogo publicado: repos con el topic `lumi-index`, sus fichas,
 *  y los desreclamos que esta misma web firma. Devuelve `null` si GitHub no
 *  responde — la sección lo dice, nunca inventa un número. */
export async function cobertura(): Promise<Resumen | null> {
  const cabeceras: Record<string, string> = { accept: "application/vnd.github+json" };
  if (process.env.GITHUB_LIBERACIONES_TOKEN) {
    cabeceras.authorization = `Bearer ${process.env.GITHUB_LIBERACIONES_TOKEN}`;
  }
  try {
    const busqueda = await fetch(
      `https://api.github.com/search/repositories?q=topic:${ETIQUETA}&per_page=100`,
      { headers: cabeceras, next: { revalidate: 3600 } },
    );
    if (!busqueda.ok) return null;
    const repos = ((await busqueda.json()).items ?? []) as { full_name: string }[];

    // Los paquetes retirados por la web no cuentan como cobertura.
    const retirados = new Set(
      ((desreclamos as { lista?: [string, string][] }).lista ?? []).map(([paquete]) => paquete),
    );

    const quadkeys = new Set<string>();
    const autores = new Set<string>();
    let paquetes = 0;

    for (const repo of repos) {
      // La ficha viaja en claro como asset del release más reciente.
      const rel = await fetch(
        `https://api.github.com/repos/${repo.full_name}/releases/latest`,
        { headers: cabeceras, next: { revalidate: 3600 } },
      );
      if (!rel.ok) continue;
      const assets = ((await rel.json()).assets ?? []) as { name: string; browser_download_url: string }[];
      const ficha = assets.find((a) => a.name === "ficha.json");
      if (!ficha) continue;

      const fr = await fetch(ficha.browser_download_url, { next: { revalidate: 3600 } });
      if (!fr.ok) continue;
      const f = (await fr.json()) as {
        paquete: string; autor: string; fuentes_por_quadkey: [string, string[]][];
      };
      if (retirados.has(f.paquete)) continue;

      paquetes += 1;
      autores.add(f.autor);
      for (const [qk] of f.fuentes_por_quadkey ?? []) quadkeys.add(qk);
    }

    return { quadkeys: [...quadkeys], paquetes, autores: autores.size };
  } catch {
    return null;
  }
}
```

**El token no es opcional por capricho:** sin él, GitHub limita a 60 peticiones/hora por IP saliente, y en Vercel esa IP se comparte. `GITHUB_LIBERACIONES_TOKEN` ya está configurado para `/api/desreclamos/solicitar`.

Revalidación de una hora vía `next: { revalidate: 3600 }`.

- [ ] **Paso 2: `web/components/Cobertura.tsx`**

Mapa SVG del mundo (no canvas animado: la Task 4 y la 5 ya se llevan el presupuesto de animación). Cada quadkey se convierte a lat/lng y se pinta como una baliza. La leyenda del concepto se mantiene, pero ahora es cierta.

Y el estado de fallo, obligatorio:

```tsx
{resumen === null && (
  <p className="font-mono text-[11px] text-warning-fg">
    catálogo no disponible — no se pudo consultar GitHub
  </p>
)}
```

Nunca un cero, nunca una sección que desaparece.

- [ ] **Paso 3: Verificar** — con red, salen balizas y conteos; simulando fallo (token inválido a propósito), sale el aviso y **no** un cero.

- [ ] **Paso 4: Commit**

```bash
git add web/lib/catalogo.ts web/components/Cobertura.tsx web/app/page.tsx
git commit -m "feat(web): mapa de cobertura alimentado por el catalogo real, con estado explicito si github falla"
```

---

### Task 9 · Responsive, movimiento reducido y cierre

**Files:**
- Modify: `web/components/HeroOrbita.tsx`, `web/components/Sobrevuelo.tsx`
- Modify: `web/app/page.tsx`

- [ ] **Paso 1: Móvil** — por debajo de 768px, ninguna de las dos escenas 3D arranca su bucle: ambas pintan un fotograma estático legible. El sobrevuelo, además, deja de secuestrar el scroll.

- [ ] **Paso 2: Movimiento reducido** — verifica con las DevTools (Rendering → «Emulate prefers-reduced-motion») que **ningún bucle de `requestAnimationFrame` sigue corriendo**. El bloque CSS de `globals.css` no basta: solo mata animaciones CSS, y ese fue exactamente el bug #98 del cliente.

- [ ] **Paso 3: Verificación final**

```bash
cd web && npm run build
```
Esperado: compila sin errores ni avisos nuevos.

- [ ] **Paso 4: Commit**

```bash
git add web/components web/app/page.tsx
git commit -m "feat(web): degradado en movil y respeto real a prefers-reduced-motion en las dos escenas"
```

---

## Fuera de alcance

Anotado en §8 y §10 del spec, no se toca aquí: publicar el binario `lumi` en las releases (sin él `/install` descarga un 404), los benchmarks que sustituyan los marcadores, limpiar la nota obsoleta de `FUTURO.md` sobre el `LICENSE`, y el contenido de las cinco páginas internas.
