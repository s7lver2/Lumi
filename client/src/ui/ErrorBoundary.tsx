import { Component, useState, type ErrorInfo, type ReactNode } from "react";

/** Red de seguridad para toda la app: sin esto, un error de render en
 *  CUALQUIER componente (una imagen mal formada, un campo que llega `null`
 *  donde se esperaba un valor...) desmonta el árbol entero de React y deja
 *  la ventana en negro -- el fondo (`bg`, `#0e0f11`) sin nada encima, y sin
 *  ningún rastro salvo lo que haya quedado en la consola de DevTools. Reportado
 *  como "toda la app se puso en negro" mientras corría un agente: ese es
 *  justo el síntoma de un error sin capturar en cualquier punto del árbol
 *  que se repinta durante la espera (progreso, telemetría, la cola).
 *
 *  No arregla la causa de un error concreto -- eso hay que seguir
 *  cazándolo cuando se sepa cuál fue -- pero convierte "la app desaparece
 *  sin dejar pista" en una pantalla que dice qué pasó y deja llevarse el
 *  registro entero (mensaje, pila, qué componente lo disparó) para
 *  reportarlo, sin depender de que alguien tuviera DevTools ya abierto. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null; info: ErrorInfo | null }> {
  state: { error: Error | null; info: ErrorInfo | null } = { error: null, info: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("error sin capturar en el árbol de React:", error, info.componentStack);
    this.setState({ info });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <PantallaDeCrasheo error={this.state.error} info={this.state.info} />;
  }
}

function registro(error: Error, info: ErrorInfo | null): string {
  return [
    `Lumi -- ${new Date().toISOString()}`,
    `Agente: ${navigator.userAgent}`,
    "",
    `${error.name}: ${error.message}`,
    error.stack ?? "(sin pila)",
    "",
    "Componente donde se detectó:",
    info?.componentStack ?? "(sin información de componente)",
  ].join("\n");
}

function PantallaDeCrasheo({ error, info }: { error: Error; info: ErrorInfo | null }) {
  const [detalles, setDetalles] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const texto = registro(error, info);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      // Sin permiso de portapapeles o API no disponible -- "Ver detalles" ya
      // deja el mismo texto seleccionable a mano, así que no hace falta un
      // segundo mensaje de error sobre un botón secundario.
    }
  }

  function descargar() {
    const blob = new Blob([texto], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumi-error-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
      <p className="text-[14px] text-fg">Lumi encontró un error y no puede seguir en esta pantalla.</p>
      <p className="max-w-[480px] font-mono text-[11px] leading-relaxed text-subtle">
        {error.message || String(error)}
      </p>

      <div className="flex gap-2">
        <button onClick={() => window.location.reload()}
          className="jg-press rounded-[9px] bg-accent px-4 py-2 text-[11.5px] font-medium text-black">
          Recargar
        </button>
        <button onClick={() => void copiar()}
          className="jg-press rounded-[9px] border border-white/15 px-4 py-2 text-[11.5px] text-fg">
          {copiado ? "Copiado" : "Copiar registro"}
        </button>
        <button onClick={descargar}
          className="jg-press rounded-[9px] border border-white/15 px-4 py-2 text-[11.5px] text-fg">
          Descargar registro
        </button>
      </div>

      <button onClick={() => setDetalles((v) => !v)}
        className="text-[10.5px] text-subtle underline decoration-dotted underline-offset-2 hover:text-fg">
        {detalles ? "Ocultar detalles técnicos" : "Ver detalles técnicos"}
      </button>
      {detalles && (
        <pre className="max-h-[240px] w-full max-w-[560px] overflow-auto rounded-[9px] border border-border
          bg-black/[.25] p-3 text-left font-mono text-[10px] leading-relaxed text-muted">
          {texto}
        </pre>
      )}
    </div>
  );
}
