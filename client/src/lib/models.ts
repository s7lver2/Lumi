/** Son NIVELES, no modelos: cada uno es una composición de recuperadores y
 *  verificadores. El registro de qué lleva dentro cada uno vive en el servidor
 *  (`registros/niveles/`), y aquí solo están los identificadores que el
 *  servidor puede conceder. El panel de solicitudes (subsistema 3, provisional)
 *  ya deja concederlos al aprobar una cuenta nueva — esta es la misma lista,
 *  para que no haya dos sitios que puedan desincronizarse. */
export const KNOWN_MODELS = ["mini", "pro", "vision"];
