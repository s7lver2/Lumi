/** @type {import('next').NextConfig} */
const nextConfig = {
  // ponytail: una carpeta de ruta llamada literalmente "index" choca con la
  // clave interna que Next.js usa para la página raíz y rompe el build
  // (`Expected clientReferenceManifest to be defined`, confirmado en
  // build local con Next 15.5.24). La página vive en app/indexado/ y esta
  // reescritura mantiene la URL pública /index que pide el nav y el spec.
  async rewrites() {
    return [{ source: "/index", destination: "/indexado" }];
  },
};

export default nextConfig;
