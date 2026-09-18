import createMDX from "@next/mdx";
import remarkGfm from "remark-gfm";

/** @type {import('next').NextConfig} */
const nextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // ponytail: una carpeta de ruta llamada literalmente "index" choca con la
  // clave interna que Next.js usa para la página raíz y rompe el build
  // (`Expected clientReferenceManifest to be defined`, confirmado en
  // build local con Next 15.5.24). La página vive en app/indexado/ y esta
  // reescritura mantiene la URL pública /index que pide el nav y el spec.
  async rewrites() {
    return [{ source: "/index", destination: "/indexado" }];
  },
};

// remark-gfm: sin él el MDX solo entiende CommonMark puro y una tabla
// como "| Nivel | Modelos |" se renderiza como texto plano con barras,
// no como una <table> — se necesita en cuanto una página usa una tabla
// (mini-pro-y-vision, y las tres de tecnologías con su "dónde se usa").
const withMDX = createMDX({
  options: { remarkPlugins: [remarkGfm] },
});

export default withMDX(nextConfig);
