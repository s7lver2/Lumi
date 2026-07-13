// apps/web/app/components/PlanetBackground.tsx
"use client";
const STARS = [
  { t: "8%", l: "12%", d: "0s" }, { t: "16%", l: "76%", d: ".6s" }, { t: "26%", l: "40%", d: "1.2s" },
  { t: "12%", l: "58%", d: "1.8s" }, { t: "70%", l: "8%", d: ".4s" }, { t: "82%", l: "30%", d: "2.1s" },
  { t: "60%", l: "88%", d: "1.5s" }, { t: "40%", l: "92%", d: ".9s" },
];
const PLANET_TEX =
  "radial-gradient(70px 46px at 8% 32%,rgba(255,255,255,.06),transparent 70%)," +
  "radial-gradient(90px 56px at 26% 64%,rgba(0,0,0,.28),transparent 70%)," +
  "radial-gradient(56px 44px at 44% 40%,rgba(255,255,255,.05),transparent 70%)," +
  "radial-gradient(100px 66px at 62% 72%,rgba(0,0,0,.24),transparent 70%)," +
  "radial-gradient(70px 46px at 58% 32%,rgba(255,255,255,.06),transparent 70%),#3a3f47";

export function PlanetBackground({ satellite = false, dead = false }: { satellite?: boolean; dead?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-[#05070a]">
      {STARS.map((s, i) => (
        <span key={i} className="lumi-anim absolute h-0.5 w-0.5 rounded-full bg-white"
          style={{ top: s.t, left: s.l, animation: `lumi-twinkle ${dead ? 5 : 3}s ease-in-out ${s.d} infinite`, opacity: dead ? 0.5 : undefined }} />
      ))}
      <div className="absolute -right-40 -bottom-52 h-[520px] w-[520px] overflow-hidden rounded-full"
        style={{ background: "#33383f", boxShadow: "0 0 130px 24px rgba(150,160,175,.10), inset -34px -22px 90px rgba(0,0,0,.65)", filter: dead ? "saturate(0.55) brightness(0.75)" : undefined }}>
        <div className="lumi-anim absolute left-0 top-0 h-full w-[200%]"
          style={{ animation: `lumi-planet-spin ${dead ? 220 : 70}s linear infinite`, background: PLANET_TEX }} />
        <div className="absolute inset-0 rounded-full"
          style={{ background: "radial-gradient(circle at 30% 28%,transparent 42%,rgba(0,0,0,.55) 100%)" }} />
      </div>
      {satellite && !dead && (
        <div className="lumi-anim absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px]"
          style={{ animation: "lumi-orbit 14s linear infinite" }}>
          <div className="absolute -top-1 left-1/2 -ml-[3px] h-[7px] w-[7px] rounded-full bg-[#f4f6f9]"
            style={{ boxShadow: "0 0 10px 2px rgba(255,255,255,.6)" }} />
        </div>
      )}
      {dead && (
        <>
          <div className="absolute -bottom-32 left-1/2 -ml-[260px] h-[520px] w-[520px] rounded-full"
            style={{ border: "1px dashed rgba(239,159,39,0.22)", clipPath: "polygon(0 0, 100% 0, 100% 62%, 0 62%)" }} />
          {[
            { size: 8, color: "var(--danger-fg, #e88f8f)", glow: true, delay: "0s" },
            { size: 6, color: "rgba(239,159,39,0.55)", glow: false, delay: "-0.22s" },
            { size: 4, color: "rgba(239,159,39,0.3)", glow: false, delay: "-0.4s" },
          ].map((dot, i) => (
            <div key={i} className="lumi-anim absolute -bottom-32 left-1/2"
              style={{
                marginLeft: -dot.size / 2, top: -4, height: dot.size, width: dot.size, borderRadius: "50%",
                background: dot.color,
                boxShadow: dot.glow ? "0 0 9px 2px rgba(239,159,39,0.4)" : "none",
                animation: `lumi-tumble-fall 4.2s cubic-bezier(.55,0,.75,1) ${dot.delay} infinite`,
              }} />
          ))}
        </>
      )}
    </div>
  );
}
