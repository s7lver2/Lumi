import "./globals.css";
import { Nav } from "../components/Nav";
import { Pie } from "../components/Pie";
import { TransicionPagina } from "../components/TransicionPagina";
import { IndicadorSecciones } from "../components/IndicadorSecciones";

export const metadata = {
  title: "Lumi Station · geolocalización de imágenes por inferencia",
  description:
    "Herramienta de geolocalización de imágenes por inferencia, de código abierto y autoalojada. Tus imágenes y tus GPUs no salen de tu servidor.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="min-h-screen">
        <Nav />
        {/* Fuera de TransicionPagina a propósito: ese wrapper anima su
            propio `transform` al entrar, y cualquier `position: fixed`
            dentro de un ancestro con transform activo deja de fijarse al
            viewport y se posiciona relativo a ese ancestro — el indicador
            "saltaba" hacia arriba en cuanto la animación de entrada
            terminaba y el transform volvía a `none`. */}
        <IndicadorSecciones />
        <TransicionPagina>{children}</TransicionPagina>
        <Pie />
      </body>
    </html>
  );
}
