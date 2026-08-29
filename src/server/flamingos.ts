import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  ARENA,
  FLAMINGO_COUNT,
  FLAMINGO_HIT_CD_MS,
  FLAMINGO_HIT_R,
  FLAMINGO_IMPULSE,
  FLAMINGO_SPEED,
  TWEEN_MIN_DIST,
  isBot,
  mulberry32,
  randomArenaPoint,
  radiusFromMass
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { pickNextPoint, tweenAlong } from '../shared/path'
import { Blob, Flamingo } from '../shared/schemas'

const PAD = FLAMINGO_HIT_R + 2

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

function posOf(bird: Flam, now = Date.now()) {
  return tweenAlong(bird.ax, bird.az, bird.bx, bird.bz, bird.speed, bird.t0, now)
}

function broadcastPath(bird: Flam, to?: string) {
  const along = posOf(bird)
  const left = Math.max(1, Math.floor(along.durMs * (1 - along.u)))
  const payload = {
    id: bird.id,
    speed: bird.speed,
    duration: left,
    from: { x: along.x, y: 0, z: along.z },
    to: { x: bird.bx, y: 0, z: bird.bz }
  }
  if (to) room.send('flamingoPath', payload, { to: [to] })
  else room.send('flamingoPath', payload)
}

function setSeg(bird: Flam, from: { x: number; z: number }, to: { x: number; z: number }, now: number) {
  bird.ax = from.x
  bird.az = from.z
  bird.bx = to.x
  bird.bz = to.z
  bird.t0 = now
  const mut = Flamingo.getMutable(bird.entity)
  mut.speed = bird.speed
  mut.t0 = bird.t0
  mut.ax = bird.ax
  mut.az = bird.az
  mut.bx = bird.bx
  mut.bz = bird.bz
  broadcastPath(bird)
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
    let a = randomArenaPoint(PAD, rng)
    for (let attempt = 0; attempt < 20; attempt++) {
      if (placed.every((q) => Math.hypot(q.x - a.x, q.z - a.z) >= FLAMINGO_HIT_R * 2 + 10)) break
      a = randomArenaPoint(PAD, rng)
    }
    const b = pickNextPoint(a, PAD, TWEEN_MIN_DIST, rng)
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
    if (!along.done && now - bird.t0 < along.durMs) continue
    const start = { x: bird.bx, z: bird.bz }
    setSeg(bird, start, pickNextPoint(start, PAD, TWEEN_MIN_DIST), now)
  }

  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (isBot(blob.address)) continue
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
