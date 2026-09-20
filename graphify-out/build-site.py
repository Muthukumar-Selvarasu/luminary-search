#!/usr/bin/env python3
"""Build a browsable static site from graphify wiki markdown."""
from __future__ import annotations

import html
import re
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
WIKI = ROOT / "wiki"
DEFAULT_OUTS = (ROOT / "site", ROOT.parent / "web" / "public" / "knowledge")


def inline_fmt(text: str) -> str:
    text = html.escape(text)
    text = re.sub(r"`([^`]+)`", r"<code>\1</code>", text)
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    return text


def md_inline(text: str) -> str:
    # Parse markdown links before html.escape so `&` in filenames is not
    # turned into `&amp;amp;` (Home → Web Ask Client was 404ing on that).
    out: list[str] = []
    last = 0
    for m in re.finditer(r"\[([^\]]+)\]\(([^)]+)\)", text):
        out.append(inline_fmt(text[last : m.start()]))
        out.append(f'<a href="{link_href(m.group(2))}">{html.escape(m.group(1))}</a>')
        last = m.end()
    out.append(inline_fmt(text[last:]))
    return "".join(out)


def link_href(target: str) -> str:
    target = target.strip()
    if target.startswith("http"):
        return html.escape(target)
    name = Path(target).name
    if name.endswith(".md"):
        stem = Path(name).stem
        name = "index.html" if stem == "index" else f"{stem}.html"
    return html.escape(name)


def md_to_html(src: str) -> str:
    lines = src.splitlines()
    out: list[str] = []
    in_list = False
    in_table = False
    table_rows: list[str] = []

    def close_list() -> None:
        nonlocal in_list
        if in_list:
            out.append("</ul>")
            in_list = False

    def flush_table() -> None:
        nonlocal in_table, table_rows
        if not table_rows:
            return
        cells = [split_row(r) for r in table_rows if not is_sep(r)]
        if not cells:
            table_rows = []
            in_table = False
            return
        head, *body = cells
        out.append('<table>')
        out.append("<thead><tr>" + "".join(f"<th>{md_inline(c)}</th>" for c in head) + "</tr></thead>")
        out.append("<tbody>")
        for row in body:
            out.append("<tr>" + "".join(f"<td>{md_inline(c)}</td>" for c in row) + "</tr>")
        out.append("</tbody></table>")
        table_rows = []
        in_table = False

    def split_row(row: str) -> list[str]:
        return [c.strip() for c in row.strip().strip("|").split("|")]

    def is_sep(row: str) -> bool:
        return bool(re.match(r"^\s*\|?\s*:?-{3,}", row))

    for raw in lines:
        s = raw.rstrip()
        if s.startswith("|"):
            close_list()
            in_table = True
            table_rows.append(s)
            continue
        if in_table:
            flush_table()
        if not s:
            close_list()
            continue
        if s.startswith("> "):
            close_list()
            out.append(f'<p class="lede">{md_inline(s[2:])}</p>')
            continue
        if s.startswith("### "):
            close_list()
            out.append(f"<h3>{md_inline(s[4:])}</h3>")
            continue
        if s.startswith("## "):
            close_list()
            out.append(f"<h2>{md_inline(s[3:])}</h2>")
            continue
        if s.startswith("# "):
            close_list()
            out.append(f"<h1>{md_inline(s[2:])}</h1>")
            continue
        if s.startswith("- "):
            if not in_list:
                out.append("<ul>")
                in_list = True
            out.append(f"<li>{md_inline(s[2:])}</li>")
            continue
        if s.strip() == "---":
            close_list()
            out.append("<hr>")
            continue
        close_list()
        out.append(f"<p>{md_inline(s)}</p>")
    close_list()
    flush_table()
    return "\n".join(out)


NAV = [
    ("Overview", [
        ("Home", "index.html"),
        ("Architecture", "architecture.html"),
        ("Code tree", "GRAPH_TREE.html"),
        ("Force graph", "graph.html"),
        ("Path", "path.html"),
        ("Call flow", "lumina-1-callflow.html"),
    ]),
    ("God nodes", [
        ("executeAsk()", "executeAsk.html"),
        ("db()", "db.html"),
        ("env", "env.html"),
        ("SseStream", "SseStream.html"),
        ("runRag()", "runRag.html"),
        ("ask()", "ask.html"),
    ]),
    ("Runtime", [
        ("Web ask client", "SSE_Streaming_&_Protocol.html"),
        ("Agent ask loop", "SSE_Streaming_&_Protocol_2.html"),
        ("Agent HTTP + Mongo", "SSE_Streaming_&_Protocol_3.html"),
        ("Gateway runtime", "Gateway_&_Edge_Proxy.html"),
        ("Fetch + Tavily", "Search_&_Cache_Engine.html"),
        ("Architecture concepts", "SSE_Streaming_&_Protocol_7.html"),
    ]),
    ("Contract", [
        ("HTTP schemas", "API_Contract_&_Schemas.html"),
        ("Persistence schemas", "API_Contract_&_Schemas_4.html"),
        ("Entity IDs", "API_Contract_&_Schemas_8.html"),
        ("SSE events", "SSE_Streaming_&_Protocol_5.html"),
    ]),
    ("Quality & deploy", [
        ("Benchmark SLA", "SSE_Streaming_&_Protocol_4.html"),
        ("Eval report", "Evaluation_&_Quality_Grader.html"),
        ("Quality rules", "Evaluation_&_Quality_Grader_2.html"),
        ("Cloud tokens", "Cloud_Deployment_&_Ops.html"),
    ]),
]


