import { PlayerIdentityData, engine } from '@dcl/sdk/ecs'
import { Color4 } from '@dcl/sdk/math'
import { getPlayer } from '@dcl/sdk/players'
import ReactEcs, { Label, ReactEcsRenderer, ScreenInsetArea, UiEntity } from '@dcl/sdk/react-ecs'
import { BOOST_MS, BOOST_MULT, BOT_MAX, COG_MAX, DEATH_BURST_MS, MAX_BLOBS, SPIKE_MS, botName, isBot } from '../shared/config'
import { isGm } from '../shared/gm'
import { room } from '../shared/messages'
import { Blob } from '../shared/schemas'
import { sendCombine, sendGmCmd, sendSplit } from './input'
import { getLocalAddress, isLocalAddr } from './local'
import { catalystFaceUrl, requestCatalystFaces } from './profiles'
import { getBoostRemain, getBoostStacks, getSpikeRemain } from './smooth'

type BoardRow = { address: string; name: string; best: number }

const SPLASH_MS = 5000
const DEATH_UI_MS = DEATH_BURST_MS + 3500

let deathAt = 0
let deathRevealAt = 0
let deathUntil = 0
let killerLabel = ''
let storedBoard: BoardRow[] = []
let splashUntil = 0
let gmConfirmUntil = 0
let gmFlashUntil = 0
let gmFlash = ''
let gmOpen = true
let gmTab: 'general' | 'obstacles' = 'general'
let gmFlamingosOn = false
let gmSpinnerCount = 4
let gmBotCount = 2
let gmForgeOn = false

export function isSplashActive(): boolean {
  return Date.now() < splashUntil
}

function shortAddr(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function playerName(address: string): string {
  const bot = botName(address)
  if (bot) return bot
  const p = getPlayer({ userId: address })
  const name = p?.name?.trim()
  if (name) return name
  return shortAddr(address)
}

function boardName(name: string): string {
  const n = name.trim()
  if (n.length <= 15) return n
  return `${n.slice(0, 14)}…`
}

function boardRows(): (BoardRow & { mine: boolean })[] {
  const rows = storedBoard.slice(0, 5)
  requestCatalystFaces(rows.filter((row) => !isBot(row.address)).map((row) => row.address))
  return rows.map((row) => ({
    ...row,
    name: boardName(row.name || playerName(row.address)),
    mine: isLocalAddr(row.address)
  }))
}

export function beginDeath(killer: string) {
  deathAt = Date.now()
  deathRevealAt = deathAt + DEATH_BURST_MS
  deathUntil = deathAt + DEATH_UI_MS
  killerLabel = killer ? playerName(killer) : 'another sphere'
}

export function showDeathUi(killer: string) {
  beginDeath(killer)
}

export function hideDeathUi() {
  deathAt = 0
  deathRevealAt = 0
  deathUntil = 0
  killerLabel = ''
}

export function isDeathUiVisible(): boolean {
  const now = Date.now()
  return deathRevealAt > 0 && now >= deathRevealAt && now < deathUntil
}

export function isDying(): boolean {
  return deathAt > 0 && Date.now() < deathUntil
}

function leaderRow(row: BoardRow & { mine: boolean }, index: number) {
  const face = catalystFaceUrl(row.address)
  return (
    <UiEntity
      key={row.address}
      uiTransform={{
        width: 340,
        height: 80,
        flexDirection: 'row',
        alignItems: 'center',
        padding: { left: 8, right: 8 },
        margin: { bottom: 8 }
      }}
    >
      <Label
        value={`${index + 1}`}
        fontSize={35}
        color={Color4.create(0, 0, 0, 1)}
        textAlign="middle-center"
        uiTransform={{ width: 52, height: 64 }}
      />
      <UiEntity
        uiTransform={{ width: 56, height: 56, margin: { left: 4, right: 10 } }}
        uiBackground={
          face
            ? { texture: { src: face }, textureMode: 'stretch' }
            : { color: Color4.create(0.2, 0.2, 0.22, 1) }
        }
      />
      <Label
        value={row.name}
        fontSize={31}
        color={Color4.create(0, 0, 0, 1)}
        textAlign="middle-left"
        uiTransform={{ flexGrow: 1, height: 64 }}
      />
    </UiEntity>
  )
}

function leaderboardUi() {
  const rows = boardRows()
  const midH = Math.max(200, rows.length * 88)
  return (
    <UiEntity
      uiTransform={{
        width: 360,
        height: 108 + midH,
        positionType: 'absolute',
        position: { top: 8, right: '2%' },
        flexDirection: 'column',
        alignItems: 'center',
        pointerFilter: 'none'
      }}
    >
      <UiEntity
        uiTransform={{
          width: 360,
          height: 108,
          justifyContent: 'flex-end',
          alignItems: 'center',
          padding: { bottom: 4, left: 6, right: 48 }
        }}
        uiBackground={{
          texture: { src: 'images/leaderboard-header-v2.png' },
          textureMode: 'stretch',
          color: Color4.create(1, 1, 1, 1)
        }}
      >
        <Label
          value="ALL TIME"
          fontSize={21}
          color={Color4.White()}
          textAlign="middle-center"
          uiTransform={{
            width: 200,
            height: 40,
            positionType: 'absolute',
            position: { left: 77, top: 44 }
          }}
        />
      </UiEntity>
      <UiEntity
        uiTransform={{
          width: 340,
          height: midH,
          flexDirection: 'column',
          alignItems: 'center',
          padding: { top: 16, bottom: 16 }
        }}
      >
        {rows.map((row, i) => leaderRow(row, i))}
      </UiEntity>
    </UiEntity>
  )
}

function gmTabBtn(id: 'general' | 'obstacles', label: string) {
  const on = gmTab === id
  return (
    <UiEntity
      uiTransform={{ width: 124, height: 32, margin: { right: 6 } }}
      uiBackground={{ color: on ? Color4.create(0.22, 0.28, 0.4, 0.95) : Color4.create(0.08, 0.08, 0.1, 0.8) }}
      onMouseDown={() => {
        gmTab = id
      }}
    >
      <Label
        value={label}
        fontSize={13}
        color={on ? Color4.create(1, 0.88, 0.45, 1) : Color4.create(0.85, 0.85, 0.88, 1)}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: 32 }}
      />
    </UiEntity>
  )
}

