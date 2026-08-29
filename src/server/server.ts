import { engine, Entity, PlayerIdentityData, Transform } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { syncEntity } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'
import {
  ARENA,
  BOOST_COUNT,
  BOOST_MASS,
  BOOST_MS,
  BOOST_MAX_STACKS,
  BOOST_MULT,
  FOOD_COUNT,
  FOOD_KIND_BOOST,
  FOOD_KIND_PELLET,
  FOOD_KIND_SPIKE,
  FOOD_MASS,
  SPIKE_COUNT,
  SPIKE_HIT_CD_MS,
  SPIKE_IMPULSE,
  SPIKE_MASS,
  SPIKE_MS,
  BLOB_SEPARATE,
  ELASTIC,
  MAX_BLOBS,
  MIN_SPLIT_MASS,
  DEATH_RESPAWN_MS,
  SPLIT_COOLDOWN_MS,
  PLAYER_COLORS,
  START_MASS,
  BOT_MAX_MASS,
  blobEatsBlob,
  clampArena,
  foodOverlaps,
  radiusFromMass,
  randomArenaPoint,
  shredMass,
  speedFromMass,
  stepBody
} from '../shared/config'
import { isGm } from '../shared/gm'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { Blob, Cell, Food, Heartbeat, protectServerWrites } from '../shared/schemas'
import { loadBoard, recordBest, rememberName, resetBoard, sendBoard } from './board'

import { addBot, botCount, botPosition, forgetBot, isBot, loadBots, removeBot, sendBotsTo, tickBots } from './bots'
import { addCog, cogCount, hitCogEntity, removeCog, sendCogsTo, spawnCogs, tickCogs } from './cogs'
import { clearFlamingos, hasFlamingos, sendFlamingosTo, spawnFlamingos, tickFlamingos } from './flamingos'
import { initForge, isForgePinging, noteFoodEaten, noteHumanEaten, reportForgeLeave, setForgePinging } from './forge'

const cells = new Map<string, Entity>()
const intents = new Map<string, { x: number; z: number }>()
const foodById = new Map<number, Entity>()
const splitCd = new Map<string, number>()
const deadUntil = new Map<string, number>()
const boostUntil = new Map<string, number[]>()
const spikeUntil = new Map<string, number>()
const spikeHitCd = new Map<string, number>()
const playerTint = new Map<string, number>()
let nextFoodId = 1
let nextBlobId = 1
let heartbeatEntity: Entity | null = null
let heartbeatAcc = 0

function normalizeAddress(address: string): string {
  return address.toLowerCase()
}

function protectTransform(entity: Entity) {
  Transform.validateBeforeChange(entity, (value) => value.senderAddress === AUTH_SERVER_PEER_ID)
}

function broadcastMass(address: string, mass: number) {
  room.send('massUpdate', { address, mass })
  if (!isBot(address)) recordBest(address, mass)
}

function spawnCell(address: string, at?: { x: number; z: number }): Entity {
  const r = radiusFromMass(START_MASS)
  const p = at ?? randomArenaPoint(r)
  const entity = engine.addEntity()
  Transform.create(entity, { position: Vector3.create(p.x, ARENA.y, p.z) })
  Cell.create(entity, { address, mass: START_MASS, vx: 0, vz: 0 })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Cell.componentId])
  cells.set(address, entity)
  intents.set(address, { x: 0, z: 0 })
  spawnBlob(address, START_MASS, p.x, p.z)
  broadcastMass(address, START_MASS)
  room.send('respawn', { address, x: p.x, z: p.z })
  logEvent('player.spawn', { address, x: p.x, z: p.z, mass: START_MASS })
  return entity
}

function pickTint(): number {
  const counts = new Array(PLAYER_COLORS).fill(0)
  for (const t of playerTint.values()) {
    const i = ((t % PLAYER_COLORS) + PLAYER_COLORS) % PLAYER_COLORS
    counts[i]++
  }
  let min = Infinity
  for (const c of counts) if (c < min) min = c
  const free: number[] = []
  for (let i = 0; i < PLAYER_COLORS; i++) if (counts[i] === min) free.push(i)
  const pick = free[Math.floor(Math.random() * free.length)]
  return pick ?? Math.floor(Math.random() * PLAYER_COLORS)
}

