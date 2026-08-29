const CATALYST = 'https://peer.decentraland.org'
const faces = new Map<string, string | null>()
const pending = new Set<string>()

function keyOf(address: string): string {
  return address.trim().toLowerCase()
}

function resolveFace(raw: unknown): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (v.startsWith('http://') || v.startsWith('https://')) return v
  return `https://profile-images.decentraland.org/entities/${v}/face.png`
}

function faceFromProfile(data: unknown, wallet: string): string | null {
  const profiles = Array.isArray(data) ? data : data ? [data] : []
  const profile = profiles[0] as { avatars?: any[] } | undefined
  const avatars = profile?.avatars
  if (!Array.isArray(avatars) || avatars.length === 0) return null
  const want = keyOf(wallet)
  const deployed =
    avatars.find((entry) => keyOf(String(entry?.userId ?? entry?.ethAddress ?? '')) === want) ??
    avatars.find((entry) => entry?.avatar) ??
    avatars[0]
  return resolveFace(deployed?.avatar?.snapshots?.face256)
}

export function catalystFaceUrl(address: string): string | null {
  const key = keyOf(address)
  if (!key) return null
  return faces.get(key) ?? null
}

export function requestCatalystFaces(addresses: string[]) {
  const need: string[] = []
  for (const address of addresses) {
    const key = keyOf(address)
    if (!key) continue
    if (key.startsWith('bot:')) continue
    if (faces.has(key) || pending.has(key)) continue
    pending.add(key)
    need.push(key)
  }
  if (need.length === 0) return
  void loadFaces(need)
}

async function loadFaces(ids: string[]) {
  try {
    const res = await fetch(`${CATALYST}/lambdas/profiles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ ids })
    })
    if (!res.ok) throw new Error(`profiles ${res.status}`)
    const data = await res.json()
    const profiles = Array.isArray(data) ? data : []
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const row = profiles[i]
      faces.set(id, row ? faceFromProfile(row, id) : null)
      pending.delete(id)
    }
  } catch {
    for (const id of ids) {
      if (!faces.has(id)) faces.set(id, null)
      pending.delete(id)
    }
  }
}
