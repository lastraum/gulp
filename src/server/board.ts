import { Storage } from '@dcl/sdk/server'
import { isBot } from '../shared/config'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'

export type BoardRow = { address: string; name: string; best: number }

const KEY = 'allTimeBoard'
const KEEP = 50
const SHOW = 5

let board: BoardRow[] = []
let saveTimer: number | null = null
const names = new Map<string, string>()

function looksLikeId(name: string, address: string): boolean {
  const n = name.trim()
  if (!n) return true
  const addr = address.trim().toLowerCase()
  if (n.toLowerCase() === addr) return true
  if (n.startsWith('0x') && n.length >= 10) return true
  if (addr.length >= 8 && n.length <= 14 && addr.includes(n.toLowerCase())) return true
  if (/^(?=.*[0-9])(?=.*[A-Za-z])[A-Za-z0-9]{8,14}$/.test(n)) return true
  if (/[0-9]/.test(n) && /^[A-Za-z0-9]{6,12}\s+[A-Za-z0-9]{2,14}$/.test(n)) return true
  return false
}

export function rememberName(address: string, name: string) {
  const n = name.trim()
  if (!n || looksLikeId(n, address)) return
  const key = address.toLowerCase()
  names.set(key, n)
  names.set(address, n)
  for (const row of board) {
    if (row.address === key) row.name = n
  }
  for (const row of foodBoard) {
    if (row.address === key) row.name = n
  }
  for (const row of humansBoard) {
    if (row.address === key) row.name = n
  }
}

export function displayName(address: string): string {
  return names.get(address) || shortName(address)
}

function shortName(address: string): string {
  if (address.length < 12) return address
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

export function boardPayload(): { rows: BoardRow[] } {
  return { rows: board.slice(0, SHOW) }
}

export function sendBoard(to?: string) {
  const payload = boardPayload()
  if (to) room.send('leaderboard', payload, { to: [to] })
  else room.send('leaderboard', payload)
}

export async function loadBoard() {
  try {
    Storage.configure({ skipIfUnchanged: true, cacheReads: true })
    const rows = await Storage.get<BoardRow[]>(KEY)
    if (Array.isArray(rows)) {
      board = rows
        .filter((r) => r && typeof r.address === 'string' && typeof r.best === 'number')
        .map((r) => ({
          address: r.address.toLowerCase(),
          name: r.name || shortName(r.address),
          best: r.best
        }))
        .sort((a, b) => b.best - a.best)
        .slice(0, KEEP)
    }
    logEvent('board.load', { count: board.length })
    sendBoard()
    await loadStats()
  } catch (e) {
    logEvent('board.load.fail', { error: String(e) })
  }
}

export async function resetBoard() {
  board = []
  foodBoard = []
  humansBoard = []
  sendBoard()
  sendStats()
  logEvent('board.reset', {})
  try {
    await persist()
    await persistStats()
  } catch (e) {
    logEvent('board.reset.fail', { error: String(e) })
  }
}

export function recordBest(address: string, mass: number) {
  if (!address || !(mass > 0)) return
  const key = address.toLowerCase()
  const name = displayName(key)
  const row = board.find((r) => r.address === key)
  if (row) {
    let changed = false
    if (mass > row.best + 0.01) {
      row.best = mass
      changed = true
    }
    if (name && name !== row.name) {
      row.name = name
      changed = true
    }
    if (!changed) return
  } else {
    board.push({ address: key, name, best: mass })
  }
  board.sort((a, b) => b.best - a.best)
  if (board.length > KEEP) board = board.slice(0, KEEP)
  sendBoard()
  queueSave()
}

function queueSave() {
  if (saveTimer !== null) return
  saveTimer = setTimeout(() => {
    saveTimer = null
    void persist()
  }, 500) as unknown as number
}

async function persist() {
  try {
    await Storage.set(KEY, board)
    for (const row of board.slice(0, SHOW)) {
      await Storage.player.set(row.address, 'bestMass', row.best)
    }
    logEvent('board.save', { count: board.length, top: board[0]?.best ?? 0 })
  } catch (e) {
    logEvent('board.save.fail', { error: String(e) })
  }
}


export type StatRow = { address: string; name: string; count: number }

const FOOD_KEY = 'allTimeFood'
const HUMANS_KEY = 'allTimeHumans'
const STAT_KEEP = 50
const STAT_SHOW = 8

let foodBoard: StatRow[] = []
let humansBoard: StatRow[] = []
let statsSendTimer: number | null = null
let statsSaveTimer: number | null = null

function parseStats(rows: unknown): StatRow[] {
  if (!Array.isArray(rows)) return []
  return rows
    .filter((r) => r && typeof r.address === 'string' && typeof r.count === 'number' && r.count > 0)
    .map((r) => ({
      address: String(r.address).toLowerCase(),
      name: String(r.name || shortName(String(r.address))),
      count: Math.floor(r.count)
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, STAT_KEEP)
}

async function loadStats() {
  try {
    const food = await Storage.get<StatRow[]>(FOOD_KEY)
    const humans = await Storage.get<StatRow[]>(HUMANS_KEY)
    foodBoard = parseStats(food)
    humansBoard = parseStats(humans)
    logEvent('stats.load', { food: foodBoard.length, humans: humansBoard.length })
    sendStats()
  } catch (e) {
    logEvent('stats.load.fail', { error: String(e) })
  }
}

function bumpStat(list: StatRow[], address: string): StatRow[] {
  const key = address.toLowerCase()
  const name = displayName(key)
  const row = list.find((r) => r.address === key)
  if (row) {
    row.count += 1
    if (name && name !== row.name) row.name = name
  } else {
    list.push({ address: key, name, count: 1 })
  }
  list.sort((a, b) => b.count - a.count)
  if (list.length > STAT_KEEP) return list.slice(0, STAT_KEEP)
  return list
}

export function recordFood(address: string) {
  if (!address || isBot(address)) return
  foodBoard = bumpStat(foodBoard, address)
  queueStatsFlush()
}

export function recordHuman(killer: string, victim?: string) {
  if (!killer || isBot(killer)) return
  if (victim && (killer === victim || isBot(victim))) return
  humansBoard = bumpStat(humansBoard, killer)
  queueStatsFlush()
}

export function sendStats(to?: string) {
  const payload = {
    food: foodBoard.slice(0, STAT_SHOW),
    humans: humansBoard.slice(0, STAT_SHOW)
  }
  if (to) room.send('statsBoard', payload, { to: [to] })
  else room.send('statsBoard', payload)
}

function queueStatsFlush() {
  if (statsSendTimer === null) {
    statsSendTimer = setTimeout(() => {
      statsSendTimer = null
      sendStats()
    }, 400) as unknown as number
  }
  if (statsSaveTimer === null) {
    statsSaveTimer = setTimeout(() => {
      statsSaveTimer = null
      void persistStats()
    }, 2000) as unknown as number
  }
}

async function persistStats() {
  try {
    await Storage.set(FOOD_KEY, foodBoard)
    await Storage.set(HUMANS_KEY, humansBoard)
    logEvent('stats.save', { food: foodBoard[0]?.count ?? 0, humans: humansBoard[0]?.count ?? 0 })
  } catch (e) {
    logEvent('stats.save.fail', { error: String(e) })
  }
}
