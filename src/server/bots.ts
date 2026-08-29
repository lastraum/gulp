import { engine, Transform } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import {
  BOT_COUNT,
  BOT_MAX,
  COG_HIT_R,
  EAT_MASS_RATIO,
  START_MASS,
  botAddress,
  botName,
  isBot,
  radiusFromMass,
  randomArenaPoint
} from '../shared/config'
import { logEvent } from '../shared/log'
import { Blob, Cell, Food } from '../shared/schemas'
import { rememberName } from './board'
import { getCogPositions } from './cogs'

type Intent = { x: number; z: number }
type SpawnFn = (address: string, at?: { x: number; z: number }) => void
type RemoveFn = (address: string) => void

const KEY = 'botCount'
const wanderUntil = new Map<string, number>()
const wanderDir = new Map<string, Intent>()

let wanted = BOT_COUNT
let spawnFn: SpawnFn | null = null
let removeFn: RemoveFn | null = null

export { isBot, BOT_MAX }

export function botCount(): number {
  let n = 0
  for (const [_e, cell] of engine.getEntitiesWith(Cell)) {
    if (isBot(cell.address)) n++
  }
  return n
}

export function forgetBot(address: string) {
  wanderUntil.delete(address)
  wanderDir.delete(address)
}

function botIndex(address: string): number {
  return Number(address.slice(4))
}

function liveIndices(): number[] {
  const out: number[] = []
  for (const [_e, cell] of engine.getEntitiesWith(Cell)) {
    if (!isBot(cell.address)) continue
    const i = botIndex(cell.address)
    if (Number.isFinite(i)) out.push(i)
  }
  return out.sort((a, b) => a - b)
}

function occupiedPoints(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    out.push({ x: blob.x, z: blob.z })
  }
  return out
}

function spawnOne(index: number) {
  if (!spawnFn) return
  const address = botAddress(index)
  rememberName(address, botName(address) ?? `Pip ${index + 1}`)
  const placed = occupiedPoints()
  let p = randomArenaPoint(8)
  for (let n = 0; n < 40; n++) {
    if (placed.every((q) => Math.hypot(q.x - p.x, q.z - p.z) >= 36)) break
    p = randomArenaPoint(8)
  }
  spawnFn(address, p)
}

function syncLive() {
  if (!spawnFn || !removeFn) return
  let live = liveIndices()
  while (live.length < wanted) {
    const have = new Set(live)
    let idx = -1
    for (let i = 0; i < BOT_MAX; i++) {
      if (!have.has(i)) {
        idx = i
        break
      }
    }
    if (idx < 0) break
    spawnOne(idx)
    live = liveIndices()
  }
  while (live.length > wanted) {
    const idx = live[live.length - 1]
    removeFn(botAddress(idx))
    live = liveIndices()
  }
}

async function persist() {
  try {
    await Storage.set(KEY, wanted)
    logEvent('bots.save', { count: wanted })
  } catch (e) {
    logEvent('bots.save.fail', { error: String(e) })
  }
}

export async function loadBots(spawn: SpawnFn, remove: RemoveFn) {
  spawnFn = spawn
  removeFn = remove
  wanted = BOT_COUNT
  let stored = false
  try {
    Storage.configure({ skipIfUnchanged: true, cacheReads: true })
    const n = await Storage.get<number>(KEY)
    if (typeof n === 'number' && Number.isFinite(n)) {
      wanted = Math.max(0, Math.min(BOT_MAX, Math.floor(n)))
      stored = true
    }
  } catch {
    stored = false
  }
  syncLive()
  if (!stored) void persist()
  logEvent('bots.load', { count: wanted, live: botCount() })
}

export function addBot(): number {
  if (wanted >= BOT_MAX) return wanted
  wanted += 1
  syncLive()
  void persist()
  return wanted
}

export function removeBot(): number {
  if (wanted <= 0) return 0
  wanted -= 1
  syncLive()
  void persist()
  return wanted
}

function cluster(address: string): { x: number; z: number; mass: number; r: number } | null {
  let x = 0
  let z = 0
  let mass = 0
  let n = 0
  let maxR = 0
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (blob.address !== address) continue
    x += blob.x
    z += blob.z
    mass += blob.mass
    n++
    const r = radiusFromMass(blob.mass)
    if (r > maxR) maxR = r
  }
  if (n === 0 || mass <= 0) return null
  return { x: x / n, z: z / n, mass, r: maxR }
}

