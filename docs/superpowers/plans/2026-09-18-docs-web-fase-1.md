# Documentación técnica en la web — Fase 1 (el chasis) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el chasis completo de `/docs` en `web/` (Next.js 15, App Router): ruta, layout de
tres columnas, árbol de navegación, sistema de página MDX, los cuatro grupos de "detalle" del spec,
buscador `⌘K`, y los cinco esquemas animados del núcleo — con las seis páginas mínimas para
estrenarlos: «el viaje de una foto», «recuperación: los candidatos», «verificación: la geometría»,
«agentes: lo que se ve en la foto», «el veredicto y su confianza» y «RoMa».

**Architecture:** Cada página es un fichero `page.mdx` estático bajo `web/app/docs/<rama>/<pagina>/`
(sin ruta dinámica). Un script de Node (`web/scripts/indice-docs.mjs`) recorre esos `.mdx` en
`predev`/`prebuild`, genera `web/lib/indiceDocs.json` (buscador, previsualizaciones, anterior/
siguiente, procedencia) y `web/lib/registrosDocs.generated.json` (copia aplanada de los campos de
`registros/**/*.json` que necesitan `<Ficha>` y `<Dato>`), y falla el build si falta la frase de
apertura de una página, si un `<Tec id>` no resuelve, o si una ruta del árbol sin marcar "pendiente"
no tiene su `.mdx`. En tiempo de ejecución del sitio nada sale de `web/`: todo lo que necesita datos
de `registros/` los lee de esos dos ficheros generados, no del disco.

**Tech Stack:** Next.js 15 (App Router) + React 19 + TypeScript + Tailwind, `@next/mdx` (y sus
`@mdx-js/*`, la única dependencia nueva) para renderizar `.mdx` de forma nativa. Sin librerías de
iconos, sin librería de animación: CSS + `IntersectionObserver` + estado de React.

## Global Constraints

- Español en código, specs, comentarios y todo el contenido de las páginas.
- Un commit por tarea terminada (cada tarea de este plan es una entrega autocontenida).
- Sin tests salvo que se pidan explícitamente — no añadir ninguno.
- ponytail: la solución más simple que funcione; cualquier simplificación deliberada lleva un
  comentario `// ponytail:` explicando el techo al que llegó y el camino de salida.
- Tema oscuro único, sin verde en ningún sitio, mono (`font-mono`, ya mapeado a la pila
  `ui-monospace,SFMono-Regular,Menlo,monospace` en `web/tailwind.config.ts`) para todo dato de
  máquina: IPs, puertos, huellas, rutas de fichero, timestamps, cifras de registro.
- Iconos SVG a mano: `viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`,
  `strokeLinecap="round"`, `strokeLinejoin="round"`, `strokeWidth` 1.6–2.0 que no adelgaza al
  crecer. Nunca librería de iconos.
- Prohibido: iconos en cajitas de color, gradientes morado-azul, texto con gradiente, botones
  pastilla con glow, tarjetas apiladas o anidadas, rejillas de tarjetas idénticas icono+título+texto,
  bordes laterales de color como acento, cualquier color fuera de la tabla de `DESIGN.md`.
- Sin librerías de animación nuevas (no `framer-motion`, no GSAP): CSS + `cubic-bezier(.16,1,.3,1)` /
  `cubic-bezier(.22,1,.36,1)`, respetando siempre `prefers-reduced-motion` (ya cubierto de forma
  global por la regla en `web/app/globals.css:137-142`, que reduce toda `animation-duration` y
  `transition-duration` a `.001ms` — los esquemas de este plan usan animación CSS pura y no
  necesitan lógica adicional para cumplir esa condición).
- Ancho de lectura de `/docs`: 640px (no 720, que es el de las páginas de nivel).
- Fuera de alcance de esta fase (NO TOCAR): las ramas «Empezar», «Indexar territorio» y «El repo por
  dentro» más allá de declararlas en el árbol como pendientes; cualquier otra página de «Cómo
  funciona» o «Las tecnologías» que no sea una de las seis nombradas arriba; los cinco esquemas de
  segunda tanda; la mudanza de `ARCHITECTURE.md`.

## Decisiones de ambigüedades del spec (resueltas aquí, no las reabras)

1. **Cifras de esquema que son constantes de Rust (§2 vs §4).** El spec dice en §2 que valores como
   `limit=200` o el puerto 7717 quedan fuera de `<Dato>` porque extraerlos de Rust en build sería un
   analizador propio; su garantía es el aviso de página envejecida, no un enlace vivo. §4 dice que
   "los que muestran cifras las leen del registro, no las llevan escritas". Estas dos reglas
   conviven así: una cifra de esquema que **sí** existe en `registros/**/*.json` (p. ej. `dims` de un
   modelo) se lee con `<Dato>`/`campoRegistro()`; una cifra que es una constante del código Rust
   (`limit=200`, `hnsw_ef=128`, el puerto) se escribe en prosa protegida solo por el aviso de
   envejecimiento — igual que hace el propio mockup en la sección 2 (200/z14 sin `<Dato>`).
2. **"Ficheros adicionales" de la ficha (§5).** El campo lo describe el spec pero ningún registro
   actual (`registros/verificadores/roma.json` incluido) tiene un campo estructurado para "segundo
   fichero" — el caso de RoMa+DINOv2 solo está descrito en prosa dentro de `licencia_texto`. La
   `<Ficha>` de esta fase renderiza únicamente los campos que el JSON del registro trae de verdad
   (tipo, licencia, fichero de pesos, huella, estado) y omite la fila "ficheros adicionales" cuando
   el registro no declara ninguno; la relación con el backbone se explica en la prosa de la página,
   no en un campo inventado.
3. **Permalinks de encabezado sin dependencia nueva.** El spec limita la dependencia nueva a
   `@next/mdx`. En vez de añadir `rehype-slug`, los encabezados `##`/`###` se interceptan vía
   `useMDXComponents` (mecanismo nativo de `@next/mdx`) con un componente `EncabezadoDocs` que
   calcula su propio `id` con una función `slugificar()` compartida — sin plugin remark/rehype
   adicional.
4. **TOC ("índice de la página") sin duplicar contenido en el índice de build.** En vez de que
   `indice-docs.mjs` calcule y publique los encabezados para el TOC de cada página (el spec sí pide
   que los guarde para el buscador, y eso se mantiene), el componente de TOC en pantalla
   (`IndicePagina`) los lee directamente del DOM ya renderizado con `document.querySelectorAll` +
   `IntersectionObserver` — más simple que sincronizar dos fuentes, y el resultado visual es
   idéntico.
5. **Breakpoint móvil de 900px.** Tailwind no trae ese breakpoint por defecto; se usa la sintaxis de
   valor arbitrario de Tailwind (`min-[900px]:`) en vez de añadir uno a `tailwind.config.ts`, para no
   tocar tokens compartidos con el resto del sitio.

---

### Task 1: Dependencia MDX, árbol de navegación y configuración base

**Files:**
- Modify: `web/package.json`
- Modify: `web/next.config.mjs`
- Create: `web/mdx-components.tsx`
- Create: `web/lib/arbolDocs.ts`
- Create: `web/lib/slug.ts`

**Interfaces:**
- Produces: `arbolDocs: RamaArbol[]`, `ramaDeRuta(idRama: string): RamaArbol | undefined`,
  `paginaDeRuta(idRama: string, ruta: string): PaginaArbol | undefined`,
  `siguienteYAnterior(idRama: string, ruta: string): { anterior: PaginaArbol | null; siguiente: PaginaArbol | null }`
  desde `web/lib/arbolDocs.ts`, tipos `RamaArbol`, `PaginaArbol` exportados desde el mismo fichero.
- Produces: `slugificar(texto: string): string` desde `web/lib/slug.ts`.

- [ ] **Step 1: Instalar `@next/mdx`**

Desde `web/`:

```bash
cd web && npm install @next/mdx @mdx-js/loader @mdx-js/react
```

Esto añade las tres entradas a `dependencies` en `web/package.json`. No instales nada más.

- [ ] **Step 2: Configurar `next.config.mjs` para reconocer `.mdx`**

Reemplaza el contenido completo de `web/next.config.mjs` por:

```js
import createMDX from "@next/mdx";

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // ponytail: una carpeta de ruta llamada literalmente "index" choca con la
  // clave interna que Next.js usa para la página raíz y rompe el build
  // (`Expected clientReferenceManifest to be defined`, confirmado en
  // build local con Next 15.5.24). La página vive en app/indexado/ y esta
  // reescritura mantiene la URL pública /index que pide el nav y el spec.
  async rewrites() {
    return [{ source: "/index", destination: "/indexado" }];
  },
};

const withMDX = createMDX({});

export default withMDX(nextConfig);
```

- [ ] **Step 3: Crear `web/mdx-components.tsx`**

`@next/mdx` requiere este fichero en la raíz del proyecto Next (junto a `next.config.mjs`) para
mapear elementos Markdown a componentes React. De momento solo declara el tipo; el mapeo de `h2`/
`h3` a `EncabezadoDocs` se añade en la Tarea 7, cuando ese componente exista.

```tsx
import type { MDXComponents } from "mdx/types";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
  };
}
```

- [ ] **Step 4: Crear `web/lib/slug.ts`**

```ts
/** Convierte un texto de encabezado en un id de ancla estable: minúsculas,
 *  sin acentos, espacios y símbolos a guiones. Usada tanto por
 *  `EncabezadoDocs` (para poner el id real en el DOM) como por
 *  `scripts/indice-docs.mjs` (para que el índice del buscador enlace al
 *  mismo id) — dos usos, una sola definición de qué es un slug válido. */
export function slugificar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}
```

- [ ] **Step 5: Crear `web/lib/arbolDocs.ts`**

Fuente de verdad del árbol de navegación, escrita a mano (no deducida de carpetas — ver spec §2). Las
`paginas` marcadas `pendiente: true` no tienen `.mdx` todavía; el script de la Tarea 4 falla el build
si una página con `pendiente: false` no tiene fichero.

```ts
export type PaginaArbol = {
  titulo: string;
  /** Slug dentro de la rama, ej. "el-viaje-de-una-foto". La ruta completa es
   *  `/docs/<rama.id>/<pagina.ruta>`. */
  ruta: string;
  pendiente: boolean;
};

export type RamaArbol = {
  id: string;
  titulo: string;
  /** Nombre del glifo de trazo dibujado a mano en `GlifoRama.tsx`. */
  glifo: "camino" | "engranaje" | "llave" | "mapa" | "caja";
  paginas: PaginaArbol[];
};

export const arbolDocs: RamaArbol[] = [
  {
    id: "como-funciona",
    titulo: "Cómo funciona",
    glifo: "camino",
    paginas: [
      { titulo: "De qué va todo esto", ruta: "de-que-va-todo-esto", pendiente: true },
      { titulo: "El viaje de una foto", ruta: "el-viaje-de-una-foto", pendiente: false },
      { titulo: "El índice y la cobertura", ruta: "indice-y-cobertura", pendiente: true },
      { titulo: "Recuperación: los candidatos", ruta: "recuperacion", pendiente: false },
      { titulo: "Verificación: la geometría", ruta: "verificacion", pendiente: false },
      { titulo: "Agentes: lo que se ve en la foto", ruta: "agentes", pendiente: false },
      { titulo: "El veredicto y su confianza", ruta: "veredicto", pendiente: false },
      { titulo: "La cola y el reparto de GPU", ruta: "cola-y-gpu", pendiente: true },
      { titulo: "Confianza y transporte", ruta: "confianza-y-transporte", pendiente: true },
    ],
  },
  {
    id: "tecnologias",
    titulo: "Las tecnologías",
    glifo: "engranaje",
    paginas: [
      { titulo: "Cómo leer estas páginas", ruta: "como-leer-estas-paginas", pendiente: true },
      { titulo: "RoMa", ruta: "roma", pendiente: false },
      { titulo: "RoMa v2", ruta: "roma-v2", pendiente: true },
      { titulo: "tiny-RoMa", ruta: "tiny-roma", pendiente: true },
      { titulo: "EfficientLoFTR", ruta: "efficient-loftr", pendiente: true },
      { titulo: "LightGlue + ALIKED", ruta: "lightglue-aliked", pendiente: true },
      { titulo: "DINOv2", ruta: "dinov2", pendiente: true },
      { titulo: "SALAD", ruta: "salad", pendiente: true },
      { titulo: "AnyLoc", ruta: "anyloc", pendiente: true },
      { titulo: "EigenPlaces", ruta: "eigenplaces", pendiente: true },
      { titulo: "CosPlace", ruta: "cosplace", pendiente: true },
      { titulo: "DINO-Mix", ruta: "dino-mix", pendiente: true },
      { titulo: "CliqueMining", ruta: "cliquemining", pendiente: true },
      { titulo: "Lumi-2 y Lumi-preview", ruta: "lumi-2-y-lumi-preview", pendiente: true },
      { titulo: "Qwen3-VL", ruta: "qwen3-vl", pendiente: true },
      { titulo: "Depth-Anything v2", ruta: "depth-anything-v2", pendiente: true },
      { titulo: "PaddleOCR", ruta: "paddleocr", pendiente: true },
      { titulo: "Real-ESRGAN", ruta: "real-esrgan", pendiente: true },
      { titulo: "Qdrant y HNSW", ruta: "qdrant-y-hnsw", pendiente: true },
      { titulo: "SQLite y Redis", ruta: "sqlite-y-redis", pendiente: true },
      { titulo: "Tauri", ruta: "tauri", pendiente: true },
      { titulo: "Ed25519 y el emparejado", ruta: "ed25519-y-el-emparejado", pendiente: true },
    ],
  },
  {
    id: "empezar",
    titulo: "Empezar",
    glifo: "llave",
    paginas: [
      { titulo: "Instalar lumid", ruta: "instalar-lumid", pendiente: true },
      { titulo: "Emparejar el cliente", ruta: "emparejar-cliente", pendiente: true },
      { titulo: "Actualizar", ruta: "actualizar", pendiente: true },
      { titulo: "Compilar a mano", ruta: "compilar-a-mano", pendiente: true },
      { titulo: "Cuando algo no arranca", ruta: "cuando-algo-no-arranca", pendiente: true },
      { titulo: "Modo mantenimiento", ruta: "modo-mantenimiento", pendiente: true },
    ],
  },
  {
    id: "indexar",
    titulo: "Indexar territorio",
    glifo: "mapa",
    paginas: [
      { titulo: "Qué es un .lumidx", ruta: "que-es-un-lumidx", pendiente: true },
      { titulo: "Orígenes de red", ruta: "origenes-de-red", pendiente: true },
      { titulo: "Presupuesto", ruta: "presupuesto", pendiente: true },
      { titulo: "Sellado", ruta: "sellado", pendiente: true },
      { titulo: "Publicación", ruta: "publicacion", pendiente: true },
      { titulo: "Reclamo de territorio", ruta: "reclamo-de-territorio", pendiente: true },
      { titulo: "Levantar en WSL", ruta: "levantar-en-wsl", pendiente: true },
    ],
  },
  {
    id: "repo",
    titulo: "El repo por dentro",
    glifo: "caja",
    paginas: [
      { titulo: "El workspace", ruta: "el-workspace", pendiente: true },
      { titulo: "Rust ↔ Python", ruta: "rust-python", pendiente: true },
      { titulo: "Las tres bases de datos", ruta: "las-tres-bases-de-datos", pendiente: true },
      { titulo: "Compilar cada mitad", ruta: "compilar-cada-mitad", pendiente: true },
      { titulo: "Convenciones", ruta: "convenciones", pendiente: true },
    ],
  },
];

export function ramaDeRuta(idRama: string): RamaArbol | undefined {
  return arbolDocs.find((r) => r.id === idRama);
}

export function paginaDeRuta(idRama: string, ruta: string): PaginaArbol | undefined {
  return ramaDeRuta(idRama)?.paginas.find((p) => p.ruta === ruta);
}

export function siguienteYAnterior(
  idRama: string,
  ruta: string
): { anterior: (PaginaArbol & { ramaId: string }) | null; siguiente: (PaginaArbol & { ramaId: string }) | null } {
  const rama = ramaDeRuta(idRama);
  if (!rama) return { anterior: null, siguiente: null };
  const escritas = rama.paginas.filter((p) => !p.pendiente);
  const i = escritas.findIndex((p) => p.ruta === ruta);
  return {
    anterior: i > 0 ? { ...escritas[i - 1], ramaId: idRama } : null,
    siguiente: i >= 0 && i < escritas.length - 1 ? { ...escritas[i + 1], ramaId: idRama } : null,
  };
}
```

