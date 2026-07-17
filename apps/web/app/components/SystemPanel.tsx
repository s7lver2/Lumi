import { FloatingCard } from "./FloatingCard";

export function SystemPanel() {
  return (
    <FloatingCard className="flex items-center justify-between p-5">
      <div>
        <div className="text-sm font-medium text-fg">Volver a ejecutar el setup</div>
        <p className="mt-1 text-xs text-muted">Reinstala dependencias, migra la base de datos o cambia credenciales paso a paso.</p>
      </div>
      <a href="/setup" className="rounded-md border border-white/15 px-4 py-2 text-xs text-fg hover:bg-white/10">Abrir setup</a>
    </FloatingCard>
  );
}
