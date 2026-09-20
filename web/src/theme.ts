export type Theme = 'light' | 'dark';

const KEY = 'lumina.theme';

function readStored(): Theme | null {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // private mode / blocked storage
  }
  return null;
}

export function getTheme(): Theme {
  const stored = readStored();
  if (stored) return stored;
  if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches) {
    return 'light';
  }
  return 'dark';
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // preference still applies for this session
  }
  document.documentElement.setAttribute('data-theme', theme);
}

export function applyStoredTheme(): Theme {
  const theme = getTheme();
  setTheme(theme);
  return theme;
}
