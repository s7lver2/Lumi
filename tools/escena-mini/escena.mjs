// La escena del hero de /meetmini: un servidor, una mano robótica que lo
// aprieta, y un Mac mini.
//
// No es código del sitio. Esto se corre una vez en un Chromium headless
// (`capturar.mjs`), se guardan los fotogramas, y lo que viaja a `web/` son las
// imágenes. Ver docs/superpowers/specs/2026-09-07-pagina-mini-design.md.
//
// Toda la parametrización vive arriba a propósito: iterar sobre esta escena es
// mirar un fotograma y mover un número, y no hay que bucear en el montaje para
// encontrarlo.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// La paleta es la de DESIGN.md, no la de los modelos originales: sus texturas
// de color se descartan enteras (ver `neutralizar`) y solo se conserva el
// relieve. Es lo que garantiza que la escena sea de Lumi y no de tres autores
// distintos de Sketchfab.
export const PALETA = {
  fondo: 0x0e0f11, // bg
  metal: 0x8e9196, // gris frío neutro para el grueso del metal
  metalOscuro: 0x3a3e44, // border, para plásticos y chasis
  emisivo: 0xe8e8e6, // fg -- decisión del propietario: sin color
};

export const AJUSTES = {
  // Escalas relativas. El servidor manda (escala 1) y el resto se mide contra
  // él. No son proporciones del mundo real: un servidor de verdad es cinco
  // veces más ancho que una mano, y con eso la pinza no se lee. Manda que el
  // gesto se entienda.
  escalaMacMini: 0.42,
  escalaBrazo: 0.026,

  // Encuadre.
  camara: { pos: [1.9, 0.85, 2.35], mira: [0, 0.02, 0], fov: 32 },

  // Cómo se orienta el brazo. NO son ángulos de Euler: encadenar tres giros
  // sobre un modelo que ya viene girado es imposible de razonar (cada ajuste
  // mueve los otros dos ejes y acaba enseñando el codo a cámara). En su lugar
  // se declara HACIA DÓNDE apuntan los dedos, y cuánto rueda la muñeca sobre
  // ese mismo eje. Dos números con significado, independientes entre sí.
  dirDedos: [-0.72, -0.12, 0.68], // el brazo cruza en diagonal desde la derecha
  giroPalma: 0.3, // rueda la mano sobre el eje de los dedos

  // Reposo del servidor: de casi tres cuartos a algo más frontal. El frontal
  // (rejilla y asas) es su cara con detalle; de canto no es más que una losa.
  servidorGiro: [0.92, 0.58],

  // Momentos de la línea de tiempo, en t normalizado [0,1].
  tiempos: {
    entraMano: [0.14, 0.4], // la mano entra en cuadro y se coloca
    cierraPinza: [0.36, 0.56], // los dedos se cierran sobre el servidor
    comprime: [0.5, 0.82], // el servidor se aplasta
    fundido: [0.62, 0.78], // servidor -> Mac mini
    asienta: [0.82, 1.0], // remate: se queda quieto en la mano
  },

  // Cuánto se cierran pulgar e índice, en radianes por articulación.
  pinza: { pulgar: 0.52, indice: 0.62 },

  // Dónde acaba la YEMA del índice, no el pivote del modelo. El pivote del
  // brazo cae a media altura del antebrazo y a mano no hay forma de saber
  // dónde deja los dedos; aquí se declara el punto de agarre y la posición del
  // brazo se despeja midiendo el rig (ver `montar`).
  servidorEn: [-0.34, 0.0, 0.0], // reposo, descentrado a la izquierda
  pinzaEn: [0.06, 0.0, 0.2], // borde derecho del servidor, ya casi en el centro
  // Cuánto más lejos, en la dirección de los dedos, arranca la mano antes de
  // entrar en cuadro.
  retroceso: 1.15,
};

