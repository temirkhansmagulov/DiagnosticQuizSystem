import { GET, esc, meta, difficulty, renderMath } from './ui.js';

/** Filter controls shared by the bank browser and the quiz builder. */
export function categoryFilters(m, { withType = true, withDifficulty = true, prefix = 'f' } = {}) {
  return `
    <label class="field">Subject<select data-f="subject" id="${prefix}-subject"><option value="">Any subject</option>
      ${[...m.subjects.values()].map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></label>
    <label class="field">Topic<select data-f="topic" id="${prefix}-topic"><option value="">Any topic</option></select></label>
    <label class="field">Subtopic<select data-f="subtopic" id="${prefix}-subtopic"><option value="">Any subtopic</option></select></label>
    ${withType ? `<label class="field">Type<select data-f="type"><option value="">Any type</option><option value="numeric">Calculated answer</option><option value="mcq">Multiple choice</option></select></label>` : ''}
    ${withDifficulty ? `<label class="field">Difficulty<span class="row" style="flex-wrap:nowrap">
      <select data-f="difficultyMin">${[1, 2, 3, 4, 5].map((d) => `<option ${d === 1 ? 'selected' : ''}>${d}</option>`).join('')}</select>–
      <select data-f="difficultyMax">${[1, 2, 3, 4, 5].map((d) => `<option ${d === 5 ? 'selected' : ''}>${d}</option>`).join('')}</select></span></label>` : ''}`;
}

