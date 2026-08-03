import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Wizard } from "./wizard/Wizard";
import { PairStep } from "./wizard/PairStep";
import { AdminStep } from "./wizard/AdminStep";
import { ProvisionStep } from "./wizard/ProvisionStep";
import { TelemetryStrip } from "./ui/TelemetryStrip";
import { StatusOverlay } from "./ui/StatusOverlay";
import { useServer } from "./lib/store";
import { api, type Hello, type Sample } from "./lib/api";

export default function App() {
  const [step, setStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const hello = useServer((s) => s.hello);
  const bootstrapToken = useServer((s) => s.bootstrapToken);
  const [status, setStatus] = useState<"ok" | "reboot" | "error" | "sealed" | "lost">("ok");
  const fails = useRef(0);

  useEffect(() => {
    const un = listen<Sample>("telemetry", (e) => useServer.getState().setSample(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  // Sondear solo DESPUÉS de vincular. Antes no hay servidor al que sondear:
  // `request` falla con "sin servidor vinculado" y el contador de fallos
  // levantaba el overlay de reconexión sin que el usuario hubiera pegado
  // siquiera la clave.
  const paired = hello !== null;
  useEffect(() => {
    if (!paired) return;
    const t = setInterval(async () => {
      try {
        const h = await api.get<Hello>("/v1/hello");
        useServer.getState().setHello(h);
        const wasDown = fails.current > 0;
        fails.current = 0;
        setStatus(h.locked ? "sealed" : wasDown ? "reboot" : "ok");
      } catch {
        fails.current += 1;
        if (fails.current >= 2) setStatus(fails.current > 20 ? "lost" : "reboot");
      }
    }, 3000);
    return () => clearInterval(t);
  }, [paired]);

  async function unseal(passphrase: string) {
    await api.post("/v1/unseal", { passphrase });
  }

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <PlanetBackground dead={status !== "ok"} />
      <TelemetryStrip collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      {/* El wizard se centra en el espacio que deja la franja, en vez de
          colgar de arriba dejando media pantalla vacía. */}
      <div className="relative flex flex-1 items-center justify-center overflow-y-auto">
      <Wizard step={step} title="Lumi Station" subtitle="vincular servidor"
        onBack={step > 0 ? () => setStep((s) => s - 1) : undefined}
        onNext={() => {
          if (step === 1) {
            document.getElementById("admin-submit")?.click();
            return;
          }
          setStep((s) => s + 1);
        }}
        nextDisabled={step === 0 && !hello}>
        {step === 0 && <PairStep onDone={() => setStep(1)} />}
        {step === 1 && <AdminStep bootstrapToken={bootstrapToken} onDone={() => setStep(2)} />}
        {step === 2 && <ProvisionStep onDone={() => setStep(3)} />}
      </Wizard>
      </div>
      {status !== "ok" && (
        <StatusOverlay
          status={status}
          queue={useServer.getState().sample?.queue_depth ?? 0}
          onRetry={() => setStatus("ok")}
          onUnseal={unseal}
        />
      )}
    </div>
  );
}
