import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { aplicarReducirMovimiento, leerReducirMovimiento } from './lib/apariencia.ts'

aplicarReducirMovimiento(leerReducirMovimiento())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
