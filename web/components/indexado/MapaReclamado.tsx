import { cobertura } from "../../lib/catalogo";
import { RevelaSeccion } from "../RevelaSeccion";
import { MapaInteractivo } from "./MapaInteractivo";

/** Mismo catálogo real que alimenta `Cobertura` en la home (lib/catalogo.ts,
 *  resuelto en servidor), pero sobre un mapa base real de Mapbox en vez de
 *  una proyección propia — ver `MapaInteractivo`. Si GitHub no responde, la
 *  sección lo dice, igual que el resto del sitio. */
export async function MapaReclamado() {
  const resumen = await cobertura();

  return (
    <section id="mapa" className="mx-auto max-w-[1180px] px-7 py-24">
      <RevelaSeccion>
        <span className="font-mono text-[11px] uppercase tracking-wide text-draw-fg">cobertura real</span>
        <h2 className="mt-2 text-[clamp(22px,2.8vw,30px)] font-semibold tracking-tight">
          Las teselas que ya están reclamadas
        </h2>
        <p className="mt-3 max-w-[52ch] leading-relaxed text-muted">
          Un polígono por tesela z14 con dueño, sobre el mapa real. Busca un lugar o un autor.
        </p>

        {resumen ? (
          <MapaInteractivo teselas={resumen.teselas} paquetes={resumen.paquetes} autores={resumen.autores} />
        ) : (
          <p className="mt-8 font-mono text-[11px] text-warning-fg">
            catálogo no disponible — no se pudo consultar GitHub
          </p>
        )}
      </RevelaSeccion>
    </section>
  );
}
