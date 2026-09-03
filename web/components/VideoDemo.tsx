"use client";
import { usarRevelado } from "./usarRevelado";

/** Sección de vídeo, justo después de "modelos". Placeholder deliberado
 *  hasta que exista una grabación real de Lumi en uso — se avisa como tal
 *  en vez de dejar que alguien lo confunda con material real del producto. */
export function VideoDemo() {
  const { ref, visible } = usarRevelado<HTMLElement>();

  return (
    <section ref={ref} id="video" className="mx-auto max-w-[1180px] px-7 py-28">
      <span
        className="font-mono text-[11px] uppercase tracking-wide text-subtle"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        meet lumi
      </span>
      <h2
        className="mt-2 text-[clamp(24px,3.4vw,36px)] font-semibold tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .05s" } : { opacity: 0 }}
      >
        Lumi, en marcha
      </h2>
      <p
        className="mt-3 max-w-[70ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .1s" } : { opacity: 0 }}
      >
        Una grabación real del cliente resolviendo un caso, de principio a fin.
      </p>

      <div
        className="jg-micro mt-10 overflow-hidden rounded-card border border-border bg-panel hover:border-subtle"
        style={visible ? { animation: "jg-reveal-up .8s cubic-bezier(.16,1,.3,1) both .16s" } : { opacity: 0 }}
      >
        <div className="relative aspect-video w-full bg-[#101216]">
          <iframe
            className="absolute inset-0 h-full w-full"
            src="https://www.youtube.com/embed/dQw4w9WgXcQ"
            title="Lumi en acción — marcador de posición"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      </div>
      <p className="mt-3 font-mono text-[11px] text-subtle">
        marcador de posición — se sustituye por la grabación real
      </p>
    </section>
  );
}
