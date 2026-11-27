import { MAX_NOTES } from '../utils/constants.ts'

// Separate coincident meshes by a thin layer so WebGL depth and ray intersections agree.
export const noteLayerDepth = (index: number) => 0.024 + index * 0.001
export const DRAG_NOTE_DEPTH = noteLayerDepth(MAX_NOTES) + 0.015
export const NOTE_CONTACT_DEPTH = 0.008

// The photo camera is orthographic and square to the wall. Give each sheet
// enough depth to contain its entire curl without moving its projected footprint.
const PHOTO_LAYER_GAP = 0.15

export function photoNoteLayerDepth(index: number, foreground: boolean) {
  const layer = foreground ? MAX_NOTES : index
  return noteLayerDepth(0) + layer * PHOTO_LAYER_GAP
}

// Keep selection targets nearer than even a curled sheet during pickup.
export const NOTE_HANDLE_OFFSET = 0.22
