import './dev-errors'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// One family, two cuts, regular only (latin + latin-ext via unicode-range, font-display swap)
import '@fontsource/castoro/400.css'
import '@fontsource/castoro/400-italic.css'
import '@fontsource/castoro-titling/400.css'
import './styles/tokens.css'
import './styles/fonts.css'
import './styles/global.css'
import './styles/art.css'
import App from './App'

// production: the entry stylesheet loads without blocking first paint (vite.config.ts
// asyncEntryCss); never render the app before it applies
const pendingCss = [...document.querySelectorAll<HTMLLinkElement>('link[data-boot-css]')]
  .filter((l) => l.rel !== 'stylesheet')
  .map((l) => new Promise<void>((done) => {
    const ok = () => (l.rel === 'stylesheet' && l.sheet ? done() : requestAnimationFrame(ok))
    l.addEventListener('load', () => requestAnimationFrame(ok), { once: true })
    l.addEventListener('error', () => done(), { once: true })
  }))
if (pendingCss.length) await Promise.all(pendingCss)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
