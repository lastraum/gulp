import {
  Entity,
  InputAction,
  MainCamera,
  PointerLock,
  PrimaryPointerInfo,
  Transform,
  VirtualCamera,
  engine,
  inputSystem
} from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { movePlayerTo } from '~system/RestrictedActions'
import { AVATAR_Y, WORLD_M, radiusFromMass } from '../shared/config'
import { Cell } from '../shared/schemas'
import { setCamYaw } from './camLook'
import { isLocalAddr } from './local'
import { getLocalDisplayPos, getLocalMass } from './smooth'

const ZOOM_MIN = 0.45
const ZOOM_MAX = 3.6
const PITCH_MIN = 18
const PITCH_MAX = 78
const SENS = 0.18

let camTarget: Entity
let camEye: Entity
let moveAcc = 0
let yaw = 180
let pitch = 50
let zoomMul = 1.15
let sizeMul = 1
let lastScreen: { x: number; y: number } | null = null
let shake = 0

export function shakeCamera(amount = 1.4) {
  shake = Math.max(shake, amount)
}

function findMyCell() {
  let fallback: Entity | null = null
  let n = 0
  for (const [entity, cell] of engine.getEntitiesWith(Cell, Transform)) {
    n++
    fallback = entity
    if (isLocalAddr(cell.address)) return entity
  }
  return n === 1 ? fallback : null
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function orbitInput(dt: number) {
  if (inputSystem.isPressed(InputAction.IA_ACTION_3)) zoomMul = Math.max(ZOOM_MIN, zoomMul - 1.15 * dt)
  if (inputSystem.isPressed(InputAction.IA_ACTION_4)) zoomMul = Math.min(ZOOM_MAX, zoomMul + 1.15 * dt)

  const pointer = PrimaryPointerInfo.getOrNull(engine.RootEntity)
  const locked = PointerLock.getOrNull(engine.CameraEntity)?.isPointerLocked ?? false
  const dragging = inputSystem.isPressed(InputAction.IA_POINTER)
  const coords = pointer?.screenCoordinates
  const delta = pointer?.screenDelta

  if (locked && delta) {
    yaw += delta.x * SENS
    pitch = clamp(pitch - delta.y * SENS, PITCH_MIN, PITCH_MAX)
    lastScreen = null
    setCamYaw(yaw)
    return
  }

  if (dragging && coords) {
    if (lastScreen) {
      yaw += (coords.x - lastScreen.x) * SENS
      pitch = clamp(pitch - (coords.y - lastScreen.y) * SENS, PITCH_MIN, PITCH_MAX)
      setCamYaw(yaw)
    }
    lastScreen = { x: coords.x, y: coords.y }
    return
  }

  lastScreen = null
}

export function registerFollow() {
  camTarget = engine.addEntity()
  Transform.create(camTarget, {
    position: Vector3.create(WORLD_M / 2, 2, WORLD_M / 2)
  })

  camEye = engine.addEntity()
  Transform.create(camEye, {
    position: Vector3.create(WORLD_M / 2, 24, WORLD_M / 2 - 20)
  })
  VirtualCamera.create(camEye, {
    lookAtEntity: camTarget,
    fov: 55,
    defaultTransition: { transitionMode: VirtualCamera.Transition.Time(0) }
  })
  MainCamera.createOrReplace(engine.CameraEntity, { virtualCameraEntity: camEye })
  setCamYaw(yaw)

  engine.addSystem((dt) => {
    dt = Math.min(dt, 0.05)
    orbitInput(dt)

    const cell = findMyCell()
    const display = getLocalDisplayPos()
    const server = cell ? Transform.get(cell).position : null
    const x = display?.x ?? server?.x
    const z = display?.z ?? server?.z
    if (x === undefined || z === undefined) return

    const lookY = 1.6
    const wantSize = 1 + clamp((radiusFromMass(getLocalMass()) - 5.6) / 24, 0, 0.42)
    sizeMul += (wantSize - sizeMul) * Math.min(1, dt * 2.1)
    const dist = clamp(32 * zoomMul * sizeMul, 8, 118)

    const yawR = (yaw * Math.PI) / 180
    const pitchR = (pitch * Math.PI) / 180
    const cosP = Math.cos(pitchR)
    let eyeX = x + Math.sin(yawR) * cosP * dist
    let eyeY = lookY + Math.sin(pitchR) * dist
    let eyeZ = z + Math.cos(yawR) * cosP * dist
    eyeX = clamp(eyeX, 1.2, WORLD_M - 1.2)
    eyeZ = clamp(eyeZ, 1.2, WORLD_M - 1.2)
    eyeY = Math.max(2.2, eyeY)

    if (shake > 0.02) {
      const t = Date.now() / 1000
      const mag = shake * 2.8
      eyeX += Math.sin(t * 47.1) * mag
      eyeY += Math.cos(t * 53.7) * mag * 0.55
      eyeZ += Math.sin(t * 41.3) * mag
      shake = Math.max(0, shake - dt * 3.4)
    } else {
      shake = 0
    }

    const targetT = Transform.getMutable(camTarget)
    const eyeT = Transform.getMutable(camEye)
    targetT.position.x = x
    targetT.position.y = lookY
    targetT.position.z = z
    eyeT.position.x = eyeX
    eyeT.position.y = eyeY
    eyeT.position.z = eyeZ
    setCamYaw(yaw)

    moveAcc += dt
    if (moveAcc < 0.4) return
    moveAcc = 0
    void movePlayerTo({
      newRelativePosition: Vector3.create(x, AVATAR_Y, z)
    })
  }, -1000, 'sphere-orbit-cam')
}
