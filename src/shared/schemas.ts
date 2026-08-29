import { engine, Schemas } from '@dcl/sdk/ecs'
import { isServer } from '@dcl/sdk/network'
import { AUTH_SERVER_PEER_ID } from '@dcl/sdk/network/message-bus-sync'

export const Cell = engine.defineComponent('vibe:Cell', {
  address: Schemas.String,
  mass: Schemas.Float,
  vx: Schemas.Float,
  vz: Schemas.Float
})

export const Blob = engine.defineComponent('vibe:Blob', {
  address: Schemas.String,
  blobId: Schemas.Int,
  mass: Schemas.Float,
  x: Schemas.Float,
  z: Schemas.Float,
  vx: Schemas.Float,
  vz: Schemas.Float,
  tint: Schemas.Int
})

export const Food = engine.defineComponent('vibe:Food', {
  id: Schemas.Int,
  mass: Schemas.Float,
  hue: Schemas.Float,
  kind: Schemas.Int
})

export const Heartbeat = engine.defineComponent('vibe:Heartbeat', {
  t: Schemas.Float
})

export const Cog = engine.defineComponent('vibe:Cog', {
  id: Schemas.Int,
  spin: Schemas.Float,
  t0: Schemas.Float
})

export const Flamingo = engine.defineComponent('vibe:Flamingo', {
  id: Schemas.Int,
  speed: Schemas.Float,
  t0: Schemas.Float,
  ax: Schemas.Float,
  az: Schemas.Float,
  bx: Schemas.Float,
  bz: Schemas.Float
})

export function protectServerWrites() {
  if (!isServer()) return
  const onlyServer = (v: { senderAddress: string }) => v.senderAddress === AUTH_SERVER_PEER_ID
  Cell.validateBeforeChange(onlyServer)
  Blob.validateBeforeChange(onlyServer)
  Food.validateBeforeChange(onlyServer)
  Heartbeat.validateBeforeChange(onlyServer)
  Cog.validateBeforeChange(onlyServer)
  Flamingo.validateBeforeChange(onlyServer)
}
