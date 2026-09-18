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
