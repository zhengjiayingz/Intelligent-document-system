export const DEFAULT_NOTE_COLOR = '#FFD666'

export const NOTE_COLOR_PRESETS = [
  '#FFD666',
  '#A8E6A1',
  '#9EC9FF',
  '#FFB3C6',
  '#FFC58A',
] as const

const COLOR_RE = /^#[0-9A-Fa-f]{6}$/

export function isValidNoteColor(value: string): boolean {
  return COLOR_RE.test(value)
}

export function normalizeNoteColor(value: string | null | undefined): string {
  if (value == null || value === '' || !isValidNoteColor(value)) return DEFAULT_NOTE_COLOR
  return value.toUpperCase()
}

/** 高亮叠色：约 32% 不透明度，色块可见且正文不易发灰 */
export function noteColorToOverlay(color: string): string {
  const hex = normalizeNoteColor(color).slice(1)
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, 0.32)`
}
