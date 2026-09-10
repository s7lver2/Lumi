import { cookies } from "next/headers";
import { NOMBRE_COOKIE, verificarSesion } from "@/lib/adminAuth";
import { BotonCerrarSesion, PanelLiberaciones } from "./PanelLiberaciones";

export const metadata = { title: "Panel de administración — Lumi" };

/// Server Component: decide server-side si hay sesión de admin válida (lee
/// la cookie directamente con `next/headers`, no hace falta un `fetch` a sí
/// mismo) y renderiza login o panel. La parte interactiva vive en
/// `PanelLiberaciones.tsx` porque un Server Component no puede tener
/// `onClick`.
export default async function PanelAdmin() {
  const jar = await cookies();
  const login = verificarSesion(jar.get(NOMBRE_COOKIE)?.value);

  if (!login) {
    return (
      <main className="flex min-h-[100vh] items-center justify-center bg-bg px-6">
        <div className="w-full max-w-xl text-center">
          <span className="block text-[40px] text-accent">✦</span>
          <h1 className="mt-5 text-[24px] font-semibold tracking-tight text-fg">
            Panel de administración
          </h1>
          <p className="mt-3 text-[13px] text-muted">
            Acceso restringido a las cuentas de GitHub autorizadas para revisar
            liberaciones de teselas.
          </p>
          <a
            href="/api/admin/login"
            className="jg-micro jg-micro-scale mt-7 inline-block rounded-card bg-accent px-5 py-2.5 text-[13px] font-medium text-bg hover:opacity-90"
          >
            Continuar con GitHub
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-[100vh] max-w-3xl bg-bg px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-[20px] font-semibold tracking-tight text-fg">
            Liberaciones pendientes
          </h1>
          <p className="mt-1 font-mono text-[11.5px] text-subtle">{login}</p>
        </div>
        <BotonCerrarSesion />
      </div>
      <PanelLiberaciones />
    </main>
  );
}
