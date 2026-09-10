import { Entity, engine } from '@dcl/sdk/ecs'
import {
  ARENA_RADIUS,
  CANE_COUNT_MAX,
  CANE_COUNT_MIN,
  CANE_HIT_CD_MS,
  CANE_HIT_K,
  CANE_MIN_CENTER,
  CANE_RING_PAD,
  CANE_SCALE_MAX,
  CANE_SCALE_MIN,
  CANE_SEP_PAD,
  WORLD_CENTER,
  clampArena,
  isBot,
  mulberry32,
  radiusFromMass,
  resolveCaneBounce
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { Blob } from '../shared/schemas'

type CaneState = {
  id: number
  x: number
  z: number
  yaw: number
  scale: number
  hitR: number
}

const canes: CaneState[] = []
const hitCd = new Map<string, number>()
const inside = new Set<string>()
let bootSeed = 0

function caneHitR(scale: number): number {
  return scale * CANE_HIT_K
}

function randomCanePoint(hitR: number, rng: () => number): { x: number; z: number } {
  const maxR = Math.max(CANE_MIN_CENTER + 1, ARENA_RADIUS - CANE_RING_PAD - hitR)
  const minR = Math.min(CANE_MIN_CENTER, maxR - 1)
  const a = rng() * Math.PI * 2
  const r = Math.sqrt(rng() * (maxR * maxR - minR * minR) + minR * minR)
  return { x: WORLD_CENTER + Math.cos(a) * r, z: WORLD_CENTER + Math.sin(a) * r }
}

function farEnough(p: { x: number; z: number }, hitR: number): boolean {
  return canes.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= q.hitR + hitR + CANE_SEP_PAD)
}

function layoutPayload() {
  return {
    seed: bootSeed,
    canes: canes.map((c) => ({ id: c.id, x: c.x, z: c.z, yaw: c.yaw, scale: c.scale }))
  }
}

export function spawnCanes() {
  canes.length = 0
  hitCd.clear()
  inside.clear()
  bootSeed = (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0
  const rng = mulberry32(bootSeed)
  const count = CANE_COUNT_MIN + Math.floor(rng() * (CANE_COUNT_MAX - CANE_COUNT_MIN + 1))
  logEvent('cane.seed', { seed: bootSeed, count })
  for (let i = 0; i < count; i++) {
    const scale = CANE_SCALE_MIN + rng() * (CANE_SCALE_MAX - CANE_SCALE_MIN)
    const hitR = caneHitR(scale)
    let p = randomCanePoint(hitR, rng)
    for (let attempt = 0; attempt < 40; attempt++) {
      if (farEnough(p, hitR)) break
      p = randomCanePoint(hitR, rng)
    }
    canes.push({
      id: i + 1,
      x: p.x,
      z: p.z,
      yaw: rng() * 360,
      scale,
      hitR
    })
  }
  sendCanesTo()
}

export function sendCanesTo(address?: string) {
  if (canes.length === 0) return
  const payload = layoutPayload()
  if (address) room.send('caneLayout', payload, { to: [address] })
  else room.send('caneLayout', payload)
}

export function hitCaneEntity(entity: Entity, slack = 1): boolean {
  if (!Blob.has(entity)) return false
  const now = Date.now()
  let hit = false
  for (const cane of canes) {
    if (!Blob.has(entity)) break
    const blob = Blob.get(entity)
    const r = radiusFromMass(blob.mass)
    const dist = Math.hypot(blob.x - cane.x, blob.z - cane.z)
    const reach = (cane.hitR + r) * slack
    const key = `${blob.blobId}:${cane.id}`
    if (dist >= reach) {
      inside.delete(key)
      continue
    }
    const next = resolveCaneBounce(blob.x, blob.z, blob.vx, blob.vz, r, cane.x, cane.z, cane.hitR)
    if (!next.hit) {
      inside.delete(key)
      continue
    }
    const mut = Blob.getMutable(entity)
    mut.x = next.x
    mut.z = next.z
    mut.vx = next.vx
    mut.vz = next.vz
    const placed = clampArena(mut.x, mut.z, r)
    mut.x = placed.x
    mut.z = placed.z
    const last = hitCd.get(key) ?? 0
    if (!inside.has(key) && now - last >= CANE_HIT_CD_MS) {
      inside.add(key)
      hitCd.set(key, now)
      room.send('blobKnock', {
        blobId: mut.blobId,
        x: mut.x,
        z: mut.z,
        vx: mut.vx,
        vz: mut.vz,
        mass: mut.mass
      })
    }
    hit = true
  }
  return hit
}

export function tickCanes() {
  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (isBot(blob.address)) continue
    hitCaneEntity(entity, 1)
  }
}
