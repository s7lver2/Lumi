import { useEffect, useState } from "react";
import { api, type NivelEstado } from "../lib/api";
import { ModelosView } from "../admin/ModelosView";

export function ModelosStep({ token, onStatusChange }: {
  token: string; onStatusChange?: (listo: boolean) => void;
}) {
  const [niveles, setNiveles] = useState<NivelEstado[]>([]);

  async function refrescar() {
    const n = await api.get<NivelEstado[]>("/v1/admin/models", token);
    setNiveles(n);
  }
  useEffect(() => { void refrescar(); }, [token]);

  useEffect(() => {
    const mini = niveles.find((n) => n.id === "mini");
    onStatusChange?.(!!mini && mini.resolucion.faltan.length === 0);
  }, [niveles, onStatusChange]);

  return (
    <div>
      <p className="mb-3 max-w-[52ch] text-[11px] text-muted">
        Con Mini basta para seguir — Pro y Vision se completan cuando quieras, desde el panel.
      </p>
      <ModelosView token={token} nivelInicial="mini" />
    </div>
  );
}