- [ ] **Step 6: Verificar que el workspace de TypeScript sigue resolviendo**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores (los ficheros nuevos no se importan todavía desde ningún sitio, así que esto
solo confirma que no hay errores de sintaxis).

- [ ] **Step 7: Commit**

```bash
git add web/package.json web/package-lock.json web/next.config.mjs web/mdx-components.tsx web/lib/arbolDocs.ts web/lib/slug.ts
git commit -m "$(cat <<'EOF'
feat(docs): añadir @next/mdx y el árbol de navegación de /docs

Base de la fase 1 del spec de documentación: dependencia MDX, config de
Next para reconocer page.mdx, y arbolDocs.ts como fuente de verdad
escrita a mano de las cinco ramas y sus páginas (pendientes incluidas).

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Chasis de tres columnas y glifos de rama

**Files:**
- Create: `web/components/docs/GlifoRama.tsx`
- Create: `web/components/docs/ArbolLateral.tsx`
- Create: `web/components/docs/IndicePagina.tsx`
- Create: `web/app/docs/layout.tsx`
- Modify: `web/components/IndicadorSecciones.tsx`
- Modify: `web/components/Nav.tsx`

**Interfaces:**
- Consumes: `arbolDocs`, `RamaArbol`, `PaginaArbol` de `web/lib/arbolDocs.ts` (Tarea 1).
- Produces: `<GlifoRama glifo={...} className?: string />` — componente de icono.
- Produces: `<ArbolLateral rutaActual={string} />` — sidebar de navegación, client component.
- Produces: `<IndicePagina />` — TOC de la derecha, client component, escanea `#contenido-docs`.
- Produces: `id="contenido-docs"` como contenedor de la columna central (lo usa `IndicePagina` y lo
  usarán los componentes de la Tarea 7).

- [ ] **Step 1: Crear `web/components/docs/GlifoRama.tsx`**

Cinco glifos de trazo, uno por rama, siguiendo el patrón de iconos de `DESIGN.md`
(`viewBox="0 0 24 24"`, `fill="none"`, `stroke="currentColor"`, `strokeWidth` 1.7 fijo).

```tsx
type Props = {
  glifo: "camino" | "engranaje" | "llave" | "mapa" | "caja";
  className?: string;
};

/** Un glifo de trazo por rama de /docs — pequeño junto al nombre en el
 *  árbol, grande y muy tenue tras la cabecera de portada de cada rama
 *  (spec §3 C). Cinco formas simples, coherentes con el resto de iconos
 *  de la web (candado, check, chevron, info en DESIGN.md). */
export function GlifoRama({ glifo, className }: Props) {
  const comun = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
  };
  switch (glifo) {
    case "camino":
      return (
        <svg {...comun}>
          <path d="M4 20c2-6 4-9 8-9s6 3 8 9" />
          <circle cx="12" cy="6" r="2.6" />
        </svg>
      );
    case "engranaje":
      return (
        <svg {...comun}>
          <circle cx="12" cy="12" r="3.2" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </svg>
      );
    case "llave":
      return (
        <svg {...comun}>
          <circle cx="7.5" cy="14.5" r="3.5" />
          <path d="M10 12l9-9M17 5l2 2M14 8l2 2" />
        </svg>
      );
    case "mapa":
      return (
        <svg {...comun}>
          <path d="M9 4L4 6v14l5-2 6 2 5-2V4l-5 2-6-2z" />
          <path d="M9 4v14M15 6v14" />
        </svg>
      );
    case "caja":
      return (
        <svg {...comun}>
          <path d="M4 8l8-4 8 4-8 4-8-4z" />
          <path d="M4 8v8l8 4 8-4V8M12 12v8" />
        </svg>
      );
  }
}
```

- [ ] **Step 2: Crear `web/components/docs/ArbolLateral.tsx`**

Sidebar de 250px en escritorio (`min-[900px]:` en adelante); en móvil, barra de ruta + desplegable.
El botón de buscar solo abre el buscador (implementado en la Tarea 8) mediante un evento
`window.dispatchEvent(new Event("docs:abrir-buscador"))` — así `ArbolLateral` no necesita conocer el
estado interno del buscador, solo pedir que se abra.

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { arbolDocs } from "../../lib/arbolDocs";
import { GlifoRama } from "./GlifoRama";

function IconoBuscar() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-4.2-4.2" />
    </svg>
  );
}

function IconoRuta() {
  return (
    <svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 5l8 7-8 7" />
    </svg>
  );
}

