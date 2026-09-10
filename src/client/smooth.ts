import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import {
  BLOB_SEPARATE,
  BOOST_MAX_STACKS,
  BOOST_MS,
  BOOST_MULT,
  CANE_HIT_CD_MS,
  COG_HIT_CD_MS,
  COG_HIT_R,
  COG_IMPULSE,
  FLAMINGO_HIT_CD_MS,
  FLAMINGO_HIT_R,
  FLAMINGO_IMPULSE,
  ELASTIC,
  REMOTE_HALF_LIFE,
  SPIKE_HIT_CD_MS,
  SPIKE_IMPULSE,
  START_MASS,
  blobEatsBlob,
  expAlpha,
  isBot,
  radiusFromMass,
  resolveCaneBounce,
  shredMass,
  speedFromMass,
  stepBody
} from '../shared/config'
import { room } from '../shared/messages'
import { Blob, Cell } from '../shared/schemas'
import { getBotMotion } from './bots'
import { getCaneHits } from './canes'
import { getCogHits } from './cogs'
import { getFlamingoHits } from './flamingos'
import { getMoveInput } from './input'
import { getLocalAddress, isLocalAddr } from './local'

const RESPAWN_DIST2 = 40 * 40

type Display = { x: number; z: number }
type Pred = { x: number; z: number; vx: number; vz: number }
const display = new Map<Entity, Display>()
const localPred = new Map<number, Pred>()
const localBlobMass = new Map<number, { mass: number; until: number }>()

let predX = 0
let predZ = 0
let primed = false
let localMass = START_MASS
let shredUntil = 0
let spawnUntil = 0
let boostUntils: number[] = []
const spikeUntil = new Map<string, number>()
const cogHitAt = new Map<number, number>()
const cogInside = new Set<string>()
const caneHitAt = new Map<number, number>()
const caneInside = new Set<string>()
const flamingoHitAt = new Map<number, number>()
const spikeHitAt = new Map<number, number>()

function liveLocalBoosts(now = Date.now()): number[] {
  boostUntils = boostUntils.filter((t) => t > now)
  return boostUntils
}

export function startBoost(until = Date.now() + BOOST_MS) {
  const live = liveLocalBoosts()
  live.push(until)
  boostUntils = live.length > BOOST_MAX_STACKS ? live.slice(live.length - BOOST_MAX_STACKS) : live
}

export function setBoosts(untils: number[]) {
  const now = Date.now()
  const cap = now + BOOST_MS * BOOST_MAX_STACKS + 500
  boostUntils = untils.map((t) => Number(t)).filter((t) => t > now && t <= cap)
}

export function setBoostRemains(remains: number[]) {
  const now = Date.now()
  const cap = BOOST_MS * BOOST_MAX_STACKS + 500
  boostUntils = remains
    .map((r) => Number(r))
    .filter((r) => r > 0 && r <= cap)
    .map((r) => now + r)
}

export function getBoostStacks(): number {
  return liveLocalBoosts().length
}

export function getBoostRemain(): number {
  const live = liveLocalBoosts()
  if (live.length === 0) return 0
  return Math.max(0, Math.max(...live) - Date.now())
}

export function startSpike(address: string, until: number) {
  spikeUntil.set(address, Math.max(spikeUntil.get(address) ?? 0, until))
}

export function getSpikeRemain(address?: string): number {
  const key = address ?? getLocalAddress()
  if (!key) return 0
  return Math.max(0, (spikeUntil.get(key) ?? 0) - Date.now())
}

export function isSpiked(address: string): boolean {
  if (isBot(address)) return true
  return Date.now() < (spikeUntil.get(address) ?? 0)
}

function currentSpeed(mass: number): number {
  const s = speedFromMass(mass)
  const stacks = liveLocalBoosts().length
  return stacks > 0 ? s * Math.pow(BOOST_MULT, stacks) : s
}

function resolvedMass(blobId: number, serverMass: number): number {
  const pred = localBlobMass.get(blobId)
  if (!pred) return serverMass
  if (serverMass <= pred.mass + 0.05) {
    localBlobMass.delete(blobId)
    return serverMass
  }
  if (Date.now() > pred.until) {
    localBlobMass.delete(blobId)
    return serverMass
  }
  return Math.min(pred.mass, serverMass)
}

