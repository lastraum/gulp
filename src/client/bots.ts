import { Entity, Transform, Tween, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { isBot } from '../shared/config'
import { room } from '../shared/messages'
import { Cell } from '../shared/schemas'

type BotTween = {
  parent: Entity
  speed: number
  ax: number
  az: number
  bx: number
  bz: number
  seen: boolean
}

const tweens = new Map<string, BotTween>()

function ensureParent(address: string, x: number, z: number): BotTween {
  let rec = tweens.get(address)
  if (rec) return rec
  const parent = engine.addEntity()
  Transform.create(parent, { position: Vector3.create(x, 0, z) })
  rec = { parent, speed: 0, ax: x, az: z, bx: x, bz: z, seen: false }
  tweens.set(address, rec)
  return rec
}

function playMove(rec: BotTween, ax: number, az: number, bx: number, bz: number, speed: number, duration: number) {
  rec.speed = speed
  rec.ax = ax
  rec.az = az
  rec.bx = bx
  rec.bz = bz
  const t = Transform.getMutable(rec.parent)
  t.position = Vector3.create(ax, 0, az)
  t.rotation = Quaternion.fromEulerDegrees(0, (Math.atan2(bx - ax, bz - az) * 180) / Math.PI, 0)
  Tween.setMove(rec.parent, Vector3.create(ax, 0, az), Vector3.create(bx, 0, bz), Math.max(1, duration))
}

export function getBotParent(address: string): Entity | null {
  return tweens.get(address)?.parent ?? null
}

export function getBotMotion(address: string): { x: number; z: number; vx: number; vz: number } | null {
  const rec = tweens.get(address)
  if (!rec) return null
  const t = Transform.getOrNull(rec.parent)
  if (!t) return null
  const dx = rec.bx - rec.ax
  const dz = rec.bz - rec.az
  const len = Math.hypot(dx, dz) || 1
  return {
    x: t.position.x,
    z: t.position.z,
    vx: (dx / len) * rec.speed,
    vz: (dz / len) * rec.speed
  }
}

export function registerBots() {
  room.onMessage('botPath', (data) => {
    const rec = ensureParent(data.address, data.from.x, data.from.z)
    playMove(rec, data.from.x, data.from.z, data.to.x, data.to.z, data.speed, data.duration)
  })

  engine.addSystem(() => {
    const live = new Set<string>()
    for (const [_e, cell] of engine.getEntitiesWith(Cell)) {
      if (isBot(cell.address)) live.add(cell.address)
    }
    for (const [address, rec] of tweens) {
      if (live.has(address)) {
        rec.seen = true
        continue
      }
      if (!rec.seen) continue
      engine.removeEntity(rec.parent)
      tweens.delete(address)
    }
  })
}