function Contenido({ rutaActual }: { rutaActual: string }) {
  return (
    <>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event("docs:abrir-buscador"))}
        className="jg-micro mx-4 mb-[18px] flex items-center gap-2 rounded-[8px] border border-border bg-panel px-2.5 py-[7px] text-left text-subtle hover:border-[#33363b]"
      >
        <IconoBuscar />
        <span className="text-[11.5px]">Buscar</span>
        <span className="ml-auto rounded-[4px] border border-border px-[5px] text-[9.5px] font-mono">⌘K</span>
      </button>
      {arbolDocs.map((rama) => (
        <div key={rama.id} className="mb-5">
          <div className="mb-[7px] flex items-center gap-1.5 px-4 text-[9.5px] uppercase tracking-[.12em] text-subtle">
            <GlifoRama glifo={rama.glifo} className="h-[11px] w-[11px]" />
            {rama.titulo}
          </div>
          {rama.paginas.map((pagina) => {
            const href = `/docs/${rama.id}/${pagina.ruta}`;
            const activa = href === rutaActual;
            if (pagina.pendiente) {
              return (
                <span key={pagina.ruta} className="block px-4 py-[5px] text-[12.5px] leading-snug text-subtle">
                  {pagina.titulo}
                  <em className="relative -top-px ml-1.5 rounded-[4px] border border-border px-1 text-[9px] not-italic uppercase tracking-[.09em] text-subtle">
                    pendiente
                  </em>
                </span>
              );
            }
            return (
              <Link
                key={pagina.ruta}
                href={href}
                className={`jg-micro block border-l-2 px-4 py-[5px] text-[12.5px] leading-snug ${
                  activa ? "border-fg bg-white/[.035] text-fg" : "border-transparent text-muted hover:text-fg"
                }`}
              >
                {pagina.titulo}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

/** Árbol de navegación de /docs. En escritorio (≥900px) es una columna fija
 *  de 250px; por debajo, una barra de ruta con desplegable (spec §1: "el
 *  árbol pasa a un desplegable bajo una barra de ruta"). */
export function ArbolLateral({ rutaActual, tituloActual }: { rutaActual: string; tituloActual: string }) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <aside className="hidden w-[250px] shrink-0 overflow-y-auto border-r border-border py-[22px] min-[900px]:block">
        <Contenido rutaActual={rutaActual} />
      </aside>

      <div className="border-b border-border min-[900px]:hidden">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          className="jg-micro flex w-full items-center gap-2 bg-panel px-4 py-[11px] text-left"
        >
          <IconoRuta />
          <span className="text-[11.5px] text-muted">{tituloActual}</span>
        </button>
        {abierto && (
          <div className="max-h-[70vh] overflow-y-auto border-t border-border bg-bg py-[18px]">
            <Contenido rutaActual={rutaActual} />
          </div>
        )}
      </div>
    </>
  );
}
```

- [ ] **Step 3: Crear `web/components/docs/IndicePagina.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";

type Item = { id: string; texto: string; nivel: number };

/** Índice de la página actual (columna derecha, 210px, solo desde
 *  min-[900px] — en 900–1200px puede que ya no sobre sitio, así que en
 *  realidad se reserva desde xl como el resto del sitio de tres columnas
 *  hace con paneles secundarios). Lee los encabezados directamente del DOM
 *  ya renderizado en vez de duplicar esa lista en indiceDocs.json — ver
 *  decisión 4 del plan. */
export function IndicePagina() {
  const [items, setItems] = useState<Item[]>([]);
  const [activo, setActivo] = useState<string | null>(null);

  useEffect(() => {
    const nodos = Array.from(
      document.querySelectorAll<HTMLElement>("#contenido-docs h2, #contenido-docs h3")
    );
    setItems(nodos.map((n) => ({ id: n.id, texto: n.textContent ?? "", nivel: n.tagName === "H2" ? 2 : 3 })));
    if (nodos.length === 0) return;

    const observador = new IntersectionObserver(
      (entradas) => {
        const visible = entradas.find((e) => e.isIntersecting);
        if (visible) setActivo(visible.target.id);
      },
      { rootMargin: "-88px 0px -70% 0px" }
    );
    nodos.forEach((n) => observador.observe(n));
    return () => observador.disconnect();
  }, []);

  if (items.length === 0) return null;

  return (
    <nav className="hidden w-[210px] shrink-0 pl-[22px] pt-[52px] xl:block">
      <div className="text-[9.5px] uppercase tracking-[.12em] text-subtle">En esta página</div>
      <div className="mt-2.5 flex flex-col gap-1">
        {items.map((it) => (
          <a
            key={it.id}
            href={`#${it.id}`}
            className={`jg-micro border-l text-[11.5px] leading-tight ${it.nivel === 3 ? "pl-[22px]" : "pl-[11px]"} py-1 ${
              activo === it.id ? "border-fg text-fg" : "border-border text-subtle hover:text-muted"
            }`}
          >
            {it.texto}
          </a>
        ))}
      </div>
    </nav>
  );
}
```

- [ ] **Step 4: Crear `web/app/docs/layout.tsx`**

El marco propio de `/docs` (spec §1: "un subsitio con su propio marco, no una página más de la
landing"). `rutaActual` sale del propio pathname de Next.

```tsx
import { ArbolLateral } from "../../components/docs/ArbolLateral";
import { IndicePagina } from "../../components/docs/IndicePagina";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pt-14 min-[900px]:flex-row">
      {/* ArbolLateral necesita saber la ruta activa, pero un layout de
          servidor no tiene acceso a usePathname(). Se resuelve dentro del
          propio ArbolLateral con un hook — ver Step 5. */}
      <ArbolLateralConectado />
      <main id="contenido-docs" className="flex flex-1 justify-center overflow-x-hidden px-6 py-11 min-[900px]:px-0">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
      <IndicePagina />
    </div>
  );
}

// Se define debajo, en el mismo fichero, para no crear un componente cliente
// extra solo por leer el pathname.
import { ArbolLateralConectado } from "../../components/docs/ArbolLateralConectado";
```

Ese `import` al final es intencional (evita un ciclo: `ArbolLateralConectado` es un client component
pequeño que solo llama a `usePathname()` y delega en `ArbolLateral`). Créalo:

- [ ] **Step 5: Crear `web/components/docs/ArbolLateralConectado.tsx`**

```tsx
"use client";

import { usePathname } from "next/navigation";
import { arbolDocs } from "../../lib/arbolDocs";
import { ArbolLateral } from "./ArbolLateral";

/** Envoltorio fino: usePathname() solo puede llamarse desde un client
 *  component, y app/docs/layout.tsx es un server component (así toda la
 *  navegación estática de las cinco ramas se sirve sin JS de por medio
 *  salvo este puente). */
export function ArbolLateralConectado() {
  const pathname = usePathname();
  const partes = pathname.split("/").filter(Boolean); // ["docs", ramaId, ruta] o ["docs"]
  const ramaId = partes[1];
  const ruta = partes[2];
  const rama = arbolDocs.find((r) => r.id === ramaId);
  const pagina = rama?.paginas.find((p) => p.ruta === ruta);
  const titulo = pagina ? `${rama!.titulo} · ${pagina.titulo}` : rama?.titulo ?? "Documentación";

  return <ArbolLateral rutaActual={pathname} tituloActual={titulo} />;
}
```

Corrige `web/app/docs/layout.tsx` para importar `ArbolLateralConectado` arriba junto a los demás
imports en vez de al final (el fichero final queda así):

```tsx
import { ArbolLateralConectado } from "../../components/docs/ArbolLateralConectado";
import { IndicePagina } from "../../components/docs/IndicePagina";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pt-14 min-[900px]:flex-row">
      <ArbolLateralConectado />
      <main id="contenido-docs" className="flex flex-1 justify-center overflow-x-hidden px-6 py-11 min-[900px]:px-0">
        <div className="w-full max-w-[640px]">{children}</div>
      </main>
      <IndicePagina />
    </div>
  );
}
```

- [ ] **Step 6: Ocultar `IndicadorSecciones` bajo `/docs`**

`web/components/IndicadorSecciones.tsx` hoy se monta sin condición desde el layout raíz (spec §1).
Añade el chequeo de ruta al principio del componente:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
```

Y dentro de la función, como primera línea del cuerpo (antes de los `useState`):

```tsx
export function IndicadorSecciones() {
  const pathname = usePathname();
  const [activo, setActivo] = useState(0);
```

Y justo antes del `return` final, sustituye el `return (...)` existente por:

```tsx
  if (pathname.startsWith("/docs")) return null;

  return (
```

(el resto del JSX no cambia). El resto del fichero (el `useEffect` de scroll, etc.) sigue igual.

- [ ] **Step 7: Añadir "Docs" al `Nav`**

En `web/components/Nav.tsx`, localiza la línea:

```tsx
        <a className="jg-micro hover:text-fg" href="/indexado">Indexado</a>
        <a className="jg-micro hover:text-fg" href="/aboutme">Sobre mí</a>
```

Y añade la entrada de Docs entre ambas:

```tsx
        <a className="jg-micro hover:text-fg" href="/indexado">Indexado</a>
        <a className="jg-micro hover:text-fg" href="/docs">Docs</a>
        <a className="jg-micro hover:text-fg" href="/aboutme">Sobre mí</a>
```

- [ ] **Step 8: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores. (El build completo con `npm run build` fallará todavía porque no existe
ninguna página `page.mdx` ni `web/app/docs/page.tsx` — eso llega en la Tarea 3. No ejecutes
`npm run build` en esta tarea.)

- [ ] **Step 9: Commit**

```bash
git add web/components/docs/GlifoRama.tsx web/components/docs/ArbolLateral.tsx web/components/docs/ArbolLateralConectado.tsx web/components/docs/IndicePagina.tsx web/app/docs/layout.tsx web/components/IndicadorSecciones.tsx web/components/Nav.tsx
git commit -m "$(cat <<'EOF'
feat(docs): chasis de tres columnas de /docs

Layout propio con árbol de navegación (desplegable en móvil, <900px),
índice de página que se resalta con IntersectionObserver, glifos de
rama a mano, y IndicadorSecciones/Nav ajustados para el nuevo subsitio.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Portada de `/docs`

**Files:**
- Create: `web/app/docs/page.tsx`

**Interfaces:**
- Consumes: `arbolDocs` de `web/lib/arbolDocs.ts`.

- [ ] **Step 1: Crear `web/app/docs/page.tsx`**

Portada corta que presenta las cinco ramas (spec §1: "no un índice de cuarenta enlaces"). Los
recuentos de página se calculan del propio árbol, no se escriben a mano.

```tsx
import Link from "next/link";
import { arbolDocs } from "../../lib/arbolDocs";

export const metadata = {
  title: "Documentación · Lumi Station",
  description: "Cómo se despliega Lumi, cómo funciona por dentro y qué hace exactamente cada pieza.",
};

const DESCRIPCIONES: Record<string, string> = {
  "como-funciona":
    "El viaje completo de una foto: del píxel al vector, del vector a doscientos candidatos, de los candidatos a un veredicto con una confianza que significa algo. Con esquemas que se pueden tocar.",
  tecnologias:
    "Una página por técnica —RoMa, SALAD, Qwen3-VL, Qdrant— con qué problema resuelve, cómo lo resuelve y por qué está aquí y no otra.",
  empezar:
    "Instalar lumid en tu máquina, emparejar el cliente, actualizar y qué mirar cuando algo no arranca.",
  indexar:
    "El Indexer: orígenes de red, presupuesto, sellado de un .lumidx y publicación.",
  repo: "Layout del workspace, qué hace cada crate, el contrato Rust↔Python y cómo compilar cada mitad.",
};

export default function PortadaDocs() {
  return (
    <div>
      <div className="text-[34px] font-medium leading-[1.1] tracking-[-.025em]">Documentación</div>
      <p className="mt-3.5 max-w-[600px] text-[14.5px] leading-relaxed text-muted">
        Cómo se despliega Lumi, cómo funciona por dentro y qué hace exactamente cada pieza. Escrita
        para leerse entera o para consultar un dato suelto.
      </p>
      <div className="mt-11 grid grid-cols-1 gap-3 min-[640px]:grid-cols-2">
        {arbolDocs.map((rama, i) => {
          const escritas = rama.paginas.filter((p) => !p.pendiente).length;
          const total = rama.paginas.length;
          const primeraEscrita = rama.paginas.find((p) => !p.pendiente);
          const href = primeraEscrita ? `/docs/${rama.id}/${primeraEscrita.ruta}` : `/docs`;
          return (
            <Link
              key={rama.id}
              href={href}
              className={`jg-micro rounded-card border border-border bg-panel px-[18px] py-4 hover:border-[#33363b] ${
                i === 0 ? "min-[640px]:col-span-2" : ""
              }`}
            >
              <div className="text-[14px] text-fg">{rama.titulo}</div>
              <div className="mt-[7px] text-[12px] leading-relaxed text-subtle">{DESCRIPCIONES[rama.id]}</div>
              <div className="mt-3 font-mono text-[10px] uppercase tracking-[.07em] text-subtle">
                {escritas === total ? `${total} páginas` : `${total} páginas · pendiente`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add web/app/docs/page.tsx
git commit -m "$(cat <<'EOF'
feat(docs): portada de /docs con las cinco ramas

Presenta las cinco ramas con su recuento de páginas calculado del
árbol (arbolDocs.ts), no escrito a mano — cambiar una página en el
árbol mantiene la portada correcta sola.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Script de índice y registros generados

**Files:**
- Create: `web/scripts/indice-docs.mjs`
- Modify: `web/package.json`
- Modify: `web/.gitignore`

**Interfaces:**
- Produces (en disco, no en código): `web/lib/indiceDocs.json` con forma
  `{ paginas: Array<{ ruta: string; ramaId: string; ramaTitulo: string; titulo: string; frase: string; encabezados: Array<{id:string; texto:string; nivel:number; parrafo:string}>; procedencia: string[]; fechaMdx: string | null; envejecida: boolean }> }`.
- Produces (en disco): `web/lib/registrosDocs.generated.json` con forma
  `{ [id: string]: { id: string; nombre: string; categoria: "modelos"|"verificadores"|"motores"; tipo?: string; licencia?: string; ficheroPesos?: string; sha256?: string; activoEnNiveles: string[]; alternativaNoActiva: boolean } }`.
- Consumes: `web/app/docs/**/page.mdx` (los que exista en el momento de ejecutarse — en esta tarea
  todavía no hay ninguno, así que el script debe correr sin fallar y producir ficheros con listas
  vacías salvo por lo que ya exige el árbol).

Este script es Node puro (ESM, `.mjs`), sin dependencias nuevas — usa solo `node:fs`, `node:path` y
`node:child_process` (para `git log`).

- [ ] **Step 1: Crear `web/scripts/indice-docs.mjs`**

```js
#!/usr/bin/env node
// Genera web/lib/indiceDocs.json y web/lib/registrosDocs.generated.json a
// partir de web/app/docs/**/page.mdx y de registros/**/*.json en la raíz
// del repo. Es el único punto que lee fuera de web/ (spec §2): en tiempo de
// ejecución del sitio nada sale de web/, todo pasa por estos dos ficheros
// generados. Se engancha como predev/prebuild en package.json.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.resolve(AQUI, "..");
const REPO_DIR = path.resolve(WEB_DIR, "..");
const DOCS_DIR = path.join(WEB_DIR, "app", "docs");
const LIB_DIR = path.join(WEB_DIR, "lib");

// Duplicado deliberado de web/lib/slug.ts: este script corre en Node antes
// de que exista ningún paso de compilación de TypeScript, así que no puede
// importar ese fichero. Debe producir exactamente el mismo id que
// EncabezadoDocs calcula en el navegador. // ponytail
function slugificar(texto) {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "");
}

function listarMdx(dir) {
  const resultado = [];
  for (const entrada of readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, entrada.name);
    if (entrada.isDirectory()) resultado.push(...listarMdx(ruta));
    else if (entrada.name === "page.mdx") resultado.push(ruta);
  }
  return resultado;
}

function fechaGitDelFichero(rutaAbsoluta) {
  try {
    const salida = execFileSync("git", ["log", "-1", "--format=%cI", "--", rutaAbsoluta], {
      cwd: REPO_DIR,
      encoding: "utf8",
    }).trim();
    return salida || null;
  } catch {
    return null;
  }
}

function extraerExportString(texto, nombre) {
  const m = texto.match(new RegExp(`export const ${nombre} = "((?:[^"\\\\]|\\\\.)*)";`));
  return m ? m[1].replace(/\\"/g, '"') : null;
}

function extraerExportArray(texto, nombre) {
  const m = texto.match(new RegExp(`export const ${nombre} = (\\[[\\s\\S]*?\\]);`));
  if (!m) return [];
  // El array solo contiene literales de string (rutas de fichero), así que
  // un Function() controlado sobre nuestro propio contenido versionado es
  // seguro y evita añadir un parser JSON5 solo para permitir comentarios. // ponytail
  return new Function(`return ${m[1]};`)();
}

function extraerEncabezados(texto) {
  const lineas = texto.split("\n");
  const encabezados = [];
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(/^(##|###) (.+)$/);
    if (!m) continue;
    const nivel = m[1].length;
    const texto2 = m[2].trim();
    let parrafo = "";
    for (let j = i + 1; j < lineas.length; j++) {
      const l = lineas[j].trim();
      if (l.startsWith("#")) break;
      if (l.length > 0 && !l.startsWith("<") && !l.startsWith("export ")) {
        parrafo = l;
        break;
      }
    }
    encabezados.push({ id: slugificar(texto2), texto: texto2, nivel, parrafo });
  }
  return encabezados;
}

function extraerTecIds(texto) {
  const ids = [];
  const re = /<Tec id="([^"]+)"/g;
  let m;
  while ((m = re.exec(texto))) ids.push(m[1]);
  return ids;
}

// --- Construcción del árbol esperado (duplicado mínimo de arbolDocs.ts) ---
// ponytail: el árbol real vive en web/lib/arbolDocs.ts (TypeScript). Este
// script solo necesita, de cada página no pendiente, su rama+ruta para
// validar que existe un page.mdx — así que basta con un requerimiento
// dinámico: se listan los page.mdx existentes y se comparan contra las
// rutas de arbolDocs.ts leyendo ese fichero como texto (sin ejecutar TS).
function leerArbolComoTexto() {
  const contenido = readFileSync(path.join(LIB_DIR, "arbolDocs.ts"), "utf8");
  const ramas = [];
  const reRama = /id:\s*"([^"]+)"[\s\S]*?titulo:\s*"([^"]+)"[\s\S]*?paginas:\s*\[([\s\S]*?)\n\s*\],\n\s*\},/g;
  let m;
  while ((m = reRama.exec(contenido))) {
    const [, id, titulo, bloquePaginas] = m;
    const paginas = [];
    const rePagina = /ruta:\s*"([^"]+)",\s*pendiente:\s*(true|false)/g;
    let mp;
    while ((mp = rePagina.exec(bloquePaginas))) {
      paginas.push({ ruta: mp[1], pendiente: mp[2] === "true" });
    }
    ramas.push({ id, titulo, paginas });
  }
  return ramas;
}

function main() {
  const errores = [];
  const arbol = leerArbolComoTexto();
  const ficherosMdx = existsSync(DOCS_DIR) ? listarMdx(DOCS_DIR) : [];

  // 1. Toda ruta del árbol sin marcar pendiente debe tener su .mdx.
  for (const rama of arbol) {
    for (const pagina of rama.paginas) {
      if (pagina.pendiente) continue;
      const esperado = path.join(DOCS_DIR, rama.id, pagina.ruta, "page.mdx");
      if (!existsSync(esperado)) {
        errores.push(`falta ${path.relative(REPO_DIR, esperado)} (declarada no-pendiente en arbolDocs.ts)`);
      }
    }
  }

  // 2. Recopilar todos los ids de Tec citados, para validarlos contra las
  //    rutas reales de la rama "tecnologias".
  const idsTecnologiasValidos = new Set(
    (arbol.find((r) => r.id === "tecnologias")?.paginas ?? []).map((p) => p.ruta)
  );

  const paginas = [];
  for (const rutaMdx of ficherosMdx) {
    const relativo = path.relative(DOCS_DIR, rutaMdx); // "<ramaId>/<ruta>/page.mdx"
    const [ramaId, ruta] = relativo.split(path.sep);
    const ramaDef = arbol.find((r) => r.id === ramaId);
    const paginaDef = ramaDef?.paginas.find((p) => p.ruta === ruta);
    const texto = readFileSync(rutaMdx, "utf8");

    const frase = extraerExportString(texto, "frase");
    if (!frase) {
      errores.push(`${path.relative(REPO_DIR, rutaMdx)} no exporta "frase" (obligatoria, spec §2)`);
    }

    for (const id of extraerTecIds(texto)) {
      if (!idsTecnologiasValidos.has(id)) {
        errores.push(`${path.relative(REPO_DIR, rutaMdx)} referencia <Tec id="${id}"> pero no existe esa ruta en la rama tecnologias`);
      }
    }

    const procedencia = extraerExportArray(texto, "procedencia");
    const fechaMdx = fechaGitDelFichero(rutaMdx);
    let envejecida = false;
    if (fechaMdx) {
      for (const fichero of procedencia) {
        const abs = path.join(REPO_DIR, fichero);
        if (!existsSync(abs)) continue;
        const fechaFichero = fechaGitDelFichero(abs);
        if (fechaFichero && fechaFichero > fechaMdx) envejecida = true;
      }
    }

    paginas.push({
      ruta: `/docs/${ramaId}/${ruta}`,
      ramaId,
      ramaTitulo: ramaDef?.titulo ?? ramaId,
      titulo: paginaDef?.titulo ?? ruta,
      frase: frase ?? "",
      encabezados: extraerEncabezados(texto),
      procedencia,
      fechaMdx,
      envejecida,
    });
  }

  if (errores.length > 0) {
    console.error("indice-docs: build inválido —");
    for (const e of errores) console.error(`  - ${e}`);
    process.exit(1);
  }

  writeFileSync(path.join(LIB_DIR, "indiceDocs.json"), JSON.stringify({ paginas }, null, 2));

  // --- registrosDocs.generated.json ---
  const registrosDir = path.join(REPO_DIR, "registros");
  const categorias = ["modelos", "verificadores", "motores"];
  const salida = {};
  const niveles = readdirSync(path.join(registrosDir, "niveles"))
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(registrosDir, "niveles", f), "utf8")));

  for (const categoria of categorias) {
    const dir = path.join(registrosDir, categoria);
    if (!existsSync(dir)) continue;
    for (const fichero of readdirSync(dir)) {
      if (!fichero.endsWith(".json")) continue;
      const datos = JSON.parse(readFileSync(path.join(dir, fichero), "utf8"));
      const activoEnNiveles = niveles
        .filter((n) =>
          [n.recuperacion, n.geometricos, n.agentes].some((lista) => Array.isArray(lista) && lista.includes(datos.id))
        )
        .map((n) => n.nombre);
      const ficheroUrl = datos.fichero_url ?? datos.pesos_url ?? null;
      salida[datos.id] = {
        id: datos.id,
        nombre: datos.nombre,
        categoria,
        tipo: datos.tipo,
        licencia: datos.licencia,
        dims: datos.dims,
        ficheroPesos: ficheroUrl ? ficheroUrl.split("/").pop() : undefined,
        sha256: datos.sha256,
        activoEnNiveles,
        alternativaNoActiva: activoEnNiveles.length === 0,
      };
    }
  }
  writeFileSync(path.join(LIB_DIR, "registrosDocs.generated.json"), JSON.stringify(salida, null, 2));

  console.log(`indice-docs: ${paginas.length} página(s) indexada(s), ${Object.keys(salida).length} registro(s) copiado(s).`);
}

main();
```

- [ ] **Step 2: Enganchar el script en `package.json`**

Reemplaza el bloque `"scripts"` de `web/package.json` por:

```json
  "scripts": {
    "predev": "node scripts/indice-docs.mjs",
    "dev": "next dev",
    "prebuild": "node scripts/indice-docs.mjs",
    "build": "next build",
    "start": "next start"
  },
