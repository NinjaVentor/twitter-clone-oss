import { create } from 'zustand'

export type ThemeName = 'default' | 'dim' | 'lights-out'

export interface AccentOption {
  name: string
  color: string
  hover: string
}

export const ACCENTS: AccentOption[] = [
  { name: 'Blue', color: '#1d9bf0', hover: '#1a8cd8' },
  { name: 'Yellow', color: '#ffd400', hover: '#d9b400' },
  { name: 'Pink', color: '#f91880', hover: '#e01674' },
  { name: 'Purple', color: '#7856ff', hover: '#6a45e0' },
  { name: 'Orange', color: '#ff7a00', hover: '#e66e00' },
  { name: 'Green', color: '#00ba7c', hover: '#00a56e' },
]

export const FONT_SIZES = [13, 14, 15, 16, 18]
export const DEFAULT_FONT_SIZE = 15

const THEME_KEY = 'twitter.theme'
const ACCENT_KEY = 'twitter.accent'
const FONT_KEY = 'twitter.font-size'
const LEGACY_THEME_KEY = 'x-theme'

interface ThemeState {
  theme: ThemeName
  accent: string
  accentHover: string
  fontSize: number
  displayOpen: boolean
  setTheme: (t: ThemeName) => void
  setAccent: (color: string, hover: string) => void
  setFontSize: (n: number) => void
  setDisplayOpen: (open: boolean) => void
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* private mode — preferences simply won't persist */
  }
}

export function applyThemeVars(theme: ThemeName, accent: string, hover: string, fontSize: number) {
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.setProperty('--accent-color', accent)
  root.style.setProperty('--accent-hover', hover)
  root.style.fontSize = `${fontSize}px`
}

function migrateLegacyTheme(): ThemeName {
  const legacy = readStorage(LEGACY_THEME_KEY)
  if (legacy === 'dim') return 'dim'
  if (legacy === 'light') return 'default'
  if (legacy === 'dark') return 'lights-out'
  const stored = readStorage(THEME_KEY)
  if (stored === 'default' || stored === 'dim' || stored === 'lights-out') return stored
  return 'lights-out'
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  theme: 'lights-out',
  accent: ACCENTS[0].color,
  accentHover: ACCENTS[0].hover,
  fontSize: DEFAULT_FONT_SIZE,
  displayOpen: false,
  setTheme: (theme) => {
    writeStorage(THEME_KEY, theme)
    const s = get()
    applyThemeVars(theme, s.accent, s.accentHover, s.fontSize)
    set({ theme })
  },
  setAccent: (accent, accentHover) => {
    writeStorage(ACCENT_KEY, `${accent}|${accentHover}`)
    const s = get()
    applyThemeVars(s.theme, accent, accentHover, s.fontSize)
    set({ accent, accentHover })
  },
  setFontSize: (fontSize) => {
    writeStorage(FONT_KEY, String(fontSize))
    const s = get()
    applyThemeVars(s.theme, s.accent, s.accentHover, fontSize)
    set({ fontSize })
  },
  setDisplayOpen: (displayOpen) => set({ displayOpen }),
}))

export function initTheme() {
  const theme = migrateLegacyTheme()
  let accent = ACCENTS[0].color
  let hover = ACCENTS[0].hover
  const storedAccent = readStorage(ACCENT_KEY)
  if (storedAccent) {
    const found = ACCENTS.find((a) => `${a.color}|${a.hover}` === storedAccent)
    if (found) {
      accent = found.color
      hover = found.hover
    }
  }
  const storedSize = Number(readStorage(FONT_KEY))
  const fontSize = FONT_SIZES.includes(storedSize) ? storedSize : DEFAULT_FONT_SIZE
  applyThemeVars(theme, accent, hover, fontSize)
  useThemeStore.setState({ theme, accent, accentHover: hover, fontSize })
}
