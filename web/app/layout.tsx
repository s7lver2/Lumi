import "./globals.css";
import { Nav } from "../components/Nav";
import { Pie } from "../components/Pie";

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
        {children}
        <Pie />
      </body>
    </html>
  );
}
