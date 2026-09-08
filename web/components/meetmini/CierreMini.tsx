"use client";
import type { ProductoDescargable } from "../../lib/version";
import { SelectorDescarga } from "../SelectorDescarga";
import { usarRevelado } from "../usarRevelado";

/** El cierre de la página: nada nuevo que explicar, solo el paso siguiente.
 *  Reutiliza `SelectorDescarga` tal cual (mismo cuestionario producto →
 *  plataforma que ya usa la home y `/indexado`) en vez de un botón propio
 *  que duplicara esa lógica — es el mismo Lumi que se descarga desde
 *  cualquier otro sitio del site, no una build especial de "Mini". */
export function CierreMini({ productos }: { productos: ProductoDescargable[] }) {
  const { ref, visible } = usarRevelado<HTMLElement>();
  const productosCliente = productos.filter((p) => p.producto === "cliente" || p.producto === "instalador");

  return (
    <section ref={ref} className="mx-auto max-w-[720px] px-7 pb-40 pt-16 text-center">
      <h2
        className="text-[clamp(28px,4.4vw,44px)] font-semibold leading-[1.08] tracking-tight"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both" } : { opacity: 0 }}
      >
        Try Lumi Mini now
      </h2>
      <p
        className="mx-auto mt-4 max-w-[48ch] leading-relaxed text-muted"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .06s" } : { opacity: 0 }}
      >
        Same client, same server — pick Mini once it's paired to your own hardware.
      </p>
      <div
        className="mt-7 flex flex-wrap items-center justify-center gap-3"
        style={visible ? { animation: "jg-reveal-up .7s cubic-bezier(.16,1,.3,1) both .12s" } : { opacity: 0 }}
      >
        <SelectorDescarga productos={productosCliente} />
        <a
          className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
          href="/#agentes"
        >
          See it in action ↓
        </a>
      </div>
    </section>
  );
}
