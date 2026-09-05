/** 404 propia, con la misma estética que el resto del sitio — nunca la
 *  página genérica de Next. Sin `usarRevelado` (dispara al entrar en
 *  viewport): aquí no hay scroll que esperar, la página entera ya está a
 *  la vista, así que usa la misma entrada orquestada que el hero. */
export default function NoEncontrado() {
  return (
    <main className="relative flex min-h-[100vh] items-center justify-center overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-bg to-transparent" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-36 bg-gradient-to-b from-bg/70 to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-[560px] px-7 text-center">
        <span className="jg-hero-in block text-[40px] text-accent">✦</span>
        <span
          className="jg-hero-in mt-5 block font-mono text-[11px] uppercase tracking-[.14em] text-subtle"
          style={{ animationDelay: ".06s" }}
        >
          error 404
        </span>
        <h1
          className="jg-hero-in mt-4 text-[clamp(30px,5vw,48px)] font-semibold leading-[1.05] tracking-tight"
          style={{ animationDelay: ".12s" }}
        >
          Esto Lumi no lo <em className="italic text-muted">reconoce</em>.
        </h1>
        <p
          className="jg-hero-in mx-auto mt-5 max-w-[42ch] leading-relaxed text-muted"
          style={{ animationDelay: ".2s" }}
        >
          La página que buscabas no existe o se movió de sitio. Ningún agente ha visto
          suficiente para acotar esta ruta.
        </p>

        <div className="jg-hero-in mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: ".28s" }}>
          <a
            className="jg-micro jg-micro-scale rounded-card border border-border px-4 py-2 text-[13px] font-medium text-fg hover:border-subtle hover:bg-elevated"
            href="/"
          >
            Volver al inicio
          </a>
        </div>
      </div>
    </main>
  );
}
