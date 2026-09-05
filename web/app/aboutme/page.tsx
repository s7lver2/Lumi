import { cobertura, topContribuidores } from "../../lib/catalogo";
import { RevelaSeccion } from "../../components/RevelaSeccion";

const GITHUB = "s7lver2";

/** Página personal: quién lo escribe, quién más ha puesto mapa de verdad
 *  (mismo catálogo real que /indexado, no una cifra inventada), y una
 *  dedicatoria. Server component — `cobertura()` hace `await` a GitHub. */
export default async function Page() {
  const resumen = await cobertura();
  const top = resumen ? topContribuidores(resumen, 3) : [];

  return (
    <main className="mx-auto max-w-[1180px] px-7 pb-24 pt-32">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">sobre mí</span>
        <h1 className="mt-2 text-[clamp(26px,3.4vw,38px)] font-semibold tracking-tight">
          Lumi lo escribo yo
        </h1>
        <p className="mt-3 max-w-[62ch] leading-relaxed text-muted">
          Este proyecto lo he hecho yo desde mi casa, con claude, y mucha perseverancia
        </p>
        <a
          className="jg-micro jg-micro-lift mt-5 inline-flex items-center gap-2 rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
          href={`https://github.com/${GITHUB}`}
        >
          <GithubIcono />
          github.com/{GITHUB}
        </a>
      </RevelaSeccion>

      <section className="mt-24">
        <RevelaSeccion>
          <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">catálogo real</span>
          <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">
            Quién más ha puesto mapa
          </h2>
          <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
            El mapa no lo he indexado solo yo, muchas personas contribuyen de forma voluntaria
            Aqui estan los 3 mayores contribuidores
          </p>

          {resumen === null ? (
            <p className="mt-8 font-mono text-[11px] text-warning-fg">
              catálogo no disponible — no se pudo consultar GitHub
            </p>
          ) : top.length === 0 ? (
            <p className="mt-8 font-mono text-[11px] text-subtle">
              todavía nadie ha publicado teselas
            </p>
          ) : (
            <ol className="mt-8 flex flex-col gap-2.5">
              {top.map((c, i) => (
                <li
                  key={c.autor}
                  className="jg-micro flex items-center gap-4 rounded-card border border-border bg-panel px-5 py-3.5 hover:border-subtle"
                >
                  <span className="font-mono text-[11px] tabular-nums text-subtle">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-elevated text-[13px] font-semibold text-fg">
                    {c.autor.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="flex-1 text-[14px] font-medium text-fg">{c.autor}</span>
                  <span className="font-mono text-[12px] tabular-nums text-subtle">
                    {c.teselas} {c.teselas === 1 ? "tesela" : "teselas"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </RevelaSeccion>
      </section>

      <section className="mt-24 max-w-[62ch]">
        <RevelaSeccion>
          <p className="border-l border-border pl-4 text-[15px] italic leading-relaxed text-muted">
            Dedicado a la cartera de Pablo, quien murio desangrado por culpa de que nadie sabe como coño usar
            google cloud console.
            Descanse en paz. Y jodete google
          </p>
        </RevelaSeccion>
      </section>
    </main>
  );
}

function GithubIcono() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
      <path
        d="M12 2.5c-5.25 0-9.5 4.36-9.5 9.75 0 4.31 2.73 7.96 6.52 9.25.48.09.65-.21.65-.48 0-.24-.01-.87-.01-1.7-2.66.59-3.22-1.31-3.22-1.31-.44-1.14-1.07-1.45-1.07-1.45-.87-.61.07-.6.07-.6.97.07 1.48 1.02 1.48 1.02.86 1.5 2.25 1.07 2.8.82.09-.64.34-1.07.61-1.32-2.12-.25-4.35-1.09-4.35-4.83 0-1.07.37-1.94.97-2.62-.1-.25-.42-1.26.09-2.62 0 0 .79-.26 2.6 1a8.8 8.8 0 0 1 4.73 0c1.8-1.26 2.6-1 2.6-1 .51 1.36.19 2.37.09 2.62.6.68.97 1.55.97 2.62 0 3.75-2.23 4.57-4.36 4.82.35.31.65.92.65 1.85 0 1.34-.01 2.41-.01 2.74 0 .27.17.58.66.48A9.78 9.78 0 0 0 21.5 12.25c0-5.39-4.25-9.75-9.5-9.75Z"
        fill="currentColor"
      />
    </svg>
  );
}