CSS = """
:root, [data-theme='dark'] {
  --bg: #0b0d10; --panel: #12151a; --border: #232a33;
  --text: #e7ecf2; --muted: #94a2b3; --accent: #5eead4;
  --hover: #1c222a; --code-bg: #0e1116; --code-ink: #f8fafc;
  color-scheme: dark;
}
[data-theme='light'] {
  --bg: #f3f5f8; --panel: #ffffff; --border: #d4dce5;
  --text: #12161c; --muted: #4a5868; --accent: #0f766e;
  --hover: #e4eaf0; --code-bg: #eef2f6; --code-ink: #12161c;
  color-scheme: light;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; background: var(--bg); color: var(--text);
  font: 15px/1.55 ui-sans-serif, system-ui, sans-serif; }
.layout { display: grid; grid-template-columns: 260px 1fr; min-height: 100%; }
aside { background: var(--panel); border-right: 1px solid var(--border);
  padding: 20px 16px; overflow: auto; position: sticky; top: 0; height: 100vh; }
aside h1 { font-size: 15px; margin: 0 0 4px; }
aside .meta { color: var(--muted); font-size: 12px; margin-bottom: 16px; }
#filter { width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 8px 10px; border-radius: 6px; margin-bottom: 16px; }
nav h2 { font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); margin: 16px 0 6px; }
nav a { display: block; color: var(--text); text-decoration: none; padding: 5px 8px;
  border-radius: 6px; font-size: 13px; }
nav a:hover, nav a.active { background: var(--hover); color: var(--accent); }
main:not(.viz) { padding: 32px 40px 64px; max-width: 880px; }
main:not(.viz) h1 { font-size: 28px; margin: 0 0 12px; }
main:not(.viz) h2 { font-size: 20px; margin: 32px 0 12px; border-bottom: 1px solid var(--border); padding-bottom: 6px; }
main:not(.viz) h3 { font-size: 16px; margin: 24px 0 8px; color: var(--accent); }
main:not(.viz) p, main:not(.viz) li { color: var(--muted); }
.lede { color: var(--text); background: var(--code-bg); border: 1px solid var(--border);
  padding: 10px 12px; border-radius: 8px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em;
  background: var(--code-bg); padding: 1px 5px; border-radius: 4px; color: var(--code-ink); }
a { color: var(--accent); }
table { width: 100%; border-collapse: collapse; margin: 12px 0 24px; font-size: 13px; }
th, td { border: 1px solid var(--border); padding: 8px 10px; text-align: left; vertical-align: top; }
th { color: var(--accent); background: var(--code-bg); }
.mermaid { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 16px; margin: 16px 0; }
.cards { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.card { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
.card h3 { margin-top: 0; }
.layout.viz, .layout.shell { height: 100%; }
main.viz, main.shell { padding: 0; max-width: none; height: 100%; overflow: hidden; }
iframe#article { display: block; width: 100%; height: 100%; border: 0; background: var(--bg); }
.viz-inner { height: 100%; min-height: 0; }
.viz-graph { display: flex; overflow: hidden; background: var(--bg); color: var(--text); height: 100%; }
.viz-graph #graph { flex: 1; min-width: 0; min-height: 0; height: 100%; background: var(--bg); }
.viz-graph #sidebar { background: var(--panel); border-left: 1px solid var(--border); color: var(--text); }
.viz-graph #search { background: var(--bg); color: var(--text); border-color: var(--border); }
.viz-graph #info-content, .viz-graph #stats, .viz-graph .legend-count { color: var(--muted); }
.viz-tree { overflow: auto; background: var(--bg); color: var(--text); }
.viz-tree h1 { color: var(--text) !important; margin: 16px 20px 0; }
.viz-tree .controls { margin: 12px 20px; }
.viz-tree button { background: var(--accent) !important; color: var(--bg) !important; }
.viz-tree #tree-container, .viz-tree svg { background: var(--panel) !important; border-color: var(--border) !important; }
.viz-tree .node text { stroke: var(--bg) !important; }
.viz-flow { overflow: auto; background: var(--bg); color: var(--text);
  --surface: var(--panel); --warn: #fbbf24; --err: #f87171; --ok: #34d399; }
[data-theme='light'] .viz-flow { --warn: #b45309; --err: #b91c1c; --ok: #047857; }
.viz-flow .nav { background: var(--bg) !important; border-color: var(--border) !important; }
.viz-flow .container { background: var(--bg); }
.viz-flow .mermaid { background: var(--panel) !important; border-color: var(--border) !important; }
.viz-flow .mermaid-toolbar { background: var(--panel) !important; border-color: var(--border) !important;
  box-shadow: none !important; }
.viz-flow .mermaid-toolbar button, .viz-flow .mermaid-toolbar .zoom-level {
  background: var(--bg) !important; color: var(--text) !important; border-color: var(--border) !important; }
.viz-flow .call-table th { background: var(--code-bg) !important; color: var(--accent) !important; }
.viz-flow .call-table tr:nth-child(even) { background: var(--hover) !important; }
.viz-flow .card { background: var(--panel) !important; border-color: var(--border) !important; }
.viz-flow code { background: var(--code-bg) !important; color: var(--code-ink) !important; }
.viz-flow h1 { background: none !important; -webkit-text-fill-color: unset !important; color: var(--text) !important; }
.aside-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.nav-toggle { display: none; }
@media (max-width: 640px) {
  .layout { grid-template-columns: 1fr; }
  .layout.shell { grid-template-rows: auto 1fr; height: 100%; }
  aside { position: relative; height: auto; max-height: none; overflow: visible;
    border-right: none; border-bottom: 1px solid var(--border); z-index: 4; }
  .aside-head { align-items: center; padding-bottom: 4px; }
  .aside-head .meta { margin-bottom: 0; }
  .nav-toggle { display: inline-flex; align-items: center; justify-content: center;
    flex-shrink: 0; background: var(--bg); color: var(--text); border: 1px solid var(--border);
    border-radius: 6px; padding: 8px 12px; font: 600 13px ui-sans-serif, system-ui, sans-serif; }
  aside:not(.open) .aside-body { display: none; }
  aside.open { position: absolute; left: 0; right: 0; top: 0; max-height: 80%;
    overflow: auto; box-shadow: 0 16px 40px rgba(0,0,0,.28); }
  main:not(.viz) { padding: 20px 16px 48px; }
  main.viz, main.shell { height: 100%; min-height: 0; }
  iframe#article { height: 100%; }
  .cards { grid-template-columns: 1fr; }
  .viz-graph { flex-direction: column; }
  .viz-graph #graph { width: 100%; min-height: 58%; height: 58%; }
  .viz-graph #sidebar { width: 100% !important; max-height: 42%; border-left: none;
    border-top: 1px solid var(--border); }
  .viz-flow .mermaid { overflow-x: auto; }
}
.path-form { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-end; margin: 16px 0 8px; }
.path-field { flex: 1 1 220px; position: relative; min-width: 0; }
.path-field label { display: block; font-size: 11px; letter-spacing: .06em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 6px; }
.path-field input { width: 100%; background: var(--bg); border: 1px solid var(--border);
  color: var(--text); padding: 8px 10px; border-radius: 6px; }
.path-suggest { display: none; position: absolute; left: 0; right: 0; top: calc(100% + 4px); z-index: 6;
  background: var(--panel); border: 1px solid var(--border); border-radius: 8px; max-height: 220px; overflow: auto; }
.path-suggest button { display: block; width: 100%; text-align: left; background: transparent; border: 0;
  color: var(--text); padding: 8px 10px; font: inherit; cursor: pointer; }
.path-suggest button small { display: block; color: var(--muted); font-size: 11px; }
.path-suggest button:hover, .path-suggest button[aria-selected="true"] { background: var(--hover); }
.path-go { background: var(--accent); color: var(--bg); border: 0; border-radius: 8px;
  padding: 9px 16px; font: 600 14px ui-sans-serif, system-ui, sans-serif; cursor: pointer; }
.path-chips { display: flex; flex-wrap: wrap; gap: 8px; margin: 0 0 18px; }
.path-chips button { background: var(--panel); border: 1px solid var(--border); color: var(--text);
  border-radius: 999px; padding: 6px 10px; font-size: 12px; cursor: pointer; }
.path-status { color: var(--muted); min-height: 1.4em; }
.path-status.bad { color: #f87171; }
[data-theme='light'] .path-status.bad { color: #b91c1c; }
.path-diagram { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 16px 0; }
.path-node { background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
  padding: 10px 12px; font-weight: 600; max-width: 100%; }
.path-node.end { border-color: var(--accent); color: var(--accent); }
.path-rel { font-size: 12px; color: var(--muted); font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.path-rel span { color: var(--accent); }
.path-empty { display: none; }
@media (max-width: 640px) {
  .path-diagram { flex-direction: column; align-items: stretch; }
  .path-rel { text-align: center; }
  .path-go { width: 100%; min-height: 44px; }
  #path-out table { display: block; overflow-x: auto; -webkit-overflow-scrolling: touch; }
}
"""

