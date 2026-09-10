import { engine, InputAction, inputSystem } from '@dcl/sdk/ecs'
import { isStateSyncronized } from '@dcl/sdk/network'
import { getPlayer } from '@dcl/sdk/players'
import { MOVE_SEND_HZ } from '../shared/config'
import { room } from '../shared/messages'
import { getCamFlatForward } from './camLook'
import { isSplashActive } from './hud'

let sendAcc = 0
let joined = false
let sentName = ''

function dclJoinName(): string {
  const n = getPlayer()?.name?.trim() ?? ''
  if (!n) return ''
  if (n.startsWith('0x') && n.length >= 10) return ''
  if (/^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9]{8,14}$/.test(n)) return ''
  if (/[0-9]/.test(n) && /^[A-Za-z0-9]{6,12}\s+[A-Za-z0-9]{2,14}$/.test(n)) return ''
  return n
}
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
      sentName = dclJoinName()
      room.send('join', { name: sentName })
      joined = true
      return
    }
    const later = dclJoinName()
    if (later && later !== sentName) {
      sentName = later
      room.send('join', { name: later })
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
