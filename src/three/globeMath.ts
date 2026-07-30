import * as THREE from 'three'

const DEG = Math.PI / 180

/** lat/lon → unit vector on the globe (three.js Y-up convention) */
export function latLonToVec3(lat: number, lon: number, r = 1): THREE.Vector3 {
  const phi = (90 - lat) * DEG
  const theta = (lon + 180) * DEG
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta),
  )
}

/**
 * yaw/pitch that bring (lat, lon) to face the camera (+Z), roll-free.
 * Globe group applies rotation.x = pitch then rotation.y = yaw (Euler XYZ).
 */
export function facingAngles(lat: number, lon: number): { yaw: number; pitch: number } {
  const theta = (lon + 180) * DEG
  // azimuth of the point before rotation, measured atan2(x, z)
  const azimuth = Math.atan2(-Math.cos(theta), Math.sin(theta))
  return { yaw: -azimuth, pitch: lat * DEG }
}

/** wrap target angle to the nearest equivalent of `current` (shortest path) */
export function nearestAngle(target: number, current: number): number {
  const TWO_PI = Math.PI * 2
  let t = target
  while (t - current > Math.PI) t -= TWO_PI
  while (t - current < -Math.PI) t += TWO_PI
  return t
}

/** frame-rate independent exponential damping */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return THREE.MathUtils.damp(current, target, lambda, dt)
}