function tintOf(address: string): number {
  const have = playerTint.get(address)
  if (have !== undefined) return have
  const tint = pickTint()
  playerTint.set(address, tint)
  return tint
}

function spawnBlob(address: string, mass: number, x: number, z: number): Entity {
  const entity = engine.addEntity()
  Blob.create(entity, { address, blobId: nextBlobId++, mass, x, z, vx: 0, vz: 0, tint: tintOf(address) })
  syncEntity(entity, [Blob.componentId])
  return entity
}

function blobsOf(address: string): Entity[] {
  const out: Entity[] = []
  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (blob.address === address) out.push(entity)
  }
  return out
}

function refreshCellMass(address: string) {
  const cellEntity = cells.get(address)
  if (!cellEntity || !Cell.has(cellEntity)) return 0
  if (isBot(address)) {
    for (const entity of blobsOf(address)) {
      const b = Blob.getMutable(entity)
      if (b.mass >= BOT_MAX_MASS) b.mass = START_MASS
    }
  }
  let total = 0
  for (const entity of blobsOf(address)) total += Blob.get(entity).mass
  if (isBot(address) && total >= BOT_MAX_MASS) {
    const list = blobsOf(address)
    if (list.length > 0) {
      Blob.getMutable(list[0]).mass = START_MASS
      for (let i = 1; i < list.length; i++) engine.removeEntity(list[i])
    }
    total = START_MASS
  }
  Cell.getMutable(cellEntity).mass = total
  broadcastMass(address, total)
  return total
}

function clearBlobs(address: string) {
  for (const entity of blobsOf(address)) engine.removeEntity(entity)
}

function removeCell(address: string) {
  reportForgeLeave(address)
  const entity = cells.get(address)
  clearBlobs(address)
  if (entity) engine.removeEntity(entity)
  cells.delete(address)
  intents.delete(address)
  deadUntil.delete(address)
  boostUntil.delete(address)
  spikeUntil.delete(address)
  playerTint.delete(address)
  missingSince.delete(address)
  if (isBot(address)) forgetBot(address)
  logEvent('player.remove', { address })
}

function sendGmState(to?: string) {
  const payload = { flamingos: hasFlamingos(), spinners: cogCount(), bots: botCount(), forge: isForgePinging() }
  if (to) room.send('gmState', payload, { to: [to] })
  else room.send('gmState', payload)
}

function respawnCell(entity: Entity, address: string) {
  const r = radiusFromMass(START_MASS)
  const p = botPosition(address) ?? randomArenaPoint(r)
  const t = Transform.getMutable(entity)
  t.position.x = p.x
  t.position.y = ARENA.y
  t.position.z = p.z
  const cell = Cell.getMutable(entity)
  cell.mass = START_MASS
  cell.vx = 0
  cell.vz = 0
  intents.set(address, { x: 0, z: 0 })
  clearBlobs(address)
  spawnBlob(address, START_MASS, p.x, p.z)
  deadUntil.delete(address)
  boostUntil.delete(address)
  spikeUntil.delete(address)
  broadcastMass(address, START_MASS)
  room.send('respawn', { address, x: p.x, z: p.z })
  logEvent('player.respawn', { address, x: p.x, z: p.z })
}

function spawnFood(at?: { x: number; z: number }) {
  const id = nextFoodId++
  const r = radiusFromMass(FOOD_MASS)
  const p = at ?? randomArenaPoint(r)
  const entity = engine.addEntity()
  const d = r * 2
  Transform.create(entity, {
    position: Vector3.create(p.x, r, p.z),
    scale: Vector3.create(d, d, d)
  })
  const hue = (Math.floor(Math.random() * 10) + 0.5) / 10
  Food.create(entity, { id, mass: FOOD_MASS, hue, kind: FOOD_KIND_PELLET })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Food.componentId])
  foodById.set(id, entity)
  room.send('foodSpawn', { id, x: p.x, z: p.z, mass: FOOD_MASS, hue, kind: FOOD_KIND_PELLET })
  return id
}

