import { AppNav } from './components/AppNav';
import { ThemeToggle } from './components/ThemeToggle';

const VERCEL = 'https://lumina-ui-eight.vercel.app';
const GATEWAY = 'https://gateway-production-9ac0.up.railway.app';

export function NotesPage() {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          LUM<span>INA</span>
        </div>
        <AppNav active="notes" />
        <ThemeToggle />
      </header>
      <div className="evals notes">
        <h1>Where this is deployed</h1>
        <p className="sub">Showcase notes for the live demo — what to open, what talks to what, what stays private.</p>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
            Live hosts
          </h2>
          <table className="notes-table">
            <thead>
              <tr>
                <th>Surface</th>
                <th>Where</th>
                <th>Why it is there</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Submission UI</td>
                <td>
                  <a href={VERCEL} target="_blank" rel="noreferrer">
                    {VERCEL}
                  </a>
                </td>
                <td>Vercel hosts the Vite SPA. This is the URL graders open. Hard refresh of /evals, /graph, /notes rewrites to index.html.</td>
              </tr>
              <tr>
                <td>Gateway (public API)</td>
                <td>
                  <a href={GATEWAY} target="_blank" rel="noreferrer">
                    {GATEWAY}
                  </a>
                </td>
                <td>Railway Express on :8787. Browser talks only here. Serves CORS, X-User-Id, rate limit, SSE, web/dist, /knowledge.</td>
              </tr>
              <tr>
                <td>Agent + worker</td>
                <td>Railway private (.railway.internal :8000)</td>
                <td>Not publicly reachable. Holds OpenAI / Tavily keys, runs the loop, jobs worker, Atlas writes.</td>
              </tr>
              <tr>
                <td>Data + vectors</td>
                <td>MongoDB Atlas</td>
                <td>threads, messages, memories, spaces, chunks, jobs, searchCache, GridFS. Vector indexes on chunks and memories.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
            Local (this machine)
          </h2>
          <table className="notes-table">
            <thead>
              <tr>
                <th>Process</th>
                <th>Port</th>
                <th>Open</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vite UI</td>
                <td>5173</td>
                <td>Dev only. Same SPA as production.</td>
              </tr>
              <tr>
                <td>Gateway</td>
                <td>8787</td>
                <td>
                  <a href="http://localhost:8787">http://localhost:8787</a> — Ask / Evals / Graph / Notes
                </td>
              </tr>
              <tr>
                <td>Agent</td>
                <td>8000</td>
                <td>Gateway proxies here. Do not point the browser at it.</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
            What to click on stage
          </h2>
          <div className="cards notes-cards">
            <div className="card">
              <h3>Ask</h3>
              <p>Streamed answer with citations. Quick stays on 8 tools / 90s. Deep runs plan_research first and is capped at 5/day per X-User-Id.</p>
            </div>
            <div className="card">
              <h3>Evals</h3>
              <p>
                Renders <code>GET /evals/report.json</code> only. Live Railway bench scored 85/100. Do not hand-edit the file.
              </p>
            </div>
            <div className="card">
              <h3>Graph</h3>
              <p>727-node Graphify wiki. Left nav stays mounted; only the right panel changes. Code tree, force graph, call flow.</p>
            </div>
            <div className="card">
              <h3>Health</h3>
              <p>
                <code>GET /health</code> names gpt-4o-mini · tavily · atlas-vector-search · db. Ask header shows it live.
              </p>
            </div>
          </div>
        </section>

        <section style={{ marginTop: 26 }}>
          <h2 style={{ fontSize: 12, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
            Red lines worth saying
          </h2>
          <ul className="notes-list">
            <li>The browser never holds provider keys or Mongo URIs. Those exist only in the agent .env.</li>
            <li>Vercel rewrites /health and /threads/* to the Railway gateway so the submission URL still lights up.</li>
            <li>A citation that was not retrieved in that request is an automatic fail. Empty retrieval cites nothing.</li>
            <li>Deep is never auto-upgraded. The server only runs plan_research when the client asked for depth=deep.</li>
            <li>Document upload returns 202 in under 300 ms; parsing happens on the worker, not in the HTTP handler.</li>
          </ul>
        </section>
      </div>
    </>
  );
}
