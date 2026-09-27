// Shared client helpers: API calls, session, formatting, math rendering.

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { v === null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* storage unavailable */ } },
};

export const session = {
  user: null,
  get userId() { return store.get('dq.userId'); },
  set userId(v) { store.set('dq.userId', v); },
};

export async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(session.userId ? { 'X-User-Id': session.userId } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}
export const GET = (p) => api('GET', p);
export const POST = (p, b = {}) => api('POST', p, b);
export const PUT = (p, b = {}) => api('PUT', p, b);
export const DEL = (p) => api('DELETE', p);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Render $...$ / $$...$$ with KaTeX (loaded from CDN; falls back to raw TeX). */
export function renderMath(el) {
  const run = () => window.renderMathInElement && window.renderMathInElement(el, {
    delimiters: [{ left: '$$', right: '$$', display: true }, { left: '$', right: '$', display: false }],
    throwOnError: false,
  });
  if (window.renderMathInElement) run();
  else window.addEventListener('load', run, { once: true });
}

export const pct = (x, digits = 0) => (x === null || x === undefined ? '—' : `${(x * 100).toFixed(digits)}%`);
export function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function humanDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}
export function dateTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
export function toast(msg, ms = 2600) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export const statusChip = (s) => `<span class="status ${esc(s.status)}">${esc(s.label)}</span>`;
export const difficulty = (d) => `<span class="diff" title="Difficulty ${d}/5"><b>${'●'.repeat(d)}</b>${'○'.repeat(5 - d)}</span>`;

export const RESULTS_LABEL = { full: 'Full review', score: 'Score only', never: 'Results hidden' };
export const FEEDBACK_LABEL = { deferred: 'Graded at the end', immediate: 'Instant feedback' };

/** Mastery bar row: name | bar | % */
export function masteryBar(name, m, { href, title } = {}) {
  const value = m.mastery === null || m.mastery === undefined ? null : m.mastery;
  const label = href ? `<a href="${href}">${esc(name)}</a>` : esc(name);
  const tip = title || `${name}: ${value === null ? 'not assessed' : `${Math.round(value * 100)}% · ${m.label}`}`;
  return `<div class="mbar" title="${esc(tip)}">
    <div class="name">${label}</div>
    <div class="track" role="img" aria-label="${esc(tip)}">${value === null ? '' : `<div class="fill ${esc(m.status)}" style="width:${Math.max(2, value * 100)}%"></div>`}</div>
    <div class="pct">${value === null ? '<span class="muted">n/a</span>' : Math.round(value * 100) + '%'}</div>
  </div>`;
}

let metaCache = null;
/** Taxonomy lookup maps (cached). */
export async function meta() {
  if (metaCache) return metaCache;
  const m = await GET('/meta');
  const subjects = new Map(); const topics = new Map(); const subtopics = new Map();
  for (const s of m.taxonomy.subjects) {
    subjects.set(s.id, s);
    for (const t of s.topics) {
      topics.set(t.id, { ...t, subject: s.id });
      for (const st of t.subtopics) subtopics.set(st.id, { ...st, topic: t.id, subject: s.id });
    }
  }
  metaCache = { ...m, subjects, topics, subtopics };
  return metaCache;
}

export const SUBJECT_COLORS = ['var(--cat-1)', 'var(--cat-2)', 'var(--cat-3)', 'var(--cat-4)', 'var(--cat-5)', 'var(--cat-6)', 'var(--cat-7)'];
