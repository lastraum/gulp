import { Schemas } from '@dcl/sdk/ecs'
import { registerMessages } from '@dcl/sdk/network'

export const Messages = {
  join: Schemas.Map({
    name: Schemas.String
  }),
  leaderboard: Schemas.Map({
    rows: Schemas.Array(
      Schemas.Map({
        address: Schemas.String,
        name: Schemas.String,
        best: Schemas.Float
      })
    )
  }),
  move: Schemas.Map({
    x: Schemas.Float,
    z: Schemas.Float
  }),
  eatFood: Schemas.Map({
    id: Schemas.Int
  }),
  eatPlayer: Schemas.Map({
    id: Schemas.Int
  }),
  blobEaten: Schemas.Map({
    victim: Schemas.String,
    killer: Schemas.String,
    blobId: Schemas.Int,
    x: Schemas.Float,
    z: Schemas.Float,
    mass: Schemas.Float
  }),
  playerKilled: Schemas.Map({
    victim: Schemas.String,
    killer: Schemas.String,
    x: Schemas.Float,
    z: Schemas.Float
  }),
  split: Schemas.Map({
    x: Schemas.Float,
    z: Schemas.Float
  }),
  combine: Schemas.Map({}),
  foodGone: Schemas.Map({
    id: Schemas.Int
  }),
  foodSpawn: Schemas.Map({
    id: Schemas.Int,
    x: Schemas.Float,
    z: Schemas.Float,
    mass: Schemas.Float,
    hue: Schemas.Float,
    kind: Schemas.Int
  }),
  boostStart: Schemas.Map({
    address: Schemas.String,
    until: Schemas.Float,
    stacks: Schemas.Int,
    untils: Schemas.Array(Schemas.Float)
  }),
  spikeStart: Schemas.Map({
    address: Schemas.String,
    until: Schemas.Float,
    remain: Schemas.Float
  }),
  spikeHit: Schemas.Map({
    blobId: Schemas.Int,
    x: Schemas.Float,
    z: Schemas.Float,
    vx: Schemas.Float,
    vz: Schemas.Float,
    mass: Schemas.Float
  }),
  blobKnock: Schemas.Map({
    blobId: Schemas.Int,
    x: Schemas.Float,
    z: Schemas.Float,
    vx: Schemas.Float,
    vz: Schemas.Float,
    mass: Schemas.Float
  }),
  hitCog: Schemas.Map({
    blobId: Schemas.Int
  }),
  massUpdate: Schemas.Map({
    address: Schemas.String,
    mass: Schemas.Float
  }),
  respawn: Schemas.Map({
    address: Schemas.String,
    x: Schemas.Float,
    z: Schemas.Float
  }),
  obstaclePath: Schemas.Map({
    id: Schemas.Int,
    speed: Schemas.Float,
    spin: Schemas.Float,
    t0: Schemas.Float,
    points: Schemas.Array(Schemas.Vector3)
  }),
  flamingoPath: Schemas.Map({
    id: Schemas.Int,
    speed: Schemas.Float,
    dist: Schemas.Float,
    t0: Schemas.Float,
    from: Schemas.Vector3,
    to: Schemas.Vector3
  }),
  gmCmd: Schemas.Map({
    cmd: Schemas.String
  }),
  gmState: Schemas.Map({
    flamingos: Schemas.Boolean,
    spinners: Schemas.Int,
    bots: Schemas.Int
  })
}

export const room = registerMessages(Messages)
