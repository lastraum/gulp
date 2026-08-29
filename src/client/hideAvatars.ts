import { AvatarModifierArea, AvatarModifierType, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { WORLD_CENTER, WORLD_M } from '../shared/config'

export function hideAvatars() {
  const area = engine.addEntity()
  Transform.create(area, { position: Vector3.create(WORLD_CENTER, 120, WORLD_CENTER) })
  AvatarModifierArea.create(area, {
    area: Vector3.create(WORLD_M + 8, 240, WORLD_M + 8),
    modifiers: [
      AvatarModifierType.AMT_HIDE_AVATARS,
      AvatarModifierType.AMT_DISABLE_PASSPORTS,
      AvatarModifierType.AMT_HIDE_NAMETAGS
    ],
    excludeIds: []
  })
}