function spawnBoost(at?: { x: number; z: number }) {
  const id = nextFoodId++
  const r = radiusFromMass(BOOST_MASS)
  const p = at ?? randomArenaPoint(r)
  const entity = engine.addEntity()
  const d = r * 2
  Transform.create(entity, {
    position: Vector3.create(p.x, r, p.z),
    scale: Vector3.create(d, d, d)
  })
  Food.create(entity, { id, mass: BOOST_MASS, hue: 0.13, kind: FOOD_KIND_BOOST })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Food.componentId])
  foodById.set(id, entity)
  room.send('foodSpawn', { id, x: p.x, z: p.z, mass: BOOST_MASS, hue: 0.13, kind: FOOD_KIND_BOOST })
  return id
}

function liveBoosts(address: string, now = Date.now()): number[] {
  const live = (boostUntil.get(address) ?? []).filter((t) => t > now)
  if (live.length === 0) boostUntil.delete(address)
  else boostUntil.set(address, live)
  return live
}

function grantBoost(address: string) {
  const now = Date.now()
  const live = liveBoosts(address, now)
  live.push(now + BOOST_MS)
  const stacked = live.length > BOOST_MAX_STACKS ? live.slice(live.length - BOOST_MAX_STACKS) : live
  boostUntil.set(address, stacked)
  const until = stacked.reduce((m, t) => (t > m ? t : m), 0)
  const remains = stacked.map((t) => Math.max(0, t - now))
  room.send('boostStart', { address, until, stacks: stacked.length, untils: stacked, remains })
}

function spawnSpike(at?: { x: number; z: number }) {
  const id = nextFoodId++
  const r = radiusFromMass(SPIKE_MASS)
  const p = at ?? randomArenaPoint(r)
  const entity = engine.addEntity()
  const d = r * 2
  Transform.create(entity, {
    position: Vector3.create(p.x, r, p.z),
    scale: Vector3.create(d, d, d)
  })
  Food.create(entity, { id, mass: SPIKE_MASS, hue: 0.92, kind: FOOD_KIND_SPIKE })
  protectTransform(entity)
  syncEntity(entity, [Transform.componentId, Food.componentId])
  foodById.set(id, entity)
  room.send('foodSpawn', { id, x: p.x, z: p.z, mass: SPIKE_MASS, hue: 0.92, kind: FOOD_KIND_SPIKE })
  return id
}

function grantSpike(address: string) {
  const remain = SPIKE_MS
  const until = Date.now() + remain
  spikeUntil.set(address, until)
  room.send('spikeStart', { address, until, remain })
}

function hasSpikes(address: string): boolean {
  if (isBot(address)) return true
  return Date.now() < (spikeUntil.get(address) ?? 0)
}

function sendPowersTo(address: string) {
  const now = Date.now()
  for (const [who, untils] of boostUntil) {
    const live = untils.filter((t) => t > now)
    if (live.length === 0) continue
    const until = live.reduce((m, t) => (t > m ? t : m), 0)
    const remains = live.map((t) => Math.max(0, t - now))
    room.send('boostStart', { address: who, until, stacks: live.length, untils: live, remains }, { to: [address] })
  }
  for (const [who, until] of spikeUntil) {
    if (until > now) room.send('spikeStart', { address: who, until, remain: until - now }, { to: [address] })
  }
}

function removeFood(id: number, foodEntity: Entity) {
  foodById.delete(id)
  engine.removeEntity(foodEntity)
  room.send('foodGone', { id })
}

function tryEatFood(blobEntity: Entity, foodEntity: Entity, foodId: number, foodMass: number): boolean {
  const kind = Food.has(foodEntity) ? Food.get(foodEntity).kind : FOOD_KIND_PELLET
  const address = Blob.get(blobEntity).address
  if (isBot(address) && kind !== FOOD_KIND_PELLET) return false
  noteFoodEaten(address)
  if (kind === FOOD_KIND_BOOST) {
    grantBoost(address)
    removeFood(foodId, foodEntity)
    spawnBoost()
    return true
  }
  if (kind === FOOD_KIND_SPIKE) {
    grantSpike(address)
    removeFood(foodId, foodEntity)
    spawnSpike()
    logEvent('pickup.spike', { address, id: foodId })
    return true
  }
  Blob.getMutable(blobEntity).mass += foodMass
  refreshCellMass(address)
  removeFood(foodId, foodEntity)
  spawnFood()
  return true
}

