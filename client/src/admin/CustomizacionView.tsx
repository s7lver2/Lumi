import { MapRow } from "./MapRow";
import { Seccion } from "./AdminPanel";

/** Solo el tema de mapa y quién lo dibuja. La clave de Mapbox en sí vive en
 *  API Keys, junto al resto de credenciales de terceros. */
export function CustomizacionView({ token }: { token: string }) {
  return (
    <Seccion titulo="Customización" grupo="Servidor">
      <p className="text-[11px] text-muted">Qué mapa se dibuja y quién lo sirve.</p>
      <div className="mt-4">
        <MapRow token={token} />
      </div>
    </Seccion>
  );
}