function dist2(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

function bounceBlob(blobId: number, p: Pred, mass: number, r: number): number {
  const now = Date.now()
  let overlapping = false
  for (const cog of getCogHits()) {
    const dx = p.x - cog.x
    const dz = p.z - cog.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const reach = COG_HIT_R + r
    const key = `${blobId}:${cog.id}`
    if (dist >= reach || dist < 0.0001) {
      cogInside.delete(key)
      continue
    }
    overlapping = true
    if (cogInside.has(key)) continue
    if (now - (cogHitAt.get(blobId) ?? 0) < COG_HIT_CD_MS) continue
    cogInside.add(key)
    cogHitAt.set(blobId, now)
    const nx = dx / dist
    const nz = dz / dist
    p.vx = nx * COG_IMPULSE
    p.vz = nz * COG_IMPULSE
    p.x = cog.x + nx * (reach + 2.2)
    p.z = cog.z + nz * (reach + 2.2)
    room.send('hitCog', { blobId })
    const next = shredMass(mass)
    if (next < mass - 0.01) {
      localBlobMass.set(blobId, { mass: next, until: now + 2500 })
      shredUntil = now + 2000
      return next
    }
    return mass
  }
  if (!overlapping) {
    for (const key of [...cogInside]) {
      if (key.startsWith(`${blobId}:`)) cogInside.delete(key)
    }
  }
  return mass
}

function bounceCanes(blobId: number, p: Pred, r: number) {
  const now = Date.now()
  let overlapping = false
  for (const cane of getCaneHits()) {
    const dx = p.x - cane.x
    const dz = p.z - cane.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const reach = cane.hitR + r
    const key = `${blobId}:${cane.id}`
    if (dist >= reach) {
      caneInside.delete(key)
      continue
    }
    overlapping = true
    const next = resolveCaneBounce(p.x, p.z, p.vx, p.vz, r, cane.x, cane.z, cane.hitR)
    p.x = next.x
    p.z = next.z
    p.vx = next.vx
    p.vz = next.vz
    if (!caneInside.has(key) && now - (caneHitAt.get(blobId) ?? 0) >= CANE_HIT_CD_MS) {
      caneInside.add(key)
      caneHitAt.set(blobId, now)
      room.send('hitCane', { blobId })
    }
  }
  if (!overlapping) {
    for (const key of [...caneInside]) {
      if (key.startsWith(`${blobId}:`)) caneInside.delete(key)
    }
  }
}

function bounceFlamingos(blobId: number, p: Pred, r: number) {
  const now = Date.now()
  if (now - (flamingoHitAt.get(blobId) ?? 0) < FLAMINGO_HIT_CD_MS) return
  for (const bird of getFlamingoHits()) {
    const dx = p.x - bird.x
    const dz = p.z - bird.z
    const dist = Math.sqrt(dx * dx + dz * dz)
    const reach = FLAMINGO_HIT_R + r
    if (dist >= reach || dist < 0.0001) continue
    flamingoHitAt.set(blobId, now)
    const nx = dx / dist
    const nz = dz / dist
    p.vx = -p.vx * 0.85 + nx * FLAMINGO_IMPULSE
    p.vz = -p.vz * 0.85 + nz * FLAMINGO_IMPULSE
    p.x = bird.x + nx * (reach + 0.5)
    p.z = bird.z + nz * (reach + 0.5)
    return
  }
}

function bounceSpikes(blobId: number, p: Pred, mass: number, r: number): number {
  const me = getLocalAddress()
  if (!me) return mass
  const now = Date.now()
  if (now - (spikeHitAt.get(blobId) ?? 0) < SPIKE_HIT_CD_MS) return mass
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (isLocalAddr(blob.address)) continue
    if (!isSpiked(blob.address)) continue
    if (!blobEatsBlob(mass, blob.mass, 0, 1)) continue
    const at = isBot(blob.address) ? getBotMotion(blob.address) : null
    const ox = at?.x ?? blob.x
    const oz = at?.z ?? blob.z
    const dx = p.x - ox
    const dz = p.z - oz
    const dist = Math.sqrt(dx * dx + dz * dz)
    const otherR = radiusFromMass(blob.mass)
    const reach = (r + otherR) * 1.4
    const eatish = blobEatsBlob(mass, blob.mass, dist, 2.2)
    if ((dist >= reach && !eatish) || dist < 0.0001) continue
    spikeHitAt.set(blobId, now)
    const nx = dx / dist
    const nz = dz / dist
    p.vx = nx * SPIKE_IMPULSE
    p.vz = nz * SPIKE_IMPULSE
    p.x = ox + nx * (r + otherR + 0.8)
    p.z = oz + nz * (r + otherR + 0.8)
    const next = shredMass(mass)
    if (next < mass - 0.01) {
      localBlobMass.set(blobId, { mass: next, until: now + 2500 })
      shredUntil = now + 2000
      return next
    }
    return mass
  }
  return mass
}

