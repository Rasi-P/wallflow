import { MAX_NOTES } from '../utils/constants.ts'

// Separate coincident meshes by a thin layer so WebGL depth and ray intersections agree.
export const noteLayerDepth = (index: number) => 0.024 + index * 0.001
export const DRAG_NOTE_DEPTH = noteLayerDepth(MAX_NOTES) + 0.015
export const NOTE_CONTACT_DEPTH = 0.008
