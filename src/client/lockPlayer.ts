import { InputModifier, TouchScreenControls, engine } from '@dcl/sdk/ecs'

function applyLock() {
  InputModifier.createOrReplace(engine.PlayerEntity, {
    mode: InputModifier.Mode.Standard({
      disableAll: false,
      disableWalk: true,
      disableJog: true,
      disableRun: true,
      disableJump: true,
      disableEmote: true,
      disableDoubleJump: true,
      disableGliding: true
    })
  })
  TouchScreenControls.hideAll()
  TouchScreenControls.showJoystick()
  TouchScreenControls.hideCrosshair()
}

export function lockPlayer() {
  applyLock()
  engine.addSystem(applyLock, -100, 'lock-hud')
}