const missingSince = new Map<string, number>()

function syncPlayers() {
  const live = new Set<string>()
  for (const [_entity, identity] of engine.getEntitiesWith(PlayerIdentityData)) {
    const address = normalizeAddress(identity.address)
    if (!address) continue
    live.add(address)
  }
  if (live.size === 0) return
  const now = Date.now()
  for (const [address, entity] of cells) {
    if (isBot(address) || live.has(address)) {
      missingSince.delete(address)
      continue
    }
    const since = missingSince.get(address) ?? now
    missingSince.set(address, since)
    if (now - since < 8000) continue
    missingSince.delete(address)
    reportForgeLeave(address)
    engine.removeEntity(entity)
    cells.delete(address)
    intents.delete(address)
    clearBlobs(address)
    deadUntil.delete(address)
    boostUntil.delete(address)
    spikeUntil.delete(address)
    playerTint.delete(address)
    logEvent('player.leave', { address })
  }
}

function isDead(address: string): boolean {
  const until = deadUntil.get(address)
  if (!until) return false
  if (Date.now() >= until) {
    deadUntil.delete(address)
    return false
  }
  return true
}

function blobById(blobId: number): Entity | null {
  for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
    if (blob.blobId === blobId) return entity
  }
  return null
}

function killPlayer(victim: string, killer: string, x: number, z: number) {
  noteHumanEaten(killer, victim)
  clearBlobs(victim)
  const cell = cells.get(victim)
  if (cell && Cell.has(cell)) {
    const mut = Cell.getMutable(cell)
    mut.mass = 0
    mut.vx = 0
    mut.vz = 0
  }
  intents.set(victim, { x: 0, z: 0 })
  boostUntil.delete(victim)
  spikeUntil.delete(victim)
  deadUntil.set(victim, Date.now() + DEATH_RESPAWN_MS)
  broadcastMass(victim, 0)
  room.send('playerKilled', { victim, killer, x, z })
  logEvent('player.killed', { victim, killer, x, z })
}

function consumeBlob(eaterBlob: Entity, preyBlob: Entity) {
  if (!Blob.has(eaterBlob) || !Blob.has(preyBlob)) return
  const prey = Blob.get(preyBlob)
  const eater = Blob.get(eaterBlob)
  if (eater.address === prey.address) return
  if (isBot(prey.address)) return
  const victim = prey.address
  const killer = eater.address
  const x = prey.x
  const z = prey.z
  const mass = prey.mass
  const blobId = prey.blobId
  Blob.getMutable(eaterBlob).mass += mass
  refreshCellMass(killer)
  engine.removeEntity(preyBlob)
  if (blobsOf(victim).length === 0) {
    killPlayer(victim, killer, x, z)
    return
  }
  refreshCellMass(victim)
  room.send('blobEaten', { victim, killer, blobId, x, z, mass })
  logEvent('blob.eaten', { victim, killer, blobId, mass, x, z })
}

function tickDeaths() {
  const now = Date.now()
  for (const [address, until] of [...deadUntil.entries()]) {
    if (now < until) continue
    deadUntil.delete(address)
    const cell = cells.get(address)
    if (cell && Cell.has(cell)) respawnCell(cell, address)
  }
}

function blobWorld(_parent: Entity, blobEntity: Entity) {
  const b = Blob.get(blobEntity)
  return { x: b.x, z: b.z, mass: b.mass, r: radiusFromMass(b.mass), blob: blobEntity, address: b.address }
}

function overlappingBlob(address: string, foodEntity: Entity, slack = 1.4): Entity | null {
  const parent = cells.get(address)
  if (!parent || !Transform.has(parent)) return null
  const ft = Transform.get(foodEntity).position
  const fr = radiusFromMass(Food.get(foodEntity).mass)
  let best: Entity | null = null
  let bestD = Infinity
  for (const blobEntity of blobsOf(address)) {
    const w = blobWorld(parent, blobEntity)
    const dx = w.x - ft.x
    const dz = w.z - ft.z
    const d2 = dx * dx + dz * dz
    if (foodOverlaps(dx, dz, w.r, fr, slack) && d2 < bestD) {
      bestD = d2
      best = blobEntity
    }
  }
  return best
}

