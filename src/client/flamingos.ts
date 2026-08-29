import { Entity, GltfContainer, Transform, Tween, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { FLAMINGO_SCALE, FLAMINGO_Y } from '../shared/config'
import { room } from '../shared/messages'
import { Flamingo } from '../shared/schemas'

type BirdVis = {
  root: Entity
  model: Entity
  seen: boolean
}

const visuals = new Map<number, BirdVis>()

function ensureVisual(id: number, x: number, z: number): BirdVis {
  let vis = visuals.get(id)
  if (vis) return vis
  const root = engine.addEntity()
  Transform.create(root, { position: Vector3.create(x, 0, z) })
  const model = engine.addEntity()
  Transform.create(model, {
    parent: root,
    position: Vector3.create(0, FLAMINGO_Y, 0),
    rotation: Quaternion.fromEulerDegrees(0, -90, 0),
    scale: Vector3.create(FLAMINGO_SCALE, FLAMINGO_SCALE, FLAMINGO_SCALE)
  })
  GltfContainer.create(model, {
    src: 'models/flamingo-pusher.glb',
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  vis = { root, model, seen: false }
  visuals.set(id, vis)
  return vis
}

function playMove(vis: BirdVis, ax: number, az: number, bx: number, bz: number, duration: number) {
  const t = Transform.getMutable(vis.root)
  t.position = Vector3.create(ax, 0, az)
  t.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(bx - ax, bz - az) * 180) / Math.PI, 0)
  Tween.setMove(vis.root, Vector3.create(ax, 0, az), Vector3.create(bx, 0, bz), Math.max(1, duration))
}

export function registerFlamingos() {
  room.onMessage('flamingoPath', (data) => {
    const vis = ensureVisual(data.id, data.from.x, data.from.z)
    playMove(vis, data.from.x, data.from.z, data.to.x, data.to.z, data.duration)
  })

  engine.addSystem(() => {
    const live = new Set<number>()
    for (const [_e, bird] of engine.getEntitiesWith(Flamingo)) {
      live.add(bird.id)
    }
    for (const [id, vis] of visuals) {
      if (live.has(id)) {
        vis.seen = true
        continue
      }
      if (!vis.seen) continue
      engine.removeEntity(vis.model)
      engine.removeEntity(vis.root)
      visuals.delete(id)
    }
  })
}

export function getFlamingoHits(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  for (const vis of visuals.values()) {
    const t = Transform.getOrNull(vis.root)
    if (!t) continue
    out.push({ x: t.position.x, z: t.position.z })
  }
  return out
}
