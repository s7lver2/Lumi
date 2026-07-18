export const USE_CASES = [
  { id: "image-recognition", label: "Reconocimiento de imágenes", icon: "📷", blurb: "identificar lugares a partir de fotos" },
  { id: "testing", label: "Solo testeo", icon: "🧪", blurb: "probar la app, sin uso serio" },
  { id: "geolocation", label: "Geolocalización", icon: "📍", blurb: "ubicar imágenes en el mapa" },
  { id: "experimentation", label: "Experimentación", icon: "🛠", blurb: "probar herramientas y modelos" },
] as const;

export type UseCaseId = (typeof USE_CASES)[number]["id"];
