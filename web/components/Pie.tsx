import { ultimaVersion } from "../lib/version";

/** Pie del sitio. Porta el pie del concepto (líneas 916-937) sin el «3
 *  verificadores en línea» —no hay flota central que contar, Lumi es
 *  autoalojado— y añade el bloque de atribuciones obligatorias. */
export function Pie() {
  const version = ultimaVersion();

  return (
    <footer className="border-t border-border px-6 pb-10 pt-14">
      <div className="mx-auto grid max-w-[1180px] gap-10 sm:grid-cols-[1.3fr_1fr]">
        <div>
          <div className="flex items-center gap-2 text-[13px] font-medium tracking-tight">
            <span className="text-accent">✦</span> Lumi Station
          </div>
          <p className="mt-3 max-w-[46ch] leading-relaxed text-muted">
            Geolocalización de imágenes por inferencia, de código abierto y autoalojada.
            Tus imágenes y tus GPUs no salen de tu servidor.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-6 text-[13px]">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-subtle">modelos</div>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <a className="hover:text-fg" href="/meetmini">Lumi Mini</a>
              <a className="hover:text-fg" href="/meetpro">Lumi Pro</a>
              <a className="hover:text-fg" href="/meetvision">Lumi Vision</a>
            </div>
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-subtle">proyecto</div>
            <div className="mt-3 flex flex-col gap-2 text-muted">
              <a className="hover:text-fg" href="/index">Indexado</a>
              <a className="hover:text-fg" href="/aboutme">Sobre mí</a>
              <a className="hover:text-fg" href="https://github.com/s7lver2/Lumi/releases/latest">Descargar cliente</a>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-10 flex max-w-[1180px] flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-subtle">
        <span>v2.0 · Rust + Python · autoalojado</span>
        {version && <span>última publicación · v{version.version}</span>}
      </div>

      <div className="mx-auto mt-8 max-w-[1180px] border-t border-border pt-6 text-[11px] leading-relaxed text-subtle">
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
    </footer>
  );
}
