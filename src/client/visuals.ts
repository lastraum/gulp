import {
  Billboard,
  BillboardMode,
  Entity,
  GltfContainer,
  TextAlignMode,
  TextShape,
  Transform,
  Tween,
  engine
} from '@dcl/sdk/ecs'
import { Color3, Color4, Quaternion, Vector3 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import { FOOD_KIND_BOOST, FOOD_KIND_SPIKE, botName, isBot, radiusFromMass } from '../shared/config'
import { room } from '../shared/messages'
import { Blob, Food } from '../shared/schemas'
import { getBotMotion, getBotParent } from './bots'
import { isLocalAddr } from './local'
import { IRIS, SPIKE, WHITE, addressIndex, hueIndex, makeBall, paintCone, paintGoldSphere, paintSphere, paintSpikeSphere, pastel } from './mesh'
import { getLocalBlobMass, getLocalBlobPos, getLocalBlobVel, isSpiked } from './smooth'

type Eye = { white: Entity; iris: Entity }
type BlobVis = {
  root: Entity
  body: Entity
  rollPivot: Entity
  left: Eye
  right: Eye
  shownR: number
  yaw: number
  roll: number
  blink: number
  blinkWait: number
  spikeRing: Entity | null
  spikes: Entity[]
  spikeSpin: number
}
const blobVisuals = new Map<number, BlobVis>()
const nameTags = new Map<string, Entity>()
const foodVisuals = new Map<number, Entity>()
const foodBits = new Map<number, Entity[]>()
const goneFood = new Set<number>()
const BLOB_SPIKE_N = 10
let lastLocalTint = 0

type Spark = { entity: Entity; vx: number; vy: number; vz: number; life: number; maxLife: number; size: number }
const sparks: Spark[] = []

function displayName(address: string): string {
  const bot = botName(address)
  if (bot) return bot
  const name = getPlayer({ userId: address })?.name?.trim()
  if (name) return name
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function makeEye(parent: Entity): Eye {
  const white = makeBall(parent, WHITE, 0, 0.4)
  const iris = makeBall(white, IRIS, 0, 0.35)
  return { white, iris }
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function ensureBlobVisual(blobId: number, address: string, tint = -1): BlobVis {
  let vis = blobVisuals.get(blobId)
  if (vis) return vis
  const root = engine.addEntity()
  Transform.create(root)
  Tween.deleteFrom(root)
  const color = tint >= 0 ? pastel(tint) : pastel(addressIndex(address))
  const body = makeBall(root, color)
  const rollPivot = engine.addEntity()
  Transform.create(rollPivot, { parent: root })
  try {
    GltfContainer.create(rollPivot, {
      src: 'models/roll-strip.glb',
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    })
  } catch {
    /* sphere still renders without the roll strip */
  }
  vis = {
    root,
    body,
    rollPivot,
    left: makeEye(root),
    right: makeEye(root),
    shownR: radiusFromMass(5),
    yaw: 0,
    roll: 0,
    blink: 0,
    blinkWait: 1 + Math.random() * 3,
    spikeRing: null,
    spikes: [],
    spikeSpin: 0
  }
  blobVisuals.set(blobId, vis)
  return vis
}

function layoutEye(eye: Eye, x: number, y: number, z: number, size: number, yScale: number, pitchDeg: number) {
  const white = Transform.getMutable(eye.white)
  white.position = Vector3.create(x, y, z)
  white.scale = Vector3.create(size, size * yScale, size)
  white.rotation = Quaternion.fromEulerDegrees(pitchDeg, 0, 0)
  const iris = Transform.getMutable(eye.iris)
  iris.position = Vector3.create(0, 0, 0.46)
  iris.scale = Vector3.create(0.52, 0.52, 0.52)
}

function layoutBlob(vis: BlobVis, mass: number, lx: number, lz: number, vx: number, vz: number, dt: number) {
  const target = radiusFromMass(mass)
  if (target > vis.shownR) vis.shownR = target
  else if (target < vis.shownR * 0.8) vis.shownR = target
  else vis.shownR += (target - vis.shownR) * Math.min(1, dt * 8)
  const r = vis.shownR
  const d = r * 2

  const spd = Math.hypot(vx, vz)
  if (spd > 0.35) vis.yaw = lerpAngle(vis.yaw, Math.atan2(vx, vz), Math.min(1, dt * 9))

  vis.blinkWait -= dt
  if (vis.blinkWait <= 0) {
    vis.blink = Math.min(1, vis.blink + dt * 11)
    if (vis.blink >= 1) {
      vis.blink = 0
      vis.blinkWait = 2.1 + Math.random() * 3.4
    }
  }
  const close = vis.blink <= 0 ? 0 : vis.blink < 0.5 ? vis.blink * 2 : (1 - vis.blink) * 2
  const eyeY = 1 - close * 0.88

  const root = Transform.getMutable(vis.root)
  root.position = Vector3.create(lx, r, lz)
  root.scale = Vector3.One()
  root.rotation = Quaternion.fromEulerDegrees(0, (vis.yaw * 180) / Math.PI, 0)

  const body = Transform.getMutable(vis.body)
  body.position = Vector3.Zero()
  body.scale = Vector3.create(d, d, d)

  const along = vx * Math.sin(vis.yaw) + vz * Math.cos(vis.yaw)
  vis.roll += (along / Math.max(0.35, r)) * dt
  const roll = Transform.getMutable(vis.rollPivot)
  roll.position = Vector3.Zero()
  roll.scale = Vector3.create(d, d, d)
  roll.rotation = Quaternion.fromEulerDegrees((vis.roll * 180) / Math.PI, 0, 0)

  const eyeSize = r * 0.5
  const eyeX = r * 0.3
  const tilt = 26
  const tiltR = (tilt * Math.PI) / 180
  const bulge = r * 1.08
  const eyeLift = bulge * Math.sin(tiltR)
  const eyeZ = bulge * Math.cos(tiltR)
  layoutEye(vis.left, -eyeX, eyeLift, eyeZ, eyeSize, eyeY, -tilt)
  layoutEye(vis.right, eyeX, eyeLift, eyeZ, eyeSize, eyeY, -tilt)
}

function ensureBlobSpikes(vis: BlobVis) {
  if (vis.spikeRing) return
  const ring = engine.addEntity()
  Transform.create(ring, { parent: vis.root })
  vis.spikeRing = ring
  for (let i = 0; i < BLOB_SPIKE_N; i++) {
    const spike = engine.addEntity()
    paintCone(spike, SPIKE)
    Transform.create(spike, { parent: ring })
    vis.spikes.push(spike)
  }
}

function layoutSpikes(vis: BlobVis, r: number, spiked: boolean, dt: number) {
  if (!spiked) {
    if (vis.spikeRing) {
      const t = Transform.getMutable(vis.spikeRing)
      t.scale = Vector3.create(0.001, 0.001, 0.001)
    }
    return
  }
  ensureBlobSpikes(vis)
  vis.spikeSpin += dt * 110
  const ring = vis.spikeRing!
  const rt = Transform.getMutable(ring)
  rt.position = Vector3.Zero()
  rt.scale = Vector3.One()
  rt.rotation = Quaternion.fromEulerDegrees(0, vis.spikeSpin, 18)
  const len = Math.max(0.55, r * 0.52)
  const base = Math.max(0.14, r * 0.15)
  for (let i = 0; i < vis.spikes.length; i++) {
    const theta = (i / vis.spikes.length) * Math.PI * 2
    const lat = i % 2 === 0 ? 0.32 : -0.28
    const cl = Math.cos(lat)
    const dir = Vector3.create(Math.sin(theta) * cl, Math.sin(lat), Math.cos(theta) * cl)
    const t = Transform.getMutable(vis.spikes[i])
    t.position = Vector3.scale(dir, r + len * 0.32)
    t.scale = Vector3.create(base * 2, len, base * 2)
    t.rotation = Quaternion.fromToRotation(Vector3.Up(), dir)
  }
}

function ensureNameTag(address: string): Entity {
  let tag = nameTags.get(address)
  if (tag) return tag
  tag = engine.addEntity()
  Transform.create(tag)
  Billboard.create(tag, { billboardMode: BillboardMode.BM_Y })
  TextShape.create(tag, {
    text: displayName(address),
    fontSize: 10.4,
    width: 40,
    height: 8,
    textWrapping: false,
    textColor: Color4.create(1, 1, 1, 0.96),
    outlineWidth: 1,
    outlineColor: Color3.create(0, 0, 0),
    textAlign: TextAlignMode.TAM_MIDDLE_CENTER
  })
  nameTags.set(address, tag)
  return tag
}

function layoutNameTags() {
  const clusters = new Map<string, { x: number; z: number; top: number; n: number }>()
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    const vis = blobVisuals.get(blob.blobId)
    const local = isLocalAddr(blob.address)
    const p = local ? getLocalBlobPos(blob.blobId) : isBot(blob.address) ? getBotMotion(blob.address) : null
    const x = p?.x ?? blob.x
    const z = p?.z ?? blob.z
    const r = vis?.shownR ?? radiusFromMass(blob.mass)
    const cur = clusters.get(blob.address)
    if (!cur) {
      clusters.set(blob.address, { x, z, top: r * 2 + 2.2, n: 1 })
      continue
    }
    cur.x += x
    cur.z += z
    cur.n++
    const top = r * 2 + 2.2
    if (top > cur.top) cur.top = top
  }
  const live = new Set<string>()
  for (const [address, c] of clusters) {
    live.add(address)
    const tag = ensureNameTag(address)
    const t = Transform.getMutable(tag)
    t.position = Vector3.create(c.x / c.n, c.top, c.z / c.n)
    t.scale = Vector3.One()
    const shape = TextShape.getMutable(tag)
    shape.text = displayName(address)
  }
  for (const [address, tag] of nameTags) {
    if (live.has(address)) continue
    engine.removeEntity(tag)
    nameTags.delete(address)
  }
}

function removeBlobVisual(vis: BlobVis) {
  for (const spike of vis.spikes) engine.removeEntity(spike)
  if (vis.spikeRing) engine.removeEntity(vis.spikeRing)
  engine.removeEntity(vis.rollPivot)
  engine.removeEntity(vis.left.iris)
  engine.removeEntity(vis.left.white)
  engine.removeEntity(vis.right.iris)
  engine.removeEntity(vis.right.white)
  engine.removeEntity(vis.body)
  engine.removeEntity(vis.root)
}

export function getLocalClusterRadius(): number {
  let cx = 0
  let cz = 0
  let n = 0
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (!isLocalAddr(blob.address)) continue
    const p = getLocalBlobPos(blob.blobId) ?? { x: blob.x, z: blob.z }
    cx += p.x
    cz += p.z
    n++
  }
  if (n === 0) return radiusFromMass(10)
  cx /= n
  cz /= n
  let max = radiusFromMass(10)
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (!isLocalAddr(blob.address)) continue
    const p = getLocalBlobPos(blob.blobId) ?? { x: blob.x, z: blob.z }
    const reach = Math.hypot(p.x - cx, p.z - cz) + radiusFromMass(getLocalBlobMass(blob.blobId, blob.mass))
    if (reach > max) max = reach
  }
  return max
}

