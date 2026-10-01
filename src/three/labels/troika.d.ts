/**
 * Minimal typings for troika-three-text 0.52.5 (the package ships no "types" entry and no
 * BatchedText declaration). Only what src/three/labels uses.
 */
declare module 'troika-three-text' {
  import type { Color, Material, Mesh, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'

  export interface TroikaTextRenderInfo {
    blockBounds: [number, number, number, number]
    visibleBounds: [number, number, number, number]
    glyphAtlasIndices: Float32Array
  }

  export class Text extends Mesh {
    text: string
    font: string | null
    fontSize: number
    letterSpacing: number
    anchorX: number | string
    anchorY: number | string
    color: Color | string | number | null
    fillOpacity: number
    outlineWidth: number | string
    outlineColor: Color | string | number
    outlineOpacity: number
    outlineBlur: number | string
    sdfGlyphSize: number | null
    curveRadius: number
    whiteSpace: 'normal' | 'nowrap'
    readonly textRenderInfo: TroikaTextRenderInfo | null
    sync(callback?: () => void): void
    dispose(): void
  }

  export class BatchedText extends Text {
    addText(text: Text): void
    removeText(text: Text): void
    createDerivedMaterial(baseMaterial: Material): Material & {
      onBeforeCompile: (shader: WebGLProgramParametersWithUniforms, renderer: WebGLRenderer) => void
      customProgramCacheKey: () => string
    }
  }

  export function configureTextBuilder(config: {
    defaultFontURL?: string | null
    unicodeFontsURL?: string | null
    sdfGlyphSize?: number
    sdfExponent?: number
    sdfMargin?: number
    textureWidth?: number
    useWorker?: boolean
  }): void

  export function preloadFont(
    options: { font?: string; characters?: string | string[]; sdfGlyphSize?: number },
    callback: () => void,
  ): void
}
