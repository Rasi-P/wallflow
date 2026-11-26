import { OFFICE_KEY_POSITION } from './officeWhiteboardLayout.ts'

export function officeSunPosition(seconds: number): [number, number, number] {
  const [x, y, z] = OFFICE_KEY_POSITION
  return [
    x,
    y + 0.66 * Math.sin(seconds * Math.PI * 2 / 235),
    z + 0.74 * Math.sin(seconds * Math.PI * 2 / 307),
  ]
}
