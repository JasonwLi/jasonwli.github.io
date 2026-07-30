export interface Role {
  company: string
  role: string
  period: string
  start: number // year, for the log rhythm
  location: string
  summary: string
}

export const roles: Role[] = [
  {
    company: 'Tempo',
    role: 'Engineering',
    period: 'Jun 2026 — now',
    start: 2026,
    location: 'San Francisco · remote',
    summary: 'Yield, FX and payments.',
  },
  {
    company: 'Codex',
    role: 'Founding Engineer, Head of Product',
    period: 'Nov 2024 — Jun 2026',
    start: 2024,
    location: 'Singapore & New York',
    summary:
      'Built a stablecoin FX OTC desk from zero to $3.6B a year across seven currencies — product, engineering, banking rails and solo treasury ops.',
  },
  {
    company: 'Immutable',
    role: 'Senior Software Engineer',
    period: 'May 2023 — Dec 2024',
    start: 2023,
    location: 'Melbourne',
    summary:
      'Account abstraction, asset indexing and white-label NFT contracts for Immutable zkEVM.',
  },
  {
    company: 'Coherent',
    role: 'Founding Engineer',
    period: 'Sep 2022 — May 2023',
    start: 2022,
    location: 'Dahab, Egypt · remote',
    summary:
      'Indexed, decoded and beautified 99.6% of all data on Ethereum, Polygon, Optimism and Base.',
  },
  {
    company: 'Coinbase',
    role: 'SWE II → Senior / Tech Lead',
    period: 'Feb 2020 — Nov 2022',
    start: 2018,
    location: 'San Francisco → New York',
    summary:
      'HD wallets, then Commerce tech lead through $1.5B processed, then cross-chain bridging for the exchange — intern first, 2018 & 2019.',
  },
]
