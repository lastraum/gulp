import { Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { COG_HUB_R, COG_SPOKE_LEN, COG_SPOKE_R, COG_SPOKES } from '../shared/config'
import { room } from '../shared/messages'
import { Cog } from '../shared/schemas'
import { COG_RED, COG_YELLOW, paintBasicSphere, paintBox } from './mesh'

type CogVisual = {
  root: Entity
  spinner: Entity
  parts: Entity[]
  spin: number
  t0: number
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

function ensureCogVisual(id: number, x: number, z: number, spin: number, t0: number) {
  let vis = visuals.get(id)
  if (!vis) {
    const root = engine.addEntity()
    Transform.create(root, { position: Vector3.create(x, 0, z) })
    const spinner = engine.addEntity()
    Transform.create(spinner, { parent: root })
    const parts = buildCogMesh(spinner)
    vis = { root, spinner, parts, spin, t0 }
    visuals.set(id, vis)
    return vis
  }
  vis.spin = spin
  vis.t0 = t0
  const t = Transform.getMutable(vis.root)
  t.position.x = x
  t.position.y = 0
  t.position.z = z
  return vis
}

export function registerCogs() {
  room.onMessage('obstaclePath', (data) => {
    const point = data.points[0] ?? { x: 8, y: 0, z: 8 }
    ensureCogVisual(data.id, point.x, point.z, data.spin, Number(data.t0))
  })

  engine.addSystem(() => {
    const live = new Set<number>()
    for (const [_entity, cog] of engine.getEntitiesWith(Cog, Transform)) {
      live.add(cog.id)
      const p = Transform.get(_entity).position
      ensureCogVisual(cog.id, p.x, p.z, cog.spin, Number(cog.t0))
    }
    const now = Date.now()
    for (const [id, vis] of visuals) {
      if (!live.has(id)) {
        for (const part of vis.parts) engine.removeEntity(part)
        engine.removeEntity(vis.spinner)
        engine.removeEntity(vis.root)
        visuals.delete(id)
        continue
      }
      const spinT = Transform.getMutable(vis.spinner)
      const deg = ((now - vis.t0) / 1000) * vis.spin
      spinT.rotation = Quaternion.fromEulerDegrees(0, deg, 0)
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
