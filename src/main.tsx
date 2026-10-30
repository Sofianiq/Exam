import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './app/pwa'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
