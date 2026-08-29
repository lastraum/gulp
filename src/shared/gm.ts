const GM_OPEN = true

const GM_ADDRESSES = new Set([
  '0xaabe0ecfaf9e028d63cf7ea7e772cf52d662691a'
])

export function isGm(address: string | undefined | null): boolean {
  if (GM_OPEN) return true
  if (!address) return false
  return GM_ADDRESSES.has(address.toLowerCase())
}
