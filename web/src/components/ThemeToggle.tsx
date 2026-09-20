import { useEffect, useState } from 'react';
import { applyStoredTheme, setTheme, type Theme } from '../theme';

export function ThemeToggle() {
  const [theme, setThemeState] = useState<Theme>(() => applyStoredTheme());

  useEffect(() => {
    setTheme(theme);
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      <button
        type="button"
        className={theme === 'light' ? 'on' : undefined}
        aria-pressed={theme === 'light'}
        onClick={() => setThemeState('light')}
      >
        Light
      </button>
      <button
        type="button"
        className={theme === 'dark' ? 'on' : undefined}
        aria-pressed={theme === 'dark'}
        onClick={() => setThemeState('dark')}
      >
        Dark
      </button>
    </div>
  );
}