function steerWander(address: string, now: number): Intent {
  if (now >= (wanderUntil.get(address) ?? 0)) {
    const p = randomArenaPoint(4)
    const me = cluster(address)
    const dx = p.x - (me?.x ?? p.x)
    const dz = p.z - (me?.z ?? p.z)
    const len = Math.hypot(dx, dz) || 1
    wanderDir.set(address, { x: dx / len, z: dz / len })
    wanderUntil.set(address, now + 1400 + Math.random() * 2200)
  }
  return wanderDir.get(address) ?? { x: 0, z: 0 }
}

export function tickBots(setIntent: (address: string, x: number, z: number) => void, isDead: (address: string) => boolean) {
  const now = Date.now()
  const pieces: { address: string; x: number; z: number; mass: number; r: number }[] = []
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    pieces.push({
      address: blob.address,
      x: blob.x,
      z: blob.z,
      mass: blob.mass,
      r: radiusFromMass(blob.mass)
    })
  }
  const foods: { x: number; z: number; mass: number }[] = []
  for (const [entity, food] of engine.getEntitiesWith(Food, Transform)) {
    const p = Transform.get(entity).position
    foods.push({ x: p.x, z: p.z, mass: food.mass })
  }
  const cogs = getCogPositions()

  for (const [_entity, cell] of engine.getEntitiesWith(Cell)) {
    if (!isBot(cell.address)) continue
    if (isDead(cell.address)) {
      setIntent(cell.address, 0, 0)
      continue
    }
    const me = cluster(cell.address)
    if (!me) {
      setIntent(cell.address, 0, 0)
      continue
    }

    const idx = Number(cell.address.slice(4)) || 0
    const nerve = 0.85 + (idx % 5) * 0.08
    const greed = 0.75 + (idx % 4) * 0.12

    let fx = 0
    let fz = 0
    let hx = 0
    let hz = 0
    let huntBest = Infinity
    let foodX = 0
    let foodZ = 0
    let foodBest = Infinity

    for (const other of pieces) {
      if (other.address === cell.address) continue
      const dx = other.x - me.x
      const dz = other.z - me.z
      const dist = Math.hypot(dx, dz)
      if (dist < 0.001) continue
      const nx = dx / dist
      const nz = dz / dist
      const danger = dist < (other.r + me.r) * 2.4 + 10 * nerve && other.mass > me.mass * EAT_MASS_RATIO
      if (danger) {
        const w = (18 * nerve) / Math.max(2, dist - other.r)
        fx -= nx * w
        fz -= nz * w
      } else if (
        me.mass >= START_MASS + 4 &&
        me.mass > other.mass * EAT_MASS_RATIO &&
        dist < 22 * greed + me.r * 3 &&
        dist < huntBest
      ) {
        huntBest = dist
        hx = nx
        hz = nz
      }
    }

    for (const cog of cogs) {
      const dx = cog.x - me.x
      const dz = cog.z - me.z
      const dist = Math.hypot(dx, dz)
      const keep = COG_HIT_R + me.r + 5
      if (dist >= keep || dist < 0.001) continue
      const w = 14 / Math.max(1.2, dist - COG_HIT_R)
      fx -= (dx / dist) * w
      fz -= (dz / dist) * w
    }

    for (let i = 0; i < foods.length; i++) {
      const food = foods[i]
      const dx = food.x - me.x
      const dz = food.z - me.z
      const dist = Math.hypot(dx, dz)
      if (dist > 48 || dist >= foodBest) continue
      foodBest = dist
      foodX = dx
      foodZ = dz
    }

    let dirx = 0
    let dirz = 0
    const flee = Math.hypot(fx, fz)
    if (flee > 0.15) {
      dirx = fx
      dirz = fz
    } else if (huntBest < Infinity) {
      dirx = hx
      dirz = hz
    } else if (foodBest < Infinity) {
      dirx = foodX
      dirz = foodZ
    } else {
      const w = steerWander(cell.address, now)
      dirx = w.x
      dirz = w.z
    }

    const t = now * 0.001 + idx * 1.7
    dirx += Math.sin(t * 0.9) * 0.12
    dirz += Math.cos(t * 0.8) * 0.12
    const len = Math.hypot(dirx, dirz)
    if (len < 0.02) {
      setIntent(cell.address, 0, 0)
      continue
    }
    setIntent(cell.address, dirx / len, dirz / len)
  }
}
