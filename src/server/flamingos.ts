import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  ARENA,
  COG_HIT_R,
  FLAMINGO_COUNT,
  FLAMINGO_HIT_CD_MS,
  FLAMINGO_HIT_R,
  FLAMINGO_IMPULSE,
  FLAMINGO_SPEED,
  clampArena,
  mulberry32,
  randomArenaPoint,
  radiusFromMass
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { tweenAlong } from '../shared/path'
import { Blob, Flamingo } from '../shared/schemas'
import { getCogPositions } from './cogs'

const MIN_PATH_DIST = 48
const MIN_PATH_MS = 3500

type Flam = {
  id: number
  entity: Entity
  speed: number
  t0: number
  ax: number
  az: number
  bx: number
  bz: number
}

const flock: Flam[] = []
const hitCd = new Map<string, number>()

function protectTransform(entity: Entity) {
  Transform.validateBeforeChange(entity, (value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

function cogKeepout(): number {
  return COG_HIT_R + FLAMINGO_HIT_R + 1.8
}

function segmentHitsCircle(
  ax: number,
  az: number,
  bx: number,
  bz: number,
  cx: number,
  cz: number,
  radius: number
): boolean {
  const abx = bx - ax
  const abz = bz - az
  const acx = cx - ax
  const acz = cz - az
  const ab2 = abx * abx + abz * abz
  if (ab2 < 0.0001) return Math.hypot(acx, acz) < radius
  let t = (acx * abx + acz * abz) / ab2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const px = ax + abx * t
  const pz = az + abz * t
  return Math.hypot(px - cx, pz - cz) < radius
}

function pathClear(from: { x: number; z: number }, to: { x: number; z: number }): boolean {
  const pad = cogKeepout()
  for (const cog of getCogPositions()) {
    if (Math.hypot(to.x - cog.x, to.z - cog.z) < pad) return false
    if (segmentHitsCircle(from.x, from.z, to.x, to.z, cog.x, cog.z, pad)) return false
  }
  return true
}

function pickClearTarget(from: { x: number; z: number }, rng: () => number): { x: number; z: number } {
  for (let i = 0; i < 18; i++) {
    const p = randomArenaPoint(FLAMINGO_HIT_R + 2, rng)
    if (Math.hypot(p.x - from.x, p.z - from.z) < MIN_PATH_DIST) continue
    if (!pathClear(from, p)) continue
    return p
  }
  const a = rng() * Math.PI * 2
  const d = 70
  return clampArena(from.x + Math.cos(a) * d, from.z + Math.sin(a) * d, FLAMINGO_HIT_R)
}

function broadcastPath(bird: Flam, to?: string) {
  const dist = Math.hypot(bird.bx - bird.ax, bird.bz - bird.az)
  const payload = {
    id: bird.id,
    speed: bird.speed,
    dist,
    t0: bird.t0,
    from: { x: bird.ax, y: 0, z: bird.az },
    to: { x: bird.bx, y: 0, z: bird.bz }
  }
  if (to) room.send('flamingoPath', payload, { to: [to] })
  else room.send('flamingoPath', payload)
}

function writePath(bird: Flam) {
  const mut = Flamingo.getMutable(bird.entity)
  mut.speed = bird.speed
  mut.t0 = bird.t0
  mut.ax = bird.ax
  mut.az = bird.az
  mut.bx = bird.bx
  mut.bz = bird.bz
  const t = Transform.getMutable(bird.entity)
  t.position.x = bird.ax
  t.position.y = ARENA.y
  t.position.z = bird.az
  broadcastPath(bird)
}

function setPath(bird: Flam, from: { x: number; z: number }, to: { x: number; z: number }, now: number) {
  bird.ax = from.x
  bird.az = from.z
  bird.bx = to.x
  bird.bz = to.z
  bird.t0 = now
  writePath(bird)
}

function posOf(bird: Flam, now = Date.now()) {
  return tweenAlong(bird.ax, bird.az, bird.bx, bird.bz, bird.speed, bird.t0, now)
}

export function hasFlamingos(): boolean {
  return flock.length > 0
}

export function clearFlamingos() {
  for (const bird of flock) {
    if (Transform.getOrNull(bird.entity)) engine.removeEntity(bird.entity)
  }
  flock.length = 0
  hitCd.clear()
  logEvent('flamingo.clear', {})
}

export function spawnFlamingos() {
  if (flock.length > 0) return
  const seed = (Date.now() ^ 0x9e3779b9) >>> 0
  const rng = mulberry32(seed)
  const placed: { x: number; z: number }[] = []
  logEvent('flamingo.seed', { seed, count: FLAMINGO_COUNT })
  const now = Date.now()

  for (let i = 0; i < FLAMINGO_COUNT; i++) {
    let a = randomArenaPoint(FLAMINGO_HIT_R + 2, rng)
    for (let attempt = 0; attempt < 20; attempt++) {
      const far = placed.every((q) => Math.hypot(q.x - a.x, q.z - a.z) >= FLAMINGO_HIT_R * 2 + 10)
      if (far && pathClear(a, a)) break
      a = randomArenaPoint(FLAMINGO_HIT_R + 2, rng)
    }
    const b = pickClearTarget(a, rng)
    placed.push(a)
    const entity = engine.addEntity()
    Transform.create(entity, { position: Vector3.create(a.x, ARENA.y, a.z) })
    Flamingo.create(entity, {
      id: i + 1,
      speed: FLAMINGO_SPEED,
      t0: now,
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z
    })
    protectTransform(entity)
    syncEntity(entity, [Transform.componentId, Flamingo.componentId])
    const bird: Flam = {
      id: i + 1,
      entity,
      speed: FLAMINGO_SPEED,
      t0: now,
      ax: a.x,
      az: a.z,
      bx: b.x,
      bz: b.z
    }
    flock.push(bird)
    broadcastPath(bird)
  }
}

export function sendFlamingosTo(address?: string) {
  for (const bird of flock) broadcastPath(bird, address)
}

export function tickFlamingos() {
  const now = Date.now()
  for (const bird of flock) {
    const along = posOf(bird, now)
    const elapsed = now - bird.t0
    if (elapsed < MIN_PATH_MS) continue
    if (!along.done && elapsed < along.durMs) continue
    const start = { x: bird.bx, z: bird.bz }
    const next = pickClearTarget(start, Math.random)
    setPath(bird, start, next, now)
  }

  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    const r = radiusFromMass(blob.mass)
    for (const bird of flock) {
      const at = posOf(bird, now)
      const dx = blob.x - at.x
      const dz = blob.z - at.z
      const dist = Math.sqrt(dx * dx + dz * dz)
      const reach = FLAMINGO_HIT_R + r
      if (dist >= reach || dist < 0.0001) continue
      const key = `${blob.blobId}:${bird.id}`
      const last = hitCd.get(key) ?? 0
      if (now - last < FLAMINGO_HIT_CD_MS) continue
      hitCd.set(key, now)
      const nx = dx / dist
      const nz = dz / dist
      const mut = Blob.getMutable(entity)
      mut.vx = -mut.vx * 0.85 + nx * FLAMINGO_IMPULSE
      mut.vz = -mut.vz * 0.85 + nz * FLAMINGO_IMPULSE
      mut.x = at.x + nx * (reach + 0.5)
      mut.z = at.z + nz * (reach + 0.5)
    }
  }
}
