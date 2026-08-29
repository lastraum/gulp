import { Entity, Transform, Tween, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COG_HUB_R, COG_SPOKE_LEN, COG_SPOKE_R, COG_SPOKES } from '../shared/config'
import { room } from '../shared/messages'
import { Cog } from '../shared/schemas'
import { COG_RED, COG_YELLOW, paintBasicSphere, paintBox } from './mesh'

type CogVisual = {
  root: Entity
  spinner: Entity
  parts: Entity[]
  seen: boolean
}

const visuals = new Map<number, CogVisual>()

function buildCogMesh(spinner: Entity): Entity[] {
  const parts: Entity[] = []
  const hub = engine.addEntity()
  paintBasicSphere(hub, COG_YELLOW)
  Transform.create(hub, {
    parent: spinner,
    position: Vector3.create(0, COG_HUB_R, 0),
    scale: Vector3.create(COG_HUB_R * 2, COG_HUB_R * 2, COG_HUB_R * 2)
  })
  parts.push(hub)

  for (let i = 0; i < COG_SPOKES; i++) {
    const a = (i / COG_SPOKES) * Math.PI * 2
    const mid = COG_HUB_R + COG_SPOKE_LEN / 2
    const spoke = engine.addEntity()
    paintBox(spoke, COG_RED, 1, 0)
    Transform.create(spoke, {
      parent: spinner,
      position: Vector3.create(Math.cos(a) * mid, COG_HUB_R, Math.sin(a) * mid),
      rotation: Quaternion.multiply(
        Quaternion.fromEulerDegrees(0, (-a * 180) / Math.PI, 0),
        Quaternion.fromEulerDegrees(0, 0, 90)
      ),
      scale: Vector3.create(COG_SPOKE_R * 2, COG_SPOKE_LEN, COG_SPOKE_R * 2)
    })
    parts.push(spoke)
  }
  return parts
}

function ensureVisual(id: number, x: number, z: number, spin: number): CogVisual {
  let vis = visuals.get(id)
  if (vis) return vis
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(x, 0, z) })
  const spinner = engine.addEntity()
  Transform.create(spinner, { parent: root })
  Tween.setRotateContinuous(spinner, Quaternion.fromEulerDegrees(0, 1, 0), spin)
  vis = { root, spinner, parts: buildCogMesh(spinner), seen: false }
  visuals.set(id, vis)
  return vis
}

function playMove(vis: CogVisual, ax: number, az: number, bx: number, bz: number, duration: number) {
  const t = Transform.getMutable(vis.root)
  t.position = Vector3.create(ax, 0, az)
  Tween.setMove(vis.root, Vector3.create(ax, 0, az), Vector3.create(bx, 0, bz), Math.max(1, duration))
}

export function registerCogs() {
  room.onMessage('obstaclePath', (data) => {
    const pts = data.points ?? []
    const a = pts[0]
    if (!a) return
    const b = pts[1] ?? a
    const vis = ensureVisual(data.id, a.x, a.z, data.spin)
    playMove(vis, a.x, a.z, b.x, b.z, data.duration)
  })

  engine.addSystem(() => {
    const live = new Set<number>()
    for (const [_entity, cog] of engine.getEntitiesWith(Cog)) {
      live.add(cog.id)
    }
    for (const [id, vis] of visuals) {
      if (live.has(id)) {
        vis.seen = true
        continue
      }
      if (!vis.seen) continue
      for (const part of vis.parts) engine.removeEntity(part)
      engine.removeEntity(vis.spinner)
      engine.removeEntity(vis.root)
      visuals.delete(id)
    }
  })
}

export function getCogHits(): { id: number; x: number; z: number }[] {
  const out: { id: number; x: number; z: number }[] = []
  for (const [id, vis] of visuals) {
    const t = Transform.getOrNull(vis.root)
    if (!t) continue
    out.push({ id, x: t.position.x, z: t.position.z })
  }
  return out
}