function clusterRadius(address: string): number {
  const list = blobsOf(address)
  if (list.length === 0) return radiusFromMass(START_MASS)
  let cx = 0
  let cz = 0
  for (const entity of list) {
    const b = Blob.get(entity)
    cx += b.x
    cz += b.z
  }
  cx /= list.length
  cz /= list.length
  let max = radiusFromMass(START_MASS)
  for (const entity of list) {
    const b = Blob.get(entity)
    const reach = Math.hypot(b.x - cx, b.z - cz) + radiusFromMass(b.mass)
    if (reach > max) max = reach
  }
  return max
}

function tickEat() {
  const pieces: ReturnType<typeof blobWorld>[] = []
  for (const [parent, cell] of engine.getEntitiesWith(Cell, Transform)) {
    for (const blobEntity of blobsOf(cell.address)) {
      pieces.push(blobWorld(parent, blobEntity))
    }
  }

  const eatenFood: { blob: Entity; food: Entity; id: number; mass: number }[] = []
  for (const a of pieces) {
    for (const [foodEntity, food] of engine.getEntitiesWith(Food, Transform)) {
      if (!foodById.has(food.id)) continue
      const ft = Transform.get(foodEntity)
      const fr = radiusFromMass(food.mass)
      const dx = a.x - ft.position.x
      const dz = a.z - ft.position.z
      if (foodOverlaps(dx, dz, a.r, fr)) {
        eatenFood.push({ blob: a.blob, food: foodEntity, id: food.id, mass: food.mass })
      }
    }
  }
  const usedFood = new Set<number>()
  for (const hit of eatenFood) {
    if (usedFood.has(hit.id)) continue
    usedFood.add(hit.id)
    tryEatFood(hit.blob, hit.food, hit.id, hit.mass)
  }

  const eatenBlobs = new Set<Entity>()
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      const a = pieces[i]
      const b = pieces[j]
      if (a.address === b.address) continue
      if (eatenBlobs.has(a.blob) || eatenBlobs.has(b.blob)) continue
      if (!Blob.has(a.blob) || !Blob.has(b.blob)) continue
      if (resolveSpikeTouch(a, b)) continue
      const am = Blob.get(a.blob).mass
      const bm = Blob.get(b.blob).mass
      const dist = Math.hypot(a.x - b.x, a.z - b.z)
      const aEats = blobEatsBlob(am, bm, dist, 1.45)
      const bEats = blobEatsBlob(bm, am, dist, 1.45)
      if (aEats && (!bEats || am >= bm)) {
        eatenBlobs.add(b.blob)
        consumeBlob(a.blob, b.blob)
      } else if (bEats) {
        eatenBlobs.add(a.blob)
        consumeBlob(b.blob, a.blob)
      }
    }
  }
}

function spikePairKey(aId: number, bId: number): string {
  return aId < bId ? `${aId}:${bId}` : `${bId}:${aId}`
}

function knockBlob(
  entity: Entity,
  fromX: number,
  fromZ: number,
  fromR: number,
  impulse: number,
  shred: boolean
) {
  if (!Blob.has(entity)) return
  if (isBot(Blob.get(entity).address)) return
  const mut = Blob.getMutable(entity)
  const dx = mut.x - fromX
  const dz = mut.z - fromZ
  const dist = Math.hypot(dx, dz) || 1
  const nx = dx / dist
  const nz = dz / dist
  const r = radiusFromMass(mut.mass)
  mut.vx = nx * impulse
  mut.vz = nz * impulse
  const placed = clampArena(fromX + nx * (fromR + r + 0.8), fromZ + nz * (fromR + r + 0.8), r)
  mut.x = placed.x
  mut.z = placed.z
  if (shred) {
    const next = shredMass(mut.mass)
    if (next < mut.mass - 0.01) {
      mut.mass = next
      refreshCellMass(mut.address)
    }
  }
  room.send('spikeHit', {
    blobId: mut.blobId,
    x: mut.x,
    z: mut.z,
    vx: mut.vx,
    vz: mut.vz,
    mass: mut.mass
  })
}

