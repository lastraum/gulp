import { AudioSource, Entity, Transform, engine } from '@dcl/sdk/ecs'
import { Vector3 } from '@dcl/sdk/math'
import { WORLD_CENTER } from '../shared/config'

const MUSIC = 'assets/sounds/background-music.wav'
const FOOD_POP = 'assets/sounds/food-pop.wav'
const POP_VOICES = 3

let music: Entity
const pops: Entity[] = []
let popIndex = 0
let lastPopAt = 0

function placeOnCam(entity: Entity) {
  const cam = Transform.getOrNull(engine.CameraEntity)
  if (!cam) return
  const t = Transform.getMutable(entity)
  t.position.x = cam.position.x
  t.position.y = cam.position.y
  t.position.z = cam.position.z
}

export function registerAudio() {
  music = engine.addEntity()
  Transform.create(music, { position: Vector3.create(WORLD_CENTER, 4, WORLD_CENTER) })
  AudioSource.create(music, {
    audioClipUrl: MUSIC,
    playing: true,
    loop: true,
    volume: 0.1,
    global: true
  })

  for (let i = 0; i < POP_VOICES; i++) {
    const pop = engine.addEntity()
    Transform.create(pop, { position: Vector3.create(WORLD_CENTER, 4, WORLD_CENTER) })
    pops.push(pop)
  }

  engine.addSystem(() => {
    placeOnCam(music)
    for (const pop of pops) placeOnCam(pop)
  }, 8, 'music-follow-cam')
}

export function playFoodPop() {
  const now = Date.now()
  if (now - lastPopAt < 70) return
  lastPopAt = now
  const pop = pops[popIndex % pops.length]
  popIndex++
  if (!pop) return
  placeOnCam(pop)
  AudioSource.createOrReplace(pop, {
    audioClipUrl: FOOD_POP,
    playing: true,
    loop: false,
    volume: 0.7,
    global: true,
    currentTime: 0
  })
}
