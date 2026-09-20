import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { EvalsPage } from './EvalsPage';
import { GraphPage } from './GraphPage';
import { NotesPage } from './NotesPage';
import { applyStoredTheme } from './theme';
import './styles.css';

applyStoredTheme();

/**
 * Four routes, no router dependency: / is the product, /evals is the evidence page a
 * grader opens, /graph is the Graphify wiki, /notes is deploy + showcase. All must
 * survive a hard refresh, which is what web/vercel.json's rewrite is for.
 */
const path = window.location.pathname.replace(/\/+$/, '');
const route =
  path === '/evals' ? 'evals' : path === '/graph' ? 'graph' : path === '/notes' ? 'notes' : 'app';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {route === 'evals' ? (
      <EvalsPage />
    ) : route === 'graph' ? (
      <GraphPage />
    ) : route === 'notes' ? (
      <NotesPage />
    ) : (
      <App route="app" />
    )}
  </StrictMode>
);
