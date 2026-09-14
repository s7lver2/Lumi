import { Component, type ErrorInfo, type ReactNode } from "react";

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
 *  sin dejar pista" en "una pantalla que dice qué pasó y deja recargar". */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("error sin capturar en el árbol de React:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg p-8 text-center">
        <p className="text-[14px] text-fg">Lumi encontró un error y no puede seguir en esta pantalla.</p>
        <p className="max-w-[480px] font-mono text-[11px] leading-relaxed text-subtle">
          {this.state.error.message || String(this.state.error)}
        </p>
        <button onClick={() => window.location.reload()}
          className="jg-press rounded-[9px] border border-white/15 px-4 py-2 text-[11.5px] text-fg">
          Recargar
        </button>
      </div>
    );
  }
}