function gmActionBtn(label: string, color: Color4, onPress: () => void) {
  return (
    <UiEntity
      uiTransform={{ width: '100%', height: 36, margin: { bottom: 8 } }}
      uiBackground={{ color: Color4.create(0.12, 0.12, 0.14, 0.92) }}
      onMouseDown={onPress}
    >
      <Label
        value={label}
        fontSize={14}
        color={color}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: 36 }}
      />
    </UiEntity>
  )
}

function gmGeneralTab() {
  const confirming = Date.now() < gmConfirmUntil
  const flash = Date.now() < gmFlashUntil
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      {gmCountRow(
        'BOTS',
        gmBotCount,
        () => {
          if (gmBotCount <= 0) return
          gmBotCount -= 1
          sendGmCmd('botRemove')
        },
        () => {
          if (gmBotCount >= BOT_MAX) return
          gmBotCount += 1
          sendGmCmd('botAdd')
        }
      )}
      {gmActionBtn(
        gmForgeOn ? 'FORGE: ON' : 'FORGE: OFF',
        gmForgeOn ? Color4.create(0.45, 0.95, 0.62, 1) : Color4.create(0.8, 0.8, 0.85, 1),
        () => {
          const next = !gmForgeOn
          gmForgeOn = next
          sendGmCmd(next ? 'forgeOn' : 'forgeOff')
        }
      )}
      {gmActionBtn(
        flash ? gmFlash : confirming ? 'CONFIRM RESET' : 'RESET BOARD',
        confirming || flash ? Color4.create(1, 0.55, 0.55, 1) : Color4.create(1, 0.78, 0.32, 1),
        () => {
          if (Date.now() < gmConfirmUntil) {
            gmConfirmUntil = 0
            gmFlash = 'BOARD CLEARED'
            gmFlashUntil = Date.now() + 2200
            sendGmCmd('resetBoard')
            storedBoard = []
            return
          }
          gmConfirmUntil = Date.now() + 3500
        }
      )}
    </UiEntity>
  )
}

function gmCountRow(label: string, count: number, onMinus: () => void, onPlus: () => void) {
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 36,
        flexDirection: 'row',
        alignItems: 'center',
        margin: { bottom: 8 }
      }}
    >
      <UiEntity
        uiTransform={{ width: 36, height: 36 }}
        uiBackground={{ color: Color4.create(0.18, 0.18, 0.2, 0.95) }}
        onMouseDown={onMinus}
      >
        <Label value="-" fontSize={22} color={Color4.White()} textAlign="middle-center" uiTransform={{ width: 36, height: 36 }} />
      </UiEntity>
      <Label
        value={`${label}  ${count}`}
        fontSize={14}
        color={Color4.create(1, 0.78, 0.32, 1)}
        textAlign="middle-center"
        uiTransform={{ flexGrow: 1, height: 36 }}
      />
      <UiEntity
        uiTransform={{ width: 36, height: 36 }}
        uiBackground={{ color: Color4.create(0.18, 0.18, 0.2, 0.95) }}
        onMouseDown={onPlus}
      >
        <Label value="+" fontSize={22} color={Color4.White()} textAlign="middle-center" uiTransform={{ width: 36, height: 36 }} />
      </UiEntity>
    </UiEntity>
  )
}

