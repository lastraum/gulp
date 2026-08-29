import { ColliderLayer, LightSource, MeshCollider, SkyboxTime, Transform, engine } from '@dcl/sdk/ecs'
import { Color3, Vector3 } from '@dcl/sdk/math'
import { WALL_H, WALL_H_SOUTH, WALL_T, WORLD_CENTER, WORLD_M } from '../shared/config'
import { GRASS, WALL_PINK, paintBox } from './mesh'

function wall(x: number, z: number, sx: number, sz: number, height: number) {
  const e = engine.addEntity()
  paintBox(e, WALL_PINK, 0.05, 0.5)
  MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS | ColliderLayer.CL_POINTER)
  Transform.create(e, {
    position: Vector3.create(x, height / 2, z),
    scale: Vector3.create(sx, height, sz)
  })
}

function ground() {
  const e = engine.addEntity()
  paintBox(e, GRASS, 0, 0.62)
  MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
  Transform.create(e, {
    position: Vector3.create(WORLD_CENTER, -0.08, WORLD_CENTER),
    scale: Vector3.create(WORLD_M, 0.16, WORLD_M)
  })
}

function brightSky() {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: 12 * 3600 })
  const lamp = engine.addEntity()
  Transform.create(lamp, { position: Vector3.create(WORLD_CENTER, 72, WORLD_CENTER) })
  LightSource.create(lamp, {
    type: LightSource.Type.Point({}),
    color: Color3.create(1, 0.98, 0.9),
    intensity: 220000,
    range: 420,
    shadow: false,
    active: true
  })
}

export function buildArena() {
  brightSky()
  ground()
  const t = WALL_T
  wall(t / 2, WORLD_CENTER, t, WORLD_M, WALL_H)
  wall(WORLD_M - t / 2, WORLD_CENTER, t, WORLD_M, WALL_H)
  wall(WORLD_CENTER, t / 2, WORLD_M, t, WALL_H_SOUTH)
  wall(WORLD_CENTER, WORLD_M - t / 2, WORLD_M, t, WALL_H)
}
