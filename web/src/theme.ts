export type ThemeMode = 'light' | 'dark' | 'system'
export type ThemeAccent = 'violet' | 'emerald' | 'rose' | 'sky' | 'amber'

export interface ThemePref {
  mode: ThemeMode
  accent: ThemeAccent
}

export const ACCENTS: { value: ThemeAccent; label: string; swatch: string }[] = [
  { value: 'violet', label: 'Violet', swatch: '#7c3aed' },
  { value: 'emerald', label: 'Emerald', swatch: '#059669' },
  { value: 'rose', label: 'Rose', swatch: '#e11d48' },
  { value: 'sky', label: 'Sky', swatch: '#0284c7' },
  { value: 'amber', label: 'Amber', swatch: '#d97706' },
]

const KEY = 'fold-theme'
const media = window.matchMedia('(prefers-color-scheme: dark)')

export function loadTheme(): ThemePref {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemePref>
      return {
        mode: parsed.mode === 'dark' || parsed.mode === 'system' ? parsed.mode : parsed.mode === 'light' ? 'light' : 'system',
        accent: ACCENTS.some((a) => a.value === parsed.accent) ? (parsed.accent as ThemeAccent) : 'violet',
      }
    }
  } catch {
    // fall through to default
  }
  return { mode: 'system', accent: 'violet' }
}

export function applyTheme(pref: ThemePref): void {
  const resolved = pref.mode === 'system' ? (media.matches ? 'dark' : 'light') : pref.mode
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
}