THEME_JS = """
function luminaTheme() {
  try {
    const t = localStorage.getItem('lumina.theme');
    if (t === 'light' || t === 'dark') return t;
  } catch (e) {}
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function applyLuminaTheme(t) {
  document.documentElement.setAttribute('data-theme', t || luminaTheme());
}
applyLuminaTheme();
window.addEventListener('storage', (e) => {
  if (!e.key || e.key === 'lumina.theme') applyLuminaTheme();
});
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (e.data && e.data.type === 'lumina-theme') applyLuminaTheme(e.data.theme);
});
"""

ARTICLE_JS = THEME_JS + """
try {
  if (!(window.frameElement && window.frameElement.id === 'article') && window.top === window) {
    var file = location.pathname.split('/').pop() || 'architecture.html';
    location.replace('app.html?p=' + encodeURIComponent(file));
  }
} catch (e) {}
"""

APP_JS = THEME_JS + """
const article = document.getElementById('article');
function fileOf(href) {
  try { return new URL(href, location.href).pathname.split('/').pop(); }
  catch (e) { return String(href || '').split('#')[0]; }
}
function syncActive(file) {
  document.querySelectorAll('aside nav a').forEach(a => {
    a.classList.toggle('active', fileOf(a.getAttribute('href')) === file);
  });
}
function show(href) {
  const file = fileOf(href);
  if (!file) return;
  article.src = file;
  syncActive(file);
  if (matchMedia('(max-width: 640px)').matches) setNavOpen(false);
}
const aside = document.querySelector('aside');
const toggle = document.getElementById('nav-toggle');
function setNavOpen(open) {
  if (!aside) return;
  aside.classList.toggle('open', open);
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.textContent = open ? 'Close' : 'Menu';
  }
}
if (toggle) toggle.addEventListener('click', () => setNavOpen(!aside.classList.contains('open')));
document.querySelectorAll('aside nav a').forEach(a => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    show(a.getAttribute('href'));
  });
});
article.addEventListener('load', () => {
  try {
    const file = article.contentWindow.location.pathname.split('/').pop();
    syncActive(file);
    const theme = luminaTheme();
    article.contentDocument.documentElement.setAttribute('data-theme', theme);
    article.contentWindow.postMessage({ type: 'lumina-theme', theme, reload: false }, location.origin);
  } catch (e) {}
});
const start = new URLSearchParams(location.search).get('p');
if (start) article.src = start;
window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  if (!(e.data && e.data.type === 'lumina-theme')) return;
  applyLuminaTheme(e.data.theme);
  try {
    article.contentDocument.documentElement.setAttribute('data-theme', e.data.theme);
    article.contentWindow.postMessage({ type: 'lumina-theme', theme: e.data.theme, reload: false }, location.origin);
    if (e.data.reload) article.contentWindow.location.reload();
  } catch (err) {}
});
const q = document.getElementById('filter');
q.addEventListener('input', () => {
  const v = q.value.toLowerCase();
  document.querySelectorAll('aside nav a').forEach(a => {
    a.style.display = a.textContent.toLowerCase().includes(v) ? '' : 'none';
  });
});
"""

