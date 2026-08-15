import { useEffect, useState } from "react";
import { api, type SecuritySettings } from "../lib/api";
import { useServer } from "../lib/store";
import { Hueco } from "./Hueco";
import { IndexToast } from "./IndexToast";
import { IndicesPanel } from "./IndicesPanel";
import { ApiKeysView } from "./ApiKeysView";
import { SecurityView } from "./SecurityView";
import { ModelosView } from "./ModelosView";
import { ModelToasts } from "./ModelToasts";
import { QueueRow } from "./QueueRow";
import { RequestsView } from "./RequestsView";
import { ResumenView } from "./ResumenView";
import { CustomizacionView } from "./CustomizacionView";
import { Sidebar, type Seccion } from "./Sidebar";
import { UsersView } from "./UsersView";

const PRONTO: Seccion[] = ["notificaciones", "hardware"];

export function AdminPanel({ token }: { token: string }) {
  const [seccion, setSeccion] = useState<Seccion>("resumen");
  const [cuentas, setCuentas] = useState<Partial<Record<Seccion, { n: number; espera?: boolean }>>>({});
  const [licenciasPendientes, setLicenciasPendientes] = useState(false);
  const capIndices = useServer((s) => s.hello?.capabilities.find((c) => c.id === "indices"));
  // Vive aquí, no dentro de SecurityView, para que un cambio se refleje al
  // instante sin depender de que la propia vista vuelva a pedirlo. (La tira
  // de aviso de mantenimiento, en cambio, ya no depende de este estado — la
  // pinta `App.tsx` para toda la aplicación a partir de la telemetría.)
  const [seguridad, setSeguridad] = useState<SecuritySettings | null>(null);

  // Los contadores de la barra lateral salen del mismo Resumen que pinta la
  // primera pantalla: una sola petición alimenta las dos cosas.
  useEffect(() => {
    api.get<import("../lib/api").Resumen>("/v1/admin/resumen", token)
      .then((r) => setCuentas({
        indices: { n: r.indices },
        solicitudes: { n: r.solicitudes_pendientes, espera: r.solicitudes_pendientes > 0 },
        usuarios: { n: r.usuarios },
        cola: { n: r.analisis_en_cola },
        claves: { n: 1, espera: true },
      }))
      .catch(() => setCuentas({}));
  }, [token]);

  useEffect(() => {
    api.get<SecuritySettings>("/v1/admin/security", token).then(setSeguridad).catch(() => setSeguridad(null));
  }, [token]);

  return (
    <div className="relative z-10 grid h-full w-full grid-cols-[206px_1fr] overflow-hidden bg-bg">
      <Sidebar actual={seccion} onIr={setSeccion} contadores={cuentas} />
      <div key={seccion} className="overflow-y-auto"
        style={{ animation: "jg-fade-rise .5s cubic-bezier(.16,1,.3,1) both" }}>
        {PRONTO.includes(seccion) ? <Hueco seccion={seccion} />
          : seccion === "resumen" ? <ResumenView token={token} onIr={setSeccion} />
          : seccion === "solicitudes" ? <Seccion titulo="Solicitudes de acceso" grupo="Personas">
              <RequestsView token={token} /></Seccion>
          : seccion === "usuarios" ? <UsersView token={token} />
          : seccion === "seguridad" ? <SecurityView token={token} ajustes={seguridad} onCambiar={setSeguridad} />
          : seccion === "claves" ? <ApiKeysView token={token} onIr={setSeccion} />
          : seccion === "personalizacion" ? <CustomizacionView token={token} />
          : seccion === "modelos" ? <ModelosView token={token} onLicenciasPendientesChange={setLicenciasPendientes} />
          : seccion === "cola" ? <Seccion titulo="Cola" grupo="Operación">
              <QueueRow token={token} /></Seccion>
                    : <Seccion titulo="Índices instalados" grupo="Servidor"
              accion={
                <button disabled title="Abrirá el catálogo remoto; todavía no hace nada"
                  className="inline-flex items-center gap-1.5 rounded-[8px] bg-accent px-2.5 py-1
                    text-[10.5px] font-medium text-black opacity-40">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  Instalar índice
                </button>
              }>
              {capIndices?.state === "on" ? <IndicesPanel token={token} /> : (
                <p className="mt-[19px] text-[11px] text-muted">{capIndices?.reason ?? "no disponible"}</p>
              )}
            </Seccion>}
      </div>
      <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2.5" style={{ width: 308 }}>
        <ModelToasts token={token} onIr={setSeccion} licenciasPendientes={licenciasPendientes} />
        <IndexToast token={token} onIr={setSeccion} />
      </div>
    </div>
  );
}

/** La cabecera común de una sección mudada. Existe para que las cinco vistas
 *  que se mudan no tengan que aprender a pintar su propio título. */
export function Seccion({ titulo, grupo, accion, children }: {
  titulo: string; grupo: string; accion?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <div className="px-6 pb-8 pt-5">
      <span className="mb-1.5 block text-[8.5px] uppercase tracking-[.15em] text-subtle">{grupo}</span>
      <div className="flex items-end gap-3 border-b border-border pb-[11px]">
        <h2 className="text-[21px] font-medium leading-none tracking-[-.025em]">{titulo}</h2>
        {accion && <span className="ml-auto pb-px">{accion}</span>}
      </div>
      <div className="mt-[19px]">{children}</div>
    </div>
  );
}