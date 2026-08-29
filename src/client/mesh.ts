import { Entity, Material, MeshRenderer, Transform, engine } from '@dcl/sdk/ecs'
import { Color3, Color4 } from '@dcl/sdk/math'

export const PALETTE_N = 12

function hsl(h: number, s: number, l: number): Color4 {
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + h * 12) % 12
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1)
  }
  return Color4.create(f(0), f(8), f(4), 1)
}

export const PASTELS: Color4[] = [
  hsl(0.00, 0.62, 0.64),
  hsl(0.08, 0.62, 0.64),
  hsl(0.16, 0.62, 0.64),
  hsl(0.25, 0.62, 0.64),
  hsl(0.33, 0.62, 0.64),
  hsl(0.42, 0.62, 0.64),
  hsl(0.50, 0.62, 0.64),
  hsl(0.58, 0.62, 0.64),
  hsl(0.67, 0.62, 0.64),
  hsl(0.75, 0.62, 0.64),
  hsl(0.83, 0.62, 0.64),
  hsl(0.92, 0.62, 0.64)
]

export const WHITE = Color4.create(0.98, 0.97, 0.95, 1)
export const IRIS = Color4.create(0.08, 0.07, 0.1, 1)
export const COG_RED = Color4.create(0.92, 0.08, 0.08, 1)
export const COG_YELLOW = Color4.create(1, 0.86, 0.12, 1)
export const WALL_PINK = Color4.create(0.93, 0.78, 0.82, 1)
export const GRASS = Color4.create(0.38, 0.92, 0.28, 1)
export const GOLD = Color4.create(1, 0.78, 0.18, 1)
export const SPIKE = Color4.create(1, 0.22, 0.58, 1)

export function hueIndex(h: number): number {
  return Math.floor((((h % 1) + 1) % 1) * PALETTE_N) % PALETTE_N
}

export function addressIndex(address: string): number {
  let hash = 0
  for (let i = 0; i < address.length; i++) hash = (hash * 31 + address.charCodeAt(i)) >>> 0
  return hash % PALETTE_N
}

export function pastel(index: number): Color4 {
  return PASTELS[((index % PALETTE_N) + PALETTE_N) % PALETTE_N]
}

export function paintSphere(entity: Entity, color: Color4, metallic = 0.08, roughness = 0.45) {
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(color.r, color.g, color.b, 1),
    metallic,
    roughness
  })
}

export function paintBasicSphere(entity: Entity, color: Color4) {
  MeshRenderer.setSphere(entity)
  Material.setBasicMaterial(entity, {
    diffuseColor: Color4.create(color.r, color.g, color.b, 1)
  })
}

export function paintGoldSphere(entity: Entity) {
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: GOLD,
    emissiveColor: Color3.create(1, 0.72, 0.12),
    emissiveIntensity: 2.8,
    metallic: 0.85,
    roughness: 0.18
  })
}

export function paintSpikeSphere(entity: Entity) {
  MeshRenderer.setSphere(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: SPIKE,
    emissiveColor: Color3.create(1, 0.12, 0.42),
    emissiveIntensity: 2.6,
    metallic: 0.28,
    roughness: 0.28
  })
}

export function paintCone(entity: Entity, color: Color4, metallic = 0.2, roughness = 0.32) {
  MeshRenderer.setCylinder(entity, 1, 0)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(color.r, color.g, color.b, 1),
    emissiveColor: Color3.create(color.r, color.g * 0.45, color.b * 0.7),
    emissiveIntensity: 1.8,
    metallic,
    roughness
  })
}

export function paintBox(entity: Entity, color: Color4, metallic = 0.08, roughness = 0.45) {
  MeshRenderer.setBox(entity)
  Material.setPbrMaterial(entity, {
    albedoColor: Color4.create(color.r, color.g, color.b, 1),
    metallic,
    roughness
  })
}

export function makeBall(parent: Entity | null, color: Color4, metallic = 0.08, roughness = 0.45): Entity {
  const e = engine.addEntity()
  paintSphere(e, color, metallic, roughness)
  Transform.create(e, parent ? { parent } : {})
  return e
}
