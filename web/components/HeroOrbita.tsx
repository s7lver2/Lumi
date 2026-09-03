"use client";
import { useEffect, useRef, useState } from "react";
import { usarEscenaViva } from "./usarEscenaViva";

/** Escena 3D del hero: un planeta de puntos con los tres modelos (Mini,
 *  Pro, Vision) orbitando y descendiendo a "escanear" zonas — eco directo
 *  del mapa de cobertura. Motor propio en canvas 2D (proyección de
 *  perspectiva manual), porte de la escena `hero3d` del concepto (líneas
 *  649-690 y 1118-1498 de `2026-09-02-concepto-landing-v6.html`).
 *
 *  ponytail: el concepto distinguía tierra/océano con una máscara de
 *  continentes cargada de un bitmap aparte; ese asset no forma parte de
 *  esta tanda, así que los puntos de la esfera son uniformes. La lectura
 *  como "planeta" la sostienen el graticulo, el halo y las órbitas, no el
 *  contorno de los continentes.
 */

const R = 1;
const N = 900;

type Punto = { x: number; y: number; z: number; lit: number };

type EstadoSat = "orbit" | "diving" | "scanning" | "returning";

type Satelite = {
  c: string; nombre: string; radio: number; anillo: boolean;
  incl: number; nodo: number; velocidad: number; fase: number; orbitR: number;
  estado: EstadoSat; t0: number;
  from: { x: number; y: number; z: number } | null;
  to: { x: number; y: number; z: number } | null;
  targetIdx: number;
  pos: { x: number; y: number; z: number };
  orbitPath: { x: number; y: number; z: number }[];
};

function crearEsfera(): Punto[] {
  const golden = Math.PI * (3 - Math.sqrt(5));
  const esfera: Punto[] = [];
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const t = golden * i;
    esfera.push({ x: Math.cos(t) * r * R, y: y * R, z: Math.sin(t) * r * R, lit: 0 });
  }
  return esfera;
}

function circlePts(axis: "eq" | "m0" | "m1") {
  const pts: { x: number; y: number; z: number }[] = [];
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    if (axis === "eq") pts.push({ x: Math.cos(a) * R, y: 0, z: Math.sin(a) * R });
    else if (axis === "m0") pts.push({ x: 0, y: Math.cos(a) * R, z: Math.sin(a) * R });
    else pts.push({ x: Math.sin(a) * R * 0.94, y: Math.cos(a) * R * 0.94, z: 0.34 * R });
  }
  return pts;
}
const GRATICULE = [circlePts("eq"), circlePts("m0"), circlePts("m1")];

function orbitPosAt(sat: Pick<Satelite, "orbitR" | "incl" | "nodo">, a: number) {
  const x = Math.cos(a) * sat.orbitR, y0 = 0, z = Math.sin(a) * sat.orbitR;
  const y1 = y0 * Math.cos(sat.incl) - z * Math.sin(sat.incl);
  const z1 = y0 * Math.sin(sat.incl) + z * Math.cos(sat.incl);
  const x2 = x * Math.cos(sat.nodo) - z1 * Math.sin(sat.nodo);
  const z2 = x * Math.sin(sat.nodo) + z1 * Math.cos(sat.nodo);
  return { x: x2, y: y1, z: z2 };
}

/** ease-out cúbica — timing no lineal para el pulso de "bloqueo de escaneo":
 *  arranca rápido y se asienta, en vez del lerp plano que había antes. */
function easeOutCubic(x: number) {
  return 1 - Math.pow(1 - x, 3);
}

function rad_outer(scale: number, camZ: number) {
  return scale / (camZ - R * 0.02);
}

function project(p: { x: number; y: number; z: number }, rotY: number, tiltX: number, camZ: number, scale: number, cx: number, cy: number) {
  let x = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
  let z = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);
  const y = p.y * Math.cos(tiltX) - z * Math.sin(tiltX);
  z = p.y * Math.sin(tiltX) + z * Math.cos(tiltX);
  const depth = Math.max(camZ * 0.42, camZ - z);
  const f = scale / depth;
  return { sx: cx + x * f, sy: cy - y * f, z, f };
}