function hideFood(id: number) {
  goneFood.add(id)
  const extras = foodBits.get(id)
  if (extras) {
    for (const e of extras) engine.removeEntity(e)
    foodBits.delete(id)
  }
  const vis = foodVisuals.get(id)
  if (vis) {
    engine.removeEntity(vis)
    foodVisuals.delete(id)
  }
}

function addFoodSpikes(root: Entity): Entity[] {
  const extras: Entity[] = []
  const n = 8
  for (let i = 0; i < n; i++) {
    const theta = (i / n) * Math.PI * 2
    const lat = i % 2 === 0 ? 0.38 : -0.22
    const cl = Math.cos(lat)
    const dir = Vector3.create(Math.sin(theta) * cl, Math.sin(lat), Math.cos(theta) * cl)
    const spike = engine.addEntity()
    paintCone(spike, SPIKE)
    Transform.create(spike, {
      parent: root,
      position: Vector3.scale(dir, 0.62),
      rotation: Quaternion.fromToRotation(Vector3.Up(), dir),
      scale: Vector3.create(0.16, 0.46, 0.16)
    })
    extras.push(spike)
  }
  return extras
}

function ensureFoodVisual(id: number, x: number, y: number, z: number, mass: number, hue: number, kind = 0) {
  if (goneFood.has(id)) return
  let vis = foodVisuals.get(id)
  if (!vis) {
    vis = engine.addEntity()
    Transform.create(vis)
    if (kind === FOOD_KIND_BOOST) paintGoldSphere(vis)
    else if (kind === FOOD_KIND_SPIKE) {
      paintSpikeSphere(vis)
      foodBits.set(id, addFoodSpikes(vis))
    } else paintSphere(vis, pastel(hueIndex(hue)))
    foodVisuals.set(id, vis)
  }
  const r = radiusFromMass(mass)
  const pulse =
    kind === FOOD_KIND_BOOST || kind === FOOD_KIND_SPIKE ? 1 + Math.sin(Date.now() / 180) * 0.12 : 1
  const d = r * 2 * pulse
  const t = Transform.getMutable(vis)
  t.position = Vector3.create(x, r * pulse, z)
  t.scale = Vector3.create(d, d, d)
}