PATH_HTML = """
<h1>Path</h1>
<p class="lede">Same as <code>graphify path "A" "B"</code>: pick two nodes from this repo's graph and see the shortest walk. Nothing is invented — if they do not connect, the page says so.</p>
<form class="path-form" id="path-form" autocomplete="off">
  <div class="path-field">
    <label for="path-from">From</label>
    <input id="path-from" name="from" placeholder="executeAsk()" aria-autocomplete="list">
    <div class="path-suggest" id="from-suggest" role="listbox"></div>
  </div>
  <div class="path-field">
    <label for="path-to">To</label>
    <input id="path-to" name="to" placeholder="SseStream" aria-autocomplete="list">
    <div class="path-suggest" id="to-suggest" role="listbox"></div>
  </div>
  <button class="path-go" type="submit">Show path</button>
</form>
<div class="path-chips">
  <button type="button" data-from="executeAsk()" data-to="SseStream">executeAsk() → SseStream</button>
  <button type="button" data-from="executeAsk()" data-to="db()">executeAsk() → db()</button>
  <button type="button" data-from="Gateway Service (:8787)" data-to="Agent Service (:8000)">Gateway → Agent</button>
</div>
<p class="path-status" id="path-status">Loading graph.json…</p>
<div id="path-out" class="path-empty"></div>
"""

