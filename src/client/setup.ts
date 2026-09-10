import { getUserData } from '~system/UserIdentity'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'
import { buildArena } from './arena'
import { registerAudio } from './audio'
import { registerFollow } from './follow'
import { registerBots } from './bots'
import { registerCanes } from './canes'
import { registerCogs } from './cogs'
import { registerFlamingos } from './flamingos'
import { hideAvatars } from './hideAvatars'
import { setupHud } from './hud'
import { registerInput } from './input'
import { lockPlayer } from './lockPlayer'
import { setLocalAddress } from './local'
import { registerEat } from './eat'
import { registerSmooth } from './smooth'
import { registerVisuals } from './visuals'

export async function initClient() {
  logEvent('client.start', { game: 'gulp' })
  buildArena()
  hideAvatars()
  registerAudio()
  lockPlayer()
  registerInput()
  registerCogs()
  registerCanes()
  registerFlamingos()
  registerBots()
  registerSmooth()
  registerVisuals()
  registerEat()
  registerFollow()
  setupHud()

  try {
    const user = await getUserData({})
    if (user.data?.userId) setLocalAddress(user.data.userId)
    const display = String((user.data as { displayName?: string } | undefined)?.displayName ?? '').trim()
    if (display) room.send('join', { name: display })
    logEvent('client.identity', { address: user.data?.userId ?? null, name: display || null })
  } catch {
    logEvent('client.identity', { address: null, guest: true })
  }
}
