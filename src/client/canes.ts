import { Entity, GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { CANE_HIT_K, CANE_Y0 } from '../shared/config'
import { room } from '../shared/messages'

type CaneHit = { id: number; x: number; z: number; hitR: number }

const visuals = new Map<number, Entity>()
const hits: CaneHit[] = []

function clearCanes() {
  for (const entity of visuals.values()) engine.removeEntity(entity)
  visuals.clear()
  hits.length = 0
}

function spawnCane(id: number, x: number, z: number, yaw: number, scale: number) {
  const entity = engine.addEntity()
  Transform.create(entity, {
    position: Vector3.create(x, CANE_Y0 * scale, z),
    rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
    scale: Vector3.create(scale, scale, scale)
  })
  GltfContainer.create(entity, {
    src: 'models/candy-reef/lollipop.glb',
    visibleMeshesCollisionMask: 0,
    invisibleMeshesCollisionMask: 0
  })
  visuals.set(id, entity)
  hits.push({ id, x, z, hitR: scale * CANE_HIT_K })
}

export function registerCanes() {
  room.onMessage('caneLayout', (data) => {
    clearCanes()
    for (const cane of data.canes ?? []) {
      spawnCane(cane.id, cane.x, cane.z, cane.yaw, cane.scale)
    }
  })
}

export function getCaneHits(): CaneHit[] {
  return hits
}
