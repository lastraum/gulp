import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  ARENA,
  COG_COUNT,
  COG_MAX,
  COG_HIT_CD_MS,
  COG_HIT_R,
  COG_IMPULSE,
  COG_SPIN_DEG,
  clampArena,
  mulberry32,
  randomArenaPoint,
  radiusFromMass,
  shredMass
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { Blob, Cog } from '../shared/schemas'

type CogState = {
  id: number
  entity: Entity
  x: number
  z: number
  spin: number
  t0: number
}

const cogs: CogState[] = []
const hitCd = new Map<string, number>()
const inside = new Set<string>()
let nextCogId = 1

function broadcastCog(cog: CogState, to?: string) {
  const payload = {
    id: cog.id,
    speed: 0,
    spin: cog.spin,
    t0: cog.t0,
    points: [{ x: cog.x, y: 0, z: cog.z }]
  }
  if (to) room.send('obstaclePath', payload, { to: [to] })
  else room.send('obstaclePath', payload)
}

function protectTransform(entity: Entity) {
  Transform.validateBeforeChange(entity, (value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

function placeCog(p: { x: number; z: number }, now: number): CogState {
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(p.x, ARENA.y, p.z) })
  const cog: CogState = {
    id: nextCogId++,
    entity,
    x: p.x,
    z: p.z,
    spin: COG_SPIN_DEG,
    t0: now
  }
  Cog.create(entity, { id: cog.id, spin: cog.spin, t0: cog.t0 })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Cog.componentId])
  cogs.push(cog)
  broadcastCog(cog)
  return cog
}

function farEnough(p: { x: number; z: number }): boolean {
  const minSep = COG_HIT_R * 2 + 8
  return cogs.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= minSep)
}

export function cogCount(): number {
  return cogs.length
}

export function addCog(): number {
  if (cogs.length >= COG_MAX) return cogs.length
  const rng = Math.random
  let p = randomArenaPoint(COG_HIT_R + 2, rng)
  for (let attempt = 0; attempt < 40; attempt++) {
    if (farEnough(p)) break
    p = randomArenaPoint(COG_HIT_R + 2, rng)
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
    let p = randomArenaPoint(COG_HIT_R + 2, rng)
    for (let attempt = 0; attempt < 40; attempt++) {
      if (farEnough(p)) break
      p = randomArenaPoint(COG_HIT_R + 2, rng)
    }
    placeCog(p, now)
  }
}

export function sendCogsTo(address?: string) {
  for (const cog of cogs) broadcastCog(cog, address)
}

export function getCogPositions(): { x: number; z: number }[] {
  return cogs.map((c) => ({ x: c.x, z: c.z }))
}

function knockFromCog(entity: Entity, cog: CogState, r: number): boolean {
  const dx = Blob.get(entity).x - cog.x
  const dz = Blob.get(entity).z - cog.z
  const dist = Math.hypot(dx, dz) || 1
  const nx = dx / dist
  const nz = dz / dist
  const mut = Blob.getMutable(entity)
  mut.vx = nx * COG_IMPULSE
  mut.vz = nz * COG_IMPULSE
  const placed = clampArena(cog.x + nx * (COG_HIT_R + r + 2.2), cog.z + nz * (COG_HIT_R + r + 2.2), r)
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
    const dist = Math.hypot(blob.x - cog.x, blob.z - cog.z)
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
    if (knockFromCog(entity, cog, r)) shredded = true
  }
  return shredded
}

export function tickCogs(onShred: (address: string) => void) {
  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (hitCogEntity(entity, 1)) onShred(blob.address)
  }
}