// Los huesos del pulgar y del índice, deducidos de la jerarquía del rig (ver
// `sondear.mjs`): el pulgar es la única cadena de cuatro que arranca baja en la
// palma; el índice es la cadena de tres más cercana a él.
const PULGAR = ["Bone003_03", "Bone015_04", "Bone004_05", "Bone005_06"];
const INDICE = ["Bone016_016", "Bone017_017", "Bone018_018"];

const suave = (x) => x * x * (3 - 2 * x); // smoothstep
const clamp01 = (x) => Math.min(1, Math.max(0, x));
/** Progreso dentro de un tramo [a,b] de la línea de tiempo, suavizado. */
const tramo = (t, [a, b]) => suave(clamp01((t - a) / (b - a)));
const mezcla = (a, b, k) => a + (b - a) * k;
const ORIGEN = new THREE.Vector3(0, 0, 0);

/**
 * Descarta el color que traía el modelo y deja solo el relieve.
 *
 * Los tres modelos vienen de autores distintos, con sus propias texturas de
 * color: azules, cromados, un logo de Apple. Tintar por encima no basta —
 * `material.color` multiplica el mapa, así que un mapa saturado sigue
 * saturado. Se tira el mapa de color entero y se conservan normales, rugosidad
 * y metalicidad, que son las que llevan todo el detalle mecánico. El resultado
 * es la misma pieza, en la paleta de Lumi.
 */
function neutralizar(raiz, { color = PALETA.metal, metalness = 0.85, roughness = 0.42 } = {}) {
  const cacheEmisivo = new Map();
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    const viejos = Array.isArray(o.material) ? o.material : [o.material];
    const nuevos = viejos.map((m) => {
      const emisivo = m.emissiveMap ? aLuminancia(m.emissiveMap, cacheEmisivo) : null;
      const nuevo = new THREE.MeshStandardMaterial({
        color,
        metalness,
        roughness,
        normalMap: m.normalMap ?? null,
        roughnessMap: m.roughnessMap ?? null,
        metalnessMap: m.metalnessMap ?? null,
        // Donde el autor puso una parte que brilla sola, brilla en `fg`.
        emissive: emisivo ? new THREE.Color(PALETA.emisivo) : new THREE.Color(0x000000),
        emissiveMap: emisivo,
        emissiveIntensity: emisivo ? 1.15 : 0,
        transparent: true,
        opacity: 1,
      });
      if (nuevo.normalMap) nuevo.normalScale = m.normalScale?.clone() ?? new THREE.Vector2(1, 1);
      return nuevo;
    });
    o.material = Array.isArray(o.material) ? nuevos : nuevos[0];
    o.castShadow = true;
    o.receiveShadow = true;
  });
}

/**
 * Un mapa emisivo pasado a luminancia, para usarlo como MÁSCARA y no como
 * color.
 *
 * El brazo trae sus partes luminosas en azul, dentro de la propia textura. El
 * color emisivo del material MULTIPLICA esa textura, así que poner `fg` encima
 * de un mapa azul da azul, no blanco: no hay forma de neutralizarlo desde el
 * material. Se convierte la textura a gris y entonces sí, el color del material
 * manda y las partes que brillan brillan en `fg`.
 */
function aLuminancia(textura, cache) {
  if (cache.has(textura.uuid)) return cache.get(textura.uuid);
  const img = textura.image;
  const lienzo = document.createElement("canvas");
  lienzo.width = img.width;
  lienzo.height = img.height;
  const ctx = lienzo.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const datos = ctx.getImageData(0, 0, lienzo.width, lienzo.height);
  const p = datos.data;
  for (let i = 0; i < p.length; i += 4) {
    const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2];
    p[i] = p[i + 1] = p[i + 2] = l;
  }
  ctx.putImageData(datos, 0, 0);
  const nueva = new THREE.CanvasTexture(lienzo);
  nueva.flipY = textura.flipY;
  nueva.colorSpace = textura.colorSpace;
  nueva.wrapS = textura.wrapS;
  nueva.wrapT = textura.wrapT;
  cache.set(textura.uuid, nueva);
  return nueva;
}

