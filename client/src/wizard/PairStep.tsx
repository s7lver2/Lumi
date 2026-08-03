import { useState } from "react";
import { addrFromKey, api } from "../lib/api";
import { useServer } from "../lib/store";
import { updateSession } from "../lib/session";
import { Icon } from "../ui/Icon";

export function PairStep({ onDone }: { onDone: () => void }) {
  const { key, setKey, hello, setHello } = useServer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function verify() {
    setBusy(true); setError(null);
    try {
      const h = await api.pair(key.trim());
      setHello(h);
      const addr = addrFromKey(key);
      useServer.getState().setAddr(addr);
      // Persistido ya en este punto, no solo al terminar el wizard: si la
      // app se cierra aquí, reabrirla puede reconectar sin la clave
      // original (que a partir del canje de abajo queda gastada).
      updateSession({ addr, fingerprint: h.fingerprint });
      // El secreto es el último campo de la clave: lumi1_<addr>_<huella>_<secreto>.
      const secret = key.trim().split("_").pop() ?? "";
      if (h.state === "unclaimed") {
        const claim = await api.post<{ bootstrap_token: string }>("/v1/claim", { secret });
        useServer.getState().setBootstrapToken(claim.bootstrap_token);
        updateSession({ bootstrapToken: claim.bootstrap_token });
      }
    } catch (e) {
      setHello(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  const fp = hello?.fingerprint ?? "";

  return (
    <>
      <label className="mb-[7px] block text-[11px] tracking-[.02em] text-muted">Clave de vinculación</label>
      <input value={key} onChange={(e) => setKey(e.target.value)} onBlur={verify}
        placeholder="lumi1_192.168.1.40:7717_…"
        className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none transition-[border-color,box-shadow] duration-300 ease-expo focus:border-white/40 focus:shadow-[0_0_0_3px_rgba(242,243,245,.055)]" />

      {busy && (
        <div className="mt-3.5 flex items-center gap-2.5 text-xs text-muted">
          <Icon name="spinner" /> Verificando identidad del servidor
        </div>
      )}

      {hello && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-center gap-2.5 text-xs text-muted">
            <Icon name="check" />
            <span>
              Huella{" "}
              <b className="font-mono font-normal text-fg">
                {[...fp].map((c, i) => (
                  <span key={i} style={{ animation: `jg-fade-rise .4s ${0.3 + i * 0.03}s both` }}>{c}</span>
                ))}
              </b>{" "}
              verificada
            </span>
          </div>
          <p className="mt-2 max-w-[50ch] text-[11px] text-muted">
            Coincide con la que viaja dentro de la clave. Nadie se ha interpuesto en la conexión.
          </p>
        </>
      )}

      {error && (
        <>
          <div className="my-3 h-px bg-border" />
          <div className="flex items-start gap-2.5 text-xs text-danger-fg">
            <Icon name="alert" className="mt-0.5" />
            <span className="text-muted">{error}</span>
          </div>
        </>
      )}
      <button hidden onClick={onDone} />
    </>
  );
}
