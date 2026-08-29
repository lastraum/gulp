let fwdX = 0
let fwdZ = 1

export function setCamFlatForward(x: number, z: number) {
  const len = Math.hypot(x, z)
  if (len < 0.001) return
  fwdX = x / len
  fwdZ = z / len
}

export function getCamFlatForward(): { x: number; z: number } {
  return { x: fwdX, z: fwdZ }
}
