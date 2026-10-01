import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const MANIFEST = fileURLToPath(new URL('./public/textures/terrain/manifest.json', import.meta.url))

/**
 * Fills the <!-- terrain-preload --> block of index.html from the terrain manifest
 * (INT owns the block): the manifest plus the two stage-A preview equirects, with the
 * manifest's ?v= hashes, so the loader's first three fetches are already in flight
 * while the entry chunk parses. Generated on every dev request and build, so a re-encode
 * (scripts/terrain/encode.py rewrites the hashes) can never leave a stale preload behind.
 */
function terrainPreload(): Plugin {
  let base = '/'
  return {
    name: 'terrain-preload',
    configResolved(c) {
      base = c.base
    },
    transformIndexHtml(html) {
      const m = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
        preview: { albedo: { url: string }; data: { url: string } }
      }
      const root = `${base}textures/terrain/`
      const links = [`${root}manifest.json`, root + m.preview.albedo.url, root + m.preview.data.url]
        .map((href) => `    <link rel="preload" href="${href}" as="fetch" crossorigin="anonymous" />`)
        .join('\n')
      return html.replace(
        /(<!-- terrain-preload:[^>]*-->)[\s\S]*?(\s*<!-- \/terrain-preload -->)/,
        `$1\n${links}$2`,
      )
    },
  }
}

/**
 * Build only: the entry stylesheet stops blocking first paint. index.html's inline boot
 * shell (steel ground + engraved plate) paints on its own; on Fast 3G a render-blocking
 * stylesheet held the first paint to ~2 s. The sheet loads as a high-priority preload and
 * applies itself on load; src/main.tsx waits for it before the first React render, so the
 * page never renders unstyled.
 */
function asyncEntryCss(): Plugin {
  return {
    name: 'async-entry-css',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler: (html) =>
        html.replace(/<link rel="stylesheet"( crossorigin)? href="([^"]+\.css)">/g, (_m, co = '', href: string) =>
          `<link rel="preload" as="style"${co} href="${href}" data-boot-css onload="this.onload=null;this.rel='stylesheet'">` +
          `<noscript><link rel="stylesheet"${co} href="${href}"></noscript>`,
        ),
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), terrainPreload(), asyncEntryCss()],
  build: {
    rolldownOptions: {
      output: {
        // Every module on the entry's static import chain lands in ONE chunk. Without
        // this, Rolldown splits each entry module that a lazy chunk also imports (store,
        // lod, tokens, three…) into its own small shared chunk: more requests, worse
        // gzip, and the T1c overlay had to receive createPortal/icons by injection to
        // stay under the entry budget. Lazy chunks import from this one chunk instead.
        codeSplitting: {
          groups: [{ name: 'app', tags: ['$initial'] }],
        },
      },
    },
  },
})
