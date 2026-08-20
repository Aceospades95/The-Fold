export type ThemeMode = 'light' | 'dark' | 'system' | 'auto'
export type ThemeAccent = 'violet' | 'indigo' | 'sky' | 'teal' | 'emerald' | 'amber' | 'rose' | 'graphite'

export interface ThemePref {
  mode: ThemeMode
  accent: ThemeAccent
}

export const ACCENTS: { value: ThemeAccent; label: string; swatch: string }[] = [
  { value: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { value: 'indigo', label: 'Indigo', swatch: '#4f46e5' },
  { value: 'sky', label: 'Sky', swatch: '#0284c7' },
  { value: 'teal', label: 'Teal', swatch: '#0d9488' },
  { value: 'emerald', label: 'Emerald', swatch: '#059669' },
  { value: 'amber', label: 'Amber', swatch: '#d97706' },
  { value: 'rose', label: 'Rose', swatch: '#e11d48' },
  { value: 'graphite', label: 'Graphite', swatch: '#475569' },
]

const MODES: ThemeMode[] = ['light', 'dark', 'system', 'auto']
const KEY = 'fold-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

/** Auto mode follows the clock: roughly daylight hours get the light theme. */
function isDaytime(): boolean {
  const hour = new Date().getHours()
  return hour >= 7 && hour < 19
}

export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') return media.matches ? 'dark' : 'light'
  if (mode === 'auto') return isDaytime() ? 'light' : 'dark'
  return mode
}

export function loadTheme(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemePref>
      return {
        mode: MODES.includes(parsed.mode as ThemeMode) ? (parsed.mode as ThemeMode) : 'system',
        accent: ACCENTS.some((a) => a.value === parsed.accent) ? (parsed.accent as ThemeAccent) : 'violet',
      }
    }
  } catch {
    // fall through to default
  }
  return { mode: 'system', accent: 'violet' }
}

export function applyTheme(pref: ThemePref): void {
  const resolved = resolveMode(pref.mode)
  const root = document.documentElement
  root.dataset.mode = resolved
  root.dataset.accent = pref.accent
  root.style.colorScheme = resolved
  localStorage.setItem(KEY, JSON.stringify(pref))
}

export function initTheme(): void {
  applyTheme(loadTheme())
  media.addEventListener('change', () => {
    const pref = loadTheme()
    if (pref.mode === 'system') applyTheme(pref)
  })
  // Auto mode re-resolves as the day turns; a minute tick catches dusk & dawn.
  setInterval(() => {
    const pref = loadTheme()
    if (pref.mode === 'auto') applyTheme(pref)
  }, 60_000)
}
