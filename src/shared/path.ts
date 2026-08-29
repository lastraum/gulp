import { Vector3 } from '@dcl/sdk/math'
import { randomArenaPoint } from './config'

export type PathPoint = { x: number; y: number; z: number }

export function generateLoopPath(count: number, pad: number): PathPoint[] {
  const pts: PathPoint[] = []
  for (let i = 0; i < count; i++) {
    const p = randomArenaPoint(pad)
    pts.push({ x: p.x, y: 0, z: p.z })
  }
  return pts
}

export function segmentLen(a: PathPoint, b: PathPoint): number {
  const dx = b.x - a.x
  const dz = b.z - a.z
  return Math.sqrt(dx * dx + dz * dz)
}

export function positionOnPath(points: PathPoint[], speed: number, elapsed: number): PathPoint {
  if (points.length === 0) return { x: 0, y: 0, z: 0 }
  if (points.length === 1) return points[0]
  let total = 0
  const lens: number[] = []
  for (let i = 0; i < points.length; i++) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const l = Math.max(0.01, segmentLen(a, b))
    lens.push(l)
    total += l
  }
  let dist = ((elapsed * speed) % total + total) % total
  for (let i = 0; i < points.length; i++) {
    if (dist > lens[i]) {
      dist -= lens[i]
      continue
    }
    const a = points[i]
    const b = points[(i + 1) % points.length]
    const t = dist / lens[i]
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t
    }
  }
  return points[0]
}

export function toVec3(p: PathPoint) {
  return Vector3.create(p.x, p.y, p.z)
}

export function tweenAlong(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  speed: number,
  t0: number,
  now = Date.now()
): { x: number; z: number; dist: number; durMs: number; u: number; done: boolean } {
  const dx = bx - ax
  const dz = bz - az
  const dist = Math.hypot(dx, dz)
  const durMs = Math.max(1, Math.floor((dist / Math.max(0.01, speed)) * 1000))
  const u = durMs <= 0 ? 1 : Math.max(0, Math.min(1, (now - Number(t0)) / durMs))
  return {
    x: ax + dx * u,
    z: az + dz * u,
    dist,
    durMs,
    u,
    done: u >= 1
  }
}
