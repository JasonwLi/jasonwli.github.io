import './dev-errors'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/bricolage-grotesque/standard.css'
import '@fontsource/eb-garamond/latin-400-italic.css'
import '@fontsource/eb-garamond/latin-ext-400-italic.css'
import '@fontsource/eb-garamond/latin-500-italic.css'
import '@fontsource/eb-garamond/latin-ext-500-italic.css'
import '@fontsource/fragment-mono/latin-400.css'
import './styles/global.css'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
