import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  ARENA,
  COG_COUNT,
  COG_HIT_CD_MS,
  COG_HIT_R,
  COG_IMPULSE,
  COG_MAX,
  COG_SPEED,
  COG_SPIN_DEG,
  TWEEN_MIN_DIST,
  clampArena,
  isBot,
  mulberry32,
  radiusFromMass,
  randomArenaPoint,
  shredMass
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { pickNextPoint, tweenAlong } from '../shared/path'
import { Blob, Cog } from '../shared/schemas'

type CogState = {
  id: number
  entity: Entity
  x: number
  z: number
  ax: number
  az: number
  bx: number
  bz: number
  speed: number
  spin: number
  t0: number
}

const cogs: CogState[] = []
const hitCd = new Map<string, number>()
const inside = new Set<string>()
let nextCogId = 1

const COG_PAD = COG_HIT_R + 2

function posOf(cog: CogState, now = Date.now()) {
  return tweenAlong(cog.ax, cog.az, cog.bx, cog.bz, cog.speed, cog.t0, now)
}

function broadcastCog(cog: CogState, to?: string) {
  const along = posOf(cog)
  const left = Math.max(1, Math.floor(along.durMs * (1 - along.u)))
  const payload = {
    id: cog.id,
    speed: cog.speed,
    spin: cog.spin,
    duration: left,
    points: [
      { x: along.x, y: 0, z: along.z },
      { x: cog.bx, y: 0, z: cog.bz }
    ]
  }
  if (to) room.send('obstaclePath', payload, { to: [to] })
  else room.send('obstaclePath', payload)
}

function protectTransform(entity: Entity) {
  Transform.validateBeforeChange(entity, (value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

function farEnough(p: { x: number; z: number }): boolean {
  const now = Date.now()
  const minSep = COG_HIT_R * 2 + 8
  return cogs.every((q) => {
    const at = posOf(q, now)
    return Math.hypot(p.x - at.x, p.z - at.z) >= minSep
  })
}

function setSeg(cog: CogState, from: { x: number; z: number }, to: { x: number; z: number }, now: number) {
  cog.ax = from.x
  cog.az = from.z
  cog.bx = to.x
  cog.bz = to.z
  cog.t0 = now
  cog.x = from.x
  cog.z = from.z
  broadcastCog(cog)
}

function placeCog(from: { x: number; z: number }, now: number): CogState {
  const to = pickNextPoint(from, COG_PAD, TWEEN_MIN_DIST)
  const id = nextCogId++
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(from.x, ARENA.y, from.z) })
  const cog: CogState = {
    id,
    entity,
    x: from.x,
    z: from.z,
    ax: from.x,
    az: from.z,
    bx: to.x,
    bz: to.z,
    speed: COG_SPEED * (0.82 + (id % 6) * 0.06),
    spin: COG_SPIN_DEG,
    t0: now
  }
  Cog.create(entity, { id: cog.id, spin: cog.spin, t0: now })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Cog.componentId])
  cogs.push(cog)
  broadcastCog(cog)
  return cog
}

export function cogCount(): number {
  return cogs.length
}

export function addCog(): number {
  if (cogs.length >= COG_MAX) return cogs.length
  let p = randomArenaPoint(COG_PAD)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (farEnough(p)) break
    p = randomArenaPoint(COG_PAD)
  }
  placeCog(p, Date.now())
  logEvent('cog.add', { count: cogs.length, id: cogs[cogs.length - 1].id })
  return cogs.length
}

export function removeCog(): number {
  const cog = cogs.pop()
  if (!cog) return 0
  if (Transform.getOrNull(cog.entity)) engine.removeEntity(cog.entity)
  logEvent('cog.remove', { count: cogs.length, id: cog.id })
  return cogs.length
}

export function spawnCogs() {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  const rng = mulberry32(seed)
  const now = Date.now()
  logEvent('cog.seed', { seed, count: COG_COUNT })
  for (let i = 0; i < COG_COUNT; i++) {
    let p = randomArenaPoint(COG_PAD, rng)
    for (let attempt = 0; attempt < 40; attempt++) {
      if (farEnough(p)) break
      p = randomArenaPoint(COG_PAD, rng)
    }
    placeCog(p, now)
  }
}

export function sendCogsTo(address?: string) {
  for (const cog of cogs) broadcastCog(cog, address)
}

export function getCogPositions(): { x: number; z: number }[] {
  const now = Date.now()
  return cogs.map((c) => {
    const at = posOf(c, now)
    return { x: at.x, z: at.z }
  })
}

function knockFromCog(entity: Entity, cx: number, cz: number, r: number): boolean {
  const dx = Blob.get(entity).x - cx
  const dz = Blob.get(entity).z - cz
  const dist = Math.hypot(dx, dz) || 1
  const nx = dx / dist
  const nz = dz / dist
  const mut = Blob.getMutable(entity)
  mut.vx = nx * COG_IMPULSE
  mut.vz = nz * COG_IMPULSE
  const placed = clampArena(cx + nx * (COG_HIT_R + r + 2.2), cz + nz * (COG_HIT_R + r + 2.2), r)
  mut.x = placed.x
  mut.z = placed.z
  let shredded = false
  const next = shredMass(mut.mass)
  if (next < mut.mass - 0.01) {
    mut.mass = next
    shredded = true
  }
  room.send('blobKnock', {
    blobId: mut.blobId,
    x: mut.x,
    z: mut.z,
    vx: mut.vx,
    vz: mut.vz,
    mass: mut.mass
  })
  return shredded
}

/** Returns true if this blob was shredded. Hits once per stay — must leave before another shred. */
export function hitCogEntity(entity: Entity, slack = 1): boolean {
  if (!Blob.has(entity)) return false
  const now = Date.now()
  let shredded = false
  for (const cog of cogs) {
    if (!Blob.has(entity)) break
    const blob = Blob.get(entity)
    const r = radiusFromMass(blob.mass)
    const at = posOf(cog, now)
    const dist = Math.hypot(blob.x - at.x, blob.z - at.z)
    const reach = (COG_HIT_R + r) * slack
    const key = `${blob.blobId}:${cog.id}`
    if (dist >= reach || dist < 0.0001) {
      inside.delete(key)
      continue
    }
    if (inside.has(key)) continue
    const last = hitCd.get(key) ?? 0
    if (now - last < COG_HIT_CD_MS) continue
    inside.add(key)
    hitCd.set(key, now)
    if (knockFromCog(entity, at.x, at.z, r)) shredded = true
  }
  return shredded
}

export function tickCogs(onShred: (address: string) => void) {
  const now = Date.now()
  for (const cog of cogs) {
    let along = posOf(cog, now)
    if (along.done || now - cog.t0 >= along.durMs) {
      const start = { x: cog.bx, z: cog.bz }
      setSeg(cog, start, pickNextPoint(start, COG_PAD, TWEEN_MIN_DIST), now)
      along = posOf(cog, now)
    }
    cog.x = along.x
    cog.z = along.z
    const t = Transform.getMutable(cog.entity)
    t.position.x = along.x
    t.position.y = ARENA.y
    t.position.z = along.z
  }
  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (isBot(blob.address)) continue
    if (hitCogEntity(entity, 1)) onShred(blob.address)
  }
}