PATH_JS = r"""
(function () {
  const fromInput = document.getElementById('path-from');
  const toInput = document.getElementById('path-to');
  const fromSuggest = document.getElementById('from-suggest');
  const toSuggest = document.getElementById('to-suggest');
  const status = document.getElementById('path-status');
  const out = document.getElementById('path-out');
  let nodes = [];
  let byId = new Map();
  let adj = new Map();

  function setStatus(text, bad) {
    status.textContent = text;
    status.classList.toggle('bad', !!bad);
  }
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
  function addEdge(a, b, rel, file) {
    if (!adj.has(a)) adj.set(a, []);
    adj.get(a).push({ to: b, relation: rel || 'related', file: file || '' });
  }
  function shortest(start, end) {
    if (start === end) return { hops: [], ids: [start] };
    const prev = new Map([[start, null]]);
    const q = [start];
    for (let i = 0; i < q.length; i++) {
      const cur = q[i];
      for (const e of adj.get(cur) || []) {
        if (prev.has(e.to)) continue;
        prev.set(e.to, { from: cur, relation: e.relation, file: e.file });
        if (e.to === end) {
          const hops = [];
          let id = end;
          while (prev.get(id)) {
            const step = prev.get(id);
            hops.push({ from: step.from, to: id, relation: step.relation, file: step.file });
            id = step.from;
          }
          hops.reverse();
          return { hops, ids: [start, ...hops.map((h) => h.to)] };
        }
        q.push(e.to);
      }
    }
    return null;
  }
  function matches(q) {
    const n = q.trim().toLowerCase();
    if (!n) return [];
    const ranked = [];
    for (const node of nodes) {
      const label = (node.label || '').toLowerCase();
      const file = (node.source_file || '').toLowerCase();
      if (label === n) ranked.push({ node, score: 0 });
      else if (label.startsWith(n)) ranked.push({ node, score: 1 });
      else if (label.includes(n) || file.includes(n)) ranked.push({ node, score: 2 });
    }
    ranked.sort((a, b) => a.score - b.score || a.node.label.localeCompare(b.node.label));
    const seen = new Set();
    const outN = [];
    for (const row of ranked) {
      if (seen.has(row.node.id)) continue;
      seen.add(row.node.id);
      outN.push(row.node);
      if (outN.length >= 12) break;
    }
    return outN;
  }
  function pick(input, node) {
    input.value = node.label;
    input.dataset.id = node.id;
  }
  function bindSuggest(input, box) {
    let idx = -1;
    let items = [];
    function render(list, selected) {
      items = list;
      idx = list.length ? Math.max(0, Math.min(selected ?? 0, list.length - 1)) : -1;
      if (!list.length) { box.style.display = 'none'; box.innerHTML = ''; return; }
      box.innerHTML = list.map((n, i) =>
        `<button type="button" role="option" data-id="${esc(n.id)}" aria-selected="${i === idx}">${esc(n.label)}<small>${esc(n.source_file || n.id)}</small></button>`
      ).join('');
      box.style.display = 'block';
    }
    input.addEventListener('input', () => {
      delete input.dataset.id;
      render(matches(input.value), 0);
    });
    input.addEventListener('focus', () => {
      if (input.value.trim()) render(matches(input.value), 0);
    });
    input.addEventListener('keydown', (e) => {
      if (box.style.display !== 'block') return;
      if (e.key === 'ArrowDown') { e.preventDefault(); render(items, idx + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); render(items, idx - 1); }
      else if (e.key === 'Enter' && idx >= 0) { e.preventDefault(); pick(input, items[idx]); box.style.display = 'none'; }
      else if (e.key === 'Escape') box.style.display = 'none';
    });
    box.addEventListener('mousedown', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      e.preventDefault();
      const node = byId.get(btn.dataset.id);
      if (node) pick(input, node);
      box.style.display = 'none';
    });
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target) && e.target !== input) box.style.display = 'none';
    });
  }
  function resolve(input) {
    if (input.dataset.id && byId.has(input.dataset.id)) {
      const n = byId.get(input.dataset.id);
      if (n.label === input.value.trim()) return n;
    }
    const q = input.value.trim().toLowerCase();
    if (!q) return null;
    const exact = nodes.filter((n) => (n.label || '').toLowerCase() === q);
    if (exact.length === 1) return exact[0];
    if (exact.length > 1) return exact[0];
    const hits = matches(input.value);
    return hits.length === 1 ? hits[0] : null;
  }
  function renderPath(a, b, found) {
    out.classList.remove('path-empty');
    if (!found) {
      out.innerHTML = '<p>No path between these two nodes in <code>graph.json</code>. They are in different components, or one is isolated. Nothing was invented.</p>';
      return;
    }
    const hops = found.hops;
    const bits = [];
    bits.push(`<div class="path-node">${esc(a.label)}<small style="display:block;font-weight:400;color:var(--muted)">${esc(a.source_file || '')}</small></div>`);
    hops.forEach((h, i) => {
      const n = byId.get(h.to);
      bits.push(`<div class="path-rel">— <span>${esc(h.relation)}</span> →</div>`);
      bits.push(`<div class="path-node${i === hops.length - 1 ? ' end' : ''}">${esc(n.label)}<small style="display:block;font-weight:400;color:var(--muted)">${esc(n.source_file || '')}</small></div>`);
    });
    const rows = hops.map((h) => {
      const f = byId.get(h.from);
      const t = byId.get(h.to);
      return `<tr><td>${esc(f.label)}</td><td><code>${esc(h.relation)}</code></td><td>${esc(t.label)}</td><td><code>${esc(h.file || '')}</code></td></tr>`;
    }).join('');
    out.innerHTML =
      `<div class="path-diagram">${bits.join('')}</div>` +
      (hops.length
        ? `<table><thead><tr><th>From</th><th>Relation</th><th>To</th><th>File</th></tr></thead><tbody>${rows}</tbody></table>`
        : '<p>Same node — there is nothing to traverse.</p>');
  }
  function run() {
    const a = resolve(fromInput);
    const b = resolve(toInput);
    if (!a || !b) {
      setStatus('Pick two nodes from the suggestions. Labels must match the graph.', true);
      out.innerHTML = '';
      out.classList.add('path-empty');
      return;
    }
    pick(fromInput, a);
    pick(toInput, b);
    const found = shortest(a.id, b.id);
    if (!found) {
      setStatus(`No path from ${a.label} to ${b.label}.`, true);
      renderPath(a, b, null);
      return;
    }
    const n = found.hops.length;
    setStatus(n === 0 ? `${a.label} is the same node.` : `${n} hop${n === 1 ? '' : 's'} · ${a.label} → ${b.label}`);
    renderPath(a, b, found);
  }

  bindSuggest(fromInput, fromSuggest);
  bindSuggest(toInput, toSuggest);
  document.getElementById('path-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
  document.querySelectorAll('.path-chips button').forEach((btn) => {
    btn.addEventListener('click', () => {
      fromInput.value = btn.dataset.from;
      toInput.value = btn.dataset.to;
      delete fromInput.dataset.id;
      delete toInput.dataset.id;
      run();
    });
  });

  fetch('graph.json')
    .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then((g) => {
      nodes = g.nodes || [];
      byId = new Map(nodes.map((n) => [n.id, n]));
      adj = new Map();
      for (const e of g.links || []) {
        addEdge(e.source, e.target, e.relation, e.source_file);
        addEdge(e.target, e.source, e.relation, e.source_file);
      }
      setStatus(`${nodes.length} nodes · ${ (g.links || []).length } edges · pick two names.`);
    })
    .catch(() => setStatus('Could not load graph.json. Rebuild the Graphify site.', true));
})();
"""

