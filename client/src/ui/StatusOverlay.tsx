import { useState } from "react";
import { Icon, LockIcon } from "./Icon";

type Status = "reboot" | "error" | "sealed" | "lost";

const COPY: Record<Status, { title: string; sub: string }> = {
  reboot: { title: "Reiniciando", sub: "Vuelve solo. Nada perdido." },
  error: { title: "Fallo al arrancar", sub: "Las GPUs no responden. Paso detenido." },
  sealed: { title: "Servidor sellado", sub: "Nada se ha descifrado." },
  lost: { title: "Sin conexión", sub: "Puede ser tu red. Allí todo sigue corriendo." },
};

const TONE: Record<Status, string> = {
  reboot: "text-draw-fg", error: "text-danger-fg", sealed: "text-warning", lost: "text-subtle",
};

function Line({ icon, children, time }: { icon: React.ReactNode; children: React.ReactNode; time?: string }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5 text-xs text-muted">
      {icon}
      <span>{children}</span>
      {time && <span className="ml-auto font-mono text-[10.5px] text-subtle">{time}</span>}
    </div>
  );
}

export function StatusOverlay({ status, detail, queue, onRetry, onUnseal }: {
  status: Status; detail?: string; queue: number;
  onRetry: () => void; onUnseal: (p: string) => Promise<void>;
}) {
  const [pass, setPass] = useState("");
  const [open, setOpen] = useState(false);
  const { title, sub } = COPY[status];
  const tone = TONE[status];

  return (
    // No es una capa flotante sobre el wizard: sustituye su contenido en el
    // mismo hueco. La franja de telemetría es hermana de este bloque, no su
    // ancestro, así que sigue visible sin que haga falta excluirla a mano.
    <div className="relative z-10 mx-auto w-full max-w-xl px-6 py-9" style={{ animation: "jg-fade-rise .6s both" }}>
        <div className="mb-1 flex items-center gap-2.5">
          <span className="text-fg" style={{ animation: "jg-lock-breathe 2.4s ease-in-out infinite" }}>✦</span>
          <span className="text-[17px] font-medium text-fg">{title}</span>
        </div>
        <p className="mb-6 text-xs text-muted">{sub}</p>

        <div className="rounded-card border border-white/[.13] bg-[rgba(16,19,25,.66)] p-5 shadow-lg shadow-black/40 backdrop-blur-xl">
          <div className={`relative mx-auto mb-4 flex justify-center ${tone}`}>
            <div className="absolute top-0 h-[34px] w-16 rounded-full bg-current opacity-[.13] blur-[18px]" />
            {status === "sealed"
              ? <LockIcon size={32} open={open} className="relative" />
              : <Icon size={32} className="relative"
                  name={status === "reboot" ? "refresh" : status === "error" ? "alert" : "signal-off"} />}
          </div>

          {status === "sealed" ? (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:44">
                Clave maestra bloqueada · <b className="font-normal text-fg">{queue}</b> esperando
              </Line>
              <div className="my-3 h-px bg-border" />
              <label className="mb-[7px] block text-[11px] text-muted">Frase de desbloqueo</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)}
                className="w-full rounded-lg border border-border bg-[#0d0f12] px-3 py-2.5 font-mono text-[12.5px] text-fg outline-none focus:border-white/40" />
            </>
          ) : status === "error" ? (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:31">
                Cola congelada · <b className="font-normal text-fg">{queue}</b>
              </Line>
              <div className="my-3 h-px bg-border" />
              <pre className="overflow-x-auto whitespace-pre rounded-lg border border-border bg-[#08090b] px-3.5 py-3 font-mono text-[11px] leading-[1.7] text-muted">
                {detail ?? "sin salida del daemon"}
              </pre>
            </>
          ) : (
            <>
              <Line icon={<Icon name="pause" className="text-warning" />} time="04:12:07">
                Cola congelada · <b className="font-normal text-fg">{queue}</b>
              </Line>
              <Line icon={<Icon name="spinner" />} time={status === "lost" ? "intento 4" : "18 s"}>
                {status === "lost" ? "Reconectando" : "Esperando"}
              </Line>
            </>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono text-[11px] text-muted">
            {status === "sealed" ? "solo administradores"
              : status === "error" ? "sin reintento automático"
              : "reintento automático"}
          </span>
          <button
            onClick={status === "sealed" ? () => { setOpen(true); void onUnseal(pass); } : onRetry}
            className="rounded-lg bg-accent px-5 py-2 text-xs font-medium text-black transition-transform duration-300 ease-expo active:translate-y-px">
            {status === "sealed" ? "Desbloquear y reanudar" : "Reintentar"}
          </button>
        </div>
    </div>
  );
}