function gmObstaclesTab() {
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', flexDirection: 'column' }}>
      {gmCountRow(
        'SPINNERS',
        gmSpinnerCount,
        () => {
          if (gmSpinnerCount <= 0) return
          gmSpinnerCount -= 1
          sendGmCmd('spinnerRemove')
        },
        () => {
          if (gmSpinnerCount >= COG_MAX) return
          gmSpinnerCount += 1
          sendGmCmd('spinnerAdd')
        }
      )}
      {gmActionBtn(
        gmFlamingosOn ? 'FLAMINGOS: ON' : 'FLAMINGOS: OFF',
        gmFlamingosOn ? Color4.create(1, 0.55, 0.78, 1) : Color4.create(0.8, 0.8, 0.85, 1),
        () => {
          const next = !gmFlamingosOn
          gmFlamingosOn = next
          sendGmCmd(next ? 'flamingosOn' : 'flamingosOff')
        }
      )}
    </UiEntity>
  )
}

function gmAllowed(): boolean {
  if (isGm(getLocalAddress())) return true
  if (isGm(getPlayer()?.userId)) return true
  for (const [_e, data] of engine.getEntitiesWith(PlayerIdentityData)) {
    if (isGm(data.address)) return true
  }
  return false
}

function gmPanel() {
  return (
    <UiEntity
      uiTransform={{
        width: 268,
        height: gmOpen ? 240 : 36,
        positionType: 'absolute',
        position: { top: 16, right: 16 },
        flexDirection: 'column',
        pointerFilter: 'block'
      }}
      uiBackground={{ color: Color4.create(0.05, 0.05, 0.07, 0.82) }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 36,
          flexDirection: 'row',
          alignItems: 'center',
          padding: { left: 10, right: 10 }
        }}
        onMouseDown={() => {
          gmOpen = !gmOpen
        }}
      >
        <Label
          value="GM"
          fontSize={14}
          color={Color4.create(1, 0.84, 0.3, 1)}
          textAlign="middle-left"
          uiTransform={{ flexGrow: 1, height: 36 }}
        />
        <Label
          value={gmOpen ? '–' : '+'}
          fontSize={18}
          color={Color4.create(1, 0.84, 0.3, 1)}
          textAlign="middle-right"
          uiTransform={{ width: 28, height: 36 }}
        />
      </UiEntity>
      {gmOpen ? (
        <UiEntity uiTransform={{ width: '100%', height: 204, flexDirection: 'column' }}>
          <UiEntity uiTransform={{ width: '100%', height: 36, flexDirection: 'row', padding: { left: 8, right: 8 } }}>
            {gmTabBtn('general', 'GENERAL')}
            {gmTabBtn('obstacles', 'OBSTACLES')}
          </UiEntity>
          <UiEntity uiTransform={{ width: '100%', height: 168, padding: { left: 8, right: 8, top: 6 } }}>
            {gmTab === 'general' ? gmGeneralTab() : gmObstaclesTab()}
          </UiEntity>
        </UiEntity>
      ) : null}
    </UiEntity>
  )
}

function localBlobCount(): number {
  let n = 0
  for (const [_e, blob] of engine.getEntitiesWith(Blob)) {
    if (isLocalAddr(blob.address)) n++
  }
  return n
}

function actionButton(src: string, right: number, enabled: boolean, onPress: () => void) {
  return (
    <UiEntity
      uiTransform={{
        width: 92,
        height: 92,
        positionType: 'absolute',
        position: { bottom: 28, right },
        pointerFilter: enabled ? 'block' : 'none'
      }}
      uiBackground={{
        texture: { src },
        textureMode: 'stretch',
        color: enabled ? Color4.create(1, 1, 1, 1) : Color4.create(1, 1, 1, 0.35)
      }}
      onMouseDown={() => {
        if (enabled) onPress()
      }}
    />
  )
}

function splashUi() {
  if (!isSplashActive()) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0, right: 0, bottom: 0 },
        pointerFilter: 'block'
      }}
      uiBackground={{
        texture: { src: 'images/scene-thumbnail.png' },
        textureMode: 'stretch'
      }}
    />
  )
}

