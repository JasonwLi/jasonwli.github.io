// Contact is assembled at click time from encoded parts — nothing for
// address-harvesting crawlers to scrape out of the HTML or the bundle.
const ENC = {
  mail: 'anp3bDk2QGdtYWlsLmNvbQ==',
  github: 'aHR0cHM6Ly9naXRodWIuY29tL2phc29ud2xp',
  linkedin: 'aHR0cHM6Ly93d3cubGlua2VkaW4uY29tL2luL2phc29uendsaQ==',
} as const

function openContact(key: keyof typeof ENC) {
  const v = atob(ENC[key])
  if (key === 'mail') window.location.href = `mailto:${v}`
  else window.open(v, '_blank', 'noopener')
}

export function Footer() {
  return (
    <footer id="contact" className="footer">
      <div className="contact-icons">
        <button onClick={() => openContact('mail')} aria-label="Send an email">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="1.5" />
            <path d="M3.5 6.5 12 13l8.5-6.5" />
          </svg>
          <span className="mono">email</span>
        </button>
        <button onClick={() => openContact('github')} aria-label="Open GitHub profile">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
            <path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.9-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.7 0 0 .84-.28 2.75 1.05a9.36 9.36 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.4.2 2.44.1 2.7.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.81c0 .27.18.6.69.49A10.05 10.05 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z" />
          </svg>
          <span className="mono">github</span>
        </button>
        <button onClick={() => openContact('linkedin')} aria-label="Open LinkedIn profile">
          <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor" aria-hidden="true">
            <path d="M4.98 3.5A2.49 2.49 0 0 0 2.5 6c0 1.38 1.1 2.5 2.45 2.5h.03A2.49 2.49 0 0 0 7.5 6a2.49 2.49 0 0 0-2.52-2.5ZM3 21h4V9.75H3V21Zm6.5-11.25V21h4v-6.29c0-1.66.9-2.71 2.26-2.71 1.28 0 1.99.9 1.99 2.71V21h4v-6.79c0-3.51-1.87-5.21-4.44-5.21-2.06 0-3.09 1.15-3.81 2.06v-1.31h-4Z" />
          </svg>
          <span className="mono">linkedin</span>
        </button>
      </div>
      <p className="mono footer-fine">© 2026 Jason Li · all photographs mine</p>
    </footer>
  )
}