function resolveSpikeTouch(
  a: ReturnType<typeof blobWorld>,
  b: ReturnType<typeof blobWorld>
): boolean {
  const aSpike = hasSpikes(a.address)
  const bSpike = hasSpikes(b.address)
  if (!aSpike && !bSpike) return false
  const dist = Math.hypot(a.x - b.x, a.z - b.z)
  const am = Blob.has(a.blob) ? Blob.get(a.blob).mass : a.mass
  const bm = Blob.has(b.blob) ? Blob.get(b.blob).mass : b.mass
  const touching = dist <= (a.r + b.r) * 1.4
  const aEats = blobEatsBlob(am, bm, dist, 2.2)
  const bEats = blobEatsBlob(bm, am, dist, 2.2)
  if (dist < 0.0001 || (!touching && !aEats && !bEats)) return false
  const now = Date.now()
  const aId = Blob.get(a.blob).blobId
  const bId = Blob.get(b.blob).blobId
  const key = spikePairKey(aId, bId)
  const last = spikeHitCd.get(key) ?? 0
  if (now - last < SPIKE_HIT_CD_MS) return true
  if (aSpike && bEats) {
    spikeHitCd.set(key, now)
    knockBlob(b.blob, a.x, a.z, a.r, SPIKE_IMPULSE, true)
    logEvent('spike.hit', { attacker: a.address, victim: b.address, x: b.x, z: b.z })
    return true
  }
  if (bSpike && aEats) {
    spikeHitCd.set(key, now)
    knockBlob(a.blob, b.x, b.z, b.r, SPIKE_IMPULSE, true)
    logEvent('spike.hit', { attacker: b.address, victim: a.address, x: a.x, z: a.z })
    return true
  }
  return false
}