```

- [ ] **Step 3: Ignorar los ficheros generados**

Añade al final de `web/.gitignore`:

```
lib/indiceDocs.json
lib/registrosDocs.generated.json
```

- [ ] **Step 4: Ejecutar el script y comprobar que no falla**

```bash
cd web && node scripts/indice-docs.mjs
```

Expected: imprime `indice-docs: 0 página(s) indexada(s), N registro(s) copiado(s).` y termina con
código 0 — **no** debe fallar por páginas faltantes en esta tarea porque todavía no hay ningún
`page.mdx` no-pendiente creado (las seis páginas de la fase 1 llegan en la Tarea 10; hasta entonces,
si quieres probar la validación de "falta el .mdx", es esperable y correcto que ejecutar el script
después de la Tarea 1 SIN haber creado las páginas de la Tarea 10 falle — pero esta tarea 4 se
ejecuta justo después de la Tarea 3, antes de que existan páginas de contenido "cómo funciona" no
pendientes en el árbol, así que todavía no debería fallar). Si falla, revisa que `arbolDocs.ts` siga
teniendo exactamente `pendiente: false` en las seis páginas de la fase 1 (Tarea 1) — el script las
exigirá a partir de este punto, así que su falta se resolverá en la Tarea 10. Comprueba también que
`web/lib/indiceDocs.json` y `web/lib/registrosDocs.generated.json` se hayan creado.

Si el comando falla listando las seis páginas de la fase 1 como faltantes, es el comportamiento
correcto y esperado — quedan pendientes de contenido hasta la Tarea 10. Anota en el report de esta
tarea que el build completo (`npm run build`) no se puede verificar hasta que existan esas páginas,
y no ejecutes `npm run build` todavía.

- [ ] **Step 5: Commit**

```bash
git add web/scripts/indice-docs.mjs web/package.json web/.gitignore
git commit -m "$(cat <<'EOF'
feat(docs): script de índice de build para /docs

indice-docs.mjs recorre app/docs/**/page.mdx en predev/prebuild,
genera indiceDocs.json (buscador, previsualizaciones, procedencia,
aviso de página envejecida) y registrosDocs.generated.json (copia
aplanada de registros/ para <Ficha>/<Dato>), y falla el build si
falta una frase de apertura, un <Tec id> no resuelve, o una ruta no
pendiente del árbol no tiene su .mdx.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Cabecera de página, `<Detalle>`, `<Esquema>` y el control "leer en profundidad"

**Files:**
- Create: `web/components/docs/CabeceraDocs.tsx`
- Create: `web/components/docs/ContextoProfundidad.tsx`
- Create: `web/components/docs/Detalle.tsx`
- Create: `web/components/docs/ControlProfundidad.tsx`
- Create: `web/components/docs/Esquema.tsx`

**Interfaces:**
- Consumes: `ramaDeRuta`, `paginaDeRuta` de `web/lib/arbolDocs.ts`.
- Produces: `<CabeceraDocs ruta={string} frase={string} tipo?: string />`.
- Produces: `<ContextoProfundidadProveedor>{children}</ContextoProfundidadProveedor>`,
  hook `useProfundidad(): { senal: number; valor: boolean; disparar: (v: boolean) => void }`.
- Produces: `<Detalle titulo={string}>{children}</Detalle>`.
- Produces: `<ControlProfundidad />`.
- Produces: `<Esquema etiqueta={string}>{children}</Esquema>`.

- [ ] **Step 1: Crear `web/components/docs/CabeceraDocs.tsx`**

Server component: migaja, título, frase (spec §2 "forma de una página", pasos 1–3).

```tsx
import { ramaDeRuta, paginaDeRuta } from "../../lib/arbolDocs";

type Props = {
  /** Ruta completa, ej. "/docs/como-funciona/el-viaje-de-una-foto". */
  ruta: string;
  frase: string;
  /** Solo para la rama "tecnologías": tipo de la pieza (spec §2, "para
   *  tecnologías también el tipo"). */
  tipo?: string;
};

export function CabeceraDocs({ ruta, frase, tipo }: Props) {
  const partes = ruta.split("/").filter(Boolean); // ["docs", ramaId, paginaRuta]
  const ramaId = partes[1];
  const paginaRuta = partes[2];
  const rama = ramaDeRuta(ramaId);
  const pagina = paginaDeRuta(ramaId, paginaRuta);

  return (
    <header>
      <div className="font-mono text-[10px] uppercase tracking-[.11em] text-subtle">
        {rama?.titulo}
        {tipo ? ` · ${tipo}` : ""}
      </div>
      <h1 className="mt-[6px] text-[27px] font-medium leading-[1.2] tracking-[-.02em] text-fg">
        {pagina?.titulo}
      </h1>
      <p className="mt-3.5 text-[15px] leading-relaxed text-muted">{frase}</p>
    </header>
  );
}
```

- [ ] **Step 2: Crear `web/components/docs/ContextoProfundidad.tsx`**

Contexto de React para el control global "leer en profundidad" (spec §3 B): un único botón que abre
o cierra todos los `<Detalle>` de la página a la vez, sin impedir que cada uno se siga abriendo o
cerrando individualmente después.

```tsx
"use client";

import { createContext, useContext, useState } from "react";

type EstadoProfundidad = { senal: number; valor: boolean; disparar: (v: boolean) => void };

const Contexto = createContext<EstadoProfundidad | null>(null);

export function ContextoProfundidadProveedor({ children }: { children: React.ReactNode }) {
  const [senal, setSenal] = useState(0);
  const [valor, setValor] = useState(false);

  function disparar(v: boolean) {
    setValor(v);
    setSenal((s) => s + 1);
  }

  return <Contexto.Provider value={{ senal, valor, disparar }}>{children}</Contexto.Provider>;
}

/** Cada <Detalle> se suscribe a `senal`: cuando cambia, se fuerza su estado
 *  a `valor`, pero el usuario puede seguir plegando/desplegando uno suelto
 *  después — la señal es un pulso, no un candado. */
export function useProfundidad(): EstadoProfundidad {
  const ctx = useContext(Contexto);
  if (!ctx) throw new Error("useProfundidad() fuera de ContextoProfundidadProveedor");
  return ctx;
}
```

- [ ] **Step 3: Crear `web/components/docs/Detalle.tsx`**

```tsx
"use client";

import { useEffect, useState } from "react";
import { useProfundidad } from "./ContextoProfundidad";

export function Detalle({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  const [abierto, setAbierto] = useState(false);
  const { senal, valor } = useProfundidad();

  useEffect(() => {
    if (senal > 0) setAbierto(valor);
    // Solo reacciona a cambios de senal (el pulso del control global), no a
    // valor por sí solo — de lo contrario un Detalle abierto a mano se
    // cerraría cada vez que otro componente lee el contexto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [senal]);

  return (
    <div className="mt-[22px] rounded-card border border-border bg-panel">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="jg-micro flex w-full items-center gap-[9px] px-[14px] py-[11px] text-left"
      >
        <span
          className="block h-2 w-2 border-b-[1.3px] border-r-[1.3px] border-subtle transition-transform duration-200"
          style={{ transform: abierto ? "rotate(45deg)" : "rotate(-45deg)" }}
        />
        <b className="text-[11.5px] font-normal text-muted">{titulo}</b>
      </button>
      {abierto && <div className="border-t border-border px-[14px] pb-[14px] pt-[13px] text-[12.5px] leading-relaxed text-muted">{children}</div>}
    </div>
  );
}
```

- [ ] **Step 4: Crear `web/components/docs/ControlProfundidad.tsx`**

```tsx
"use client";

import { useProfundidad } from "./ContextoProfundidad";

/** Un único control arriba a la derecha que abre o cierra todos los
 *  <Detalle> de la página a la vez (spec §3 B). Cada page.mdx lo coloca
 *  junto a la cabecera. */
export function ControlProfundidad() {
  const { valor, disparar } = useProfundidad();
  return (
    <button
      type="button"
      onClick={() => disparar(!valor)}
      className="jg-micro rounded-[8px] border border-border px-[10px] py-[5px] text-[11px] text-subtle hover:border-[#33363b] hover:text-muted"
    >
      {valor ? "Cerrar todo" : "Leer en profundidad"}
    </button>
  );
}
```

- [ ] **Step 5: Crear `web/components/docs/Esquema.tsx`**

Contenedor común de los esquemas (spec §2, tabla de componentes): etiqueta + marco. El respeto a
`prefers-reduced-motion` ya lo cubre la regla global de `globals.css` (decisión global de este plan),
así que este componente no necesita lógica propia para ello.

```tsx
export function Esquema({ etiqueta, children }: { etiqueta: string; children: React.ReactNode }) {
  return (
    <div className="mt-7 rounded-card border border-border bg-panel px-5 pb-[18px] pt-[22px]">
      <div className="font-mono text-[9.5px] uppercase tracking-[.12em] text-subtle">{etiqueta}</div>
      <div className="mt-[18px]">{children}</div>
    </div>
  );
}
```

- [ ] **Step 6: Envolver `web/app/docs/layout.tsx` con el proveedor de contexto**

Modifica `web/app/docs/layout.tsx` (creado en la Tarea 2) para envolver el `<main>` con
`ContextoProfundidadProveedor` — el control y los `<Detalle>` de cada página necesitan compartir el
mismo contexto, y como cada página es un árbol de componentes distinto, el proveedor debe vivir en el
layout, no en cada `page.mdx`:

```tsx
import { ArbolLateralConectado } from "../../components/docs/ArbolLateralConectado";
import { ContextoProfundidadProveedor } from "../../components/docs/ContextoProfundidad";
import { IndicePagina } from "../../components/docs/IndicePagina";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pt-14 min-[900px]:flex-row">
      <ArbolLateralConectado />
      <main id="contenido-docs" className="flex flex-1 justify-center overflow-x-hidden px-6 py-11 min-[900px]:px-0">
        <div className="w-full max-w-[640px]">
          <ContextoProfundidadProveedor>{children}</ContextoProfundidadProveedor>
        </div>
      </main>
      <IndicePagina />
    </div>
  );
}
```

- [ ] **Step 7: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add web/components/docs/CabeceraDocs.tsx web/components/docs/ContextoProfundidad.tsx web/components/docs/Detalle.tsx web/components/docs/ControlProfundidad.tsx web/components/docs/Esquema.tsx web/app/docs/layout.tsx
git commit -m "$(cat <<'EOF'
feat(docs): cabecera de página, <Detalle> y control de profundidad

CabeceraDocs cubre los tres primeros pasos de "forma de una página"
(migaja, título, frase). Detalle + ContextoProfundidad implementan el
control global "leer en profundidad" del spec §3 B: un pulso que
sincroniza todos los plegables sin bloquear el toggle individual.
Esquema es el contenedor común de los cinco esquemas de la Tarea 9.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Componentes de registro — `<Dato>` y `<Ficha>`

**Files:**
- Create: `web/lib/registros.ts`
- Create: `web/components/docs/Dato.tsx`
- Create: `web/components/docs/Ficha.tsx`

**Interfaces:**
- Produces: `campoRegistro(id: string, campo: string): unknown` desde `web/lib/registros.ts`.
- Produces: `<Dato id={string} campo={string} />`.
- Produces: `<Ficha id={string} ruta={string} />` (`ruta` es la ruta del fichero de registro para el
  encabezado "Del registro", ej. `"registros/verificadores/roma.json"`).

- [ ] **Step 1: Crear `web/lib/registros.ts`**

```ts
import registros from "./registrosDocs.generated.json";

type RegistroDoc = {
  id: string;
  nombre: string;
  categoria: string;
  tipo?: string;
  licencia?: string;
  dims?: number;
  ficheroPesos?: string;
  sha256?: string;
  activoEnNiveles: string[];
  alternativaNoActiva: boolean;
};

const TABLA = registros as Record<string, RegistroDoc>;

/** Lee un campo de un registro ya volcado a registrosDocs.generated.json
 *  (spec §2: "Dato de campo: imprime un valor leído de registros/, no
 *  tecleado"). Lanza si el id o el campo no existen — un <Dato> que señala
 *  a la nada debe romper el build, no imprimir "undefined" en silencio. */
export function campoRegistro(id: string, campo: keyof RegistroDoc): unknown {
  const registro = TABLA[id];
  if (!registro) throw new Error(`campoRegistro: no existe el registro "${id}" en registrosDocs.generated.json`);
  const valor = registro[campo];
  if (valor === undefined) throw new Error(`campoRegistro: el registro "${id}" no tiene el campo "${String(campo)}"`);
  return valor;
}

export function registroCompleto(id: string): RegistroDoc {
  const registro = TABLA[id];
  if (!registro) throw new Error(`registroCompleto: no existe el registro "${id}" en registrosDocs.generated.json`);
  return registro;
}
```

- [ ] **Step 2: Crear `web/components/docs/Dato.tsx`**

Server component — el valor es texto plano leído en build, así que no necesita cliente.

```tsx
import { campoRegistro } from "../../lib/registros";

export function Dato({ id, campo }: { id: string; campo: string }) {
  const valor = campoRegistro(id, campo as never);
  return <span className="font-mono text-fg">{String(valor)}</span>;
}
```

- [ ] **Step 3: Crear `web/components/docs/Ficha.tsx`**

