/** Ancho del carril y alto de la barra superior, en píxeles reales de CSS
 *  (antes del `--ui-scale` global). Cualquier cosa que se centre "en el
 *  lienzo de trabajo" y no en la ventana entera tiene que descontarlos: sin
 *  esto, un popup centrado con `left-1/2 top-1/2` queda desplazado hacia esa
 *  esquina, y el desplazamiento pesa más cuanto más pequeña es la ventana —
 *  que es justo el "no está centrado en pestañas más pequeñas" que se ve al
 *  redimensionar. */
export const RAIL_W = 44;
export const TOPBAR_H = 38;

/** `left`/`top` para centrar dentro del lienzo de trabajo (a la derecha del
 *  carril, debajo de la barra superior) en vez de en la ventana entera.
 *  Combínalo con `-translate-x-1/2 -translate-y-1/2`. */
export const centerInWorkspace = {
  left: `calc(50% + ${RAIL_W / 2}px)`,
  top: `calc(50% + ${TOPBAR_H / 2}px)`,
};