function tickMove(dt: number) {
  for (const [entity, cell] of engine.getEntitiesWith(Cell, Transform)) {
    if (isBot(cell.address)) continue
    const intent = intents.get(cell.address) ?? { x: 0, z: 0 }
    const list = blobsOf(cell.address)
    if (list.length === 0) continue
    for (const blobEntity of list) {
      const b = Blob.getMutable(blobEntity)
      const stacks = liveBoosts(cell.address).length
      const spd = speedFromMass(b.mass) * Math.pow(BOOST_MULT, stacks)
      const next = stepBody(b.x, b.z, b.vx, b.vz, intent.x, intent.z, spd, radiusFromMass(b.mass), dt)
      b.x = next.x
      b.z = next.z
      b.vx = next.vx
      b.vz = next.vz
    }
    let cx = 0
    let cz = 0
    let cvx = 0
    let cvz = 0
    for (const blobEntity of list) {
      const b = Blob.get(blobEntity)
      cx += b.x
      cz += b.z
      cvx += b.vx
      cvz += b.vz
    }
    const n = list.length
    cx /= n
    cz /= n
    if (n > 1) {
      for (const blobEntity of list) {
        const b = Blob.getMutable(blobEntity)
        b.vx += (cx - b.x) * ELASTIC * dt
        b.vz += (cz - b.z) * ELASTIC * dt
      }
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = Blob.getMutable(list[i])
          const b = Blob.getMutable(list[j])
          const dx = b.x - a.x
          const dz = b.z - a.z
          const dist = Math.hypot(dx, dz)
          const min = radiusFromMass(a.mass) + radiusFromMass(b.mass) + 0.15
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
    const t = Transform.getMutable(entity)
    t.position.x = cx
    t.position.z = cz
    const mut = Cell.getMutable(entity)
    mut.vx = cvx / n
    mut.vz = cvz / n
  }
}

function splitPlayer(address: string, dirx: number, dirz: number) {
  if (isDead(address)) return
  const now = Date.now()
  if (now - (splitCd.get(address) ?? 0) < SPLIT_COOLDOWN_MS) return
  const parent = cells.get(address)
  if (!parent) return
  const current = blobsOf(address)
  if (current.length >= MAX_BLOBS) return
  let dx = dirx
  let dz = dirz
  let dlen = Math.hypot(dx, dz)
  if (dlen < 0.01) {
    const cell = Cell.get(parent)
    dx = cell.vx
    dz = cell.vz
    dlen = Math.hypot(dx, dz)
  }
  if (dlen < 0.01) {
    dx = 1
    dz = 0
  } else {
    dx /= dlen
    dz /= dlen
  }

  const toSplit = current.filter((e) => Blob.get(e).mass >= MIN_SPLIT_MASS * 2)
  let count = current.length
  for (const entity of toSplit) {
    if (count >= MAX_BLOBS) break
    const blob = Blob.getMutable(entity)
    const half = blob.mass / 2
    if (half < MIN_SPLIT_MASS) continue
    blob.mass = half
    const sep = radiusFromMass(half) + 0.45
    blob.x -= dx * sep
    blob.z -= dz * sep
    const kick = 10
    blob.vx -= dx * kick
    blob.vz -= dz * kick
    const child = spawnBlob(address, half, blob.x + dx * sep * 2, blob.z + dz * sep * 2)
    const c = Blob.getMutable(child)
    c.vx = blob.vx + dx * kick * 2
    c.vz = blob.vz + dz * kick * 2
    count++
  }
  refreshCellMass(address)
  splitCd.set(address, now)
}

function combinePlayer(address: string) {
  if (isDead(address)) return
  const list = blobsOf(address)
  if (list.length <= 1) return
  let cx = 0
  let cz = 0
  let mass = 0
  let vx = 0
  let vz = 0
  for (const entity of list) {
    const b = Blob.get(entity)
    cx += b.x
    cz += b.z
    mass += b.mass
    vx += b.vx
    vz += b.vz
  }
  const n = list.length
  cx /= n
  cz /= n
  vx /= n
  vz /= n
  const keep = Blob.getMutable(list[0])
  keep.mass = mass
  keep.x = cx
  keep.z = cz
  keep.vx = vx
  keep.vz = vz
  for (let i = 1; i < list.length; i++) engine.removeEntity(list[i])
  refreshCellMass(address)
  logEvent('player.combine', { address, mass, pieces: n })
}

export function initServer() {
  logEvent('server.start', { game: 'gulp' })
  protectServerWrites()
  initForge()
  void loadBoard()

  heartbeatEntity = engine.addEntity()
  Heartbeat.create(heartbeatEntity, { t: Math.floor(Date.now()) })
  syncEntity(heartbeatEntity, [Heartbeat.componentId], 1)

  for (let i = 0; i < FOOD_COUNT; i++) spawnFood()
  for (let i = 0; i < BOOST_COUNT; i++) spawnBoost()
  for (let i = 0; i < SPIKE_COUNT; i++) spawnSpike()
  spawnCogs()
  void loadBots(spawnCell, removeCell).then(() => sendGmState())
  // flamingos off by default — GM Obstacles tab can spawn them
  // spawnFlamingos()

  room.onMessage('join', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    rememberName(address, data.name ?? '')
    const existing = cells.get(address)
    if (existing && Cell.has(existing)) respawnCell(existing, address)
    else spawnCell(address)
    sendCogsTo(address)
    sendBotsTo(address)
    if (hasFlamingos()) sendFlamingosTo(address)
    sendPowersTo(address)
    sendBoard(address)
    sendGmState(address)
  })

  room.onMessage('move', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    const x = Math.max(-1, Math.min(1, data.x))
    const z = Math.max(-1, Math.min(1, data.z))
    intents.set(address, { x, z })
  })

  room.onMessage('eatFood', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    if (isDead(address)) return
    const cellEntity = cells.get(address)
    if (!cellEntity) return
    const foodEntity = foodById.get(data.id)
    if (!foodEntity || !Food.has(foodEntity)) return
    const blob = overlappingBlob(address, foodEntity, 1.6)
    if (!blob) return
    tryEatFood(blob, foodEntity, data.id, Food.get(foodEntity).mass)
  })

  room.onMessage('eatPlayer', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    if (isDead(address)) return
    const preyEntity = blobById(data.id)
    if (!preyEntity || !Blob.has(preyEntity)) return
    const prey = Blob.get(preyEntity)
    if (isDead(prey.address)) return
    if (isBot(prey.address)) return
    let eaters: Entity[] = []
    if (prey.address === address) {
      for (const [entity, blob] of engine.getEntitiesWith(Blob)) {
        if (blob.address === address) continue
        if (isDead(blob.address)) continue
        eaters.push(entity)
      }
    } else {
      eaters = blobsOf(address)
    }
    const preyParent = cells.get(prey.address)
    const open: Entity[] = []
    for (const eaterEntity of eaters) {
      if (!Blob.has(eaterEntity)) continue
      const eater = Blob.get(eaterEntity)
      const parent = cells.get(eater.address)
      if (preyParent && parent && resolveSpikeTouch(blobWorld(parent, eaterEntity), blobWorld(preyParent, preyEntity))) {
        continue
      }
      open.push(eaterEntity)
    }
    let best: Entity | null = null
    let bestD = Infinity
    for (const eaterEntity of open) {
      const eater = Blob.get(eaterEntity)
      const dist = Math.hypot(eater.x - prey.x, eater.z - prey.z)
      if (!blobEatsBlob(eater.mass, prey.mass, dist, 2.2)) continue
      if (dist < bestD) {
        bestD = dist
        best = eaterEntity
      }
    }
    if (!best) return
    consumeBlob(best, preyEntity)
  })

  room.onMessage('hitCog', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    if (isDead(address)) return
    const entity = blobById(data.blobId)
    if (!entity || !Blob.has(entity)) return
    if (Blob.get(entity).address !== address) return
    if (hitCogEntity(entity, 1.45)) refreshCellMass(address)
  })

  room.onMessage('split', (data, context) => {
    if (!context?.from) return
    splitPlayer(normalizeAddress(context.from), data.x, data.z)
  })

  room.onMessage('combine', (_data, context) => {
    if (!context?.from) return
    combinePlayer(normalizeAddress(context.from))
  })

  room.onMessage('gmCmd', (data, context) => {
    if (!context?.from) return
    const address = normalizeAddress(context.from)
    if (!isGm(address)) return
    if (data.cmd === 'resetBoard') {
      logEvent('gm.resetBoard', { address })
      void resetBoard()
      return
    }
    if (data.cmd === 'forgeOn') {
      setForgePinging(true)
      logEvent('gm.forgeOn', { address })
      sendGmState()
      return
    }
    if (data.cmd === 'forgeOff') {
      setForgePinging(false)
      logEvent('gm.forgeOff', { address })
      sendGmState()
      return
    }
    if (data.cmd === 'flamingosOn') {
      spawnFlamingos()
      logEvent('gm.flamingosOn', { address })
      sendGmState()
      return
    }
    if (data.cmd === 'flamingosOff') {
      clearFlamingos()
      logEvent('gm.flamingosOff', { address })
      sendGmState()
      return
    }
    if (data.cmd === 'spinnerAdd') {
      addCog()
      logEvent('gm.spinnerAdd', { address, count: cogCount() })
      sendGmState()
      return
    }
    if (data.cmd === 'spinnerRemove') {
      removeCog()
      logEvent('gm.spinnerRemove', { address, count: cogCount() })
      sendGmState()
      return
    }
    if (data.cmd === 'botAdd') {
      const count = addBot()
      logEvent('gm.botAdd', { address, count })
      sendGmState()
      return
    }
    if (data.cmd === 'botRemove') {
      const count = removeBot()
      logEvent('gm.botRemove', { address, count })
      sendGmState()
    }
  })

  engine.addSystem((dt) => {
    try {
      syncPlayers()
      tickMove(dt)
      tickCogs((address) => refreshCellMass(address))
      if (hasFlamingos()) tickFlamingos()
      tickBots(isDead)
      tickEat()
      tickDeaths()
      heartbeatAcc += dt
      if (heartbeatAcc >= 2 && heartbeatEntity) {
        heartbeatAcc = 0
        Heartbeat.getMutable(heartbeatEntity).t = Date.now()
      }
    } catch (e) {
      logEvent('server.tick.fail', { error: String(e) })
    }
  })
}
