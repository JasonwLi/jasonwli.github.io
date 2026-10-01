#!/usr/bin/env node
// public/basis/* must be byte-identical to the transcoder shipped with the
// installed three (R10: the transcoder version must match three's KTX2Loader).
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const src = join(root, 'node_modules/three/examples/jsm/libs/basis')
const dst = join(root, 'public/basis')
const files = ['basis_transcoder.js', 'basis_transcoder.wasm']
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')

let bad = 0
for (const f of files) {
  const a = join(src, f)
  const b = join(dst, f)
  if (!existsSync(b)) {
    console.error(`verify-basis: MISSING public/basis/${f} (copy it from ${a})`)
    bad++
    continue
  }
  const ha = sha(a)
  const hb = sha(b)
  const ok = ha === hb
  if (!ok) bad++
  console.log(`${ok ? 'ok  ' : 'DIFF'} ${f}  public=${hb.slice(0, 16)}  three=${ha.slice(0, 16)}`)
}
if (bad) {
  console.error(`verify-basis: ${bad} mismatch(es); re-copy node_modules/three/examples/jsm/libs/basis/* to public/basis/`)
  process.exit(1)
}
console.log('verify-basis: public/basis matches three')