/** Opacidad de todo un subárbol, para los fundidos. */
function opacar(raiz, valor) {
  raiz.visible = valor > 0.002;
  raiz.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) m.opacity = valor;
  });
}

/** Centra un objeto en el origen y lo escala para que su ancho sea `ancho`. */
function encajar(objeto, ancho) {
  const caja = new THREE.Box3().setFromObject(objeto);
  const tam = caja.getSize(new THREE.Vector3());
  const centro = caja.getCenter(new THREE.Vector3());
  objeto.position.sub(centro);
  const envoltorio = new THREE.Group();
  envoltorio.add(objeto);
  envoltorio.scale.setScalar(ancho / tam.x);
  return envoltorio;
}

/**
 * Una sola unidad del rack, no el armario entero.
 *
 * El modelo trae nueve servidores montados dentro de un armario, más tornillos,
 * asas y pilotos sueltos: 459 mallas en total. Quedarse solo con las mallas que
 * se llaman `RackMount Server0XX` daría un chasis pelado, sin frontal ni asas,
 * porque esas piezas son hermanas suyas y no hijas. Se recorta por FRANJA DE
 * ALTURA: todo lo que caiga dentro del grosor de esa unidad viene con ella.
 */
export function extraerUnidad(rack) {
  const alturas = [];
  rack.traverse((o) => {
    if (o.isMesh && /RackMount.Server/i.test(o.name)) {
      const caja = new THREE.Box3().setFromObject(o);
      alturas.push({ min: caja.min.y, max: caja.max.y });
    }
  });
  if (alturas.length === 0) throw new Error("no encuentro ninguna unidad rack-mount");
  // La del medio del armario: las de los extremos suelen estar recortadas por
  // la tapa o el zócalo.
  alturas.sort((a, b) => a.min - b.min);
  const elegida = alturas[Math.floor(alturas.length / 2)];
  const margen = (elegida.max - elegida.min) * 0.12;
  const min = elegida.min - margen;
  const max = elegida.max + margen;

  const unidad = new THREE.Group();
  const candidatos = [];
  rack.traverse((o) => {
    if (!o.isMesh) return;
    const caja = new THREE.Box3().setFromObject(o);
    const centroY = (caja.min.y + caja.max.y) / 2;
    // El armario entero también cruza la franja; se descarta por ser
    // desproporcionadamente alto respecto a la unidad.
    const alto = caja.max.y - caja.min.y;
    if (centroY >= min && centroY <= max && alto < (max - min) * 2.2) candidatos.push(o);
  });
  for (const o of candidatos) {
    const copia = o.clone();
    o.getWorldPosition(copia.position);
    o.getWorldQuaternion(copia.quaternion);
    o.getWorldScale(copia.scale);
    unidad.add(copia);
  }
  return unidad;
}

