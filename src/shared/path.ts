import { Vector3 } from '@dcl/sdk/math'
import { clampArena, randomArenaPoint } from './config'

export type TweenSeg = {
  speed: number
  t0: number
  ax: number
  az: number
  bx: number
  bz: number
}

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

export function motionOnPath(
  points: PathPoint[],
  speed: number,
  elapsed: number
): { x: number; y: number; z: number; vx: number; vz: number } {
  if (points.length === 0) return { x: 0, y: 0, z: 0, vx: 0, vz: 0 }
  if (points.length === 1) return { x: points[0].x, y: points[0].y, z: points[0].z, vx: 0, vz: 0 }
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
    const dx = b.x - a.x
    const dz = b.z - a.z
    const inv = 1 / lens[i]
    return {
      x: a.x + dx * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + dz * t,
      vx: dx * inv * speed,
      vz: dz * inv * speed
    }
  }
  return { x: points[0].x, y: points[0].y, z: points[0].z, vx: 0, vz: 0 }
}

export function positionOnPath(points: PathPoint[], speed: number, elapsed: number): PathPoint {
  const at = motionOnPath(points, speed, elapsed)
  return { x: at.x, y: at.y, z: at.z }
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

export function tweenMotion(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  speed: number,
  t0: number,
  now = Date.now()
) {
  const along = tweenAlong(ax, az, bx, bz, speed, t0, now)
  const moving = !along.done && along.durMs > 0
  const sec = along.durMs / 1000
  return {
    ...along,
    vx: moving ? (bx - ax) / sec : 0,
    vz: moving ? (bz - az) / sec : 0
  }
}

export function samePoint(ax: number, az: number, bx: number, bz: number, slop = 0.35): boolean {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz < slop * slop
}

export function pickNextPoint(
  from: { x: number; z: number },
  pad: number,
  minDist: number,
  rng: () => number = Math.random
): { x: number; z: number } {
  for (let i = 0; i < 18; i++) {
    const p = randomArenaPoint(pad, rng)
    if (Math.hypot(p.x - from.x, p.z - from.z) >= minDist) return p
  }
  const a = rng() * Math.PI * 2
  return clampArena(from.x + Math.cos(a) * minDist, from.z + Math.sin(a) * minDist, pad)
}

export function tweenT0(elapsedMs: number, now = Date.now()): number {
  const e = Number(elapsedMs)
  if (!Number.isFinite(e)) return now
  return now - Math.max(0, e)
}

export function acceptTween(
  cur: TweenSeg | null,
  queued: TweenSeg | null,
  next: TweenSeg
): { path: TweenSeg; queued: TweenSeg | null } {
  if (!cur) return { path: next, queued: null }
  if (samePoint(next.ax, next.az, cur.ax, cur.az) && samePoint(next.bx, next.bz, cur.bx, cur.bz)) {
    return { path: cur, queued }
  }
  if (Number(next.t0) < Number(cur.t0)) return { path: cur, queued }
  const curDone = tweenAlong(cur.ax, cur.az, cur.bx, cur.bz, cur.speed, cur.t0).done
  if (!curDone && samePoint(next.ax, next.az, cur.bx, cur.bz)) {
    return { path: cur, queued: next }
  }
  return { path: next, queued: null }
}

export function followTween(path: TweenSeg, queued: TweenSeg | null, now = Date.now()) {
  let p = path
  let q = queued
  let at = tweenMotion(p.ax, p.az, p.bx, p.bz, p.speed, p.t0, now)
  if (at.done && q) {
    p = q
    q = null
    at = tweenMotion(p.ax, p.az, p.bx, p.bz, p.speed, p.t0, now)
  }
  return { path: p, queued: q, at }
}
