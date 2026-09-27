export interface Role {
  company: string
  role: string
  period: string
  location: string
  summary: string
}

export const roles: Role[] = [
  {
    company: 'Tempo',
    role: 'Engineering',
    period: 'Jun 2026 — now',
    location: 'San Francisco · remote',
    summary: 'Yield, FX and payments.',
  },
  {
    company: 'Codex',
    role: 'Founding Engineer, Head of Product',
    period: 'Nov 2024 — Jun 2026',
    location: 'Singapore & New York',
    summary:
      'Built a stablecoin FX OTC desk from zero to $3.6B a year across seven currencies — product, engineering, banking rails and solo treasury ops.',
  },
  {
    company: 'Immutable',
    role: 'Senior Software Engineer',
    period: 'May 2023 — Dec 2024',
    location: 'Melbourne',
    summary:
      'Account abstraction, asset indexing and white-label NFT contracts for Immutable zkEVM.',
  },
  {
    company: 'Coherent',
    role: 'Founding Engineer',
    period: 'Sep 2022 — May 2023',
    location: 'Dahab, Egypt · remote',
    summary:
      'Indexed, decoded and beautified 99.6% of all data on Ethereum, Polygon, Optimism and Base.',
  },
  {
    company: 'Coinbase',
    role: 'SWE II → Senior / Tech Lead',
    period: 'Feb 2020 — Nov 2022',
    location: 'San Francisco → New York',
    summary:
      'Intern in 2018 and 2019, then full-time: HD wallets, tech lead for Commerce through $1.5B processed, and cross-chain bridging for the exchange.',
  },
]
