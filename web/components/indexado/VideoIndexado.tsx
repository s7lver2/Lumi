import { RevelaSeccion } from "../RevelaSeccion";

/** Mismo patrón que `VideoDemo.tsx` en la home: marcador de posición
 *  explícito hasta que exista una grabación real del Indexer en uso — nunca
 *  se deja que un vídeo de relleno se confunda con material real del
 *  producto. */
export function VideoIndexado() {
  return (
    <section id="video" className="mx-auto max-w-[1180px] px-7 py-16">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-subtle">en acción</span>
        <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">
          El Indexer, indexando de verdad
        </h2>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
          Dibujar un área, ver el presupuesto, publicar. Sin cortes.
        </p>

        <div className="jg-micro mt-8 overflow-hidden rounded-card border border-border bg-panel hover:border-subtle">
          <div className="relative aspect-video w-full bg-[#101216]">
            <iframe
              className="absolute inset-0 h-full w-full"
              src="https://www.youtube.com/embed/dQw4w9WgXcQ"
              title="Lumi Indexer en acción — marcador de posición"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
            />
          </div>
        </div>
        <p className="mt-3 font-mono text-[11px] text-subtle">
          marcador de posición — se sustituye por la grabación real
        </p>
      </RevelaSeccion>
    </section>
  );
}
