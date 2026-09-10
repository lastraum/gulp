import { LightSource, Material, MeshCollider, MeshRenderer, SkyboxTime, Transform, engine, ColliderLayer } from '@dcl/sdk/ecs'
import { Color3, Quaternion, Vector3 } from '@dcl/sdk/math'
import { WORLD_CENTER, WORLD_M } from '../shared/config'
import { buildCandyReef } from './candyReef'
import { GRASS } from './mesh'

const SIDE_H = 100

function ground() {
  const e = engine.addEntity()
  MeshRenderer.setBox(e)
  Material.setPbrMaterial(e, {
    albedoColor: GRASS,
    metallic: 0,
    roughness: 0.62
  })
  MeshCollider.setBox(e, ColliderLayer.CL_PHYSICS)
  Transform.create(e, {
    position: Vector3.create(WORLD_CENTER, -0.08, WORLD_CENTER),
    scale: Vector3.create(WORLD_M, 0.16, WORLD_M)
  })
}

function sidePlane(x: number, z: number, yaw: number) {
  const e = engine.addEntity()
  MeshRenderer.setPlane(e)
  Material.setPbrMaterial(e, {
    albedoColor: GRASS,
    metallic: 0,
    roughness: 0.62
  })
  Transform.create(e, {
    position: Vector3.create(x, 50, z),
    rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
    scale: Vector3.create(WORLD_M, SIDE_H, 1)
  })
}

function sidePlanes() {
  sidePlane(WORLD_CENTER, 0, 0)
  sidePlane(WORLD_CENTER, WORLD_M, 180)
  sidePlane(0, WORLD_CENTER, 90)
  sidePlane(WORLD_M, WORLD_CENTER, -90)
}

function brightSky() {
  SkyboxTime.createOrReplace(engine.RootEntity, { fixedTime: 12 * 3600 })
  const lamp = engine.addEntity()
  Transform.create(lamp, { position: Vector3.create(WORLD_CENTER, 72, WORLD_CENTER) })
  LightSource.create(lamp, {
    type: LightSource.Type.Point({}),
    color: Color3.create(1, 0.98, 0.9),
    intensity: 220000,
    range: WORLD_M,
    shadow: false,
    active: true
  })
}

export function buildArena() {
  brightSky()
  ground()
  sidePlanes()
  buildCandyReef()
}
