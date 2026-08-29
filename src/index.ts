import { isServer } from '@dcl/sdk/network'
import { initClient } from './client/setup'
import { initServer } from './server/server'
import './shared/messages'

export function main() {
  if (isServer()) {
    initServer()
    return
  }
  void initClient()
}