function crearSatelites(): Satelite[] {
  const modelos = [
    { c: "55,138,221", nombre: "Mini", radio: 5.5, anillo: false },
    { c: "239,185,104", nombre: "Pro", radio: 7, anillo: true },
    { c: "242,243,245", nombre: "Vision", radio: 8.5, anillo: true },
  ];
  return modelos.map((m, i) => {
    const sat: Satelite = {
      c: m.c, nombre: m.nombre, radio: m.radio, anillo: m.anillo,
      incl: (0.22 + i * 0.16) * (i % 2 ? 1 : -1),
      nodo: (i / modelos.length) * Math.PI * 2 + 0.4,
      velocidad: 0.16 + i * 0.05, fase: Math.random() * Math.PI * 2,
      orbitR: R * (1.55 + i * 0.34),
      estado: "orbit", t0: 0, from: null, to: null, targetIdx: -1,
      pos: { x: 0, y: 0, z: 0 }, orbitPath: [],
    };
    const N_MUESTRAS = 56;
    for (let k = 0; k <= N_MUESTRAS; k++) {
      sat.orbitPath.push(orbitPosAt(sat, (k / N_MUESTRAS) * Math.PI * 2));
    }
    sat.pos = orbitPosAt(sat, sat.fase);
    return sat;
  });
}