ARCH = """
<h1>How LUMINA is connected</h1>
<p class="lede">The browser talks only to the gateway. The gateway proxies to the agent. The agent holds keys, runs the loop, and talks to Atlas / OpenAI / Tavily.</p>
<div class="mermaid">
flowchart LR
  B[Browser UI<br/>web/] --> G[Gateway :8787]
  G --> S[web/dist SPA]
  G --> A[Agent :8000]
  A --> M[(MongoDB Atlas)]
  A --> L[OpenAI]
  A --> T[Tavily]
  A --> W[Jobs worker]
  W --> M
</div>
<h2>Ask path</h2>
<table>
<thead><tr><th>Step</th><th>Where</th><th>What to notice</th></tr></thead>
<tbody>
<tr><td>1</td><td>web/src/api.ts</td><td>POST /threads/:id/ask with X-User-Id. Same origin on Railway.</td></tr>
<tr><td>2</td><td>backend/gateway</td><td>CORS, 401, zod, rate limit, SSE flush, no keys.</td></tr>
<tr><td>3</td><td>executeAsk() in agent.ts</td><td>tools + caps. Deep runs plan_research first.</td></tr>
<tr><td>4</td><td>sse.ts</td><td>plan → trace → sources → token → done.</td></tr>
<tr><td>5</td><td>Atlas + runs/</td><td>messages, optional memory, run log with depth and cost.</td></tr>
</tbody>
</table>
<div class="cards">
  <div class="card"><h3>Start here</h3><p>Click <a href="executeAsk.html">executeAsk()</a> then <a href="Gateway_&amp;_Edge_Proxy.html">Gateway runtime</a>. Those two pages are the product.</p></div>
  <div class="card"><h3>How two names connect</h3><p>Open <a href="path.html">Path</a> and pick two symbols — same as <code>graphify path A B</code>. The force graph is the full map; Path is the walk.</p></div>
</div>
"""


THEME_BOOT = """<script>(function(){try{var t=localStorage.getItem("lumina.theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";document.documentElement.setAttribute("data-theme",t);}catch(e){document.documentElement.setAttribute("data-theme","dark");}})();</script>"""

