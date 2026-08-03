import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Wizard } from "./wizard/Wizard";
import { PairStep } from "./wizard/PairStep";
import { TelemetryStrip } from "./ui/TelemetryStrip";
import { useServer } from "./lib/store";
import type { Sample } from "./lib/api";

export default function App() {
  const [step, setStep] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const hello = useServer((s) => s.hello);

  useEffect(() => {
    const un = listen<Sample>("telemetry", (e) => useServer.getState().setSample(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  return (
    <div className="relative h-full overflow-hidden">
      <PlanetBackground />
      <TelemetryStrip collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      <Wizard step={step} title="Lumi Station" subtitle="vincular servidor"
        onNext={() => setStep((s) => s + 1)} nextDisabled={!hello}>
        <PairStep onDone={() => setStep((s) => s + 1)} />
      </Wizard>
    </div>
  );
}
