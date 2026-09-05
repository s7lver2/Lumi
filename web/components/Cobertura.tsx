import { cobertura } from "../lib/catalogo";
import { quadkeyATile, tileACentro, proyectar, siluetaContinentes, areaTeselaKm2 } from "../lib/tiles";
import { CifraIndexada } from "./CifraIndexada";
import { RevelaSeccion } from "./RevelaSeccion";

/** Mapa de cobertura, alimentado por el catálogo real publicado en GitHub
 *  (lib/catalogo.ts) — no un canvas con balizas decorativas. Si GitHub no
 *  responde, la sección lo dice explícitamente; nunca un cero fabricado ni
 *  un mapa vacío en silencio.
 *
 *  La silueta de los continentes es geografía real (Natural Earth 110m vía
 *  world-atlas), no un bitmap aparte ni un trazado inventado a mano: se
 *  recorre el mismo `proyectar()` que ya posiciona las balizas, así que
 *  costa y balizas comparten exactamente la misma proyección — nunca
 *  podrían desalinearse entre sí. */

const W = 960, H = 460;

/** El porcentaje real puede ser diminuto (un puñado de teselas contra
 *  toda la tierra firme del planeta) — mostrarlo con 1-2 decimales fijos
 *  lo redondearía a "0.00%", que se lee como "no hay nada" en vez de "hay
 *  poco todavía". Más decimales cuanto más pequeño es el número. */
export function formatoPorcentaje(p: number): string {
  if (p === 0) return "0%";
  if (p < 0.001) return "< 0.001%";
  if (p < 1) return `${p.toFixed(3)}%`;
  return `${p.toFixed(1)}%`;
}

export async function Cobertura() {
  const resumen = await cobertura();
  const { path: costa, areaKm2: areaTierraKm2 } = siluetaContinentes(W, H);

  // % de tierra indexada, no % del globo — el globo es sobre todo océano,
  // y esa cifra sería minúscula e ilegible. Se compara área contra área
  // (km² real de cada tesela reclamada contra el km² real de tierra firme),
  // no recuento de teselas contra recuento de teselas, porque una tesela
  // z14 cubre mucho más terreno cerca del ecuador que cerca de los polos.
  // Una tesela costera cuenta su área completa aunque parte caiga en el
  // mar — de ahí la nota "estimado", no un dato exacto al metro cuadrado.
  const areaReclamadaKm2 = resumen
    ? resumen.quadkeys.reduce((acc, qk) => {
        const t = quadkeyATile(qk);
        return acc + areaTeselaKm2(t.x, t.y, t.z);
      }, 0)
    : 0;
  const porcentajeIndexado = resumen ? Math.min(100, (areaReclamadaKm2 / areaTierraKm2) * 100) : 0;

  return (
    <section id="cobertura" className="mx-auto max-w-[1180px] px-7 py-28">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">indexado</span>
        <h2 className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight">
          Cuánto mundo ya reconoce Lumi
        </h2>
        <p className="mt-3 max-w-[70ch] leading-relaxed text-muted">
          Cada baliza marca una región con actividad de indexado sobre el terreno real, leída
          del catálogo publicado — el resto del mapa, sin marcar, es lo que aún falta por recorrer.
        </p>

        <div className="jg-micro mt-10 overflow-hidden rounded-card border border-border bg-panel hover:border-subtle">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Mapa de cobertura">
            <rect width={W} height={H} fill="#101216" />
            <path d={costa} fill="rgba(232,232,230,.06)" stroke="rgba(232,232,230,.14)" strokeWidth={0.75} />
            {Array.from({ length: 12 }).map((_, i) => (
              <line key={`m${i}`} x1={(i / 12) * W} y1={0} x2={(i / 12) * W} y2={H} stroke="rgba(232,232,230,.06)" />
            ))}
            {Array.from({ length: 6 }).map((_, i) => (
              <line key={`p${i}`} x1={0} y1={(i / 6) * H} x2={W} y2={(i / 6) * H} stroke="rgba(232,232,230,.06)" />
            ))}
            {resumen?.quadkeys.map((qk, i) => {
              const t = quadkeyATile(qk);
              const { lon, lat } = tileACentro(t.x, t.y, t.z);
              const { x, y } = proyectar(lon, lat, W, H);
              // Parpadeo sutil y desfasado por baliza — nunca a la vez, o se
              // lee como un parpadeo de pantalla en vez de actividad viva.
              // El desfase sale del índice, no de Math.random(): server
              // component, tiene que dar el mismo marcado en cada render.
              return (
                <circle
                  key={qk}
                  cx={x}
                  cy={y}
                  r={2.4}
                  fill="#f2f3f5"
                  className="jg-baliza"
                  style={{ animationDelay: `${(i % 11) * 0.27}s` }}
                />
              );
            })}
          </svg>
        </div>

        {/* La cifra es el punto de la sección entera — antes vivía como una
            línea mono de 11px, del mismo tamaño que "zonas" o "paquetes",
            que son detalle, no el titular. Junto a la barra que ya la
            representaba, pero con el peso que le corresponde: es lo primero
            que se lee de todo el bloque. Mono porque es un dato calculado,
            no prosa (misma regla que IPs/puertos/logs). */}
        {resumen && (
          <div className="mt-8">
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-[clamp(30px,4vw,48px)] leading-none tracking-tight text-fg">
                <CifraIndexada porcentaje={porcentajeIndexado} />
              </span>
              <span className="font-mono text-[12px] text-subtle">tierra firme indexada</span>
            </div>
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-fg"
                style={{ width: `${Math.max(porcentajeIndexado, porcentajeIndexado > 0 ? 0.4 : 0)}%` }}
              />
            </div>
            <p className="mt-1.5 font-mono text-[10px] text-subtle">
              estimado por área de tesela reclamada, no por metro cuadrado exacto — una tesela costera
              cuenta entera aunque parte caiga en el mar
            </p>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2 font-mono text-[11px] text-subtle">
            <span className="h-1.5 w-1.5 rounded-full bg-accent" /> baliza = zona con actividad de indexado
          </div>
          {resumen && (
            <div className="flex gap-5 font-mono text-[11px] text-subtle">
              <span><span className="text-fg">{resumen.quadkeys.length}</span> zonas</span>
              <span><span className="text-fg">{resumen.paquetes}</span> paquetes</span>
              <span><span className="text-fg">{resumen.autores}</span> autores</span>
            </div>
          )}
        </div>

        {resumen === null && (
          <p className="mt-4 font-mono text-[11px] text-warning-fg">
            catálogo no disponible — no se pudo consultar GitHub
          </p>
        )}
      </RevelaSeccion>
    </section>
  );
}