function tickLocalBlobs(dt: number) {
  const input = getMoveInput()
  const ids: number[] = []
  const masses = new Map<number, number>()
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (!isLocalAddr(blob.address)) continue
    ids.push(blob.blobId)
    let mass = resolvedMass(blob.blobId, blob.mass)
    if (Date.now() < spawnUntil && mass > START_MASS * 1.5) mass = START_MASS
    let p = localPred.get(blob.blobId)
    if (!p) {
      p = { x: blob.x, z: blob.z, vx: blob.vx, vz: blob.vz }
      localPred.set(blob.blobId, p)
    } else if (
      Date.now() - (cogHitAt.get(blob.blobId) ?? 0) > 400 &&
      Date.now() - (caneHitAt.get(blob.blobId) ?? 0) > 400
    ) {
      const err = Math.hypot(blob.x - p.x, blob.z - p.z)
      if (err > 28) {
        p.x = blob.x
        p.z = blob.z
        p.vx = blob.vx
        p.vz = blob.vz
      }
    }
    const r = radiusFromMass(mass)
    const next = stepBody(p.x, p.z, p.vx, p.vz, input.x, input.z, currentSpeed(mass), r, dt)
    p.x = next.x
    p.z = next.z
    p.vx = next.vx
    p.vz = next.vz
    mass = bounceBlob(blob.blobId, p, mass, r)
    bounceCanes(blob.blobId, p, r)
    bounceFlamingos(blob.blobId, p, r)
    mass = bounceSpikes(blob.blobId, p, mass, r)
    masses.set(blob.blobId, mass)
  }
  for (const id of [...localPred.keys()]) {
    if (!ids.includes(id)) localPred.delete(id)
  }
  if (ids.length === 0) return

  let cx = 0
  let cz = 0
  for (const id of ids) {
    const p = localPred.get(id)!
    cx += p.x
    cz += p.z
  }
  cx /= ids.length
  cz /= ids.length
  if (ids.length > 1) {
    for (const id of ids) {
      const p = localPred.get(id)!
      p.vx += (cx - p.x) * ELASTIC * dt
      p.vz += (cz - p.z) * ELASTIC * dt
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = localPred.get(ids[i])!
        const b = localPred.get(ids[j])!
        const dx = b.x - a.x
        const dz = b.z - a.z
        const dist = Math.hypot(dx, dz)
        const min = radiusFromMass(masses.get(ids[i]) ?? 5) + radiusFromMass(masses.get(ids[j]) ?? 5) + 0.15
        if (dist >= min || dist < 0.0001) continue
        const nx = dx / dist
        const nz = dz / dist
        const push = (min - dist) * BLOB_SEPARATE * dt
        a.x -= nx * push
        a.z -= nz * push
        b.x += nx * push
        b.z += nz * push
      }
    }
  }
  predX = cx
  predZ = cz
  primed = true
  let total = 0
  for (const m of masses.values()) total += m
  if (total > 0) localMass = total
}

