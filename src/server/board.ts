import { Storage } from '@dcl/sdk/server'
import { logEvent } from '../shared/log'
import { room } from '../shared/messages'

export type BoardRow = { address: string; name: string; best: number }

const KEY = 'allTimeBoard'
const KEEP = 50
const SHOW = 5

let board: BoardRow[] = []
let saveTimer: number | null = null
const names = new Map<string, string>()

export function rememberName(address: string, name: string) {
  const n = name.trim()
  if (n) names.set(address, n)
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
  } catch (e) {
    logEvent('board.load.fail', { error: String(e) })
  }
}

export async function resetBoard() {
  board = []
  sendBoard()
  logEvent('board.reset', {})
  try {
    await persist()
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
