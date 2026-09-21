import type { Case, Project } from "../lib/api";

/** La pantalla de un caso Darkroom. Hoy solo demuestra que el backend
 *  elegido al crear el caso enruta de extremo a extremo hasta una interfaz
 *  distinta -- el spec 2 trae los archivos, las clases y sus propiedades; el
 *  sitio donde ponerlos ya existe y está probado (spec Darkroom Parte 5). */
export function DarkroomView({
  // `project`/`case_` llegan ya (los pasa `App.tsx` igual que a `CaseView`)
  // pero todavía no se pintan: el spec 2 los necesitará para el título y el
  // panel de propiedades. No se desestructuran para no chocar con
  // `noUnusedLocals`.
  rail, drawer,
}: {
  project: Project;
  case_: Case;
  rail: React.ReactNode;
  drawer: React.ReactNode;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden"
      style={{ animation: "jg-page-fade-in 260ms cubic-bezier(.16,1,.3,1) both" }}>
      <div className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(120% 90% at 50% 35%, #16191d 0%, #0e0f11 70%)" }} />
      {rail}
      <div className="absolute inset-0 grid place-items-center">
        <p className="text-[15px] font-medium tracking-[-.01em] text-fg">ola</p>
      </div>
      {drawer}
    </div>
  );
}
