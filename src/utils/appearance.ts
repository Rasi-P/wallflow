import type { EnvironmentAmbience, EnvironmentTheme, NewNoteSize, NoteDefaults, NoteTypography, WallAppearance, WallShade } from '../types/wall.ts'
import { NOTE_COLORS } from './constants.ts'
import { readPhotoWorkspace } from './photoWorkspaces.ts'

const WALL_SHADES: Record<WallShade, string> = {
  theme: 'Theme shade', chalk: 'Soft chalk', ivory: 'Warm ivory', mist: 'Cool mist',
}

const AMBIENCE_OPTIONS: Record<EnvironmentAmbience, string> = {
  theme: 'Theme balance', quiet: 'Quiet', airy: 'Airy',
}

export const NOTE_SIZE_SCALES: Record<NewNoteSize, number> = { compact: 0.78, standard: 1, large: 1.3 }
export const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"'
export const NOTE_BODY_FONT = `"DM Sans", ${EMOJI_FONTS}, sans-serif`
export const NOTE_TITLE_FONTS: Record<NoteTypography, string> = {
  handwritten: `"Noteworthy", "Segoe Print", "Bradley Hand", ${NOTE_BODY_FONT}`,
  sans: NOTE_BODY_FONT,
}

const persistedThemes: readonly EnvironmentTheme[] = ['minimal', 'office', 'study', 'studio', 'lab']

export const MIN_LIGHT_INTENSITY = 85
export const MAX_LIGHT_INTENSITY = 115
const LIGHT_INTENSITY_STEP = 5
export const DEFAULT_APPEARANCE: WallAppearance = { theme: 'minimal', shade: 'theme', intensity: 100, ambience: 'theme' }
export const DEFAULT_NOTE_PREFERENCES: NoteDefaults = { color: 'yellow', typography: 'handwritten', size: 'standard', rotation: 'varied' }

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hasChoice<T extends string>(choices: Record<T, unknown>, value: unknown): value is T {
  return typeof value === 'string' && Object.hasOwn(choices, value)
}

export function isNoteTypography(value: unknown): value is NoteTypography {
  return hasChoice(NOTE_TITLE_FONTS, value)
}

export function readWallAppearance(value: unknown): WallAppearance {
  const saved = readRecord(value)
  const { theme, shade, intensity, ambience } = saved
  const photoWorkspace = readPhotoWorkspace(saved.photoWorkspace)
  return {
    ...(photoWorkspace !== 'professor' && { photoWorkspace }),
    theme: persistedThemes.find((entry) => entry === theme) ?? DEFAULT_APPEARANCE.theme,
    shade: hasChoice(WALL_SHADES, shade) ? shade : DEFAULT_APPEARANCE.shade,
    intensity: typeof intensity === 'number' && Number.isFinite(intensity)
      ? Math.max(MIN_LIGHT_INTENSITY, Math.min(MAX_LIGHT_INTENSITY, Math.round(intensity / LIGHT_INTENSITY_STEP) * LIGHT_INTENSITY_STEP))
      : DEFAULT_APPEARANCE.intensity,
    ambience: hasChoice(AMBIENCE_OPTIONS, ambience) ? ambience : DEFAULT_APPEARANCE.ambience,
  }
}

export function readNoteDefaults(value: unknown): NoteDefaults {
  const { color, typography, size, rotation } = readRecord(value)
  return {
    color: hasChoice(NOTE_COLORS, color) ? color : DEFAULT_NOTE_PREFERENCES.color,
    typography: isNoteTypography(typography) ? typography : DEFAULT_NOTE_PREFERENCES.typography,
    size: hasChoice(NOTE_SIZE_SCALES, size) ? size : DEFAULT_NOTE_PREFERENCES.size,
    rotation: rotation === 'straight' || rotation === 'varied' ? rotation : DEFAULT_NOTE_PREFERENCES.rotation,
  }
}
