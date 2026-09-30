/** Mutable, frame-loop-owned globe state. Lives outside React to avoid re-renders. */
// initial view faces ~25°N 45°E — the Cairo↔Balkans↔SE-Asia heart of the route
export const globeState = {
  yaw: -2.44,
  pitch: 0.44,
  targetYaw: -2.44,
  targetPitch: 0.44,
  autoRotate: true,
  dragging: false,
  lastInteraction: 0,
  /** smoothed placement, driven by scroll each frame */
  posX: 0,
  posY: 0,
  scale: 1,
  dim: 0,
  /** travel-mode zoom, user-controlled */
  zoom: 1,
  targetZoom: 1,
  /** how far the travel section owns the viewport, 0..1 (written each frame) */
  travelIn: 0,
  /** true while the pointer sits over the globe's projected disc */
  pointerInGlobe: false,
  /** projected disc, in canvas px — the drag/zoom maths grab the surface with these */
  radiusPx: 1,
  centerPx: [0, 0] as [number, number],
}
