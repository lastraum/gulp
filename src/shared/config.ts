export const PARCELS = 60
export const PARCEL_M = 16
export const WORLD_M = PARCELS * PARCEL_M

export const ARENA = {
  min: 2,
  max: WORLD_M - 2,
  y: 0
}

export const WORLD_CENTER = WORLD_M / 2
export const ARENA_RADIUS = 150

export const START_MASS = 3.5
export const PLAYER_COLORS = 12
export const BOT_COUNT = 2
export const BOT_MAX = 12
export const BOT_SPEED = 20
export const BOT_PATH_PAD = 12
export const BOT_MAX_MASS = 40
export const TWEEN_MIN_DIST = 48
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
export const VEL_ACCEL = 32
export const VEL_DAMP = 12
export const MIN_SPLIT_MASS = 5
export const MAX_BLOBS = 8
export const SPLIT_COOLDOWN_MS = 450
export const DEATH_BURST_MS = 4000
export const DEATH_RESPAWN_MS = 7000
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
export const COG_SPEED = 10
export const FLAMINGO_COUNT = 4
export const FLAMINGO_SCALE = 16.5
export const FLAMINGO_HIT_R = 8.7
export const FLAMINGO_SPEED = 11
export const FLAMINGO_IMPULSE = 64
export const FLAMINGO_HIT_CD_MS = 280
export const FLAMINGO_Y = 0.445 * FLAMINGO_SCALE
export const CANE_COUNT_MIN = 12
export const CANE_COUNT_MAX = 16
export const CANE_SCALE_MIN = 10
export const CANE_SCALE_MAX = 16
export const CANE_HIT_K = 0.2
export const CANE_HIT_CD_MS = 280
export const CANE_BOUNCE = WALL_BOUNCE * 2
export const CANE_IMPULSE = WALL_IMPULSE * 2
export const CANE_MIN_CENTER = 34
export const CANE_RING_PAD = 22
export const CANE_SEP_PAD = 4
export const CANE_Y0 = 0.5

/** Mix of sqrt + linear so food and player eats both read as growth. */
export function radiusFromMass(mass: number): number {
  const m = Math.max(0, mass)
  const span = ARENA_RADIUS * 2
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
  const maxR = Math.max(0, ARENA_RADIUS - pad)
  const dx = x - WORLD_CENTER
  const dz = z - WORLD_CENTER
  const dist = Math.hypot(dx, dz)
  if (dist <= maxR) return { x, z }
  if (dist < 1e-8) return { x: WORLD_CENTER, z: WORLD_CENTER }
  const k = maxR / dist
  return { x: WORLD_CENTER + dx * k, z: WORLD_CENTER + dz * k }
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
  const maxR = Math.max(0, ARENA_RADIUS - pad)
  const a = rng() * Math.PI * 2
  const r = Math.sqrt(rng()) * maxR
  return {
    x: WORLD_CENTER + Math.cos(a) * r,
    z: WORLD_CENTER + Math.sin(a) * r
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

  const limit = ARENA_RADIUS - radius - 0.15
  if (limit <= 0) {
    return { x: WORLD_CENTER, z: WORLD_CENTER, vx: 0, vz: 0 }
  }
  const dx = x - WORLD_CENTER
  const dz = z - WORLD_CENTER
  const dist = Math.hypot(dx, dz)
  if (dist > limit) {
    const inv = dist > 1e-8 ? 1 / dist : 1
    const nx = dist > 1e-8 ? dx * inv : 1
    const nz = dist > 1e-8 ? dz * inv : 0
    x = WORLD_CENTER + nx * limit
    z = WORLD_CENTER + nz * limit
    const vn = vx * nx + vz * nz
    if (vn > 0) {
      vx -= nx * (vn * (1 + WALL_BOUNCE) + WALL_IMPULSE)
      vz -= nz * (vn * (1 + WALL_BOUNCE) + WALL_IMPULSE)
    }
  }
  return { x, z, vx, vz }
}

export function resolveCaneBounce(
  x: number,
  z: number,
  vx: number,
  vz: number,
  radius: number,
  cx: number,
  cz: number,
  hitR: number
): { x: number; z: number; vx: number; vz: number; hit: boolean } {
  const dx = x - cx
  const dz = z - cz
  const dist = Math.hypot(dx, dz)
  const min = hitR + radius
  if (dist >= min) return { x, z, vx, vz, hit: false }
  // n points into the cane (blob → obstacle), same as the arena wall's outward n
  const nx = dist > 1e-8 ? -dx / dist : -1
  const nz = dist > 1e-8 ? -dz / dist : 0
  x = cx - nx * min
  z = cz - nz * min
  const vn = vx * nx + vz * nz
  if (vn > 0) {
    vx -= nx * (vn * (1 + CANE_BOUNCE) + CANE_IMPULSE)
    vz -= nz * (vn * (1 + CANE_BOUNCE) + CANE_IMPULSE)
  }
  const placed = clampArena(x, z, radius)
  return { x: placed.x, z: placed.z, vx, vz, hit: true }
}
