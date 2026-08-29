import { Transform, engine } from '@dcl/sdk/ecs'
import {
  BOOST_MS,
  FOOD_KIND_BOOST,
  FOOD_KIND_SPIKE,
  SPIKE_MS,
  START_MASS,
  blobEatsBlob,
  foodOverlaps,
  isBot,
  radiusFromMass
} from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { Blob, Food } from '../shared/schemas'
import { getBotMotion } from './bots'
import { playFoodPop } from './audio'
import { shakeCamera } from './follow'
import { beginDeath, hideDeathUi } from './hud'
import { getLocalAddress, isLocalAddr } from './local'
import {
  applyBlobKnock,
  applyDeath,
  applyRespawn,
  applySpikeKnock,
  forgetLocalBlob,
  getLocalBlobMass,
  getLocalBlobPos,
  getLocalDisplayPos,
  getLocalMass,
  isSpiked,
  recentlyShredded,
  recentlySpawned,
  setLocalMass,
  setBoosts,
  setBoostRemains,
  startBoost,
  startSpike
} from './smooth'
import { isFoodGone, markFoodGone, spawnCollectBurst, spawnDeathBurst, spawnKillBurst } from './visuals'

const pending = new Set<number>()
const pendingPlayers = new Map<number, number>()

export function registerEat() {
  room.onMessage('massUpdate', (data) => {
    if (data.address !== getLocalAddress()) return
    if (recentlySpawned() || data.mass <= START_MASS + 0.05) {
      setLocalMass(data.mass)
      return
    }
    if (data.mass < getLocalMass() - 0.05) {
      setLocalMass(data.mass)
      return
    }
    if (recentlyShredded()) return
    setLocalMass(Math.max(getLocalMass(), data.mass))
  })
  room.onMessage('foodGone', (data) => {
    pending.add(data.id)
  })
  room.onMessage('blobEaten', (data) => {
    spawnKillBurst(data.x, 2.1, data.z)
    if (isLocalAddr(data.victim)) {
      forgetLocalBlob(data.blobId)
      shakeCamera(1.05)
      logEvent('blob.lost', { killer: data.killer, blobId: data.blobId, mass: data.mass })
      return
    }
    if (isLocalAddr(data.killer)) {
      shakeCamera(0.85)
      logEvent('blob.ate', { victim: data.victim, blobId: data.blobId, mass: data.mass })
    }
  })
  room.onMessage('playerKilled', (data) => {
    if (isLocalAddr(data.victim)) {
      const pos = getLocalDisplayPos()
      spawnDeathBurst(pos?.x ?? data.x, 3.2, pos?.z ?? data.z)
      shakeCamera(2.2)
      applyDeath()
      beginDeath(data.killer)
      logEvent('player.died', { killer: data.killer, x: data.x, z: data.z })
      return
    }
    if (isLocalAddr(data.killer)) {
      spawnKillBurst(data.x, 2.4, data.z)
      shakeCamera(1.6)
      logEvent('player.ate', { victim: data.victim, x: data.x, z: data.z })
    }
  })
  room.onMessage('respawn', (data) => {
    if (!isLocalAddr(data.address)) return
    hideDeathUi()
    applyRespawn(data.x, data.z)
  })
  room.onMessage('boostStart', (data) => {
    if (!isLocalAddr(data.address)) return
    if (Array.isArray(data.remains) && data.remains.length > 0) {
      setBoostRemains(data.remains)
      return
    }
    if (Array.isArray(data.untils) && data.untils.length > 0) setBoosts(data.untils.map((t) => Number(t)))
    else startBoost(Number(data.until))
  })
  room.onMessage('spikeStart', (data) => {
    const remain = Number(data.remain)
    const until = remain > 0 ? Date.now() + remain : Number(data.until)
    startSpike(String(data.address), until)
  })
  room.onMessage('spikeHit', (data) => {
    if (!getLocalBlobPos(data.blobId)) return
    applySpikeKnock(data.blobId, data.x, data.z, data.vx, data.vz, data.mass)
    shakeCamera(0.7)
  })
  room.onMessage('blobKnock', (data) => {
    if (!getLocalBlobPos(data.blobId)) return
    applyBlobKnock(data.blobId, data.x, data.z, data.vx, data.vz, data.mass)
    shakeCamera(0.55)
  })

  engine.addSystem(() => {
    const pos = getLocalDisplayPos()
    if (!pos) return
    const pieces: { x: number; z: number; mass: number; r: number }[] = []
    for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
      if (!isLocalAddr(blob.address)) continue
      const p = getLocalBlobPos(blob.blobId) ?? { x: blob.x, z: blob.z }
      const mass = getLocalBlobMass(blob.blobId, blob.mass)
      pieces.push({ x: p.x, z: p.z, mass, r: radiusFromMass(mass) })
    }
    if (pieces.length === 0) return

    const now = Date.now()
    for (const [id, at] of [...pendingPlayers.entries()]) {
      if (now - at > 280) pendingPlayers.delete(id)
    }

    const liveFood = new Set<number>()
    for (const [entity, food] of engine.getEntitiesWith(Food, Transform)) {
      liveFood.add(food.id)
      if (pending.has(food.id) || isFoodGone(food.id)) continue
      const t = Transform.get(entity).position
      const fr = radiusFromMass(food.mass)
      let hit = false
      for (const p of pieces) {
        if (foodOverlaps(p.x - t.x, p.z - t.z, p.r, fr, 1.08)) {
          hit = true
          break
        }
      }
      if (!hit) continue
      pending.add(food.id)
      markFoodGone(food.id)
      if (food.kind === FOOD_KIND_BOOST) {
        startBoost(Date.now() + BOOST_MS)
        spawnCollectBurst(t.x, t.y, t.z, 0.13)
      } else if (food.kind === FOOD_KIND_SPIKE) {
        startSpike(getLocalAddress(), Date.now() + SPIKE_MS)
        spawnCollectBurst(t.x, t.y, t.z, 0.92)
      } else {
        setLocalMass(getLocalMass() + food.mass)
        spawnCollectBurst(t.x, t.y, t.z, food.hue)
      }
      playFoodPop()
      shakeCamera(food.kind === FOOD_KIND_BOOST || food.kind === FOOD_KIND_SPIKE ? 0.55 : 0.28)
      room.send('eatFood', { id: food.id })
    }
    for (const id of [...pending]) {
      if (!liveFood.has(id)) pending.delete(id)
    }

    type Seen = { blobId: number; address: string; x: number; z: number; sx: number; sz: number; mass: number }
    const locals: Seen[] = []
    const remotes: Seen[] = []
    for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
      const local = isLocalAddr(blob.address)
      const pred = local ? getLocalBlobPos(blob.blobId) : isBot(blob.address) ? getBotMotion(blob.address) : null
      const seen: Seen = {
        blobId: blob.blobId,
        address: blob.address,
        x: pred?.x ?? blob.x,
        z: pred?.z ?? blob.z,
        sx: blob.x,
        sz: blob.z,
        mass: local ? getLocalBlobMass(blob.blobId, blob.mass) : blob.mass
      }
      if (local) locals.push(seen)
      else remotes.push(seen)
    }

    const reportEat = (preyId: number) => {
      if (pendingPlayers.has(preyId)) return
      pendingPlayers.set(preyId, now)
      room.send('eatPlayer', { id: preyId })
    }

    const overlaps = (eaterMass: number, preyMass: number, distA: number, distB: number, slack: number) =>
      blobEatsBlob(eaterMass, preyMass, distA, slack) || blobEatsBlob(eaterMass, preyMass, distB, slack)

    for (const prey of remotes) {
      if (pendingPlayers.has(prey.blobId)) continue
      if (isBot(prey.address)) continue
      if (isSpiked(prey.address)) continue
      const hit = locals.some((meBlob) =>
        overlaps(
          meBlob.mass,
          prey.mass,
          Math.hypot(meBlob.x - prey.x, meBlob.z - prey.z),
          Math.hypot(meBlob.sx - prey.sx, meBlob.sz - prey.sz),
          1.4
        )
      )
      if (hit) reportEat(prey.blobId)
    }

    for (const meBlob of locals) {
      if (pendingPlayers.has(meBlob.blobId)) continue
      const eaten = remotes.some((eater) => {
        if (isSpiked(meBlob.address) && eater.mass > meBlob.mass) return false
        return overlaps(
          eater.mass,
          meBlob.mass,
          Math.hypot(eater.x - meBlob.x, eater.z - meBlob.z),
          Math.hypot(eater.sx - meBlob.sx, eater.sz - meBlob.sz),
          1.5
        )
      })
      if (eaten) reportEat(meBlob.blobId)
    }
  })
}