export function HeroOrbita() {
  const seccionRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { viva, reducido } = usarEscenaViva(seccionRef);
  const [movil, setMovil] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const sinc = () => setMovil(mq.matches);
    sinc();
    mq.addEventListener("change", sinc);
    return () => mq.removeEventListener("change", sinc);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0, H = 0;
    function tamano() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const parent = canvas!.parentElement!;
      W = parent.clientWidth; H = parent.clientHeight;
      canvas!.width = W * dpr; canvas!.height = H * dpr;
      canvas!.style.width = W + "px"; canvas!.style.height = H + "px";
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    tamano();
    window.addEventListener("resize", tamano);

    const esfera = crearEsfera();
    const satelites = crearSatelites();
    const t0 = performance.now();
    let vivo = true;

    function pintar(t: number) {
      ctx!.clearRect(0, 0, W, H);
      // El planeta se ancla cerca del borde inferior y mucho más grande —
      // cámara casi rozando la superficie en vez de la esfera completa
      // flotando pequeña en el centro. Centrado en X: el hero ya no reserva
      // el lado izquierdo para texto asimétrico.
      const cx = W * 0.5, cy = H * 1.04;
      const scale = Math.min(W, H) * 0.98;
      const camZ = 2.55;
      const rotY = t * 0.07;
      const tiltX = 0.3 + Math.sin(t * 0.12) * 0.04;

      // Capa de fondo casi imperceptible: un anillo muy amplio y muy tenue
      // que gira a una fracción de la velocidad del planeta — da la lectura
      // de profundidad (algo lejos, algo cerca) sin añadir polvo estelar
      // ni paralaje decorativo nuevo, solo una segunda velocidad angular.
      ctx!.save();
      ctx!.translate(cx, cy);
      ctx!.rotate(rotY * 0.22);
      ctx!.beginPath();
      ctx!.ellipse(0, 0, rad_outer(scale, camZ) * 1.62, rad_outer(scale, camZ) * 0.58, 0, 0, Math.PI * 2);
      ctx!.strokeStyle = "rgba(160,176,196,.05)";
      ctx!.lineWidth = 1;
      ctx!.stroke();
      ctx!.restore();

      const rad = scale / (camZ - R * 0.02);
      // Iluminación del planeta: halo frontal más marcado + sombra de
      // terminador tenue en el borde opuesto para dar volumen real.
      const grad = ctx!.createRadialGradient(cx - rad * 0.3, cy - rad * 0.34, rad * 0.5, cx, cy, rad * 1.16);
      grad.addColorStop(0, "rgba(255,255,255,0)");
      grad.addColorStop(0.72, "rgba(255,255,255,0)");
      grad.addColorStop(0.9, "rgba(206,220,236,0.13)");
      grad.addColorStop(1, "rgba(120,150,180,0)");
      ctx!.fillStyle = grad;
      ctx!.beginPath(); ctx!.arc(cx, cy, rad * 1.18, 0, Math.PI * 2); ctx!.fill();

      const terminador = ctx!.createRadialGradient(cx + rad * 0.4, cy + rad * 0.42, rad * 0.2, cx, cy, rad * 1.02);
      terminador.addColorStop(0, "rgba(5,7,10,.32)");
      terminador.addColorStop(1, "rgba(5,7,10,0)");
      ctx!.fillStyle = terminador;
      ctx!.beginPath(); ctx!.arc(cx, cy, rad * 1.02, 0, Math.PI * 2); ctx!.fill();

      ctx!.lineWidth = 1;
      GRATICULE.forEach((ring) => {
        ctx!.beginPath();
        let iniciado = false;
        for (let i = 0; i <= ring.length; i++) {
          const gp = ring[i % ring.length];
          const p = project(gp, rotY, tiltX, camZ, scale, cx, cy);
          if (p.z > R * 0.06) { iniciado = false; continue; }
          if (!iniciado) { ctx!.moveTo(p.sx, p.sy); iniciado = true; } else ctx!.lineTo(p.sx, p.sy);
        }
        ctx!.strokeStyle = "rgba(180,196,214,.08)";
        ctx!.stroke();
      });

      satelites.forEach((sat) => {
        ctx!.beginPath();
        let iniciado = false;
        for (let k = 0; k < sat.orbitPath.length; k++) {
          const p = project(sat.orbitPath[k], rotY, tiltX, camZ, scale, cx, cy);
          if (p.z > R * 0.05) { iniciado = false; continue; }
          if (!iniciado) { ctx!.moveTo(p.sx, p.sy); iniciado = true; } else ctx!.lineTo(p.sx, p.sy);
        }
        ctx!.strokeStyle = `rgba(${sat.c},.14)`;
        ctx!.lineWidth = 1;
        ctx!.stroke();
      });

      satelites.forEach((sat) => {
        if (sat.estado === "orbit" && Math.random() < 0.0011) {
          const idx = Math.floor(Math.random() * esfera.length);
          sat.estado = "diving"; sat.t0 = t; sat.targetIdx = idx;
          sat.from = orbitPosAt(sat, sat.fase + t * sat.velocidad);
          const sp = esfera[idx];
          sat.to = { x: sp.x * 1.12, y: sp.y * 1.12, z: sp.z * 1.12 };
        }
        if (sat.estado === "orbit") {
          sat.pos = orbitPosAt(sat, sat.fase + t * sat.velocidad);
        } else if (sat.estado === "diving") {
          const p = Math.min(1, (t - sat.t0) / 1.1);
          const from = sat.from!, to = sat.to!;
          sat.pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p, z: from.z + (to.z - from.z) * p };
          if (p >= 1) { sat.estado = "scanning"; sat.t0 = t; }
        } else if (sat.estado === "scanning") {
          sat.pos = sat.to!;
          const p = Math.min(1, (t - sat.t0) / 0.9);
          const pe = easeOutCubic(p); // bloqueo: rápido al entrar, se asienta al final
          const objetivo = esfera[sat.targetIdx];
          const scanR = 0.1 + pe * 0.24; // el radio de barrido crece con la curva, no de golpe
          for (let i = 0; i < esfera.length; i++) {
            const sp = esfera[i];
            const d = Math.hypot(sp.x - objetivo.x, sp.y - objetivo.y, sp.z - objetivo.z);
            if (d < scanR) sp.lit = Math.max(sp.lit, 1 - d / scanR);
          }
          if (p >= 1) { sat.estado = "returning"; sat.t0 = t; sat.from = sat.pos; sat.to = orbitPosAt(sat, sat.fase + t * sat.velocidad); }
        } else {
          const p = Math.min(1, (t - sat.t0) / 0.9);
          const liveOrbit = orbitPosAt(sat, sat.fase + t * sat.velocidad);
          const from = sat.from!;
          sat.pos = { x: from.x + (liveOrbit.x - from.x) * p, y: from.y + (liveOrbit.y - from.y) * p, z: from.z + (liveOrbit.z - from.z) * p };
          if (p >= 1) sat.estado = "orbit";
        }
      });

      for (let i = 0; i < esfera.length; i++) esfera[i].lit *= 0.985;

      for (let i = 0; i < esfera.length; i++) {
        const sp = esfera[i];
        const p = project(sp, rotY, tiltX, camZ, scale, cx, cy);
        if (p.z > R * 0.15) continue;
        const near = 1 - Math.min(1, Math.max(0, (p.z + R) / (R * 1.4)));
        const lit = sp.lit;
        const radDot = 0.6 + near * 0.7 + lit * 0.9;
        const a = Math.min(1, 0.14 + near * 0.3 + lit * 0.85);
        const grey = 150 + lit * (242 - 150);
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${grey | 0},${grey | 0},${(grey - 5) | 0},${a})`;
        ctx!.arc(p.sx, p.sy, radDot, 0, Math.PI * 2);
        ctx!.fill();
      }

      satelites.forEach((sat) => {
        const p = project(sat.pos, rotY, tiltX, camZ, scale, cx, cy);
        const dim = sat.estado === "orbit" ? 0.5 : 1;
        const escaneando = sat.estado === "diving" || sat.estado === "scanning";

        if (escaneando && sat.to) {
          const tp = project(sat.to, rotY, tiltX, camZ, scale, cx, cy);
          const spread = 5.5;
          ctx!.lineWidth = 1;
          for (let k = -1; k <= 1; k++) {
            ctx!.beginPath();
            ctx!.strokeStyle = `rgba(${sat.c},${k === 0 ? 0.55 : 0.22})`;
            ctx!.moveTo(p.sx, p.sy);
            ctx!.lineTo(tp.sx + k * spread, tp.sy + k * spread * 0.6);
            ctx!.stroke();
          }
        }

        const nearSat = Math.max(0, Math.min(1, (p.z + R * 2.4) / (R * 3.4)));
        const pr = sat.radio * (sat.estado === "orbit" ? 0.6 : 0.92) * (0.65 + nearSat * 0.7);
        if (sat.anillo) {
          ctx!.save();
          ctx!.translate(p.sx, p.sy);
          ctx!.scale(1, 0.42);
          ctx!.beginPath();
          ctx!.strokeStyle = `rgba(${sat.c},${dim * 0.55})`;
          ctx!.lineWidth = 1.1;
          ctx!.arc(0, 0, pr * 1.85, 0, Math.PI * 2);
          ctx!.stroke();
          ctx!.restore();
        }
        const pgrad = ctx!.createRadialGradient(p.sx - pr * 0.35, p.sy - pr * 0.35, pr * 0.1, p.sx, p.sy, pr * 1.05);
        pgrad.addColorStop(0, `rgba(${sat.c},${dim})`);
        pgrad.addColorStop(0.7, `rgba(${sat.c},${dim * 0.85})`);
        pgrad.addColorStop(1, `rgba(${sat.c},${dim * 0.25})`);
        ctx!.beginPath();
        ctx!.fillStyle = pgrad;
        ctx!.arc(p.sx, p.sy, pr, 0, Math.PI * 2);
        ctx!.fill();
      });

    }

    function bucle(now: number) {
      if (!vivo) return;
      const t = (now - t0) / 1000;
      pintar(t);
      requestAnimationFrame(bucle);
    }

    if (movil || reducido || !viva) {
      // Fotograma estático legible: se pinta una vez y el bucle no arranca.
      pintar(0);
    } else {
      requestAnimationFrame(bucle);
    }

    return () => { vivo = false; window.removeEventListener("resize", tamano); };
  }, [viva, reducido, movil]);

  return (
    <div ref={seccionRef} className="relative h-full w-full">
      <canvas ref={canvasRef} className="absolute inset-0" />
    </div>
  );
}
