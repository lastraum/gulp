export const PARCELS = 20
export const PARCEL_M = 16
export const WORLD_M = PARCELS * PARCEL_M

export const ARENA = {
  min: 2,
  max: WORLD_M - 2,
  y: 0
}

export const WORLD_CENTER = WORLD_M / 2

export const START_MASS = 10
export const PLAYER_COLORS = 12
export const BOT_COUNT = 2
export const BOT_MAX = 12
export const BOT_NAMES = ['Pip', 'Dot', 'Nib', 'Puff', 'Goo', 'Bean', 'Wisp', 'Mochi', 'Pebble', 'Noodle', 'Pudding', 'Blobbo']

export function isBot(address: string): boolean {
  return address.startsWith('bot:')
}

export function botAddress(index: number): string {
  return `bot:${index}`
}

export function botName(address: string): string | null {
  if (!isBot(address)) return null
  const i = Number(address.slice(4))
  if (!Number.isFinite(i) || i < 0) return 'Wanderer'
  return BOT_NAMES[i % BOT_NAMES.length] ?? `Pip ${i + 1}`
}
export const FOOD_MASS = 1
export const FOOD_COUNT = 320
export const BOOST_COUNT = 8
export const BOOST_MASS = 3
export const BOOST_MS = 5000
export const BOOST_MULT = 2
export const BOOST_MAX_STACKS = 4
export const SPIKE_COUNT = 6
export const SPIKE_MASS = 3
export const SPIKE_MS = 4000
export const SPIKE_IMPULSE = 78
export const SPIKE_HIT_CD_MS = 280
export const FOOD_KIND_PELLET = 0
export const FOOD_KIND_BOOST = 1
export const FOOD_KIND_SPIKE = 2
export const EAT_MASS_RATIO = 1.05
export const BASE_SPEED = 33.6
export const MOVE_SEND_HZ = 30
export const AVATAR_Y = 0.12
export const CAM_FOLLOW = 10
export const BOOM_HEIGHT = 24
export const BOOM_SOUTH = 20
export const REMOTE_HALF_LIFE = 0.09
export const WALL_H = 28
export const WALL_H_SOUTH = 4.5
export const WALL_T = 0.6
export const WALL_BOUNCE = 1.35
export const WALL_IMPULSE = 21
export const VEL_ACCEL = 14.7
export const VEL_DAMP = 1.8
export const MIN_SPLIT_MASS = 5
export const MAX_BLOBS = 8
export const SPLIT_COOLDOWN_MS = 450
export const DEATH_RESPAWN_MS = 3000
export const ELASTIC = 4.2
export const BLOB_SEPARATE = 10
export const COG_COUNT = 4
export const COG_MAX = 12
export const COG_SPOKES = 30
export const COG_HUB_R = 1.89
export const COG_SPOKE_LEN = 6.72
export const COG_SPOKE_R = 0.252
export const COG_HIT_R = COG_HUB_R + COG_SPOKE_LEN
export const COG_IMPULSE = 72
export const COG_SPIN_DEG = 140
export const COG_HIT_CD_MS = 520
export const FLAMINGO_COUNT = 4
export const FLAMINGO_SCALE = 16.5
export const FLAMINGO_HIT_R = 8.7
export const FLAMINGO_SPEED = 11
export const FLAMINGO_IMPULSE = 64
export const FLAMINGO_HIT_CD_MS = 280
export const FLAMINGO_Y = 0.445 * FLAMINGO_SCALE

/** Mix of sqrt + linear so food and player eats both read as growth. */
export function radiusFromMass(mass: number): number {
  const m = Math.max(0, mass)
  const span = ARENA.max - ARENA.min
  const cap = span * 0.35
  return Math.min(cap, Math.max(0.5, 0.45 * Math.sqrt(m) + 0.08 * m))
}

export function speedFromMass(mass: number): number {
  return BASE_SPEED / Math.max(1, Math.sqrt(radiusFromMass(mass)))
}

/** Collect when food touches a blob disc, not only when it reaches the center. */
export function foodOverlaps(dx: number, dz: number, blobR: number, foodR: number, slack = 1): boolean {
  const reach = (blobR + foodR) * slack
  return dx * dx + dz * dz <= reach * reach
}

/** Bigger blob eats a smaller one when it overlaps that disc (covers its center). */
export function blobEatsBlob(eaterMass: number, preyMass: number, dist: number, slack = 1): boolean {
  if (eaterMass < preyMass * EAT_MASS_RATIO) return false
  const eaterR = radiusFromMass(eaterMass)
  const preyR = radiusFromMass(preyMass)
  const reach = (eaterR + preyR * 0.65) * slack
  return dist <= reach
}

export function clampArena(x: number, z: number, radius: number): { x: number; z: number } {
  const pad = radius + 0.2
  return {
    x: Math.min(ARENA.max - pad, Math.max(ARENA.min + pad, x)),
    z: Math.min(ARENA.max - pad, Math.max(ARENA.min + pad, z))
  }
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomArenaPoint(radius: number, rng: () => number = Math.random): { x: number; z: number } {
  const pad = radius + 2
  const span = ARENA.max - ARENA.min - pad * 2
  return {
    x: ARENA.min + pad + rng() * span,
    z: ARENA.min + pad + rng() * span
  }
}

export function shredMass(mass: number): number {
  if (mass <= MIN_SPLIT_MASS) return MIN_SPLIT_MASS
  return Math.max(MIN_SPLIT_MASS, mass / 2)
}

export function expAlpha(halfLife: number, dt: number): number {
  return 1 - Math.pow(2, -dt / Math.max(0.0001, halfLife))
}

export function stepBody(
  x: number,
  z: number,
  vx: number,
  vz: number,
  ix: number,
  iz: number,
  speed: number,
  radius: number,
  dt: number
): { x: number; z: number; vx: number; vz: number } {
  const len = Math.sqrt(ix * ix + iz * iz)
  const targetVx = len > 0.01 ? (ix / len) * speed : 0
  const targetVz = len > 0.01 ? (iz / len) * speed : 0
  const k = 1 - Math.exp(-(len > 0.01 ? VEL_ACCEL : VEL_DAMP) * dt)
  vx += (targetVx - vx) * k
  vz += (targetVz - vz) * k
  x += vx * dt
  z += vz * dt

  dt = Math.min(0.05, Math.max(0, dt))
  const min = ARENA.min + radius + 0.15
  const max = ARENA.max - radius - 0.15
  if (min >= max) {
    const mid = (ARENA.min + ARENA.max) / 2
    return { x: mid, z: mid, vx: 0, vz: 0 }
  }
  if (x < min) {
    x = min
    if (vx < 0) vx = Math.abs(vx) * WALL_BOUNCE + WALL_IMPULSE
  } else if (x > max) {
    x = max
    if (vx > 0) vx = -Math.abs(vx) * WALL_BOUNCE - WALL_IMPULSE
  }
  if (z < min) {
    z = min
    if (vz < 0) vz = Math.abs(vz) * WALL_BOUNCE + WALL_IMPULSE
  } else if (z > max) {
    z = max
    if (vz > 0) vz = -Math.abs(vz) * WALL_BOUNCE - WALL_IMPULSE
  }
  return { x, z, vx, vz }
}
