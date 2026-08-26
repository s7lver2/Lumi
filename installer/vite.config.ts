import { defineConfig } from "vite";

// Puerto fijo y distinto del cliente (5173) y del Indexer (5273), para poder
// tener los tres levantados a la vez durante el desarrollo. Sin plugin de
// React: este instalador es HTML/CSS/JS estático (ver Global Constraints
// del plan), no hay JSX que transformar.
export default defineConfig({
  clearScreen: false,
  server: { port: 5373, strictPort: true },
});
