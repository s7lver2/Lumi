import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Puerto fijo y distinto del cliente (5173), para poder tener los dos
// levantados a la vez durante el desarrollo.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { port: 5273, strictPort: true },
});