export function markFoodGone(id: number) {
  hideFood(id)
}

export function isFoodGone(id: number): boolean {
  return goneFood.has(id)
}

export function spawnFoodVisual(id: number, x: number, z: number, mass: number, hue: number, kind = 0) {
  goneFood.delete(id)
  ensureFoodVisual(id, x, radiusFromMass(mass), z, mass, hue, kind)
}

function shade(color: Color4, k: number): Color4 {
  return Color4.create(Math.min(1, color.r * k), Math.min(1, color.g * k), Math.min(1, color.b * k), 1)
}

function spawnBurst(x: number, y: number, z: number, hue: number, n: number, size: number, spdMin: number, spdMax: number, life: number) {
  spawnBurstColor(x, y, z, pastel(hueIndex(hue)), n, size, spdMin, spdMax, life)
}

function spawnBurstColor(
  x: number,
  y: number,
  z: number,
  color: Color4,
  n: number,
  size: number,
  spdMin: number,
  spdMax: number,
  life: number
) {
  for (let i = 0; i < n; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.random() * Math.PI
    const spd = spdMin + Math.random() * (spdMax - spdMin)
    const spark = engine.addEntity()
    paintSphere(spark, color)
    Transform.create(spark, {
      position: Vector3.create(x, y, z),
      scale: Vector3.create(size, size, size)
    })
    sparks.push({
      entity: spark,
      vx: Math.sin(phi) * Math.cos(theta) * spd,
      vy: Math.cos(phi) * spd + 2,
      vz: Math.sin(phi) * Math.sin(theta) * spd,
      life,
      maxLife: life,
      size
    })
  }
}

