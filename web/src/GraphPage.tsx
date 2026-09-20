import { useEffect, useRef } from 'react';
import { AppNav } from './components/AppNav';
import { ThemeToggle } from './components/ThemeToggle';

export function GraphPage() {
  const frame = useRef<HTMLIFrameElement>(null);

  const pushTheme = (reload = false) => {
    const theme =
      document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    frame.current?.contentWindow?.postMessage(
      { type: 'lumina-theme', theme, reload },
      window.location.origin
    );
    const doc = frame.current?.contentDocument;
    if (doc?.documentElement) doc.documentElement.setAttribute('data-theme', theme);
  };

  useEffect(() => {
    let last = document.documentElement.getAttribute('data-theme');
    const mo = new MutationObserver(() => {
      const now = document.documentElement.getAttribute('data-theme');
      if (now === last) return;
      last = now;
      pushTheme(true);
    });
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => mo.disconnect();
  }, []);

  return (
    <>
      <header className="topbar">
        <div className="brand">
          LUM<span>INA</span>
        </div>
        <AppNav active="graph" />
        <ThemeToggle />
      </header>
      <iframe
        ref={frame}
        className="graph-frame"
        title="Graphify knowledge"
        src="/knowledge/app.html"
        onLoad={() => pushTheme(false)}
      />
    </>
  );
}