FLOW_MERMAID_PREP = r"""
  if (document.documentElement.getAttribute('data-theme') === 'light') {
    const darkClass = [
      'classDef entry fill:#422006,stroke:#fbbf24,color:#fde68a,stroke-width:1px;',
      'classDef api fill:#450a0a,stroke:#f87171,color:#fee2e2,stroke-width:1px;',
      'classDef async fill:#2e1065,stroke:#a78bfa,color:#ede9fe,stroke-width:1px;',
      'classDef klass fill:#064e3b,stroke:#34d399,color:#d1fae5,stroke-width:1px;',
      'classDef ui fill:#831843,stroke:#f472b6,color:#fce7f3,stroke-width:1px;',
      'classDef module fill:#172554,stroke:#60a5fa,color:#dbeafe,stroke-width:1px;',
      'classDef test fill:#3f3f46,stroke:#a1a1aa,color:#f4f4f5,stroke-width:1px;',
      'classDef concept fill:#292524,stroke:#a8a29e,color:#fafaf9,stroke-dasharray:4 3;',
      'classDef function fill:#0f172a,stroke:#38bdf8,color:#e0f2fe,stroke-width:1px;'
    ];
    const lightClass = [
      'classDef entry fill:#fffbeb,stroke:#d97706,color:#78350f,stroke-width:1px;',
      'classDef api fill:#fef2f2,stroke:#dc2626,color:#7f1d1d,stroke-width:1px;',
      'classDef async fill:#f5f3ff,stroke:#7c3aed,color:#4c1d95,stroke-width:1px;',
      'classDef klass fill:#ecfdf5,stroke:#059669,color:#064e3b,stroke-width:1px;',
      'classDef ui fill:#fdf2f8,stroke:#db2777,color:#831843,stroke-width:1px;',
      'classDef module fill:#eff6ff,stroke:#2563eb,color:#1e3a8a,stroke-width:1px;',
      'classDef test fill:#f4f4f5,stroke:#71717a,color:#27272a,stroke-width:1px;',
      'classDef concept fill:#f5f5f4,stroke:#78716c,color:#292524,stroke-dasharray:4 3;',
      'classDef function fill:#ecfeff,stroke:#0f766e,color:#134e4a,stroke-width:1px;'
    ];
    document.querySelectorAll('.mermaid').forEach((el) => {
      let t = el.textContent;
      t = t.replace(/"theme":\s*"dark"/g, '"theme":"base"');
      t = t.replace(/"primaryColor":\s*"#1e293b"/g, '"primaryColor":"#ffffff"');
      t = t.replace(/"primaryTextColor":\s*"#e2e8f0"/g, '"primaryTextColor":"#12161c"');
      t = t.replace(/"primaryBorderColor":\s*"#38bdf8"/g, '"primaryBorderColor":"#0f766e"');
      t = t.replace(/"secondaryColor":\s*"#0f172a"/g, '"secondaryColor":"#f3f5f8"');
      t = t.replace(/"tertiaryColor":\s*"#334155"/g, '"tertiaryColor":"#e8eef4"');
      t = t.replace(/"lineColor":\s*"#64748b"/g, '"lineColor":"#64748b"');
      t = t.replace(/"textColor":\s*"#e2e8f0"/g, '"textColor":"#12161c"');
      darkClass.forEach((d, i) => { t = t.split(d).join(lightClass[i]); });
      el.textContent = t;
    });
  }
"""


def nav_markup(current: str = "") -> str:
    groups = []
    for heading, items in NAV:
        links = []
        for label, href in items:
            cls = ' class="active"' if href == current else ""
            links.append(f'<a href="{html.escape(href)}"{cls}>{html.escape(label)}</a>')
        groups.append(f"<h2>{html.escape(heading)}</h2>" + "\n".join(links))
    return "".join(groups)


def mermaid_tag(body: str, viz: bool, inject_mermaid: bool | None) -> str:
    if inject_mermaid is None:
        inject_mermaid = 'class="mermaid"' in body and not viz
    if not inject_mermaid:
        return ""
    return '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script><script>mermaid.initialize({startOnLoad:true,theme:document.documentElement.getAttribute("data-theme")==="light"?"default":"dark"});</script>'


def article_page(
    title: str,
    body: str,
    extra_head: str = "",
    viz: bool = False,
    inject_mermaid: bool | None = None,
) -> str:
    mermaid = mermaid_tag(body, viz, inject_mermaid)
    main_cls = ' class="viz"' if viz else ""
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(title)} · LUMINA graphify</title>
<style>{CSS}</style>
{THEME_BOOT}
{extra_head}
</head>
<body>
<main{main_cls}>
  {body}
</main>
<script>{ARTICLE_JS}</script>
{mermaid}
</body>
</html>
"""


def app_page() -> str:
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Graph · LUMINA graphify</title>
<style>{CSS}</style>
{THEME_BOOT}
</head>
<body>
<div class="layout shell">
  <aside>
    <div class="aside-head">
      <div>
        <h1>LUMINA graphify</h1>
        <div class="meta">727 nodes · browse to understand</div>
      </div>
      <button type="button" id="nav-toggle" class="nav-toggle" aria-expanded="false">Menu</button>
    </div>
    <div class="aside-body" id="aside-body">
      <input id="filter" type="search" placeholder="Filter pages">
      <nav>
        {nav_markup("architecture.html")}
      </nav>
    </div>
  </aside>
  <main class="shell">
    <iframe id="article" name="article" title="Graphify article" src="architecture.html"></iframe>
  </main>
</div>
<script>{APP_JS}</script>
</body>
</html>
"""


def neutralize_body_css(extra_head: str) -> str:
    extra_head = re.sub(r":root\s*\{[^}]*\}", "", extra_head)
    extra_head = re.sub(
        r"\bbody\s*\{[^}]*\}",
        ".viz-inner { height: 100%; }",
        extra_head,
    )
    extra_head = re.sub(r"html\s*,\s*body\s*\{[^}]*\}", "", extra_head)
    return extra_head


