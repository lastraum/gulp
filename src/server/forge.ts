import { isBot } from '../shared/config'
import { logEvent } from '../shared/log'

/** Fill these from the gulp verse. The action must ADD the sent values, not SET. */
const FORGE_URL = 'https://theforgecore.xyz/ws'
const FORGE_VERSE_ID = '0d29643e-d845-46f0-952f-b0c3d510e674'
const FORGE_ACTION_ID = 'action_1788024400539_v7s2o5snd'
const FORGE_SERVER_TOKEN = 'forge_a7bc0836ff1e394b7b05c53b8d3aca44a8a928f81ea79f20afc60a7404d684ed'
const FORGE_FOOD_VAR_ID = 'd98a7df5-abcd-4060-8002-cb2ec5cb83ba'
const FORGE_HUMANS_VAR_ID = '30808a81-70ce-415a-bd8d-425797b48f0e'

const foodEaten = new Map<string, number>()
const humansEaten = new Map<string, number>()

let forgePingsOn = false
let warnedMissing = false

function forgeReady(): boolean {
  return !!(FORGE_SERVER_TOKEN && FORGE_ACTION_ID && (FORGE_FOOD_VAR_ID || FORGE_HUMANS_VAR_ID))
}

export function isForgePinging(): boolean {
  return forgePingsOn
}

export function setForgePinging(on: boolean) {
  if (forgePingsOn === on) return
  forgePingsOn = on
  if (!on) {
    foodEaten.clear()
    humansEaten.clear()
  }
  logEvent(on ? 'forge.enabled' : 'forge.disabled', { pinging: on })
}

export function initForge() {
  forgePingsOn = false
  if (forgeReady()) {
    logEvent('forge.ready', { verse: FORGE_VERSE_ID || 'from-token', action: FORGE_ACTION_ID, pinging: false })
    return
  }
  logEvent('forge.unconfigured', { reason: 'missing action, token, or variable ids' })
}

export function noteFoodEaten(address: string) {
  if (!forgePingsOn) return
  if (!address || isBot(address)) return
  foodEaten.set(address, (foodEaten.get(address) ?? 0) + 1)
}

export function noteHumanEaten(killer: string, victim: string) {
  if (!forgePingsOn) return
  if (!killer || !victim) return
  if (killer === victim) return
  if (isBot(killer) || isBot(victim)) return
  humansEaten.set(killer, (humansEaten.get(killer) ?? 0) + 1)
}

export function reportForgeLeave(address: string) {
  const food = foodEaten.get(address) ?? 0
  const humans = humansEaten.get(address) ?? 0
  foodEaten.delete(address)
  humansEaten.delete(address)
  if (!forgePingsOn) return
  if (food <= 0 && humans <= 0) return
  if (!forgeReady()) {
    if (!warnedMissing) {
      warnedMissing = true
      logEvent('forge.skip', { reason: 'not configured', food, humans })
    }
    return
  }
  void pingForge(address, food, humans)
}

async function pingForge(address: string, food: number, humans: number) {
  const variables: Record<string, number> = {}
  if (FORGE_FOOD_VAR_ID && food > 0) variables[FORGE_FOOD_VAR_ID] = food
  if (FORGE_HUMANS_VAR_ID && humans > 0) variables[FORGE_HUMANS_VAR_ID] = humans
  if (Object.keys(variables).length === 0) return

  logEvent('forge.leave', { address, food, humans })
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${FORGE_SERVER_TOKEN}`
    }
    if (FORGE_VERSE_ID) headers['X-Verse-ID'] = FORGE_VERSE_ID
    const res = await fetch(`${FORGE_URL}/api/server/action`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        wallet: address.toLowerCase(),
        actionId: FORGE_ACTION_ID,
        data: { variables }
      })
    })
    const body = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string; queueId?: string }
    if (!res.ok || body.success === false) {
      logEvent('forge.leave.fail', {
        address,
        status: res.status,
        error: body.error || `http ${res.status}`
      })
      return
    }
    logEvent('forge.leave.ok', { address, food, humans, queueId: body.queueId ?? '' })
  } catch (e) {
    logEvent('forge.leave.fail', { address, error: String(e) })
  }
}
