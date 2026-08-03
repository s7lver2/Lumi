import { useState } from "react";
import { PlanetBackground } from "./ui/PlanetBackground";
import { Wizard } from "./wizard/Wizard";
import { PairStep } from "./wizard/PairStep";
import { useServer } from "./lib/store";

export default function App() {
  const [step, setStep] = useState(0);
  const hello = useServer((s) => s.hello);

  return (
    <div className="relative h-full overflow-hidden">
      <PlanetBackground />
      <Wizard step={step} title="Lumi Station" subtitle="vincular servidor"
        onNext={() => setStep((s) => s + 1)} nextDisabled={!hello}>
        <PairStep onDone={() => setStep((s) => s + 1)} />
      </Wizard>
    </div>
  );
}
