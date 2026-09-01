import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "./index.css";

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";

// Ver el comentario equivalente en client/src/main.tsx: sin esto, WebView2
// muestra su propio menú de Edge en cualquier click derecho no cubierto por
// un menú propio.
window.addEventListener("contextmenu", (e) => e.preventDefault());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