export function spawnCollectBurst(x: number, y: number, z: number, hue: number) {
  spawnBurst(x, y, z, hue, 12, 0.54, 4, 10, 0.35)
}

export function spawnKillBurst(x: number, y: number, z: number) {
  spawnBurst(x, y, z, 0.02, 28, 2.6, 10, 22, 0.85)
  spawnBurst(x, y, z, 0.08, 16, 4.8, 6, 14, 1.05)
  spawnBurst(x, y, z, 0.12, 10, 7.2, 3, 9, 1.2)
}

export function spawnDeathBurst(x: number, y: number, z: number) {
  const color = pastel(lastLocalTint)
  spawnBurstColor(x, y, z, color, 64, 2.4, 16, 38, 1.2)
  spawnBurstColor(x, y, z, shade(color, 1.18), 48, 3.8, 12, 28, 1.45)
  spawnBurstColor(x, y, z, shade(color, 0.72), 32, 6.2, 8, 20, 1.7)
  spawnBurstColor(x, y, z, shade(color, 1.35), 28, 1.6, 10, 26, 1.05)
}

function tickSparks(dt: number) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i]
    s.life -= dt
    if (s.life <= 0 || !Transform.getOrNull(s.entity)) {
      if (Transform.getOrNull(s.entity)) engine.removeEntity(s.entity)
      sparks.splice(i, 1)
      continue
    }
    const t = Transform.getMutable(s.entity)
    s.vy -= 12 * dt
    t.position.x += s.vx * dt
    t.position.y += s.vy * dt
    t.position.z += s.vz * dt
    const k = Math.max(0.05, s.life / s.maxLife)
    t.scale = Vector3.create(s.size * k, s.size * k, s.size * k)
  }
}

export function registerVisuals() {
  room.onMessage('foodGone', (data) => {
    hideFood(data.id)
  })
  room.onMessage('foodSpawn', (data) => {
    if (goneFood.has(data.id)) return
    spawnFoodVisual(data.id, data.x, data.z, data.mass, data.hue, data.kind)
  })

  engine.addSystem((dt) => {
    tickSparks(dt)
    const liveBlobs = new Set<number>()
    for (const [_entity, blob] of engine.getEntitiesWith(Blob)) {
      liveBlobs.add(blob.blobId)
      const vis = ensureBlobVisual(blob.blobId, blob.address, blob.tint)
      const local = isLocalAddr(blob.address)
      if (local) lastLocalTint = blob.tint >= 0 ? blob.tint : lastLocalTint
      const botParent = !local && isBot(blob.address) ? getBotParent(blob.address) : null
      const rootT = Transform.getMutable(vis.root)
      if (botParent) {
        if (rootT.parent !== botParent) rootT.parent = botParent
      } else if (rootT.parent) {
        rootT.parent = 0 as Entity
        Tween.deleteFrom(vis.root)
      }
      const p = local ? getLocalBlobPos(blob.blobId) : botParent ? { x: 0, z: 0 } : null
      const v = local ? getLocalBlobVel(blob.blobId) : botParent ? { x: 0, z: 0 } : null
      const mass = local ? getLocalBlobMass(blob.blobId, blob.mass) : blob.mass
      layoutBlob(
        vis,
        mass,
        p?.x ?? blob.x,
        p?.z ?? blob.z,
        v?.x ?? blob.vx,
        v?.z ?? blob.vz,
        dt
      )
      layoutSpikes(vis, vis.shownR, isSpiked(blob.address), dt)
    }
    for (const [id, vis] of blobVisuals) {
      if (liveBlobs.has(id)) continue
      removeBlobVisual(vis)
      blobVisuals.delete(id)
    }
    layoutNameTags()

    for (const [entity, food] of engine.getEntitiesWith(Food, Transform)) {
      if (goneFood.has(food.id)) continue
      const t = Transform.get(entity).position
      ensureFoodVisual(food.id, t.x, t.y, t.z, food.mass, food.hue, food.kind)
    }
  })
}
