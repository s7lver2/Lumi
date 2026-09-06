const KEY_SENSIBILIDAD = "lumi.mapa.sensibilidad";
const KEY_INVERTIR = "lumi.mapa.invertir-zoom";

/** Porcentajes admitidos para la sensibilidad de la rueda del ratón sobre el
 *  mapa. 100% es la tasa por defecto del motor (1/450) — no una preferencia
 *  nuestra, así que quien no toque nada sigue con el comportamiento nativo. */
export const SENSIBILIDADES_CAMARA = [50, 75, 100, 125, 150, 200] as const;
export type SensibilidadCamara = (typeof SENSIBILIDADES_CAMARA)[number];

export function leerSensibilidadCamara(): SensibilidadCamara {
  try {
    const v = Number(localStorage.getItem(KEY_SENSIBILIDAD));
    return (SENSIBILIDADES_CAMARA as readonly number[]).includes(v) ? (v as SensibilidadCamara) : 100;
  } catch {
    return 100;
  }
}

export function setSensibilidadCamara(pct: SensibilidadCamara) {
  localStorage.setItem(KEY_SENSIBILIDAD, String(pct));
}

/** Invierte el sentido de la rueda al hacer zoom sobre el mapa (subir aleja
 *  en vez de acercar). El motor no trae esto de fábrica — MapCanvas sustituye
 *  su rueda nativa por una propia en cuanto esto o la sensibilidad se
 *  apartan de su valor por defecto. */
export function leerInvertirZoom(): boolean {
  try {
    return localStorage.getItem(KEY_INVERTIR) === "1";
  } catch {
    return false;
  }
}

export function setInvertirZoom(activo: boolean) {
  localStorage.setItem(KEY_INVERTIR, activo ? "1" : "0");
}
