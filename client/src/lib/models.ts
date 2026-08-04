/** Los identificadores de modelo que el sistema ya conoce, aunque el catálogo
 *  de verdad (descarga, VRAM, versiones) sea el subsistema 5 y todavía no
 *  exista. El panel de solicitudes (subsistema 3, provisional) ya deja
 *  concederlos al aprobar una cuenta nueva — esta es la misma lista, para que
 *  no haya dos sitios que puedan desincronizarse. */
export const KNOWN_MODELS = ["mini", "pro", "vision"];
