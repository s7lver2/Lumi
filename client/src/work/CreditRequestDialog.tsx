import { useState } from "react";
import { api, type CreateCreditReq } from "../lib/api";
import { useDismissable } from "../lib/useDismissable";
import { Backdrop, Pop } from "../ui/FloatingCard";
import { Icon } from "../ui/Icon";
import { Center } from "../ui/layout";

/** Mismo patrón visual que PromptDialog, pero con más de un campo — vive
 *  aparte porque PromptDialog está pensado para "un solo campo de texto" y
 *  forzar esto ahí lo complicaría para todos sus otros usos (crear
 *  proyecto, crear caso). */
export function CreditRequestDialog({
  open, tipoInicial, valorActual, token, onDone, onClose,
}: {
  open: boolean;
  tipoInicial: "diario" | "semanal";
  valorActual: number;
  token: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const [tipo, setTipo] = useState<"diario" | "semanal">(tipoInicial);
  const [valor, setValor] = useState(String(valorActual * 2));
  const [mensaje, setMensaje] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { rendered, closing } = useDismissable(open, 180);
  if (!rendered) return null;

  const numero = Number(valor);
  const puede = Number.isFinite(numero) && numero > valorActual && !busy;

  async function enviar() {
    if (!puede) return;
    setBusy(true); setError(null);
    try {
      const req: CreateCreditReq = { tipo, valor_propuesto: numero, mensaje: mensaje.trim() || null };
      await api.post("/v1/me/credit-requests", req, token);
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Backdrop closing={closing} onClick={busy ? undefined : onClose} />
      <Center className="z-[45]">
        <Pop closing={closing} className="w-[340px]">
          <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.92)] p-4 shadow-lg shadow-black/50 backdrop-blur-xl">
            <div className="mb-3.5 flex items-center gap-2.5">
              <span className="grid h-[30px] w-[30px] shrink-0 place-items-center rounded-[9px] bg-white/[.06] text-fg">
                <Icon name="lock" size={15} />
              </span>
              <p className="truncate text-[12.5px] font-medium text-fg">Pedir más cupo</p>
            </div>

            <div className="mb-3 flex gap-1.5">
              {(["diario", "semanal"] as const).map((t) => (
                <button key={t} onClick={() => setTipo(t)} disabled={busy}
                  className={`flex-1 rounded border px-2 py-1.5 text-[10.5px] transition-colors duration-300 ease-expo ${
                    tipo === t ? "border-draw text-fg" : "border-border text-subtle"}`}>
                  {t}
                </button>
              ))}
            </div>

            <div className="mb-2 flex items-baseline justify-between border-b border-border py-[5px] text-[10px]">
              <span className="text-subtle">tu tope actual</span>
              <b className="font-mono font-normal text-muted">{valorActual}</b>
            </div>

            <input autoFocus type="number" min={valorActual + 1} value={valor} disabled={busy}
              onChange={(e) => setValor(e.target.value)}
              className="mt-2 w-full rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[9px] text-[13px] text-fg outline-none transition-colors duration-300 ease-expo focus:border-white/40" />

            <textarea value={mensaje} disabled={busy} rows={2} placeholder="Motivo (opcional)"
              onChange={(e) => setMensaje(e.target.value)}
              className="mt-2 w-full resize-none rounded-[9px] border border-border bg-[#0d0f12] px-[11px] py-[9px] text-[12.5px] text-fg outline-none transition-colors duration-300 ease-expo placeholder:text-subtle focus:border-white/40" />

            {error && <p className="mt-1.5 text-[10.5px] leading-snug text-danger-fg">{error}</p>}

            <div className="mt-3.5 flex items-center gap-2">
              <span className="mr-auto font-mono text-[10px] text-[#4a4d52]">esc cancelar</span>
              <button onClick={onClose} disabled={busy} className="jg-press rounded-[9px] border border-white/15 px-3.5 py-[7px] text-[11.5px] text-fg disabled:opacity-40">Cancelar</button>
              <button onClick={enviar} disabled={!puede} className="jg-press rounded-[9px] bg-accent px-4 py-[7px] text-[11.5px] font-medium text-black disabled:opacity-40">
                {busy ? "Un momento…" : "Enviar"}
              </button>
            </div>
          </div>
        </Pop>
      </Center>
    </>
  );
}
