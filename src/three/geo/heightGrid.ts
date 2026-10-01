/**
 * CPU height grid (manifest shared.heightGrid, uint16le metres, row 0 = north,
 * cell centres lon = -180+(i+.5)*360/w, lat = 90-(j+.5)*180/h; ocean = 0).
 *
 * Dependency-free on purpose: it sits in the entry chunk (pins, route, radii) and is
 * imported by node --experimental-strip-types checks. The terrain loader (C2a, lazy
 * chunk) fetches the file during stage C and calls setHeightGrid().
 */

let grid: { w: number; h: number; data: Uint16Array } | null = null
const listeners = new Set<() => void>()

/** Bilinear height in metres (0 until the grid is loaded). Longitude wraps; latitude clamps to the edge rows. */
export function sampleHeightM(lat: number, lon: number): number {
  const g = grid
  if (!g || !Number.isFinite(lat) || !Number.isFinite(lon)) return 0
  const { w, h, data } = g
  // continuous cell coordinates: cell i has its centre at x = i
  const x = ((((lon + 180) / 360) * w - 0.5) % w + w) % w
  const y = Math.min(h - 1, Math.max(0, ((90 - lat) / 180) * h - 0.5))
  const i0 = Math.floor(x)
  const j0 = Math.floor(y)
  const i1 = i0 + 1 === w ? 0 : i0 + 1
  const j1 = Math.min(h - 1, j0 + 1)
  const fx = x - i0
  const fy = y - j0
  const r0 = j0 * w
  const r1 = j1 * w
  const top = data[r0 + i0] * (1 - fx) + data[r0 + i1] * fx
  const bot = data[r1 + i0] * (1 - fx) + data[r1 + i1] * fx
  return top * (1 - fy) + bot * fy
}

export function heightGridReady(): boolean {
  return grid !== null
}

/** Decode a uint16le buffer (endianness-safe) and install it. Throws on a size mismatch. */
export function setHeightGrid(w: number, h: number, buffer: ArrayBuffer): void {
  if (buffer.byteLength !== w * h * 2) {
    throw new Error(`heightGrid: ${buffer.byteLength} bytes, expected ${w}x${h}x2 = ${w * h * 2}`)
  }
  let data: Uint16Array
  const littleEndianHost = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1
  if (littleEndianHost) {
    data = new Uint16Array(buffer)
  } else {
    const dv = new DataView(buffer)
    data = new Uint16Array(w * h)
    for (let i = 0; i < data.length; i++) data[i] = dv.getUint16(i * 2, true)
  }
  grid = { w, h, data }
  for (const cb of listeners) cb()
}

export function clearHeightGrid(): void {
  grid = null
  for (const cb of listeners) cb()
}

/** Called when the grid is installed or cleared; returns an unsubscribe function. */
export function onHeightGrid(cb: () => void): () => void {
  listeners.add(cb)
  return () => {
    listeners.delete(cb)
  }
}
