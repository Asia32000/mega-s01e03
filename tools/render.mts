// Renders one kb page to static HTML, the way the kb's runbook layout and components show it.
// The export ships the pages and src/lib, not the SvelteKit app around them, so this stands in for
// the build: it runs the same src/lib logic (causes, problems, desk-ref, staleness) and prints the
// same markup and styles as runbook.svelte and the components the page uses.
//
//   npx tsx --tsconfig tools/tsconfig.json tools/render.mts <page.svx> <out.html> [YYYY-MM-DD]
//
// `marked` (Markdown → HTML) is the one outside dependency: MARKED=<path to marked.esm.js>.
import fs from 'node:fs';
import path from 'node:path';
import reports from '#lib/data/reports-4471.json';
import notes from '#lib/data/desk-notes.json';
import tickets from '#lib/data/tickets-4471.json';
import type { Report, Tenant } from '#lib/kb/causes';
import { PROBLEM_TITLE, splitTicket } from '#lib/kb/problems';
import { deskRef } from '#lib/kb/desk-ref';
import { daysSince, isoDay, STALE_AFTER_DAYS } from '#lib/kb/staleness';

const [pagePath, outPath, today] = process.argv.slice(2);
const now = today ? new Date(`${today}T12:00:00Z`) : new Date();
const { marked } = await import(process.env.MARKED ?? 'marked');

