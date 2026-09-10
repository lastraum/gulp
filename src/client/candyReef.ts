import { GltfContainer, Transform, engine } from '@dcl/sdk/ecs'
import { Quaternion, Vector3 } from '@dcl/sdk/math'
import { ARENA_RADIUS, WORLD_CENTER, mulberry32 } from '../shared/config'

const SEED = 0xc4d1
const PIECES = 80

type Kind = {
  src: string
  y0: number
  s0: number
  s1: number
  tangent?: boolean
}

const KINDS: Kind[] = [
  { src: 'models/candy-reef/lollipop.glb', y0: 0.5, s0: 10, s1: 16 },
  { src: 'models/candy-reef/candy-coral.glb', y0: 0.361, s0: 11, s1: 18 },
  { src: 'models/candy-reef/lantern-mushroom.glb', y0: 0.5, s0: 11, s1: 17 },
  { src: 'models/candy-reef/jelly-arch.glb', y0: 0.428, s0: 16.5, s1: 23.5, tangent: true },
  { src: 'models/candy-reef/candy-post.glb', y0: 0.5, s0: 8, s1: 12 }
]

function bag(rng: () => number): Kind[] {
  const out: Kind[] = []
  const each = PIECES / KINDS.length
  for (const kind of KINDS) {
    for (let i = 0; i < each; i++) out.push(kind)
  }
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const t = out[i]
    out[i] = out[j]
    out[j] = t
  }
  return out
}

export function buildCandyReef() {
  const rng = mulberry32(SEED)
  const kinds = bag(rng)
  const step = (Math.PI * 2) / PIECES
  const spin = rng() * Math.PI * 2
  for (let i = 0; i < PIECES; i++) {
    const kind = kinds[i]
    const a = spin + i * step + (rng() - 0.5) * step * 0.7
    const r = ARENA_RADIUS + (rng() * 4 - 2)
    const x = WORLD_CENTER + Math.cos(a) * r
    const z = WORLD_CENTER + Math.sin(a) * r
    const scale = kind.s0 + rng() * (kind.s1 - kind.s0)
    const face = (Math.atan2(WORLD_CENTER - x, WORLD_CENTER - z) * 180) / Math.PI
    const yaw = face + (kind.tangent ? 180 : 0) + (rng() - 0.5) * 22
    const e = engine.addEntity()
    Transform.create(e, {
      position: Vector3.create(x, kind.y0 * scale, z),
      rotation: Quaternion.fromEulerDegrees(0, yaw, 0),
      scale: Vector3.create(scale, scale, scale)
    })
    GltfContainer.create(e, {
      src: kind.src,
      visibleMeshesCollisionMask: 0,
      invisibleMeshesCollisionMask: 0
    })
  }
}