def wrap_viz(src: Path, title: str, current: str, kind: str) -> str:
    raw = src.read_text(encoding="utf-8")
    head_m = re.search(r"<head[^>]*>(.*?)</head>", raw, re.S | re.I)
    body_m = re.search(r"<body[^>]*>(.*)</body>", raw, re.S | re.I)
    head = head_m.group(1) if head_m else ""
    body = body_m.group(1) if body_m else raw
    extras: list[str] = []
    for m in re.finditer(r"<style[\s\S]*?</style>|<script[\s\S]*?</script>", head, re.I):
        extras.append(m.group(0))
    extra_head = neutralize_body_css("\n".join(extras))
    if kind == "tree":
        body = body.replace(
            """        const textPartColors = {
            name: '#343a40',
            count: '#0056b3'
        };""",
            """        const light = document.documentElement.getAttribute('data-theme') === 'light';
        const textPartColors = {
            name: light ? '#12161c' : '#e7ecf2',
            count: light ? '#0f766e' : '#5eead4'
        };""",
        )
        body = body.replace('return "#fff";', "return getComputedStyle(document.documentElement).getPropertyValue('--panel').trim() || '#fff';")
    if kind == "flow":
        light_vars = (
            "primaryColor:'#ffffff',primaryTextColor:'#12161c',primaryBorderColor:'#0f766e',"
            "secondaryColor:'#f3f5f8',tertiaryColor:'#eef2f6',lineColor:'#4a5868',textColor:'#12161c'"
        )
        dark_vars = (
            "primaryColor:'#1e293b',primaryTextColor:'#e2e8f0',primaryBorderColor:'#38bdf8',"
            "secondaryColor:'#0f172a',tertiaryColor:'#334155',lineColor:'#64748b',textColor:'#e2e8f0'"
        )
        body = body.replace(
            "theme: document.documentElement.getAttribute('data-theme')==='light'?'default':'dark',",
            "theme: document.documentElement.getAttribute('data-theme')==='light'?'base':'dark',",
        )
        body = re.sub(
            r"themeVariables:\s*\{[^}]*\}",
            "themeVariables: (document.documentElement.getAttribute('data-theme')==='light' ? {"
            + light_vars
            + "} : {"
            + dark_vars
            + "})",
            body,
            count=1,
        )
        body = body.replace(
            "  mermaid.initialize(mermaidConfig);",
            FLOW_MERMAID_PREP + "\n  mermaid.initialize(mermaidConfig);",
        )
    inner = f'<div class="viz-inner viz-{kind}">{body}</div>'
    return article_page(title, inner, extra_head=extra_head, viz=True, inject_mermaid=False)


def write_site(out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for md in sorted(WIKI.glob("*.md")):
        body = md_to_html(md.read_text(encoding="utf-8"))
        title = md.stem if md.stem != "index" else "Wiki index"
        name = "wiki-index.html" if md.stem == "index" else md.stem + ".html"
        (out / name).write_text(article_page(title, body), encoding="utf-8")
    (out / "architecture.html").write_text(article_page("Architecture", ARCH), encoding="utf-8")
    (out / "app.html").write_text(app_page(), encoding="utf-8")
    home = md_to_html((WIKI / "index.md").read_text(encoding="utf-8"))
    home = (
        '<p><a href="architecture.html">Open the architecture diagram</a> · '
        '<a href="path.html">Path between two nodes</a> · '
        '<a href="GRAPH_TREE.html">Code tree</a></p>'
        + home
    )
    (out / "index.html").write_text(article_page("Home", home), encoding="utf-8")
    (out / "path.html").write_text(
        article_page("Path", PATH_HTML + "<script>\n" + PATH_JS + "\n</script>"),
        encoding="utf-8",
    )
    graph_json = ROOT / "graph.json"
    if graph_json.exists():
        shutil.copy2(graph_json, out / "graph.json")
    viz_pages = (
        ("GRAPH_TREE.html", "Code tree", "tree"),
        ("graph.html", "Force graph", "graph"),
        ("lumina-1-callflow.html", "Call flow", "flow"),
    )
    for name, title, kind in viz_pages:
        src = ROOT / name
        if src.exists():
            (out / name).write_text(wrap_viz(src, title, name, kind), encoding="utf-8")
    broken: list[str] = []
    for page in out.glob("*.html"):
        for href in re.findall(r'href="([^"]+)"', page.read_text(encoding="utf-8")):
            if href.startswith(("http", "/", "#", "mailto:")):
                continue
            dest = html.unescape(href.split("#", 1)[0])
            if dest and not (out / dest).exists():
                broken.append(f"{page.name} → {dest}")
    if broken:
        raise SystemExit("Broken wiki links:\n  " + "\n  ".join(broken[:40]))
    print(f"Wrote {len(list(out.glob('*.html')))} pages to {out}")


def main() -> None:
    outs = [Path(sys.argv[1])] if len(sys.argv) > 1 else list(DEFAULT_OUTS)
    for out in outs:
        write_site(out)


if __name__ == "__main__":
    main()