/** Wire the cascading subject → topic → subtopic selects. Calls onChange(filter) on every change. */
export function wireFilters(root, m, prefix, onChange) {
  const subj = root.querySelector(`#${prefix}-subject`);
  const top = root.querySelector(`#${prefix}-topic`);
  const sub = root.querySelector(`#${prefix}-subtopic`);
  const fill = () => {
    const s = m.subjects.get(subj.value);
    const topics = s ? s.topics : [...m.topics.values()];
    const keepTopic = topics.some((t) => t.id === top.value) ? top.value : '';
    top.innerHTML = '<option value="">Any topic</option>' + topics.map((t) => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
    top.value = keepTopic;
    const t = m.topics.get(top.value);
    const subs = t ? t.subtopics : s ? s.topics.flatMap((x) => x.subtopics) : [...m.subtopics.values()];
    const keepSub = subs.some((x) => x.id === sub.value) ? sub.value : '';
    sub.innerHTML = '<option value="">Any subtopic</option>' + subs.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('');
    sub.value = keepSub;
  };
  const read = () => {
    const f = {};
    root.querySelectorAll('[data-f]').forEach((x) => { if (x.value) f[x.dataset.f] = x.value; });
    return f;
  };
  root.querySelectorAll('[data-f]').forEach((x) => x.addEventListener('change', () => { fill(); onChange(read()); }));
  fill();
  return read;
}

export function matches(q, f) {
  return (!f.subject || q.subject === f.subject) && (!f.topic || q.topics.includes(f.topic)) &&
    (!f.subtopic || q.subtopics[f.subtopic] !== undefined) && (!f.type || q.type === f.type) &&
    q.difficulty >= Number(f.difficultyMin || 1) && q.difficulty <= Number(f.difficultyMax || 5) &&
    (!f.search || `${q.id} ${q.title}`.toLowerCase().includes(f.search.toLowerCase()));
}

/** Render a random instance of a question (text, options, answer, solution). */
export async function renderPreview(box, id, seed) {
  const p = await GET(`/questions/${id}/preview${seed ? `?seed=${encodeURIComponent(seed)}` : ''}`);
  box.innerHTML = `<div class="qtext" style="margin-top:0">${esc(p.text)}</div>
    ${p.options ? `<ol type="a" style="margin:0 0 10px">${p.options.map((o) => `<li ${o.id === p.correctOption ? 'style="font-weight:700"' : ''}>${esc(o.text)}${o.id === p.correctOption ? ' ✓' : ''}</li>`).join('')}</ol>` : ''}
    <dl class="kv"><dt>Answer</dt><dd>${esc(p.answer)}</dd>
      ${p.solution ? `<dt>Solution</dt><dd class="secondary">${esc(p.solution)}</dd>` : ''}
      <dt>Parameters</dt><dd class="small num">${Object.entries(p.params).map(([k, v]) => `${esc(k)} = ${esc(v)}`).join(', ') || '—'}</dd>
      <dt>Seed</dt><dd class="small muted">${esc(p.seed)}</dd></dl>`;
  renderMath(box);
}

export function questionRow(q, m, extra = '') {
  const primary = m.subtopics.get(q.primarySubtopic);
  const others = Object.keys(q.subtopics).slice(1).map((id) => (m.subtopics.get(id) || {}).name).filter(Boolean);
  return `<tr class="clickable" data-q="${esc(q.id)}">
    <td><b>${esc(q.title)}</b><br><span class="muted small">${esc(q.id)}</span></td>
    <td>${esc(m.subjects.get(q.subject).name)}<br><span class="muted small">${esc(primary.name)}${others.length ? ` + ${esc(others.join(', '))}` : ''}</span></td>
    <td>${q.type === 'mcq' ? 'Multiple choice' : 'Calculated'}</td>
    <td>${difficulty(q.difficulty)}</td>${extra}</tr>`;
}

/** Instructor: browse the question bank and preview randomised variants. */
export async function bankView(el) {
  const [m, questions] = await Promise.all([meta(), GET('/questions')]);
  el.innerHTML = `
    <div class="page-head"><div><h1>Question bank</h1>
      <p class="secondary">${questions.length} parameterised questions stored as JSON in <code>data/bank/&lt;subject&gt;.json</code>. Every student gets different numbers.</p></div></div>
    <div class="tiles">${[...m.subjects.values()].map((s) => `<div class="card tile"><div class="label">${esc(s.name)}</div><div class="value num">${m.counts[s.id] || 0}</div></div>`).join('')}</div>
    <section class="card"><div class="form-grid" id="filters">${categoryFilters(m, { prefix: 'bk' })}
      <label class="field">Search<input data-f="search" placeholder="id or title"></label></div></section>
    <div class="grid split" style="margin-top:16px;align-items:start">
      <section class="card"><div class="table-wrap"><table>
        <thead><tr><th>Question</th><th>Subject / subtopics</th><th>Type</th><th>Difficulty</th></tr></thead>
        <tbody id="rows"></tbody></table></div></section>
      <section class="card" id="detail" style="position:sticky;top:72px"><p class="muted">Select a question to preview a random variant.</p></section>
    </div>`;
  const rows = el.querySelector('#rows');
  const detail = el.querySelector('#detail');
  const show = (f) => {
    const list = questions.filter((q) => matches(q, f));
    rows.innerHTML = list.map((q) => questionRow(q, m)).join('') || '<tr><td colspan="4" class="empty">No questions match.</td></tr>';
  };
  const read = wireFilters(el.querySelector('#filters'), m, 'bk', show);
  el.querySelector('[data-f=search]').addEventListener('input', () => show(read()));
  show(read());

  rows.addEventListener('click', async (e) => {
    const tr = e.target.closest('tr[data-q]');
    if (!tr) return;
    rows.querySelectorAll('tr').forEach((r) => r.style.background = '');
    tr.style.background = 'var(--accent-wash)';
    const full = await GET(`/questions/${tr.dataset.q}`);
    detail.innerHTML = `<div class="card-head"><h2>${esc(full.title)}</h2>${difficulty(full.difficulty)}</div>
      <div class="row" style="margin-bottom:10px">${Object.entries(full.subtopics).map(([id, w]) => `<span class="chip ${w === 1 ? 'accent' : ''}">${esc((m.subtopics.get(id) || {}).name || id)} · ${w}</span>`).join('')}</div>
      <div class="preview-box" id="pv"></div>
      <div class="row" style="margin-top:10px"><button id="again">↻ New random variant</button><span class="muted small">file: data/bank/${esc(full.file)}</span></div>
      <details style="margin-top:14px"><summary class="small">Source (JSON)</summary><pre class="code">${esc(JSON.stringify(full.source, null, 2))}</pre></details>`;
    const pv = detail.querySelector('#pv');
    await renderPreview(pv, full.id);
    detail.querySelector('#again').addEventListener('click', () => renderPreview(pv, full.id));
  });
}
