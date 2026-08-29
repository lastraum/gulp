const GM_ADDRESSES = new Set([
  '0xaabe0ecfaf9e028d63cf7ea7e772cf52d662691a'
])

function canon(address: string): string {
  const a = address.toLowerCase().trim()
  const hex = a.startsWith('0x') ? a.slice(2) : a
  return hex.length >= 40 ? `0x${hex.slice(-40)}` : a
}

export function isGm(address: string | undefined | null): boolean {
  if (!address) return false
  const a = canon(address)
  if (GM_ADDRESSES.has(a)) return true
  for (const g of GM_ADDRESSES) {
    if (a.endsWith(g.slice(2)) || g.endsWith(a.replace(/^0x/, ''))) return true
  }
  return false
}
