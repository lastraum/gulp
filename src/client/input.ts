import { engine, InputAction, inputSystem } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { MOVE_SEND_HZ } from '../shared/config'
import { room } from '../shared/messages'
import { getCamFlatForward } from './camLook'
import { isSplashActive } from './hud'

let sendAcc = 0
let joined = false
let lastX = 0
let lastZ = 0
let jumpHeld = false

export function getMoveInput(): { x: number; z: number } {
  return { x: lastX, z: lastZ }
}

export function sendSplit() {
  room.send('split', { x: lastX, z: lastZ })
}

export function sendCombine() {
  room.send('combine', {})
}

export function sendGmCmd(cmd: string) {
  room.send('gmCmd', { cmd })
}

function axis(positive: InputAction, negative: InputAction): number {
  const p = inputSystem.isPressed(positive) ? 1 : 0
  const n = inputSystem.isPressed(negative) ? 1 : 0
  return p - n
}

export function registerInput() {
  engine.addSystem((dt) => {
    const rawX = axis(InputAction.IA_RIGHT, InputAction.IA_LEFT)
    const rawZ = axis(InputAction.IA_FORWARD, InputAction.IA_BACKWARD)
    const fwd = getCamFlatForward()
    const rx = fwd.z
    const rz = -fwd.x
    lastX = rx * rawX + fwd.x * rawZ
    lastZ = rz * rawX + fwd.z * rawZ

    if (!isStateSyncronized()) return
    if (isSplashActive()) return
    if (!joined) {
      room.send('join', { name: getPlayer()?.name ?? '' })
      joined = true
      return
    }

    const jump = inputSystem.isPressed(InputAction.IA_JUMP)
    if (jump && !jumpHeld) sendSplit()
    jumpHeld = jump

    sendAcc += dt
    if (sendAcc < 1 / MOVE_SEND_HZ) return
    sendAcc = 0
    room.send('move', { x: lastX, z: lastZ })
  })
}
