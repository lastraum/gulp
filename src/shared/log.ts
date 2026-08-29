export function logEvent(event: string, data: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: Date.now(), event, ...data }))
}
