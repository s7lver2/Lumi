import { useState } from "react";

/** Rangos privados de sobra conocidos — lo primero que se sugiere en cuanto
 *  el campo tiene el foco, antes de que la persona escriba nada. */
const RANGOS_COMUNES = [
  { valor: "192.168.*.*", nota: "red local (clase C)" },
  { valor: "10.*.*.*", nota: "red local (clase A)" },
  { valor: "172.16.*.*", nota: "red local (clase B)" },
  { valor: "127.0.0.1", nota: "esta misma máquina" },
];

/** "192.168" → "192.168.*.*", "192.168.1" → "192.168.1.*". Nada que sugerir
 *  si ya parece un CIDR, un comodín, IPv6, o una IPv4 ya completa — en esos
 *  casos la persona ya sabe lo que quiere escribir. */
function sugerirComodin(texto: string): string | null {
  const limpio = texto.trim();
  if (!limpio || limpio.includes("/") || limpio.includes("*") || limpio.includes(":")) return null;
  const partes = limpio.split(".").filter((p) => p !== "");
  if (partes.length === 0 || partes.length >= 4) return null;
  if (!partes.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)) return null;
  return [...partes, ...Array(4 - partes.length).fill("*")].join(".");
}

/** Sí/no puede mandarse: IPv4 exacta, CIDR (`a.b.c.d/n`), comodín por octeto
 *  (`a.b.*.* `), o cualquier cosa con `:` (IPv6, que el backend compara
 *  exacto). Mismo criterio que `zero_trust::ip_matches` en el daemon — si
 *  esto lo acepta, el daemon también lo entiende. */
function esFormatoValido(texto: string): boolean {
  const s = texto.trim();
  if (!s) return false;
  if (s.includes(":")) return true;
  if (s.includes("*")) {
    const p = s.split(".");
    return p.length === 4 && p.every((o) => o === "*" || (/^\d{1,3}$/.test(o) && Number(o) <= 255));
  }
  if (s.includes("/")) {
    const [base, bits] = s.split("/");
    const p = base.split(".");
    return p.length === 4 && p.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255)
      && /^\d{1,2}$/.test(bits ?? "") && Number(bits) <= 32;
  }
  const p = s.split(".");
  return p.length === 4 && p.every((o) => /^\d{1,3}$/.test(o) && Number(o) <= 255);
}

/** Campo de IP/CIDR/comodín con sugerencias — mismo patrón en todo el
 *  catálogo (aquí y en el modal de emitir clave). Enter o el botón mandan;
 *  clic en una sugerencia la escribe y la manda directamente. */
export function IpInput({ onAgregar, placeholder = "IP, CIDR o 192.168.*.*" }: {
  onAgregar: (ip: string) => void; placeholder?: string;
}) {
  const [valor, setValor] = useState("");
  const [foco, setFoco] = useState(false);

  const valido = valor.trim() === "" || esFormatoValido(valor);
  const comodin = sugerirComodin(valor);
  const rangos = RANGOS_COMUNES.filter((r) => r.valor.startsWith(valor.trim()) && r.valor !== valor.trim());
  const sugerencias = [
    ...(comodin && comodin !== valor.trim() ? [{ valor: comodin, nota: "comodín a partir de lo escrito" }] : []),
    ...rangos,
  ].slice(0, 4);

  function mandar(v: string) {
    if (!esFormatoValido(v)) return;
    onAgregar(v.trim());
    setValor("");
  }

  return (
    <div className="relative flex-1">
      <div className="flex gap-1.5">
        <input value={valor} onChange={(e) => setValor(e.target.value)}
          onFocus={() => setFoco(true)} onBlur={() => setTimeout(() => setFoco(false), 120)}
          onKeyDown={(e) => { if (e.key === "Enter") mandar(valor); }}
          placeholder={placeholder}
          className={`flex-1 rounded-lg border bg-elevated px-2.5 py-1 font-mono text-[10.5px] text-fg outline-none
            transition-colors duration-200 ${
            valor && !valido ? "border-danger/50 focus:border-danger/70" : "border-border focus:border-white/40"
          }`} />
        <button onClick={() => mandar(valor)} disabled={!valor.trim() || !valido}
          className="rounded-lg border border-border px-2.5 py-1 text-[9.5px] text-fg disabled:opacity-35">
          Añadir
        </button>
      </div>
      {valor && !valido && (
        <p className="mt-1 text-[9px] text-danger-fg">IP, CIDR (`a.b.c.d/n`) o comodín (`a.b.*.*`) — no reconozco esta forma.</p>
      )}
      {foco && sugerencias.length > 0 && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-10 overflow-hidden rounded-lg border border-white/15 bg-[rgba(20,22,27,.97)] shadow-lg backdrop-blur-xl">
          {sugerencias.map((s) => (
            <button key={s.valor} onMouseDown={(e) => { e.preventDefault(); mandar(s.valor); }}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-white/[.06]">
              <span className="font-mono text-[10.5px] text-fg">{s.valor}</span>
              <span className="ml-auto text-[9px] text-subtle">{s.nota}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