Genera la tabla de procedencia de una tecnología a partir del registro (spec §5, "La ficha de
tecnología"). Solo renderiza las filas cuyo campo existe (decisión 2 del plan — sin "ficheros
adicionales" inventados).

```tsx
import { registroCompleto } from "../../lib/registros";

export function Ficha({ id, ruta }: { id: string; ruta: string }) {
  const r = registroCompleto(id);
  const estado = r.alternativaNoActiva ? "alternativa no activa" : `activo · ${r.activoEnNiveles.join(", ")}`;

  const filas: { k: string; v: string; mono?: boolean }[] = [];
  if (r.tipo) filas.push({ k: "Tipo", v: r.tipo });
  if (r.licencia) filas.push({ k: "Licencia", v: r.licencia });
  if (r.ficheroPesos) filas.push({ k: "Pesos", v: r.ficheroPesos, mono: true });
  if (r.sha256) filas.push({ k: "Huella SHA-256", v: r.sha256, mono: true });
  filas.push({ k: "Estado", v: estado });

  return (
    <div className="mt-[26px] overflow-hidden rounded-card border border-border">
      <div className="flex items-center gap-[9px] border-b border-border bg-elevated px-[14px] py-[9px]">
        <span className="text-[9.5px] uppercase tracking-[.12em] text-subtle">Del registro</span>
        <span className="ml-auto font-mono text-[10px] text-subtle">{ruta}</span>
      </div>
      <div className="grid grid-cols-2 bg-panel">
        {filas.map((f, i) => (
          <div
            key={f.k}
            className={`border-b border-border px-[14px] py-[11px] ${i % 2 === 0 ? "border-r" : ""} ${
              i >= filas.length - (filas.length % 2 === 0 ? 2 : 1) ? "border-b-0" : ""
            }`}
          >
            <div className="text-[9px] uppercase tracking-[.11em] text-subtle">{f.k}</div>
            <div className={`mt-1 break-all text-[12px] leading-snug ${f.mono ? "font-mono text-muted" : "text-fg"}`}>{f.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores. (`registrosDocs.generated.json` ya existe desde la Tarea 4, así que el import
resuelve.)

- [ ] **Step 5: Commit**

```bash
git add web/lib/registros.ts web/components/docs/Dato.tsx web/components/docs/Ficha.tsx
git commit -m "$(cat <<'EOF'
feat(docs): <Dato> y <Ficha> leen registrosDocs.generated.json

campoRegistro()/registroCompleto() son el único punto de lectura de
esos datos; ambos lanzan si el id o el campo no existen, para que un
<Dato> mal escrito rompa el build en vez de imprimir un valor vacío.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Referencias con previsualización, procedencia y pie de página

**Files:**
- Create: `web/components/docs/EnlacePrevio.tsx`
- Create: `web/components/docs/Tec.tsx`
- Create: `web/components/docs/EncabezadoDocs.tsx`
- Create: `web/components/docs/PiePaginaDocs.tsx`
- Modify: `web/mdx-components.tsx`

**Interfaces:**
- Consumes: `web/lib/indiceDocs.json` (Tarea 4), `siguienteYAnterior` de `web/lib/arbolDocs.ts`.
- Produces: `<EnlacePrevio ruta={string}>{children}</EnlacePrevio>`.
- Produces: `<Tec id={string}>{children}</Tec>`.
- Produces: `<EncabezadoDocs nivel={2|3}>{children}</EncabezadoDocs>` (usado internamente por
  `mdx-components.tsx`, no se importa a mano en las páginas).
- Produces: `<PiePaginaDocs ruta={string} />`.

- [ ] **Step 1: Crear `web/components/docs/EnlacePrevio.tsx`**

Previsualización al pasar el ratón sobre cualquier enlace interno (spec §3 D): retardo de 350ms,
datos de `indiceDocs.json` (sin petición en tiempo de ejecución), navega directo en táctil porque no
hay `mouseenter`.

```tsx
"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import indice from "../../lib/indiceDocs.json";

type PaginaIndice = { ruta: string; ramaTitulo: string; titulo: string; frase: string };

export function EnlacePrevio({ ruta, children }: { ruta: string; children: React.ReactNode }) {
  const [abierta, setAbierta] = useState(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pagina = (indice as { paginas: PaginaIndice[] }).paginas.find((p) => p.ruta === ruta);

  function entrar() {
    temporizador.current = setTimeout(() => setAbierta(true), 350);
  }
  function salir() {
    if (temporizador.current) clearTimeout(temporizador.current);
    setAbierta(false);
  }

  return (
    <span className="relative inline-block" onMouseEnter={entrar} onMouseLeave={salir}>
      <Link href={ruta} className="border-b border-dotted border-subtle pb-px text-fg no-underline hover:border-fg">
        {children}
      </Link>
      {abierta && pagina && (
        <span className="pointer-events-none absolute left-0 top-full z-30 mt-2 block w-64 rounded-card border border-border bg-panel p-3 text-left shadow-xl">
          <span className="block font-mono text-[10px] uppercase tracking-[.1em] text-subtle">{pagina.ramaTitulo}</span>
          <span className="mt-1 block text-[13px] text-fg">{pagina.titulo}</span>
          <span className="mt-1 block text-[11.5px] leading-relaxed text-subtle">{pagina.frase}</span>
        </span>
      )}
    </span>
  );
}
```

- [ ] **Step 2: Crear `web/components/docs/Tec.tsx`**

```tsx
import { EnlacePrevio } from "./EnlacePrevio";

/** Enlace a una página de tecnología. `id` es el slug de la ruta dentro de
 *  la rama "tecnologias" (spec §2, tabla de componentes). indice-docs.mjs
 *  falla el build si `id` no existe ahí. */
export function Tec({ id, children }: { id: string; children: React.ReactNode }) {
  return <EnlacePrevio ruta={`/docs/tecnologias/${id}`}>{children}</EnlacePrevio>;
}
```

- [ ] **Step 3: Crear `web/components/docs/EncabezadoDocs.tsx`**

Intercepta `h2`/`h3` vía `useMDXComponents` (decisión 3 del plan): calcula su propio id con
`slugificar()` y muestra un permalink al pasar el ratón (spec §3 B).

```tsx
"use client";

import { slugificar } from "../../lib/slug";

function textoPlano(nodo: React.ReactNode): string {
  if (typeof nodo === "string") return nodo;
  if (typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoPlano).join("");
  if (nodo && typeof nodo === "object" && "props" in (nodo as { props?: { children?: React.ReactNode } })) {
    return textoPlano((nodo as { props: { children?: React.ReactNode } }).props.children);
  }
  return "";
}

export function EncabezadoDocs({ nivel, children }: { nivel: 2 | 3; children: React.ReactNode }) {
  const id = slugificar(textoPlano(children));
  const Tag = nivel === 2 ? "h2" : "h3";
  return (
    <Tag id={id} className="group scroll-mt-24 text-[15px] font-medium tracking-[-.01em] text-fg [&:not(:first-child)]:mt-11">
      <a href={`#${id}`} className="no-underline">
        {children}
        <span className="ml-2 text-subtle opacity-0 transition-opacity duration-150 group-hover:opacity-100">#</span>
      </a>
    </Tag>
  );
}
```

- [ ] **Step 4: Registrar `h2`/`h3` en `web/mdx-components.tsx`**

Reemplaza el contenido completo del fichero (creado en la Tarea 1) por:

```tsx
import type { MDXComponents } from "mdx/types";
import { EncabezadoDocs } from "./components/docs/EncabezadoDocs";

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    ...components,
    h2: (props) => <EncabezadoDocs nivel={2} {...props} />,
    h3: (props) => <EncabezadoDocs nivel={3} {...props} />,
  };
}
```

- [ ] **Step 5: Crear `web/components/docs/PiePaginaDocs.tsx`**

Pie de procedencia, aviso de página envejecida y anterior/siguiente (spec §3 A y B). Server
component: toda la información sale de `indiceDocs.json` y `arbolDocs.ts`, ya calculada en build.

```tsx
import Link from "next/link";
import indice from "../../lib/indiceDocs.json";
import { siguienteYAnterior } from "../../lib/arbolDocs";

type PaginaIndice = {
  ruta: string;
  procedencia: string[];
  envejecida: boolean;
};

const REPO_GITHUB = "https://github.com/s7lver2/Lumi/blob/main";

export function PiePaginaDocs({ ruta }: { ruta: string }) {
  const entrada = (indice as { paginas: PaginaIndice[] }).paginas.find((p) => p.ruta === ruta);
  const partes = ruta.split("/").filter(Boolean);
  const ramaId = partes[1];
  const paginaRuta = partes[2];
  const { anterior, siguiente } = siguienteYAnterior(ramaId, paginaRuta);

  return (
    <footer className="mt-16 border-t border-border pt-6">
      {entrada && entrada.procedencia.length > 0 && (
        <div className="text-[11px] leading-relaxed text-subtle">
          <span className="uppercase tracking-[.08em]">Escrito contra </span>
          {entrada.procedencia.map((f, i) => (
            <span key={f}>
              {i > 0 && ", "}
              <a href={`${REPO_GITHUB}/${f}`} className="font-mono text-subtle underline decoration-dotted hover:text-muted">
                {f}
              </a>
            </span>
          ))}
          {entrada.envejecida && (
            <div className="mt-1.5 text-warning-fg">
              El código que describe esta página ha cambiado desde la última revisión.
            </div>
          )}
        </div>
      )}
      <div className="mt-6 flex items-stretch gap-3">
        {anterior ? (
          <Link
            href={`/docs/${anterior.ramaId}/${anterior.ruta}`}
            className="jg-micro flex-1 rounded-card border border-border bg-panel px-4 py-3 hover:border-[#33363b]"
          >
            <div className="text-[10px] uppercase tracking-[.08em] text-subtle">Anterior</div>
            <div className="mt-1 text-[13px] text-fg">{anterior.titulo}</div>
          </Link>
        ) : (
          <div className="flex-1" />
        )}
        {siguiente && (
          <Link
            href={`/docs/${siguiente.ramaId}/${siguiente.ruta}`}
            className="jg-micro flex-1 rounded-card border border-border bg-panel px-4 py-3 text-right hover:border-[#33363b]"
          >
            <div className="text-[10px] uppercase tracking-[.08em] text-subtle">Siguiente</div>
            <div className="mt-1 text-[13px] text-fg">{siguiente.titulo}</div>
          </Link>
        )}
      </div>
    </footer>
  );
}
```

- [ ] **Step 6: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add web/components/docs/EnlacePrevio.tsx web/components/docs/Tec.tsx web/components/docs/EncabezadoDocs.tsx web/components/docs/PiePaginaDocs.tsx web/mdx-components.tsx
git commit -m "$(cat <<'EOF'
feat(docs): previsualización de enlaces, permalinks y pie de página

EnlacePrevio/Tec cubren el grupo D del spec (previsualización a los
350ms, sin petición en runtime — todo sale de indiceDocs.json).
EncabezadoDocs intercepta h2/h3 vía useMDXComponents para dar
permalink sin añadir rehype-slug. PiePaginaDocs cierra el grupo A
(procedencia, aviso de página envejecida) y el anterior/siguiente
del grupo B.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 8: Buscador `⌘K`

**Files:**
- Create: `web/components/docs/Buscador.tsx`
- Modify: `web/app/docs/layout.tsx`

**Interfaces:**
- Consumes: `web/lib/indiceDocs.json`.
- Consumes: evento `window` `"docs:abrir-buscador"` disparado por `ArbolLateral` (Tarea 2).
- Produces: `<Buscador />`, montado una vez en el layout de `/docs`.

- [ ] **Step 1: Crear `web/components/docs/Buscador.tsx`**

Filtro en cliente sobre `indiceDocs.json`, sin servicio externo (spec §2). Se abre con `⌘K`/`Ctrl+K`
o el evento que dispara `ArbolLateral`.

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import indice from "../../lib/indiceDocs.json";

type Encabezado = { id: string; texto: string; nivel: number; parrafo: string };
type PaginaIndice = { ruta: string; ramaTitulo: string; titulo: string; frase: string; encabezados: Encabezado[] };

type Resultado = { ruta: string; ramaTitulo: string; titulo: string; contexto: string };

function buscar(consulta: string): Resultado[] {
  const q = consulta.trim().toLowerCase();
  if (q.length === 0) return [];
  const paginas = (indice as { paginas: PaginaIndice[] }).paginas;
  const resultados: Resultado[] = [];
  for (const p of paginas) {
    if (p.titulo.toLowerCase().includes(q) || p.frase.toLowerCase().includes(q)) {
      resultados.push({ ruta: p.ruta, ramaTitulo: p.ramaTitulo, titulo: p.titulo, contexto: p.frase });
    }
    for (const h of p.encabezados) {
      if (h.texto.toLowerCase().includes(q) || h.parrafo.toLowerCase().includes(q)) {
        resultados.push({ ruta: `${p.ruta}#${h.id}`, ramaTitulo: p.ramaTitulo, titulo: `${p.titulo} · ${h.texto}`, contexto: h.parrafo });
      }
    }
  }
  return resultados.slice(0, 24);
}

