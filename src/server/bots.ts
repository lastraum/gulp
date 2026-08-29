import { engine, Entity, Transform } from '@dcl/sdk/ecs'
import { Storage } from '@dcl/sdk/server'
import {
  ARENA,
  BOT_COUNT,
  BOT_MAX,
  BOT_PATH_PAD,
  BOT_SPEED,
  TWEEN_MIN_DIST,
  botAddress,
  botName,
  isBot,
  randomArenaPoint
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { pickNextPoint, tweenMotion, TweenSeg } from '../shared/path'
import { Blob, Cell } from '../shared/schemas'
import { rememberName } from './board'

type SpawnFn = (address: string, at?: { x: number; z: number }) => void
type RemoveFn = (address: string) => void

const KEY = 'botCount'
const paths = new Map<string, TweenSeg>()

let wanted = BOT_COUNT
let spawnFn: SpawnFn | null = null
let removeFn: RemoveFn | null = null

export { isBot, BOT_MAX }

export function botCount(): number {
  let n = 0
  for (const [_e, cell] of engine.getEntitiesWith(Cell)) {
    if (isBot(cell.address)) n++
  }
  return n
}

export function forgetBot(address: string) {
  paths.delete(address)
}

function alongOf(path: TweenSeg, now = Date.now()) {
  return tweenMotion(path.ax, path.az, path.bx, path.bz, path.speed, path.t0, now)
}

export function botPosition(address: string, now = Date.now()): { x: number; z: number } | null {
  const path = paths.get(address)
  if (!path) return null
  const at = alongOf(path, now)
  return { x: at.x, z: at.z }
}

function botIndex(address: string): number {
  return Number(address.slice(4))
}

function liveIndices(): number[] {
  const out: number[] = []
  for (const [_e, cell] of engine.getEntitiesWith(Cell)) {
    if (!isBot(cell.address)) continue
    const i = botIndex(cell.address)
    if (Number.isFinite(i)) out.push(i)
  }
  return out.sort((a, b) => a - b)
}

function broadcastPath(address: string, to?: string) {
  const path = paths.get(address)
  if (!path) return
  const along = alongOf(path)
  const left = Math.max(1, Math.floor(along.durMs * (1 - along.u)))
  const payload = {
    address,
    speed: path.speed,
    duration: left,
    from: { x: along.x, y: 0, z: along.z },
    to: { x: path.bx, y: 0, z: path.bz }
  }
  if (to) room.send('botPath', payload, { to: [to] })
  else room.send('botPath', payload)
}

export function sendBotsTo(address?: string) {
  for (const who of paths.keys()) broadcastPath(who, address)
}

function setSeg(
  address: string,
  from: { x: number; z: number },
  to: { x: number; z: number },
  now: number,
  speed: number
): TweenSeg {
  const path: TweenSeg = { speed, t0: now, ax: from.x, az: from.z, bx: to.x, bz: to.z }
  paths.set(address, path)
  broadcastPath(address)
  return path
}

function advanceIfDone(address: string, now: number) {
  const path = paths.get(address)
  if (!path) return
  const along = alongOf(path, now)
  if (!along.done && now - path.t0 < along.durMs) return
  const start = { x: path.bx, z: path.bz }
  setSeg(address, start, pickNextPoint(start, BOT_PATH_PAD, TWEEN_MIN_DIST), now, path.speed)
}

function spawnOne(index: number) {
  if (!spawnFn) return
  const address = botAddress(index)
  rememberName(address, botName(address) ?? `Pip ${index + 1}`)
  const from = randomArenaPoint(BOT_PATH_PAD)
  const to = pickNextPoint(from, BOT_PATH_PAD, TWEEN_MIN_DIST)
  const speed = BOT_SPEED * (0.82 + (index % 6) * 0.06)
  setSeg(address, from, to, Date.now(), speed)
  spawnFn(address, from)
}

function syncLive() {
  if (!spawnFn || !removeFn) return
  let live = liveIndices()
  while (live.length < wanted) {
    const have = new Set(live)
    let idx = -1
    for (let i = 0; i < BOT_MAX; i++) {
      if (!have.has(i)) {
        idx = i
        break
      }
    }
    if (idx < 0) break
    spawnOne(idx)
    live = liveIndices()
  }
  while (live.length > wanted) {
    const idx = live[live.length - 1]
    removeFn(botAddress(idx))
    live = liveIndices()
  }
}

async function persist() {
  try {
    await Storage.set(KEY, wanted)
    logEvent('bots.save', { count: wanted })
  } catch (e) {
    logEvent('bots.save.fail', { error: String(e) })
  }
}

export async function loadBots(spawn: SpawnFn, remove: RemoveFn) {
  spawnFn = spawn
  removeFn = remove
  wanted = BOT_COUNT
  let stored = false
  try {
    Storage.configure({ skipIfUnchanged: true, cacheReads: true })
    const n = await Storage.get<number>(KEY)
    if (typeof n === 'number' && Number.isFinite(n)) {
      wanted = Math.max(0, Math.min(BOT_MAX, Math.floor(n)))
      stored = true
    }
  } catch {
    stored = false
  }
  syncLive()
  if (!stored) void persist()
  logEvent('bots.load', { count: wanted, live: botCount() })
}

export function addBot(): number {
  if (wanted >= BOT_MAX) return wanted
  wanted += 1
  syncLive()
  void persist()
  return wanted
}

export function removeBot(): number {
  if (wanted <= 0) return 0
  wanted -= 1
  syncLive()
  void persist()
  return wanted
}

export function tickBots(isDead: (address: string) => boolean) {
  const now = Date.now()
  for (const address of [...paths.keys()]) advanceIfDone(address, now)
  for (const [entity, cell] of engine.getEntitiesWith(Cell, Transform)) {
    if (!isBot(cell.address)) continue
    if (isDead(cell.address)) continue
    const path = paths.get(cell.address)
    if (!path) continue
    const list: Entity[] = []
    for (const [blobEntity, blob] of engine.getEntitiesWith(Blob)) {
      if (blob.address === cell.address) list.push(blobEntity)
    }
    if (list.length === 0) continue
    const at = alongOf(path, now)
    for (const blobEntity of list) {
      const b = Blob.getMutable(blobEntity)
      b.x = at.x
      b.z = at.z
      b.vx = at.vx
      b.vz = at.vz
    }
    const t = Transform.getMutable(entity)
    t.position.x = at.x
    t.position.y = ARENA.y
    t.position.z = at.z
    const mut = Cell.getMutable(entity)
    mut.vx = at.vx
    mut.vz = at.vz
  }
}
