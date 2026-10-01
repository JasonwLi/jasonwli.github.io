import type * as THREE from 'three'

/**
 * Scene handles shared by non-React modules (controls, anchors, loaders).
 * CameraRig writes outer/inner/camera; GlobeScene's onCreated writes gl.
 * outer: choreographed transform (position posX/posY, scale). inner: globe-local
 * frame (rotation pitch/yaw, R = 1) where every surface layer renders.
 */
export const sceneRefs: {
  outer: THREE.Group | null
  inner: THREE.Group | null
  camera: THREE.PerspectiveCamera | null
  gl: THREE.WebGLRenderer | null
} = { outer: null, inner: null, camera: null, gl: null }
