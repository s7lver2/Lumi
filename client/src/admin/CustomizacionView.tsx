import { MapRow } from "./MapRow";
import { PolicyRow } from "./PolicyRow";
import { ServerProfileRow } from "./ServerProfileRow";
import { Seccion } from "./AdminPanel";

/** El tema de mapa y quién lo dibuja, y el documento de aceptación al crear
 *  cuenta. La clave de Mapbox en sí vive en API Keys, junto al resto de
 *  credenciales de terceros. */
export function CustomizacionView({ token }: { token: string }) {
  return (
    <Seccion titulo="Customización" grupo="Servidor">
      <p className="text-[11px] text-muted">Qué mapa se dibuja, quién lo sirve, y qué hay que aceptar para entrar.</p>
      <div className="mt-4">
        <MapRow token={token} />
      </div>
      <PolicyRow token={token} />
      <ServerProfileRow token={token} />
    </Seccion>
  );
}