export function Buscador() {
  const [abierto, setAbierto] = useState(false);
  const [consulta, setConsulta] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const resultados = useMemo(() => buscar(consulta), [consulta]);
  const grupos = useMemo(() => {
    const mapa = new Map<string, Resultado[]>();
    for (const r of resultados) {
      const lista = mapa.get(r.ramaTitulo) ?? [];
      lista.push(r);
      mapa.set(r.ramaTitulo, lista);
    }
    return Array.from(mapa.entries());
  }, [resultados]);

  useEffect(() => {
    function alTeclado(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAbierto((v) => !v);
      }
      if (e.key === "Escape") setAbierto(false);
    }
    function alEvento() {
      setAbierto(true);
    }
    window.addEventListener("keydown", alTeclado);
    window.addEventListener("docs:abrir-buscador", alEvento);
    return () => {
      window.removeEventListener("keydown", alTeclado);
      window.removeEventListener("docs:abrir-buscador", alEvento);
    };
  }, []);

  useEffect(() => {
    if (abierto) {
      setConsulta("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [abierto]);

  if (!abierto) return null;

  function ir(ruta: string) {
    setAbierto(false);
    router.push(ruta);
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-center" onClick={() => setAbierto(false)}>
      <div className="absolute inset-0 bg-[rgba(6,7,9,.72)] backdrop-blur-[3px]" />
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative z-10 mt-24 h-fit max-h-[70vh] w-[600px] max-w-[92vw] overflow-hidden rounded-card border border-white/[.13] bg-[rgba(16,19,25,.94)] shadow-2xl backdrop-blur-xl"
      >
        <div className="flex items-center gap-[11px] border-b border-border px-4 py-[14px]">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6a6c70" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-4.2-4.2" />
          </svg>
          <input
            ref={inputRef}
            value={consulta}
            onChange={(e) => setConsulta(e.target.value)}
            placeholder="Buscar en la documentación"
            className="flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle"
          />
        </div>
        <div className="max-h-[52vh] overflow-y-auto py-2">
          {grupos.map(([rama, items]) => (
            <div key={rama}>
              <div className="px-4 py-[6px] text-[9px] uppercase tracking-[.12em] text-subtle">{rama}</div>
              {items.map((r) => (
                <button
                  key={r.ruta}
                  onClick={() => ir(r.ruta)}
                  className="jg-micro flex w-full items-baseline gap-[10px] px-4 py-2 text-left hover:bg-white/[.055]"
                >
                  <span className="whitespace-nowrap text-[12.5px] text-fg">{r.titulo}</span>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[11px] text-subtle">{r.contexto}</span>
                </button>
              ))}
            </div>
          ))}
          {consulta.trim().length > 0 && resultados.length === 0 && (
            <div className="px-4 py-6 text-center text-[12px] text-subtle">Sin resultados.</div>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Montar `<Buscador />` en el layout**

Modifica `web/app/docs/layout.tsx` para incluirlo una vez, fuera de las tres columnas:

```tsx
import { ArbolLateralConectado } from "../../components/docs/ArbolLateralConectado";
import { Buscador } from "../../components/docs/Buscador";
import { ContextoProfundidadProveedor } from "../../components/docs/ContextoProfundidad";
import { IndicePagina } from "../../components/docs/IndicePagina";

export default function DocsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col pt-14 min-[900px]:flex-row">
      <ArbolLateralConectado />
      <main id="contenido-docs" className="flex flex-1 justify-center overflow-x-hidden px-6 py-11 min-[900px]:px-0">
        <div className="w-full max-w-[640px]">
          <ContextoProfundidadProveedor>{children}</ContextoProfundidadProveedor>
        </div>
      </main>
      <IndicePagina />
      <Buscador />
    </div>
  );
}
```

- [ ] **Step 3: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add web/components/docs/Buscador.tsx web/app/docs/layout.tsx
git commit -m "$(cat <<'EOF'
feat(docs): buscador ⌘K sobre indiceDocs.json

Filtro en cliente agrupado por rama, sin servicio externo. Se abre
con Cmd/Ctrl+K o desde la caja del árbol (evento
"docs:abrir-buscador"), y reutiliza el mismo indiceDocs.json que ya
alimenta las previsualizaciones y el anterior/siguiente.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 9: Los cinco esquemas del núcleo

**Files:**
- Create: `web/components/docs/esquemas/EsquemaViaje.tsx`
- Create: `web/components/docs/esquemas/EsquemaEspacioVectores.tsx`
- Create: `web/components/docs/esquemas/EsquemaEmparejamiento.tsx`
- Create: `web/components/docs/esquemas/EsquemaAgente.tsx`
- Create: `web/components/docs/esquemas/EsquemaConfianza.tsx`
- Modify: `web/app/globals.css`

**Interfaces:**
- Consumes: `<Esquema>` de `web/components/docs/Esquema.tsx` (Tarea 5), `campoRegistro` de
  `web/lib/registros.ts` (Tarea 6, usado desde las páginas MDX que embeben estos esquemas, no desde
  los esquemas mismos — ver Step 1).
- Produces: `<EsquemaViaje rutaActual={string} />`.
- Produces: `<EsquemaEspacioVectores />`.
- Produces: `<EsquemaEmparejamiento etiqueta={string} />`.
- Produces: `<EsquemaAgente />`.
- Produces: `<EsquemaConfianza />`.

- [ ] **Step 1: Añadir la animación del pulso a `web/app/globals.css`**

Al final del fichero (antes de la regla `@media (prefers-reduced-motion: reduce)` que ya existe,
para que quede cubierta por ella):

```css
/* El pulso que recorre las cinco etapas del viaje de una foto (esquema
   EsquemaViaje) — puramente decorativo, spec §4: "el pulso las recorre;
   ninguna transmite información solo con movimiento", así que congelado
   por prefers-reduced-motion (regla global de arriba) el esquema se sigue
   leyendo entero. */
@keyframes jg-viaje-pulso { from { left: 2px; opacity: 0; } 20% { opacity: 1; } 80% { opacity: 1; } to { left: 28px; opacity: 0; } }
.jg-viaje-pulso { animation: jg-viaje-pulso 1.1s cubic-bezier(.16,1,.3,1) infinite; }
```

- [ ] **Step 2: Crear `web/components/docs/esquemas/EsquemaViaje.tsx`**

«El viaje de una foto»: las cinco etapas, el pulso las recorre, cada una se abre al pulsarla, hace de
índice de la rama (spec §4, tabla). Las cifras que son constantes de Rust (200 candidatos, z14) van
en prosa (decisión 1 del plan); las que dependen de un modelo (dimensiones) las pasa la página que
embebe el esquema a través de la prop `dimensionesTexto`, ya resueltas con `<Dato>`/`campoRegistro`
en el server component que la envuelve.

```tsx
"use client";

import Link from "next/link";
import { useState } from "react";
import { Esquema } from "../Esquema";

type Etapa = {
  id: string;
  nombre: string;
  sub: string;
  href: string;
  detalle: string;
};

const ETAPAS: Etapa[] = [
  {
    id: "foto",
    nombre: "La foto",
    sub: "→ vector",
    href: "/docs/como-funciona/el-viaje-de-una-foto",
    detalle:
      "Una fotografía se convierte en un vector de alta dimensión con el modelo de recuperación activo — por defecto SALAD.",
  },
  {
    id: "indice",
    nombre: "El índice",
    sub: "200 candidatos",
    href: "/docs/como-funciona/recuperacion",
    detalle:
      "El vector de tu foto se compara contra millones de vectores de calles ya indexadas. Qdrant mantiene un grafo navegable que llega a los vecinos más próximos visitando una fracción diminuta del total.",
  },
  {
    id: "verificar",
    nombre: "Verificar",
    sub: "geometría",
    href: "/docs/como-funciona/verificacion",
    detalle:
      "Cada candidato se pone a prueba emparejando píxel a píxel con RoMa u otro verificador geométrico. Un candidato que solo se parecía en el color se cae aquí.",
  },
  {
    id: "agentes",
    nombre: "Agentes",
    sub: "qué se ve",
    href: "/docs/como-funciona/agentes",
    detalle:
      "Modelos de visión-lenguaje leen la foto en busca de indicios — idioma, señalética, vegetación— y penalizan las hipótesis que los contradicen.",
  },
  {
    id: "veredicto",
    nombre: "Veredicto",
    sub: "hipótesis",
    href: "/docs/como-funciona/veredicto",
    detalle: "Las hipótesis supervivientes se ordenan por confianza. Ningún agente descarta del todo: solo penaliza.",
  },
];

export function EsquemaViaje({ rutaActual, dimensionesTexto }: { rutaActual: string; dimensionesTexto?: string }) {
  const inicial = Math.max(
    0,
    ETAPAS.findIndex((e) => e.href === rutaActual)
  );
  const [activa, setActiva] = useState(inicial);
  const actual = ETAPAS[activa];

  return (
    <Esquema etiqueta="esquema · el pulso recorre las cinco etapas">
      <div className="flex items-stretch gap-0">
        {ETAPAS.map((etapa, i) => (
          <div key={etapa.id} className="flex flex-1 items-stretch">
            <div className="flex flex-1 flex-col items-center gap-[9px]">
              {etapa.href === rutaActual ? (
                <button
                  type="button"
                  onClick={() => setActiva(i)}
                  className={`flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[9px] border bg-elevated transition-colors duration-200 ${
                    i === activa ? "border-white/[.34]" : "border-border"
                  }`}
                >
                  <div className="text-center text-[11.5px] leading-tight text-fg">{etapa.nombre}</div>
                  <div className="font-mono text-[9.5px] text-subtle">{etapa.sub}</div>
                </button>
              ) : (
                <Link
                  href={etapa.href}
                  className="flex h-[62px] w-full flex-col items-center justify-center gap-1 rounded-[9px] border border-border bg-elevated transition-colors duration-200 hover:border-white/[.34]"
                >
                  <div className="text-center text-[11.5px] leading-tight text-fg">{etapa.nombre}</div>
                  <div className="font-mono text-[9.5px] text-subtle">{etapa.sub}</div>
                </Link>
              )}
              <div className="font-mono text-[10px] text-subtle">{i + 1}</div>
            </div>
            {i < ETAPAS.length - 1 && (
              <div className="relative flex w-[34px] shrink-0 items-center justify-center pb-5">
                <div className="h-px w-full bg-border" />
                <div className="jg-viaje-pulso absolute top-[calc(50%-12px)] left-0 h-[5px] w-[5px] rounded-full bg-fg" />
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-4 border-t border-border pt-[14px]">
        <p className="text-[12.5px] leading-relaxed text-muted">
          <b className="font-normal text-fg">
            Etapa {activa + 1} · {actual.nombre}.
          </b>{" "}
          {actual.detalle}
        </p>
        {activa === 0 && dimensionesTexto && (
          <div className="mt-[11px] flex gap-[26px]">
            <div>
              <div className="font-mono text-[15px] text-fg">{dimensionesTexto}</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">dimensiones</div>
            </div>
          </div>
        )}
        {activa === 1 && (
          <div className="mt-[11px] flex gap-[26px]">
            <div>
              <div className="font-mono text-[15px] text-fg">200</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">candidatos</div>
            </div>
            <div>
              <div className="font-mono text-[15px] text-fg">z14</div>
              <div className="mt-[3px] font-mono text-[9.5px] uppercase tracking-[.1em] text-subtle">tesela</div>
            </div>
          </div>
        )}
      </div>
    </Esquema>
  );
}
```

- [ ] **Step 3: Crear `web/components/docs/esquemas/EsquemaEspacioVectores.tsx`**

«El espacio de vectores»: señalas tu foto y se encienden sus vecinos; un conmutador cambia entre
"parecido de píxeles" y "parecido de lugar" (spec §4, tabla). Las posiciones son ilustrativas —
un diagrama, no una medición— así que no citan registro.

```tsx
"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

const PUNTOS = [
  { id: 0, x: 90, y: 70 },
  { id: 1, x: 150, y: 40 },
  { id: 2, x: 210, y: 95 },
  { id: 3, x: 260, y: 50 },
  { id: 4, x: 320, y: 110 },
  { id: 5, x: 130, y: 130 },
  { id: 6, x: 380, y: 70 },
  { id: 7, x: 430, y: 130 },
  { id: 8, x: 470, y: 60 },
  { id: 9, x: 510, y: 120 },
];

const CONSULTA = { x: 340, y: 90 };

// Vecinos ilustrativos en cada espacio — el mismo punto de consulta tiene
// vecinos casi opuestos según qué mide la distancia.
const VECINOS_PIXEL = [4, 6, 7];
const VECINOS_LUGAR = [1, 5, 9];

export function EsquemaEspacioVectores() {
  const [espacio, setEspacio] = useState<"pixel" | "lugar">("pixel");
  const vecinos = espacio === "pixel" ? VECINOS_PIXEL : VECINOS_LUGAR;

  return (
    <Esquema etiqueta="esquema · señala tu foto y compara los dos espacios">
      <div className="rounded-[9px] border border-border bg-[#0b0c0e] p-3">
        <svg viewBox="0 0 560 170" width="100%" height="170">
          {PUNTOS.map((p) => (
            <circle
              key={p.id}
              cx={p.x}
              cy={p.y}
              r={vecinos.includes(p.id) ? 5 : 3}
              fill={vecinos.includes(p.id) ? "#e8e8e6" : "#3a3d42"}
              className="transition-all duration-300"
            />
          ))}
          {vecinos.map((id) => {
            const p = PUNTOS[id];
            return (
              <line
                key={id}
                x1={CONSULTA.x}
                y1={CONSULTA.y}
                x2={p.x}
                y2={p.y}
                stroke="#e8e8e6"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
            );
          })}
          <circle cx={CONSULTA.x} cy={CONSULTA.y} r="6.5" fill="none" stroke="#e8e8e6" strokeWidth="1.6" />
          <circle cx={CONSULTA.x} cy={CONSULTA.y} r="2" fill="#e8e8e6" />
          <text x={CONSULTA.x + 10} y={CONSULTA.y - 10} fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            tu foto
          </text>
        </svg>
      </div>
      <div className="mt-[14px] flex items-center gap-3">
        <button
          type="button"
          onClick={() => setEspacio("pixel")}
          className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
            espacio === "pixel" ? "border-white/[.34] text-fg" : "border-border text-subtle"
          }`}
        >
          Parecido de píxeles
        </button>
        <button
          type="button"
          onClick={() => setEspacio("lugar")}
          className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
            espacio === "lugar" ? "border-white/[.34] text-fg" : "border-border text-subtle"
          }`}
        >
          Parecido de lugar
        </button>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        {espacio === "pixel"
          ? "Agrupados por color y composición — sin noción de dónde está cada sitio."
          : "Agrupados por el modelo de recuperación: dos fotos de la misma esquina quedan cerca aunque se parezcan poco a simple vista."}
      </p>
    </Esquema>
  );
}
```

- [ ] **Step 4: Crear `web/components/docs/esquemas/EsquemaEmparejamiento.tsx`**

«Emparejamiento denso vs. por puntos»: deslizador de umbral, las descartadas quedan en punteado
tenue (spec §4, tabla). Reutilizado en la página de verificación y en la de RoMa (misma composición
del mockup, con coordenadas fijas para mantener la lectura visual).

```tsx
"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

const PARES = [
  { a: { x: 120, y: 66 }, b: { x: 428, y: 60 }, certeza: 0.91 },
  { a: { x: 60, y: 104 }, b: { x: 370, y: 100 }, certeza: 0.74 },
  { a: { x: 104, y: 104 }, b: { x: 412, y: 100 }, certeza: 0.68 },
  { a: { x: 200, y: 150 }, b: { x: 508, y: 150 }, certeza: 0.55 },
  { a: { x: 214, y: 88 }, b: { x: 520, y: 84 }, certeza: 0.5 },
  { a: { x: 40, y: 150 }, b: { x: 352, y: 150 }, certeza: 0.31 },
  { a: { x: 258, y: 88 }, b: { x: 564, y: 84 }, certeza: 0.22 },
];

export function EsquemaEmparejamiento({ etiqueta }: { etiqueta: string }) {
  const [umbral, setUmbral] = useState(0.46);
  const sobreviven = PARES.filter((p) => p.certeza >= umbral).length;

  return (
    <Esquema etiqueta={etiqueta}>
      <div className="rounded-[9px] border border-border bg-[#0b0c0e] p-2">
        <svg viewBox="0 0 600 188" width="100%" height="188">
          <g stroke="#26282c" strokeWidth="1" fill="none">
            <rect x="18" y="20" width="258" height="148" rx="6" />
            <rect x="324" y="20" width="258" height="148" rx="6" />
          </g>
          {PARES.map((p, i) => {
            const activo = p.certeza >= umbral;
            return (
              <line
                key={i}
                x1={p.a.x}
                y1={p.a.y}
                x2={p.b.x}
                y2={p.b.y}
                stroke={activo ? "#e8e8e6" : "#6a6c70"}
                strokeWidth="1"
                opacity={activo ? 0.72 : 0.3}
                strokeDasharray={activo ? undefined : "3 3"}
              />
            );
          })}
          {PARES.map((p, i) => (
            <g key={i} fill={p.certeza >= umbral ? "#e8e8e6" : "#6a6c70"}>
              <circle cx={p.a.x} cy={p.a.y} r="2.6" />
              <circle cx={p.b.x} cy={p.b.y} r="2.6" />
            </g>
          ))}
          <text x="18" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            tu foto
          </text>
          <text x="324" y="13" fill="#6a6c70" fontSize="9" fontFamily="ui-monospace,Menlo,monospace">
            candidato
          </text>
        </svg>
      </div>
      <div className="mt-[14px] flex items-center gap-[14px]">
        <span className="whitespace-nowrap text-[10.5px] text-subtle">Umbral de certeza</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={umbral}
          onChange={(e) => setUmbral(Number(e.target.value))}
          className="h-[2px] flex-1 accent-fg"
        />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-fg">
          {umbral.toFixed(2)} · {sobreviven} de {PARES.length}
        </span>
      </div>
      <div className="mt-3 flex gap-[18px]">
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-fg" />
          correspondencia por encima del umbral
        </div>
        <div className="flex items-center gap-[7px] text-[10.5px] text-subtle">
          <span className="block h-[2px] w-[14px] rounded-[2px] bg-subtle opacity-50" />
          descartada
        </div>
      </div>
    </Esquema>
  );
}
```

- [ ] **Step 5: Crear `web/components/docs/esquemas/EsquemaAgente.tsx`**

«Un agente por dentro»: pregunta, verbalizadores y confianza por softmax; cambiar la imagen de
ejemplo cambia las barras (spec §4, tabla). Datos de ejemplo ilustrativos (salidas de un softmax de
juguete, no una medición real — igual que el 0,46 del mockup).

```tsx
"use client";

import { useState } from "react";
import { Esquema } from "../Esquema";

type Ejemplo = {
  id: string;
  etiqueta: string;
  pregunta: string;
  barras: { verbalizador: string; probabilidad: number }[];
};

const EJEMPLOS: Ejemplo[] = [
  {
    id: "calle-francesa",
    etiqueta: "calle con rótulos",
    pregunta: '¿Qué idioma es más probable en esta foto?',
    barras: [
      { verbalizador: "francés", probabilidad: 0.62 },
      { verbalizador: "italiano", probabilidad: 0.21 },
      { verbalizador: "español", probabilidad: 0.11 },
      { verbalizador: "alemán", probabilidad: 0.06 },
    ],
  },
  {
    id: "carretera-desierto",
    etiqueta: "carretera despejada",
    pregunta: "¿Qué tipo de vegetación domina la escena?",
    barras: [
      { verbalizador: "arbustiva árida", probabilidad: 0.71 },
      { verbalizador: "bosque templado", probabilidad: 0.15 },
      { verbalizador: "tropical", probabilidad: 0.09 },
      { verbalizador: "ninguna visible", probabilidad: 0.05 },
    ],
  },
];

export function EsquemaAgente() {
  const [activo, setActivo] = useState(0);
  const ejemplo = EJEMPLOS[activo];

  return (
    <Esquema etiqueta="esquema · cambia la imagen de ejemplo">
      <div className="flex gap-2">
        {EJEMPLOS.map((e, i) => (
          <button
            key={e.id}
            type="button"
            onClick={() => setActivo(i)}
            className={`jg-micro rounded-[8px] border px-3 py-[6px] text-[11.5px] ${
              i === activo ? "border-white/[.34] text-fg" : "border-border text-subtle"
            }`}
          >
            {e.etiqueta}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[12.5px] text-muted">{ejemplo.pregunta}</p>
      <div className="mt-3 flex flex-col gap-[9px]">
        {ejemplo.barras.map((b) => (
          <div key={b.verbalizador} className="flex items-center gap-3">
            <span className="w-[120px] shrink-0 text-[11px] text-subtle">{b.verbalizador}</span>
            <div className="h-[7px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
              <div
                className="h-full rounded-[4px] bg-fg transition-[width] duration-300 ease-out"
                style={{ width: `${b.probabilidad * 100}%` }}
              />
            </div>
            <span className="w-[42px] shrink-0 text-right font-mono text-[11px] text-fg">
              {(b.probabilidad * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </Esquema>
  );
}
```

- [ ] **Step 6: Crear `web/components/docs/esquemas/EsquemaConfianza.tsx`**

«Cómo se forma la confianza final»: mover el peso de un agente reordena las hipótesis; ninguna llega
nunca a cero (spec §4, tabla).

```tsx
"use client";

import { useMemo, useState } from "react";
import { Esquema } from "../Esquema";

type Hipotesis = { id: string; lugar: string; base: number; contradiceAgente: boolean };

const HIPOTESIS: Hipotesis[] = [
  { id: "a", lugar: "Lyon, Francia", base: 0.78, contradiceAgente: false },
  { id: "b", lugar: "Turín, Italia", base: 0.64, contradiceAgente: true },
  { id: "c", lugar: "Ginebra, Suiza", base: 0.51, contradiceAgente: true },
];

const PISO_PENALIZACION = 0.15;

export function EsquemaConfianza() {
  const [peso, setPeso] = useState(0.3);

  const ordenadas = useMemo(() => {
    const conFinal = HIPOTESIS.map((h) => {
      const factor = h.contradiceAgente ? Math.max(1 - peso, PISO_PENALIZACION) : 1;
      return { ...h, final: h.base * factor };
    });
    return conFinal.sort((a, b) => b.final - a.final);
  }, [peso]);

  return (
    <Esquema etiqueta="esquema · mueve el peso del agente de idioma">
      <div className="flex flex-col gap-[10px]">
        {ordenadas.map((h) => (
          <div key={h.id} className="flex items-center gap-3 transition-transform duration-300">
            <span className="w-[130px] shrink-0 text-[11.5px] text-fg">{h.lugar}</span>
            <div className="h-[9px] flex-1 overflow-hidden rounded-[4px] bg-elevated">
              <div
                className={`h-full rounded-[4px] transition-[width] duration-300 ease-out ${h.contradiceAgente ? "bg-warning" : "bg-fg"}`}
                style={{ width: `${h.final * 100}%` }}
              />
            </div>
            <span className="w-[46px] shrink-0 text-right font-mono text-[11px] text-fg">{(h.final * 100).toFixed(0)}%</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex items-center gap-[14px] border-t border-border pt-[14px]">
        <span className="whitespace-nowrap text-[10.5px] text-subtle">Peso del agente de idioma</span>
        <input
          type="range"
          min={0}
          max={0.85}
          step={0.01}
          value={peso}
          onChange={(e) => setPeso(Number(e.target.value))}
          className="h-[2px] flex-1 accent-fg"
        />
        <span className="whitespace-nowrap font-mono text-[11.5px] text-fg">{(peso * 100).toFixed(0)}%</span>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-subtle">
        Turín y Ginebra pierden confianza a medida que el agente de idioma pesa más — porque
        contradicen el francés detectado en la señalética— pero nunca desaparecen: el piso es{" "}
        {(PISO_PENALIZACION * 100).toFixed(0)}% de su valor base, no cero.
      </p>
    </Esquema>
  );
}
```

- [ ] **Step 7: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add web/components/docs/esquemas/EsquemaViaje.tsx web/components/docs/esquemas/EsquemaEspacioVectores.tsx web/components/docs/esquemas/EsquemaEmparejamiento.tsx web/components/docs/esquemas/EsquemaAgente.tsx web/components/docs/esquemas/EsquemaConfianza.tsx web/app/globals.css
git commit -m "$(cat <<'EOF'
feat(docs): los cinco esquemas animados del núcleo

EsquemaViaje (doble de índice de rama), EsquemaEspacioVectores,
EsquemaEmparejamiento (reutilizado en verificación y en RoMa),
EsquemaAgente y EsquemaConfianza — los cinco de la fase 1 (spec §4).
Ninguno transmite información solo con movimiento: congelados por
prefers-reduced-motion siguen siendo legibles enteros.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 10: Las seis páginas de contenido

**Files:**
- Create: `web/app/docs/como-funciona/el-viaje-de-una-foto/page.mdx`
- Create: `web/app/docs/como-funciona/recuperacion/page.mdx`
- Create: `web/app/docs/como-funciona/verificacion/page.mdx`
- Create: `web/app/docs/como-funciona/agentes/page.mdx`
- Create: `web/app/docs/como-funciona/veredicto/page.mdx`
- Create: `web/app/docs/tecnologias/roma/page.mdx`

**Interfaces:**
- Consumes: `CabeceraDocs`, `ControlProfundidad`, `Detalle`, `Tec`, `Dato`, `Ficha`, `Codigo`,
  `PiePaginaDocs` de `web/components/docs/`, los cinco esquemas de `web/components/docs/esquemas/`,
  `campoRegistro` de `web/lib/registros.ts`.

Nota: `<Codigo>` no se ha creado todavía en ninguna tarea anterior — créalo aquí, en el primer
`page.mdx` que lo necesita, porque es el único de los seis que lo usa (bloque de código con
anotaciones, spec §2 tabla de componentes).

- [ ] **Step 1: Crear `web/components/docs/Codigo.tsx`**

```tsx
"use client";

type Anotacion = { linea: number; texto: string };

export function Codigo({
  titulo,
  codigo,
  anotaciones = [],
}: {
  titulo: string;
  codigo: string;
  anotaciones?: Anotacion[];
}) {
  const lineas = codigo.split("\n");

  function copiar() {
    navigator.clipboard.writeText(codigo).catch(() => {});
  }

  return (
    <div className="mt-[18px] overflow-hidden rounded-[8px] border border-border bg-[#0b0c0e]">
      <div className="flex items-center border-b border-border px-[11px] py-[7px]">
        <span className="font-mono text-[10px] text-subtle">{titulo}</span>
        <button
          type="button"
          onClick={copiar}
          className="jg-micro ml-auto rounded-[5px] border border-border px-[7px] py-[2px] font-mono text-[10px] text-subtle hover:text-muted"
        >
          copiar
        </button>
      </div>
      <pre className="overflow-x-auto px-[13px] py-3 font-mono text-[11.5px] leading-[1.75] text-muted">
        {lineas.map((l, i) => {
          const n = i + 1;
          const nota = anotaciones.find((a) => a.linea === n);
          return (
            <div key={n} className={nota ? "text-fg" : undefined}>
              {l}
              {nota && <span className="ml-2 text-subtle">{"// " + nota.texto}</span>}
            </div>
          );
        })}
      </pre>
    </div>
  );
}
```

- [ ] **Step 2: Crear `web/app/docs/como-funciona/el-viaje-de-una-foto/page.mdx`**

```mdx
export const frase = "Le das una foto y te dice dónde se tomó. Entre esas dos cosas hay cinco etapas, y ninguna de ellas adivina: cada una descarta o reordena lo que le llega de la anterior.";
export const procedencia = [
  "crates/lumid/src/recuperar.rs",
  "crates/lumi-index/src/agrupar.rs",
  "crates/lumid/src/verificar.rs",
  "crates/lumid/src/agentar.rs",
];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { Tec } from "../../../../components/docs/Tec";
import { EsquemaViaje } from "../../../../components/docs/esquemas/EsquemaViaje";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";
import { campoRegistro } from "../../../../lib/registros";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/como-funciona/el-viaje-de-una-foto" frase={frase} />
  <ControlProfundidad />
</div>

<EsquemaViaje
  rutaActual="/docs/como-funciona/el-viaje-de-una-foto"
  dimensionesTexto={`${campoRegistro("lumi-preview", "dims")}–${campoRegistro("lumi-2", "dims")}`}
/>

Cada etapa del esquema se abre al pulsarla. La primera es la que más gente entiende mal: el índice
**no busca fotos parecidas a la tuya**, busca vectores próximos al tuyo, y dos fotos de la misma
esquina tomadas con diez años de diferencia están mucho más cerca en ese espacio que dos fotos
visualmente similares de ciudades distintas. Esa propiedad no la da Qdrant, la da el modelo que
produjo el vector — por defecto <Tec id="salad">SALAD</Tec>.

Los doscientos candidatos que salen de ahí son una **hipótesis barata**. La siguiente etapa los pone
a prueba con geometría de verdad: <Tec id="roma">RoMa</Tec> intenta emparejar píxel a píxel tu foto
con cada candidato y mide si la correspondencia resultante es consistente con dos cámaras mirando la
misma escena. Un candidato que solo se parecía en el color se cae aquí.

<Detalle titulo="Los números exactos">
  El daemon pide a Qdrant `limit=200` con `hnsw_ef=128` y agrupa el resultado por vecindad de tesela
  z14 antes de verificar, de modo que veinte fotos de la misma manzana cuentan como una sola
  hipótesis y no como veinte. El agrupado vive en `lumi_index::agrupar`; la atribución de cada
  hipótesis a su índice y a su autor vive en `lumid::recuperar`, en Rust y no en el worker de Python,
  porque la procedencia está en SQLite y el worker no la ve.
</Detalle>

<Detalle titulo="Qué hace esto en el código">
  `crates/lumid/src/recuperar.rs` orquesta las cinco etapas para una analísis: pide el vector al
  worker, consulta Qdrant, agrupa con `lumi_index::agrupar`, llama a `crates/lumid/src/verificar.rs`
  para la geometría y a `crates/lumid/src/agentar.rs` para los agentes, y deja el resultado en la
  tabla de análisis de SQLite.
</Detalle>

## Por qué son cinco y no una

Un solo modelo que mirara la foto y dijera una coordenada sería más simple y mucho peor. Las cinco
etapas existen porque cada una falla de una forma distinta, y una que falla tapa el fallo de otra: el
índice puede traer un candidato equivocado, pero la verificación geométrica lo descarta; la
verificación puede confundirse en una escena repetitiva, pero un agente que lee el idioma de un
rótulo la corrige. Ninguna etapa tiene que ser perfecta porque ninguna decide sola.

## Qué pasa cuando no hay índice

Si el servidor todavía no tiene ningún `.lumidx` instalado para la zona de la foto, la etapa del
índice no falla: simplemente no aporta candidatos, y el análisis se resuelve solo con lo que los
agentes puedan inferir del contenido de la imagen — con mucha menos confianza, marcada como tal en el
veredicto.

<PiePaginaDocs ruta="/docs/como-funciona/el-viaje-de-una-foto" />
```

- [ ] **Step 3: Crear `web/app/docs/como-funciona/recuperacion/page.mdx`**

```mdx
export const frase = "Doscientos candidatos no son doscientas fotos parecidas: son doscientos vectores que cayeron cerca del tuyo en un espacio que el modelo de recuperación aprendió a organizar por lugar, no por aspecto.";
export const procedencia = [
  "crates/lumid/src/recuperar.rs",
  "crates/lumid/src/qdrant.rs",
  "crates/lumi-index/src/agrupar.rs",
];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { Tec } from "../../../../components/docs/Tec";
import { EsquemaEspacioVectores } from "../../../../components/docs/esquemas/EsquemaEspacioVectores";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/como-funciona/recuperacion" frase={frase} />
  <ControlProfundidad />
</div>

<EsquemaEspacioVectores />

La recuperación es la primera criba: convierte "busca esta foto en todo el planeta" en "busca esta
foto entre doscientos candidatos plausibles", y lo hace sin mirar contenido — solo distancia en un
espacio vectorial. El modelo por defecto es <Tec id="salad">SALAD</Tec>, entrenado específicamente
para que esa distancia se parezca a la distancia geográfica real, no al parecido visual.

<Detalle titulo="Los números exactos">
  Qdrant mantiene un índice HNSW por `(modelo, versión)`: la consulta pide `limit=200` con
  `hnsw_ef=128`, un compromiso entre recuperar casi siempre el vecino verdadero y no visitar más
  nodos del grafo de los necesarios. El resultado se agrupa por vecindad de tesela z14 en
  `lumi_index::agrupar` antes de pasar a verificación, así que un tramo de calle con muchas fotos
  cuenta como una sola hipótesis.
</Detalle>

<Detalle titulo="Por qué no se descarga solo">
  Los vectores que Qdrant compara no salen de ningún sitio automáticamente: los produce el Indexer al
  sellar un `.lumidx`, con el mismo modelo y versión que el servidor tiene activo. Un servidor sin
  ningún índice instalado para una zona simplemente no tiene candidatos que ofrecer ahí — no es un
  error, es cobertura.
</Detalle>

## Qué diferencia a un modelo de recuperación de otro

No todos entrenan igual: <Tec id="roma">RoMa</Tec> hace algo distinto más adelante (comparar dos
fotos concretas), pero los modelos de esta etapa comprimen una foto entera en un único vector
pensado para compararse contra millones de otros en microsegundos. Esa compresión es la que hace
posible buscar en un continente entero sin verificar geométricamente cada candidato uno a uno.

<PiePaginaDocs ruta="/docs/como-funciona/recuperacion" />
```

- [ ] **Step 4: Crear `web/app/docs/como-funciona/verificacion/page.mdx`**

```mdx
export const frase = "Un candidato que salió del índice todavía no ha demostrado nada: la verificación le pide que encaje geométricamente con tu foto, píxel a píxel, y lo que no encaja se cae aquí.";
export const procedencia = ["crates/lumid/src/verificar.rs", "registros/verificadores/roma.json"];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { Tec } from "../../../../components/docs/Tec";
import { EsquemaEmparejamiento } from "../../../../components/docs/esquemas/EsquemaEmparejamiento";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/como-funciona/verificacion" frase={frase} />
  <ControlProfundidad />
</div>

<EsquemaEmparejamiento etiqueta="esquema · mueve el umbral y mira qué sobrevive" />

La recuperación es barata y aproximada; la verificación es cara y exacta. Por cada candidato,
Lumi intenta encontrar una correspondencia geométrica coherente entre tu foto y la del candidato —
si existe una transformación de cámara plausible que explique dónde cae cada punto de una imagen en
la otra, es evidencia real de que ambas muestran la misma escena. Si no existe, el candidato se
descarta, por muy bien situado que estuviera en el ranking de recuperación.

<Detalle titulo="Los números exactos">
  El verificador por defecto es <Tec id="roma">RoMa</Tec>, que exige un mínimo de correspondencias de
  alta confianza (`umbral_inliers`, definido en `registros/verificadores/roma.json`) para aceptar un
  candidato. Un umbral más alto rechaza más falsos positivos pero también más verdaderos positivos en
  escenas difíciles — el ajuste vive en el propio registro, no en el código.
</Detalle>

<Detalle titulo="Qué hace esto en el código">
  `crates/lumid/src/verificar.rs` invoca al verificador configurado para el nivel activo (Mini no
  verifica; Pro y Vision sí) sobre cada candidato agrupado que llega de recuperación, y anota en la
  hipótesis tanto el número de correspondencias como su distribución espacial.
</Detalle>

## Denso frente a por puntos

<Tec id="roma">RoMa</Tec> es un verificador **denso**: no busca primero un puñado de puntos
interesantes para luego emparejarlos, sino que estima una correspondencia para toda la imagen y
adjunta a cada punto su propia certeza. En una fachada lisa, sin esquinas que detectar, un método por
puntos no encuentra dónde agarrarse; un verificador denso sigue teniendo respuesta y la marca como
poco fiable, que es información útil en vez de silencio. Lumi Vision hace competir varios
verificadores de ambos tipos sobre el mismo par de fotos precisamente para cubrir los casos donde uno
falla y el otro no.

<PiePaginaDocs ruta="/docs/como-funciona/verificacion" />
```

- [ ] **Step 5: Crear `web/app/docs/como-funciona/agentes/page.mdx`**

```mdx
export const frase = "Un agente no mira coordenadas: mira la foto y responde una pregunta concreta — qué idioma hay en ese rótulo, de qué lado circulan los coches — y esa respuesta penaliza o refuerza cada hipótesis geográfica.";
export const procedencia = ["crates/lumid/src/agentar.rs", "registros/agentes/indicios-viales.json"];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { EsquemaAgente } from "../../../../components/docs/esquemas/EsquemaAgente";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/como-funciona/agentes" frase={frase} />
  <ControlProfundidad />
</div>

<EsquemaAgente />

Cada agente es una pregunta fija hecha a un modelo de visión-lenguaje sobre la foto de entrada, con
un conjunto cerrado de respuestas posibles — sus **verbalizadores** — y una probabilidad por cada
uno, calculada con un softmax sobre las puntuaciones del modelo. Un agente de idioma no dice "esto es
Francia"; dice "62% francés, 21% italiano, 11% español, 6% alemán", y esa distribución es lo que
llega a la etapa siguiente.

<Detalle titulo="Los números exactos">
  Los agentes activos dependen del nivel: Mini no ejecuta ninguno, Pro y Vision ejecutan el conjunto
  completo declarado en `registros/niveles/pro.json` — idioma y señalética, condiciones ambientales,
  hora y sombras, tipo de escena, dimensiones de la vía, entre otros. Cada uno es su propio registro
  bajo `registros/agentes/`.
</Detalle>

<Detalle titulo="Qué hace esto en el código">
  `crates/lumid/src/agentar.rs` ejecuta cada agente activo sobre la imagen de entrada y devuelve su
  distribución de verbalizadores; esa distribución no descarta ninguna hipótesis por sí sola, solo
  aporta un factor que la siguiente etapa combina con las demás — ver «El veredicto y su confianza».
</Detalle>

## Por qué verbalizadores y no una respuesta libre

Pedirle a un modelo de lenguaje una respuesta libre ("¿qué idioma ves?") da una cadena de texto que
hay que volver a interpretar, con todo el margen de error que eso añade. Fijar de antemano el
conjunto de respuestas posibles y leer la probabilidad que el propio modelo les asigna es más
barato, más determinista, y compone limpiamente con el resto del sistema: una probabilidad es un
número que otra etapa puede multiplicar.

<PiePaginaDocs ruta="/docs/como-funciona/agentes" />
```

- [ ] **Step 6: Crear `web/app/docs/como-funciona/veredicto/page.mdx`**

```mdx
export const frase = "La confianza final no es un solo número calculado una vez: es la confianza geométrica de la verificación, penalizada — nunca anulada — por cada agente que contradice esa hipótesis.";
export const procedencia = ["crates/lumid/src/agentar.rs", "crates/lumid/src/recuperar.rs"];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { EsquemaConfianza } from "../../../../components/docs/esquemas/EsquemaConfianza";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/como-funciona/veredicto" frase={frase} />
  <ControlProfundidad />
</div>

<EsquemaConfianza />

Cada hipótesis que sobrevive a la verificación geométrica llega con una confianza base, derivada de
cuántas correspondencias encontró el verificador y de lo consistentes que son entre sí. Los agentes
no vuelven a calcular esa confianza desde cero: la **multiplican** por un factor que depende de
cuánto contradicen lo que ven en la foto. Un agente que detecta francés en la señalética no elimina
las hipótesis en Italia — las hace menos probables, con un piso que nunca llega a cero, porque un
agente puede equivocarse y una hipótesis geométricamente fuerte no debería desaparecer por un solo
indicio dudoso.

<Detalle titulo="Los números exactos">
  El piso de penalización existe precisamente para eso: ningún agente, por muy seguro que esté, puede
  hacer que una hipótesis llegue a confianza cero. Lo que sí puede es reordenar el ranking de
  hipótesis que se le muestra al investigador, que es donde vive la decisión real.
</Detalle>

## Por qué no descartar nunca

Descartar de forma dura sería más simple de implementar, pero convertiría cada error de un agente en
un error irrecuperable del sistema entero. Penalizar y dejar que la evidencia geométrica siga
pesando es más lento de razonar pero mucho más robusto: el investigador que revisa el veredicto
siempre puede ver la hipótesis "improbable pero no descartada" si el resto de la evidencia apunta
ahí.

<PiePaginaDocs ruta="/docs/como-funciona/veredicto" />
```

- [ ] **Step 7: Crear `web/app/docs/tecnologias/roma/page.mdx`**

```mdx
export const frase = "Coge dos fotos y dice, para cada punto de una, dónde cae ese mismo punto en la otra. Si no existe una respuesta coherente, las dos fotos no son del mismo sitio — y eso es exactamente lo que Lumi necesita saber.";
export const procedencia = ["registros/verificadores/roma.json", "crates/lumid/src/verificar.rs"];

import { CabeceraDocs } from "../../../../components/docs/CabeceraDocs";
import { ControlProfundidad } from "../../../../components/docs/ControlProfundidad";
import { Detalle } from "../../../../components/docs/Detalle";
import { Ficha } from "../../../../components/docs/Ficha";
import { Tec } from "../../../../components/docs/Tec";
import { EsquemaEmparejamiento } from "../../../../components/docs/esquemas/EsquemaEmparejamiento";
import { PiePaginaDocs } from "../../../../components/docs/PiePaginaDocs";
import { campoRegistro } from "../../../../lib/registros";

<div className="flex items-start justify-between gap-4">
  <CabeceraDocs ruta="/docs/tecnologias/roma" frase={frase} tipo={String(campoRegistro("roma", "tipo")) + " · verificador"} />
  <ControlProfundidad />
</div>

<Ficha id="roma" ruta="registros/verificadores/roma.json" />

<EsquemaEmparejamiento etiqueta="esquema interactivo · mueve el umbral y mira qué sobrevive" />

Lo que hace especial a RoMa frente a <Tec id="lightglue-aliked">LightGlue + ALIKED</Tec> es que es
**denso**: no busca primero un puñado de puntos interesantes para luego emparejarlos, sino que
estima una correspondencia para toda la imagen y adjunta a cada punto su propia certeza. En una
fachada lisa, sin esquinas que detectar, un método por puntos no encuentra dónde agarrarse; RoMa
sigue teniendo respuesta y la marca como poco fiable, que es información útil en vez de silencio.

<Detalle titulo="Los números exactos">
  RoMa necesita, además de sus propios pesos (`roma_outdoor.pth`), el backbone completo de{" "}
  <Tec id="dinov2">DINOv2</Tec> ViT-L/14 como segundo fichero — la propia librería `romatch` lo
  descargaría sola vía `torch.hub` si no se le pasa resuelto, pero este proyecto no deja que ninguna
  librería descargue nada sin huella y licencia verificados, así que ese segundo fichero tiene su
  propia entrada de registro (`dinov2-vitl14.json`) e instalación independiente.
</Detalle>

<Detalle titulo="Por qué no se descarga solo">
  `roma_outdoor` también exige `torch.set_float32_matmul_precision("highest")` antes de invocarse o
  falla con un `RuntimeError` de PyTorch — ese ajuste se aplica una vez al construir el verificador,
  no en cada llamada.
</Detalle>

## Dónde se usa en Lumi

Es el verificador por defecto de Lumi Pro y uno de los que compiten en Lumi Vision. En Mini no
aparece: su coste por par no compensa cuando solo hay un verificador y el objetivo es mantener el
coste bajo.

<PiePaginaDocs ruta="/docs/tecnologias/roma" />
```

- [ ] **Step 8: Ejecutar el generador de índice manualmente y comprobar que pasa**

```bash
cd web && node scripts/indice-docs.mjs
```

Expected: imprime `indice-docs: 6 página(s) indexada(s), N registro(s) copiado(s).` y termina con
código 0 — las seis páginas ya cubren las seis rutas no-pendientes del árbol declaradas en la
Tarea 1, así que la validación debe pasar limpia por primera vez.

- [ ] **Step 9: Verificar tipos**

```bash
cd web && npx tsc --noEmit
```

Expected: sin errores.

- [ ] **Step 10: Commit**

```bash
git add web/components/docs/Codigo.tsx web/app/docs/como-funciona/el-viaje-de-una-foto/page.mdx web/app/docs/como-funciona/recuperacion/page.mdx web/app/docs/como-funciona/verificacion/page.mdx web/app/docs/como-funciona/agentes/page.mdx web/app/docs/como-funciona/veredicto/page.mdx web/app/docs/tecnologias/roma/page.mdx
git commit -m "$(cat <<'EOF'
feat(docs): las seis páginas de la fase 1

El viaje de una foto, recuperación, verificación, agentes, veredicto
y RoMa — las páginas mínimas para estrenar los cinco esquemas del
núcleo, con procedencia real contra el código y frase de apertura en
cada una. Añade <Codigo> (bloque con copiar y anotaciones), el único
componente de contenido que faltaba.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 11: Build final y revisión contra el spec

**Files:** ninguno nuevo — solo verificación. Si el build revela un error real, corrígelo en el
fichero correspondiente de las tareas anteriores y documenta el fix en el commit de esta tarea.

**Interfaces:** ninguna nueva.

- [ ] **Step 1: Build completo**

```bash
cd web && npm run build
```

Expected: termina con código 0. `prebuild` ejecuta `indice-docs.mjs` automáticamente antes de
`next build` (Tarea 4) — si falla ahí, el mensaje de error lista exactamente qué falta (página sin
frase, `<Tec>` roto, o ruta del árbol sin `.mdx`); corrígelo antes de continuar.

- [ ] **Step 2: Revisión manual contra el spec**

Repasa `docs/superpowers/specs/2026-09-18-docs-web-design.md` sección por sección y confirma con un
`grep`/lectura directa que cada punto de la fase 1 tiene su implementación:

```bash
cd "E:\Lumi Station\.claude\worktrees\agent-docs-web-retry"
ls web/app/docs/como-funciona web/app/docs/tecnologias
ls web/components/docs web/components/docs/esquemas
```

Checklist (marca cada uno leyendo el fichero correspondiente, no de memoria):
- [ ] §1: tres columnas (250/640/210), `IndicadorSecciones` oculto bajo `/docs`, entrada "Docs" en
  `Nav`, cinco ramas en el orden del spec, móvil <900px con árbol desplegable.
- [ ] §2: `page.mdx` estático por página, árbol a mano en `arbolDocs.ts`, forma de página
  (migaja→título→frase→esquema→profundidad), los seis componentes de contenido de la tabla existen
  (`Detalle`, `Tec`, `Dato`, `Codigo`, `Ficha`, `Esquema`), buscador con índice generado en build.
- [ ] §3 A: pie de procedencia, fecha real por git, símbolos enlazados al fichero (no a una línea),
  cifras vivas vía `<Dato>` donde el registro las tiene, aviso de página envejecida.
- [ ] §3 B: control único "leer en profundidad", permalink de encabezado, anotaciones numeradas en
  `<Codigo>`, anterior/siguiente con títulos reales del árbol.
- [ ] §3 C: un glifo de trazo por rama, micro-tipografía (comillas latinas y rayas ya usadas en la
  prosa de las seis páginas).
- [ ] §3 D: previsualización a 350ms desde `indiceDocs.json`, sin petición en runtime.
- [ ] §4: los cinco esquemas del núcleo existen y cumplen las condiciones comunes (reduced-motion,
  nada solo-movimiento, cifras de registro donde aplica).
- [ ] §5: las seis páginas nombradas por el spec para la fase 1 existen con contenido real (no
  relleno).
- [ ] §7: no se ha tocado `Nav`/`Pie`/landing/páginas de nivel salvo la entrada de Nav permitida, no
  se han introducido tokens nuevos fuera de `DESIGN.md`.

Si algo de la checklist falla, corrígelo ahora, vuelve a correr `npm run build`, y solo entonces
continúa.

- [ ] **Step 3: Confirmar que el árbol de trabajo queda limpio**

```bash
git status
```

Expected: `nothing to commit, working tree clean`. Si el Step 2 requirió cambios, haz un commit
adicional para ellos antes de este paso (mensaje describiendo el fix concreto, con la misma línea de
atribución que los commits anteriores).

- [ ] **Step 4: No hay commit propio de esta tarea si nada cambió**

Si el Step 2 no requirió ningún cambio, esta tarea no genera commit — su entregable es la
confirmación de que el build pasa y la checklist está satisfecha. Repórtalo así en el report de la
tarea.