function actionButtonsUi() {
  if (isDying() || isDeathUiVisible() || isSplashActive()) return null
  const pieces = localBlobCount()
  return (
    <UiEntity uiTransform={{ width: '100%', height: '100%', pointerFilter: 'none' }}>
      {actionButton('images/btn-split.png', 132, pieces > 0 && pieces < MAX_BLOBS, () => sendSplit())}
      {actionButton('images/btn-combine.png', 28, pieces > 1, () => sendCombine())}
    </UiEntity>
  )
}

function powerBar(label: string, remain: number, max: number, color: Color4) {
  const pct = Math.max(0.04, Math.min(1, remain / max))
  return (
    <UiEntity
      uiTransform={{
        width: 340,
        flexDirection: 'column',
        alignItems: 'center',
        margin: { bottom: 8 }
      }}
    >
      <Label
        value={label}
        fontSize={14}
        color={color}
        textAlign="middle-center"
        uiTransform={{ width: '100%', height: 16 }}
      />
      <UiEntity
        uiTransform={{
          width: 340,
          height: 48,
          margin: { top: 2 }
        }}
        uiBackground={{
          texture: { src: 'images/power-pill-flat.png' },
          textureMode: 'stretch'
        }}
      >
        <UiEntity
          uiTransform={{
            width: `${pct * 100}%`,
            height: '100%',
            positionType: 'absolute',
            position: { top: 0, left: 0 }
          }}
          uiBackground={{ color: Color4.create(color.r, color.g, color.b, 0.95) }}
        />
      </UiEntity>
    </UiEntity>
  )
}

function powerBarsUi() {
  const boost = getBoostRemain()
  const spike = getSpikeRemain()
  if (boost <= 0 && spike <= 0) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: 120,
        positionType: 'absolute',
        position: { bottom: 24, left: 0 },
        flexDirection: 'column',
        justifyContent: 'flex-end',
        alignItems: 'center',
        pointerFilter: 'none'
      }}
    >
      {spike > 0 ? powerBar('SPIKES', spike, SPIKE_MS, Color4.create(1, 0.35, 0.62, 1)) : null}
      {boost > 0
        ? powerBar(`SPEED x${Math.pow(BOOST_MULT, Math.max(1, getBoostStacks()))}`, boost, BOOST_MS, Color4.create(1, 0.78, 0.12, 1))
        : null}
    </UiEntity>
  )
}

function deathUi() {
  if (!isDeathUiVisible()) return null
  return (
    <UiEntity
      uiTransform={{
        width: '100%',
        height: '100%',
        positionType: 'absolute',
        position: { top: 0, left: 0, right: 0, bottom: 0 },
        justifyContent: 'flex-end',
        alignItems: 'center',
        flexDirection: 'column',
        pointerFilter: 'none'
      }}
      uiBackground={{
        texture: { src: 'images/you-died.png' },
        textureMode: 'stretch'
      }}
    >
      <UiEntity
        uiTransform={{
          width: '100%',
          height: 120,
          justifyContent: 'center',
          alignItems: 'center',
          flexDirection: 'column',
          margin: { bottom: 28 }
        }}
        uiBackground={{ color: Color4.create(0, 0, 0, 0.28) }}
      >
        <Label
          value={`Eaten by ${killerLabel}`}
          fontSize={26}
          color={Color4.create(1, 1, 1, 0.95)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 40 }}
        />
        <Label
          value="Respawning..."
          fontSize={20}
          color={Color4.create(1, 1, 1, 0.75)}
          textAlign="middle-center"
          uiTransform={{ width: '100%', height: 32, margin: { top: 6 } }}
        />
      </UiEntity>
    </UiEntity>
  )
}

export function setupHud() {
  splashUntil = Date.now() + SPLASH_MS
  room.onMessage('leaderboard', (data) => {
    storedBoard = Array.isArray(data.rows) ? data.rows : []
    requestCatalystFaces(storedBoard.map((row) => row.address))
  })
  room.onMessage('gmState', (data) => {
    gmFlamingosOn = !!data.flamingos
    gmForgeOn = !!data.forge
    if (typeof data.spinners === 'number') gmSpinnerCount = data.spinners
    if (typeof data.bots === 'number') gmBotCount = data.bots
  })

  const rootUi = () => {
    const overlay = isSplashActive() || isDeathUiVisible()
    return (
      <UiEntity
        uiTransform={{
          width: '100%',
          height: '100%',
          pointerFilter: overlay ? 'block' : 'none'
        }}
      >
        {leaderboardUi()}
        <ScreenInsetArea>
          {gmAllowed() ? gmPanel() : null}
          {powerBarsUi()}
          {actionButtonsUi()}
        </ScreenInsetArea>
        {deathUi()}
        {splashUi()}
      </UiEntity>
    )
  }

  ReactEcsRenderer.setUiRenderer(rootUi, { screenInset: 'none' })
}