// locales.ts without Vite's import.meta.glob: the same tenant directory, read from disk.
const tenantDir = path.resolve(import.meta.dirname, '../src/lib/data/tenants');
const byHandle = new Map<string, Tenant>(
  fs.readdirSync(tenantDir).map((f) => {
    const t = JSON.parse(fs.readFileSync(path.join(tenantDir, f), 'utf8')) as Tenant;
    return [t.handle, t];
  }),
);
const tenantOf = (r: Pick<Report, 'tenant'>) => byHandle.get(r.tenant);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// --- the page: frontmatter + body
const src = fs.readFileSync(pagePath, 'utf8');
const fm = src.match(/^---\n([\s\S]*?)\n---\n/);
if (!fm) throw new Error('no frontmatter');
const meta: Record<string, string> = {};
for (const line of fm[1].split('\n')) {
  const m = line.match(/^(\w+):\s*(.*)$/);
  if (m) meta[m[1]] = m[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
}
let body = src.slice(fm[0].length).replace(/<script>[\s\S]*?<\/script>\s*/, '');

// --- components
function problemTable(ticket: number): string {
  const split = splitTicket(reports as Report[], ticket, tenantOf, notes.oneDayMove);
  const issues = tickets.issues as Record<string, number | null>;
  const list = (n: Record<string, number>) =>
    Object.entries(n).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(' · ');
  const rows = split.groups
    .map((g) => {
      const what = g.problem === 'unplaced' ? 'no tenant on file' : PROBLEM_TITLE[g.problem];
      const n = issues[g.problem];
      const link = n
        ? `<a href="https://github.com/${tickets.repo}/issues/${n}">${tickets.repo}#${n}</a>`
        : `<span class="none">none yet</span>`;
      return `<tr><td><code>${g.problem}</code><br><span class="what">${esc(what)}</span></td><td><strong>${g.reports.length}</strong></td><td>${g.tenants.length}</td><td class="small">${list(g.channels)}</td><td class="small">${list(g.taggedAs)}</td><td class="small">${g.firstSeen} → ${g.lastSeen}</td><td>${link}</td></tr>`;
    })
    .join('\n');
  return `<p class="sum"><strong>${split.merged.length}</strong> reports merged into #${ticket} · <strong>${split.groups.length}</strong> ${split.groups.length === 1 ? 'problem' : 'problems'}</p>
<table><thead><tr><th>problem</th><th>reports</th><th>tenants</th><th>channels</th><th>intake tagged</th><th>seen</th><th>ticket</th></tr></thead><tbody>
${rows}
</tbody></table>`;
}

function renderStamp(signature?: string): string {
  return signature
    ? `<p class="stamp">desk ref <b>${deskRef(signature)}</b></p>`
    : `<p class="stamp missing">no desk ref: this page isn't signed (no <code>signature</code> in its frontmatter)</p>`;
}

const blocks: string[] = [];
const hold = (html: string) => `\n\n<!--block:${blocks.push(html) - 1}-->\n\n`;
body = body
  .replace(/<ProblemTable ticket=\{(\d+)\} \/>/g, (_, t) => hold(problemTable(Number(t))))
  .replace(/<Callout(?: kind="(\w+)")?>([\s\S]*?)<\/Callout>/g, (_, kind, inner) =>
    hold(`<aside class="${kind ?? 'note'}">${marked.parse(inner.trim())}</aside>`),
  )
  .replace(/<RenderStamp \{signature\} \/>/g, () => hold(renderStamp(meta.signature)));
if (/<[A-Z]\w+/.test(body)) throw new Error(`unrendered component: ${body.match(/<[A-Z]\w+[^>]*>/)![0]}`);
let html = marked.parse(body) as string;
html = html.replace(/<!--block:(\d+)-->/g, (_, i) => blocks[Number(i)]);

// --- runbook layout
const age = daysSince(meta.reviewed, now);
const stale = age > STALE_AFTER_DAYS;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(meta.title)} · support kb</title>
<style>
:root { --bg: #fbfaf7; --fg: #1d1d1b; --muted: #6b6a66; --line: #e3e0d8; --accent: #2f6f5e; --warn: #b4501f; --warn-bg: #fbeee6; --note-bg: #eef5f2; --mono: ui-monospace, 'Cascadia Code', Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root { --bg: #171716; --fg: #ecebe6; --muted: #9c9a93; --line: #34332f; --accent: #6fbfa6; --warn: #f0905d; --warn-bg: #3a2418; --note-bg: #1d2c27; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.6 system-ui, sans-serif; }
.kb table { border-collapse: collapse; width: 100%; margin: 1rem 0; font-size: 0.92rem; }
.kb th, .kb td { border-bottom: 1px solid var(--line); padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
.kb code { font-family: var(--mono); font-size: 0.88em; }
.kb a { color: var(--accent); }
.kb { max-width: 760px; margin: 0 auto; padding: 2rem 16px 4rem; }
.kb main { overflow-x: auto; }
.crumb { font: 0.8rem var(--mono); text-decoration: none; color: var(--muted); }
h1 { margin: 0.25rem 0 0.5rem; line-height: 1.2; }
.meta { display: flex; flex-wrap: wrap; gap: 0.5rem 1rem; color: var(--muted); font-size: 0.85rem; margin: 0; }
.status { border: 1px solid var(--line); border-radius: 99px; padding: 0 0.6rem; }
.stale { color: var(--warn); font-weight: 600; }
.banner { background: var(--warn-bg); color: var(--warn); padding: 0.6rem 1rem; border-radius: 6px; }
footer { margin-top: 3rem; color: var(--muted); font-size: 0.8rem; border-top: 1px solid var(--line); padding-top: 1rem; }
aside { border-left: 4px solid var(--accent); padding: 0.5rem 1rem; margin: 1rem 0; background: var(--note-bg); }
aside.warn { border-color: var(--warn); background: var(--warn-bg); }
aside p { margin: 0; }
.sum { font-size: 1.1rem; }
.what, .small { color: var(--muted); font-size: 0.85em; }
.none { color: var(--warn); font-weight: 600; }
.stamp { margin: 2rem 0 0; font: 0.85rem var(--mono); color: var(--muted); }
.stamp b { color: var(--accent); letter-spacing: 0.04em; }
.stamp.missing { color: var(--warn); }
</style>
</head>
<body>
<div class="kb">
  <header>
    <a class="crumb" href="/kb">support desk · kb</a>
    <h1>${esc(meta.title)}</h1>
    <p class="meta">
      <span>owner <b>${esc(meta.owner)}</b></span>
      <span class="status ${esc(meta.status)}">${esc(meta.status)}</span>
      <span${stale ? ' class="stale"' : ''}>reviewed ${isoDay(meta.reviewed)} · ${age} days ago${stale ? ' · stale' : ''}</span>
    </p>
  </header>
  ${stale ? `<p class="banner">Nobody has re-read this page in ${age} days. Check it against the live views before you rely on it.</p>` : ''}
  <main>
${html}
  </main>
  <footer>Pages are written by people. Tables and charts are built from data at render time.</footer>
</div>
</body>
</html>
`;
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, page);
console.log(`rendered ${pagePath} → ${outPath} · desk ref ${meta.signature ? deskRef(meta.signature) : 'none'}`);