export async function montar(ancho, alto) {
  const cargador = new GLTFLoader();
  const cargar = (r) => new Promise((ok, mal) => cargador.load(r, ok, undefined, mal));

  const escena = new THREE.Scene();
  escena.background = new THREE.Color(PALETA.fondo);

  const camara = new THREE.PerspectiveCamera(AJUSTES.camara.fov, ancho / alto, 0.01, 100);
  camara.position.set(...AJUSTES.camara.pos);
  camara.lookAt(...AJUSTES.camara.mira);

  // Luz dura de un solo tono: dramática, sin tintes fuera de paleta. El
  // contraluz es lo que despega la silueta del fondo, que es del mismo color
  // que el de la página.
  const clave = new THREE.DirectionalLight(0xffffff, 2.2);
  clave.position.set(2.4, 3.2, 2.2);
  clave.castShadow = true;
  clave.shadow.mapSize.set(2048, 2048);
  clave.shadow.camera.near = 0.1;
  clave.shadow.camera.far = 12;
  clave.shadow.bias = -0.0008;
  escena.add(clave);

  const contra = new THREE.DirectionalLight(0xdfe6f2, 2.2);
  contra.position.set(-2.6, 1.4, -2.4);
  escena.add(contra);

  const relleno = new THREE.HemisphereLight(0xa8b0bd, 0x0e0f11, 0.55);
  escena.add(relleno);

  // --- servidor ---
  const rack = await cargar("/modelos/server_racking_system/scene.gltf");
  const unidad = extraerUnidad(rack.scene);
  neutralizar(unidad, { color: PALETA.metalOscuro, metalness: 0.65, roughness: 0.72 });
  const servidor = encajar(unidad, 1);
  servidor.position.set(...AJUSTES.servidorEn);
  escena.add(servidor);

  // --- mac mini ---
  const mini = await cargar("/modelos/apple_mac_mini_m1/scene.gltf");
  neutralizar(mini.scene, { color: PALETA.metal, metalness: 0.88, roughness: 0.44 });
  const macMini = encajar(mini.scene, AJUSTES.escalaMacMini);
  escena.add(macMini);
  opacar(macMini, 0);

  // A cuánto tiene que encogerse el servidor para que, en el instante del
  // fundido, su silueta y la del Mac mini coincidan. Se mide en vez de
  // ajustarse a ojo: un servidor y un Mac mini tienen proporciones distintas
  // (el servidor es mucho más grueso en relación a su ancho), así que aplastar
  // los tres ejes por igual dejaría un fundido entre dos siluetas que no
  // encajan y se ve como un salto.
  const medir = (o) => new THREE.Box3().setFromObject(o).getSize(new THREE.Vector3());
  const tamServidor = medir(servidor);
  const tamMini = medir(macMini);
  const COMPRIME = {
    x: tamMini.x / tamServidor.x,
    y: tamMini.y / tamServidor.y,
    z: tamMini.z / tamServidor.z,
  };

  // --- brazo ---
  // Dos niveles: el interior lleva la corrección de cómo viene el modelo
  // (dedos a +Y) y no se toca nunca; el exterior es el que anima la entrada en
  // cuadro. Mezclar ambas cosas en un solo objeto obliga a recalcular la
  // corrección cada vez que se mueve la mano.
  const brazoGltf = await cargar("/modelos/robotic_prosthetic_arm/scene.gltf");
  neutralizar(brazoGltf.scene, { color: PALETA.metal, metalness: 0.88, roughness: 0.35 });
  const brazoInterno = brazoGltf.scene;
  brazoInterno.scale.setScalar(AJUSTES.escalaBrazo);
  const brazo = new THREE.Group();
  brazo.add(brazoInterno);
  escena.add(brazo);

  // Orientación: llevar el eje nativo de los dedos (+Y en este rig) hasta la
  // dirección pedida, y rodar la muñeca sobre ESE eje ya colocado. Construido
  // con cuaterniones en vez de con tres ángulos encadenados, que es lo que
  // hace que los dos parámetros sean independientes: cambiar la dirección no
  // descoloca la palma, y al revés.
  const dirDedos = new THREE.Vector3(...AJUSTES.dirDedos).normalize();
  const apuntar = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dirDedos);
  const rodar = new THREE.Quaternion().setFromAxisAngle(dirDedos, AJUSTES.giroPalma);
  brazo.quaternion.copy(rodar).multiply(apuntar);

  // Dónde cae la yema del índice respecto del pivote del brazo, medido sobre
  // el propio rig ya escalado y orientado. Es lo que permite pedir "que la
  // pinza ocurra AQUÍ" y despejar dónde va el brazo, en vez de tantear su
  // posición a ojo hasta que los dedos dejen de atravesar el servidor.
  brazo.updateMatrixWorld(true);
  const yema = new THREE.Vector3();
  brazo.traverse((o) => {
    if (o.isBone && o.name === INDICE[INDICE.length - 1]) o.getWorldPosition(yema);
  });
  const pivoteAYema = yema.clone().sub(brazo.position);
  const servidorEn = new THREE.Vector3(...AJUSTES.servidorEn);
  const pinzaEn = new THREE.Vector3(...AJUSTES.pinzaEn);
  const brazoHasta = pinzaEn.clone().sub(pivoteAYema);
  const brazoDesde = brazoHasta.clone().addScaledVector(dirDedos, -AJUSTES.retroceso);

  // Reposo de los huesos que se van a mover: la pinza se aplica SOBRE esto, no
  // en absoluto, para no perder la pose con la que el autor dejó la mano.
  const huesos = new Map();
  brazo.traverse((o) => {
    if (o.isBone && (PULGAR.includes(o.name) || INDICE.includes(o.name))) {
      huesos.set(o.name, { hueso: o, reposo: o.quaternion.clone() });
    }
  });

  const ejeCurva = new THREE.Vector3(1, 0, 0);
  function curvar(nombres, angulo) {
    for (const n of nombres) {
      const h = huesos.get(n);
      if (!h) continue;
      const giro = new THREE.Quaternion().setFromAxisAngle(ejeCurva, angulo);
      h.hueso.quaternion.copy(h.reposo).multiply(giro);
    }
  }

  /** Coloca toda la escena en el instante `t` de la línea de tiempo. */
  function aplicarT(t) {
    const T = AJUSTES.tiempos;

    // El servidor gira despacio hasta que la mano lo agarra, y ahí se queda
    // quieto: seguir girando mientras lo aprietan lo haría flotar en vez de
    // pesar.
    const giroLibre = clamp01(t / T.cierraPinza[0]);
    servidor.rotation.y = mezcla(AJUSTES.servidorGiro[0], AJUSTES.servidorGiro[1], suave(giroLibre));

    // La mano entra deslizándose por el eje de los dedos y se para en el punto
    // de agarre. La orientación no se toca aquí: se fijó una vez al montar, y
    // recalcularla por fotograma es justo lo que hacía que cada retoque
    // descolocara los otros ejes.
    const entrada = tramo(t, T.entraMano);
    const asiento = tramo(t, T.asienta);
    brazo.position.lerpVectors(brazoDesde, brazoHasta, entrada);
    brazo.position.y += asiento * 0.03;

    // La pinza.
    const cierre = tramo(t, T.cierraPinza);
    curvar(PULGAR, AJUSTES.pinza.pulgar * cierre);
    curvar(INDICE, AJUSTES.pinza.indice * cierre);

    // La compresión. El alto cede antes que el ancho: es lo que hace que se
    // lea "lo están aplastando" y no "se está alejando de la cámara", que es
    // exactamente lo que parece si los tres ejes bajan a la vez.
    const c = tramo(t, T.comprime);
    const cAlto = suave(clamp01(c * 1.35));
    servidor.scale.set(
      mezcla(1, COMPRIME.x, c),
      mezcla(1, COMPRIME.y, cAlto),
      mezcla(1, COMPRIME.z, c),
    );

    // Al encogerse, el objeto se desplaza hacia la pinza. Sin esto colapsa
    // hacia su propio centro, que está en el origen, y termina flotando A UN
    // LADO de la mano en vez de dentro de ella: la mano aprieta el borde
    // derecho, así que es ahí donde tiene que quedar lo que queda.
    servidor.position.lerpVectors(servidorEn, pinzaEn, c);

    // El fundido cruzado, en el punto donde las dos siluetas más se parecen.
    const f = tramo(t, T.fundido);
    opacar(servidor, 1 - f);
    opacar(macMini, f);
    macMini.rotation.y = servidor.rotation.y;
    macMini.position.copy(servidor.position);
  }

  return { escena, camara, aplicarT };
}
