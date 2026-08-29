import { Entity, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { FLAMINGO_SCALE, FLAMINGO_Y } from '../shared/config'
import { room } from '../shared/messages'
import { tweenAlong } from '../shared/path'
import { Flamingo } from '../shared/schemas'

type Path = { speed: number; t0: number; ax: number; az: number; bx: number; bz: number }

type BirdVis = {
  root: Entity
  model: Entity
  path: Path
  queued: Path | null
  yaw: number
}

const visuals = new Map<number, BirdVis>()

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + d * t
}

function samePoint(ax: number, az: number, bx: number, bz: number): boolean {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz < 0.35 * 0.35
}

function setPath(id: number, path: Path) {
  const existing = visuals.get(id)
  if (existing && Number(path.t0) < Number(existing.path.t0)) return existing
  let vis = existing
  if (!vis) {
    const root = engine.addEntity()
    Transform.create(root)
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
    vis = {
      root,
      model,
      path,
      queued: null,
      yaw: Math.atan2(path.bx - path.ax, path.bz - path.az)
    }
    visuals.set(id, vis)
    return vis
  }
  const cur = vis.path
  const curDone = tweenAlong(cur.ax, cur.az, cur.bx, cur.bz, cur.speed, cur.t0).done
  if (!curDone && samePoint(path.ax, path.az, cur.bx, cur.bz)) {
    vis.queued = path
    return vis
  }
  vis.path = path
  vis.queued = null
  return vis
}

export function registerFlamingos() {
  room.onMessage('flamingoPath', (data) => {
    setPath(data.id, {
      speed: data.speed,
      t0: Number(data.t0),
      ax: data.from.x,
      az: data.from.z,
      bx: data.to.x,
      bz: data.to.z
    })
  })

  engine.addSystem((dt) => {
    dt = Math.min(dt, 0.05)
    const live = new Set<number>()
    for (const [_e, bird] of engine.getEntitiesWith(Flamingo)) {
      live.add(bird.id)
      setPath(bird.id, {
        speed: bird.speed,
        t0: Number(bird.t0),
        ax: bird.ax,
        az: bird.az,
        bx: bird.bx,
        bz: bird.bz
      })
    }
    const now = Date.now()
    for (const [id, vis] of visuals) {
      if (!live.has(id)) {
        engine.removeEntity(vis.model)
        engine.removeEntity(vis.root)
        visuals.delete(id)
        continue
      }
      let p = vis.path
      let at = tweenAlong(p.ax, p.az, p.bx, p.bz, p.speed, p.t0, now)
      if (at.done && vis.queued) {
        vis.path = vis.queued
        vis.queued = null
        p = vis.path
        at = tweenAlong(p.ax, p.az, p.bx, p.bz, p.speed, p.t0, now)
      }
      const heading = Math.atan2(p.bx - p.ax, p.bz - p.az)
      vis.yaw = lerpAngle(vis.yaw, heading, Math.min(1, dt * 8))
      const t = Transform.getMutable(vis.root)
      t.position = Vector3.create(at.x, 0, at.z)
      t.rotation = Quaternion.fromEulerDegrees(0, (vis.yaw * 180) / Math.PI, 0)
    }
  })
}

export function getFlamingoHits(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = []
  const now = Date.now()
  for (const vis of visuals.values()) {
    const p = vis.path
    const at = tweenAlong(p.ax, p.az, p.bx, p.bz, p.speed, p.t0, now)
    out.push({ x: at.x, z: at.z })
  }
  return out
}
