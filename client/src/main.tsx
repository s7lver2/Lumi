import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { aplicarEscalaInterfaz, aplicarReducirMovimiento, leerEscalaInterfaz, leerReducirMovimiento } from './lib/apariencia.ts'

aplicarReducirMovimiento(leerReducirMovimiento())
aplicarEscalaInterfaz(leerEscalaInterfaz())

// WebView2 (el motor de Tauri en Windows) muestra su propio menú de Edge
// ("Ver código fuente", "Inspeccionar"...) en cualquier click derecho salvo
// que se le diga lo contrario — cada `ContextMenu` propio ya hace su
// `preventDefault`, pero cualquier zona sin uno de esos (texto suelto,
// imágenes, el fondo) seguía mostrando el nativo.
window.addEventListener("contextmenu", (e) => e.preventDefault())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
