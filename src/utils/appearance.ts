import type { EnvironmentAmbience, EnvironmentTheme, Lighting, NewNoteSize, NoteDefaults, NoteTypography, WallAppearance, WallShade } from '../types/wall.ts'
import { NOTE_COLORS } from './constants.ts'
import { readPhotoWorkspace } from './photoWorkspaces.ts'

export const WALL_SHADES: Record<WallShade, string> = {
  theme: 'Theme shade', chalk: 'Soft chalk', ivory: 'Warm ivory', mist: 'Cool mist',
}

export const AMBIENCE_OPTIONS: Record<EnvironmentAmbience, string> = {
  theme: 'Theme balance', quiet: 'Quiet', airy: 'Airy',
}

export const NOTE_SIZE_SCALES: Record<NewNoteSize, number> = { compact: 0.78, standard: 1, large: 1.3 }
export const EMOJI_FONTS = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", "Twemoji Mozilla"'
export const NOTE_BODY_FONT = `"DM Sans", ${EMOJI_FONTS}, sans-serif`
export const NOTE_TITLE_FONTS: Record<NoteTypography, string> = {
  handwritten: `"Noteworthy", "Segoe Print", "Bradley Hand", ${NOTE_BODY_FONT}`,
  sans: NOTE_BODY_FONT,
}

const MINIMAL = {
  name: 'Personal Study Room',
  background: '#efeeea',
  wall: '#f6eee2',
  ambientColor: '#fffdfa',
  sky: '#fffdf8',
  ground: '#c1b9aa',
  keyColor: '#fff9ed',
  fillColor: '#e1e9fa',
  ambient: 0.72,
  hemisphere: 1.05,
  key: 2.35,
  fill: 0.28,
  windowTint: '#ffffff',
  windowOpacity: 1,
  trim: null,
} as const

type ThemePreset = {
  [Key in keyof typeof MINIMAL]: Key extends 'trim'
    ? string | null
    : (typeof MINIMAL)[Key] extends string ? string : number
}

export const THEME_PRESETS: Record<EnvironmentTheme, ThemePreset> = {
  minimal: MINIMAL,
  office: {
    ...MINIMAL, name: 'Office Whiteboard', background: '#e1e5e7', wall: '#f7f8f7',
    ambientColor: '#faf8f4', sky: '#f3f8ff', ground: '#d9d4cb', keyColor: '#fcfdff',
    fillColor: '#f8f5ee', ambient: 0.42, hemisphere: 0.98, key: 2.04, fill: 0.29,
    trim: '#515452',
  },
  study: {
    ...MINIMAL, name: "Professor's Study", background: '#e9dfce', wall: '#f5ead6',
    ambientColor: '#ffefd5', sky: '#ffefd8', ground: '#b3a08a', keyColor: '#ffe4ba',
    fillColor: '#e9d9c3', ambient: 0.7, hemisphere: 0.99, key: 2.22, fill: 0.31,
    windowTint: '#e7cbab', windowOpacity: 1, trim: '#9e7355',
  },
  studio: {
    ...MINIMAL, name: 'Creative Studio', background: '#eee9f2', wall: '#f6eff6',
    ambientColor: '#fff8fb', sky: '#eff4ff', ground: '#d1bfcf', keyColor: '#fffbf0',
    fillColor: '#e5eaff', ambient: 0.8, hemisphere: 1.12, key: 2.48, fill: 0.34,
    windowTint: '#ede1fc', windowOpacity: 0.64, trim: '#b199bb',
  },
  lab: {
    ...MINIMAL, name: "Scientist's Lab", background: '#e8edf1', wall: '#f5f8fa',
    ambientColor: '#f3faff', sky: '#eef7ff', ground: '#b5c0c9', keyColor: '#f2f8ff',
    fillColor: '#d3e5fa', ambient: 0.76, key: 2.3, fill: 0.38,
    windowTint: '#dfeafe', windowOpacity: 0.48, trim: '#8fa6b5',
  },
}

const shadeColors = { chalk: '#f8f6f0', ivory: '#f4e9d7', mist: '#eef3f5' } as const
const ambienceStrength = { theme: 1, quiet: 0.82, airy: 1.13 } as const
const windowStrength = { theme: 1, quiet: 0.55, airy: 0.78 } as const

export const MIN_LIGHT_INTENSITY = 85
export const MAX_LIGHT_INTENSITY = 115
export const LIGHT_INTENSITY_STEP = 5
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
    theme: hasChoice(THEME_PRESETS, theme) ? theme : DEFAULT_APPEARANCE.theme,
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

export function wallFinish(appearance: WallAppearance) {
  const preset = THEME_PRESETS[appearance.theme]
  return {
    color: appearance.shade === 'theme' ? preset.wall : shadeColors[appearance.shade],
    windowTint: preset.windowTint,
    windowOpacity: preset.windowOpacity * windowStrength[appearance.ambience],
  }
}

export function environmentLighting(appearance: WallAppearance, lighting: Lighting) {
  const preset = THEME_PRESETS[appearance.theme]
  const intensity = appearance.intensity / 100
  const ambience = ambienceStrength[appearance.ambience]
  const warm = lighting === 'warm'
  return {
    background: warm && appearance.theme === 'minimal' ? '#eee6da' : preset.background,
    ambientColor: warm ? '#ffe8ca' : preset.ambientColor,
    keyColor: warm ? '#ffdfac' : preset.keyColor,
    sky: preset.sky, ground: preset.ground, fillColor: preset.fillColor,
    ambient: preset.ambient * intensity * ambience,
    hemisphere: preset.hemisphere * intensity * ambience,
    key: preset.key * intensity,
    fill: preset.fill * intensity * ambience,
  }
}