export function registerSmooth() {

  engine.addSystem((dt) => {
    dt = Math.min(dt, 0.05)
    getLocalAddress()
    tickLocalBlobs(dt)
    const live = new Set<Entity>()

    for (const [entity, cell] of engine.getEntitiesWith(Cell, Transform)) {
      live.add(entity)
      const t = Transform.get(entity).position
      if (isLocalAddr(cell.address)) {
        display.set(entity, { x: predX, z: predZ })
        continue
      }
      const cur = display.get(entity) ?? { x: t.x, z: t.z }
      const prev = display.get(entity)
      if (prev && dist2(t.x, t.z, prev.x, prev.z) > RESPAWN_DIST2 && dist2(t.x, t.z, cur.x, cur.z) > RESPAWN_DIST2) {
        cur.x = t.x
        cur.z = t.z
      } else {
        cur.x += cell.vx * dt
        cur.z += cell.vz * dt
        const a = expAlpha(REMOTE_HALF_LIFE, dt)
        cur.x += (t.x - cur.x) * a
        cur.z += (t.z - cur.z) * a
      }
      display.set(entity, cur)
    }

    for (const entity of display.keys()) {
      if (!live.has(entity)) display.delete(entity)
    }
  })
}

export function getDisplayPos(entity: Entity): Display | null {
  return display.get(entity) ?? null
}

export function getLocalDisplayPos(): Display | null {
  return primed ? { x: predX, z: predZ } : null
}

export function getLocalBlobPos(blobId: number): Display | null {
  const p = localPred.get(blobId)
  return p ? { x: p.x, z: p.z } : null
}

export function getLocalBlobVel(blobId: number): Display | null {
  const p = localPred.get(blobId)
  return p ? { x: p.vx, z: p.vz } : null
}

export function getLocalBlobMass(blobId: number, serverMass: number): number {
  return resolvedMass(blobId, serverMass)
}

export function getLocalMass(): number {
  return localMass
}

export function setLocalMass(mass: number) {
  localMass = mass
}

export function recentlyShredded(): boolean {
  return Date.now() < shredUntil
}

export function recentlySpawned(): boolean {
  return Date.now() < spawnUntil
}

export function forgetLocalBlob(blobId: number) {
  localPred.delete(blobId)
  localBlobMass.delete(blobId)
}

export function applyBlobKnock(blobId: number, x: number, z: number, vx: number, vz: number, mass: number) {
  const p = localPred.get(blobId)
  if (!p) return
  p.x = x
  p.z = z
  p.vx = vx
  p.vz = vz
  const now = Date.now()
  cogHitAt.set(blobId, now)
  caneHitAt.set(blobId, now)
  const prev = resolvedMass(blobId, mass)
  if (mass + 0.05 < prev) {
    localBlobMass.set(blobId, { mass, until: now + 2500 })
    shredUntil = now + 2000
  }
}

export function applySpikeKnock(blobId: number, x: number, z: number, vx: number, vz: number, mass: number) {
  applyBlobKnock(blobId, x, z, vx, vz, mass)
}

export function applyDeath() {
  localMass = 0
  localPred.clear()
  localBlobMass.clear()
  cogHitAt.clear()
  cogInside.clear()
  caneHitAt.clear()
  caneInside.clear()
  flamingoHitAt.clear()
  shredUntil = 0
  boostUntils = []
  const me = getLocalAddress()
  if (me) spikeUntil.delete(me)
  spikeHitAt.clear()
}

export function applyRespawn(x: number, z: number) {
  predX = x
  predZ = z
  localMass = START_MASS
  primed = true
  localPred.clear()
  localBlobMass.clear()
  cogHitAt.clear()
  cogInside.clear()
  caneHitAt.clear()
  caneInside.clear()
  flamingoHitAt.clear()
  shredUntil = 0
  spawnUntil = Date.now() + 400
  boostUntils = []
  const me = getLocalAddress()
  if (me) spikeUntil.delete(me)
  spikeHitAt.clear()
}

export function resetPrediction() {
  primed = false
  localPred.clear()
  localBlobMass.clear()
  cogHitAt.clear()
  cogInside.clear()
  caneHitAt.clear()
  caneInside.clear()
}
