import { PlayerIdentityData, engine } from '@dcl/sdk/ecs'

let localAddress = ''

export function setLocalAddress(address: string) {
  localAddress = normalizeAddr(address)
}

export function getLocalAddress(): string {
  if (localAddress) return localAddress
  const id = PlayerIdentityData.getOrNull(engine.PlayerEntity)
  if (id?.address) {
    localAddress = normalizeAddr(id.address)
    return localAddress
  }
  return localAddress
}

export function normalizeAddr(address: string): string {
  return address.toLowerCase()
}

export function isLocalAddr(address: string): boolean {
  const me = getLocalAddress()
  if (!me) return false
  return normalizeAddr(address) === me
}
