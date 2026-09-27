import { GET, POST, PUT, DEL, esc, pct, meta, toast, humanDuration, RESULTS_LABEL, FEEDBACK_LABEL } from './ui.js';
import { categoryFilters, wireFilters, matches, questionRow, renderPreview } from './bank.js';

/** Instructor: list of quizzes with headline stats. */
export async function quizzesView(el) {
  const [quizzes, analytics] = await Promise.all([GET('/quizzes'), GET('/analytics')]);
  const stats = new Map(analytics.quizzes.map((q) => [q.id, q]));
  el.innerHTML = `
    <div class="page-head"><div><h1>Quizzes</h1><p class="secondary">Build quizzes from specific questions or from categories that draw random questions per student.</p></div>
      <a class="btn btn-primary" href="#/quizzes/new">+ New quiz</a></div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>Quiz</th><th>Settings</th><th class="num">Questions</th><th class="num">Attempts</th><th class="num">Avg score</th><th class="num">Avg time</th><th></th></tr></thead>
      <tbody>${quizzes.map((q) => {
        const s = stats.get(q.id) || {};
        return `<tr>
          <td><b>${esc(q.title)}</b> ${q.published ? '' : '<span class="chip">draft</span>'}<br><span class="muted small">${esc(q.description || '')}</span></td>
          <td class="small"><div class="row" style="gap:4px">
            <span class="chip">${q.timeLimitMinutes ? `${q.timeLimitMinutes} min` : 'no limit'}</span>
            <span class="chip">${q.maxAttempts ? `${q.maxAttempts} attempt${q.maxAttempts > 1 ? 's' : ''}` : '∞ attempts'}</span>
            <span class="chip">${RESULTS_LABEL[q.showResults]}</span><span class="chip">${FEEDBACK_LABEL[q.feedback]}</span></div></td>
          <td class="num">${q.questionCount}</td><td class="num">${s.attempts ?? 0}</td>
          <td class="num">${pct(s.avgScorePct)}</td><td class="num">${humanDuration(s.avgDurationMs)}</td>
          <td><div class="row" style="flex-wrap:nowrap"><a class="btn btn-sm" href="#/quizzes/${q.id}/edit">Edit</a>
            <button class="btn-sm btn-danger" data-del="${esc(q.id)}" data-title="${esc(q.title)}">Delete</button></div></td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No quizzes yet.</td></tr>'}</tbody>
    </table></div></section>`;
  el.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`Delete "${b.dataset.title}"? Past attempts stay in student profiles.`)) return;
    await DEL(`/quizzes/${b.dataset.del}`);
    quizzesView(el);
  }));
}

/** Instructor: create / edit a quiz. */
export async function builderView(el, quizId) {
  const [m, questions, existing] = await Promise.all([meta(), GET('/questions'), quizId ? GET(`/quizzes/${quizId}`) : null]);
  const byId = new Map(questions.map((q) => [q.id, q]));
  const quiz = existing || {
    title: '', description: '', timeLimitMinutes: 20, maxAttempts: 1, showResults: 'full', feedback: 'deferred',
    shuffleQuestions: true, published: true, items: [],
  };
  const items = quiz.items.map((i) => ({ ...i }));

  const poolLabel = (it) => {
    const parts = [];
    if (it.subtopic) parts.push(m.subtopics.get(it.subtopic).name);
    else if (it.topic) parts.push(m.topics.get(it.topic).name);
    else if (it.subject) parts.push(m.subjects.get(it.subject).name);
    else parts.push('Any subject');
    if (it.subject && (it.topic || it.subtopic)) parts.push(`(${m.subjects.get(it.subject).name})`);
    if (it.type) parts.push(it.type === 'mcq' ? '· multiple choice' : '· calculated');
    if ((it.difficultyMin || 1) > 1 || (it.difficultyMax || 5) < 5) parts.push(`· difficulty ${it.difficultyMin || 1}–${it.difficultyMax || 5}`);
    return parts.join(' ');
  };
  const available = (it) => questions.filter((q) => matches(q, it)).length;

  el.innerHTML = `
    <div class="page-head"><div><h1>${existing ? 'Edit quiz' : 'New quiz'}</h1>
      <p class="secondary">Each attempt draws its own questions from categories and generates its own numbers.</p></div>
      <div class="row"><a class="btn" href="#/quizzes">Cancel</a><button class="btn-primary" id="save">Save quiz</button></div></div>
    <div class="grid" style="grid-template-columns:minmax(0,1fr)">
      <section class="card"><h2>Settings</h2>
        <div class="form-grid">
          <label class="field" style="grid-column:1/-1">Title<input id="title" value="${esc(quiz.title)}" placeholder="e.g. Week 3 — Determinants"></label>
          <label class="field" style="grid-column:1/-1">Description<input id="desc" value="${esc(quiz.description)}" placeholder="Shown to students before they start"></label>
          <label class="field">Time limit (minutes)<input id="time" type="number" min="0" max="600" value="${quiz.timeLimitMinutes}"><span class="help">0 = no time limit</span></label>
          <label class="field">Attempts allowed<input id="attempts" type="number" min="0" value="${quiz.maxAttempts}"><span class="help">0 = unlimited retakes</span></label>
          <label class="field">After submitting, students see<select id="results">
            ${Object.entries(RESULTS_LABEL).map(([k, v]) => `<option value="${k}" ${quiz.showResults === k ? 'selected' : ''}>${v}${k === 'full' ? ' (score + answers + solutions)' : k === 'score' ? ' (score and time only)' : ' (nothing)'}</option>`).join('')}</select></label>
          <label class="field">Grading<select id="feedback">
            <option value="deferred" ${quiz.feedback === 'deferred' ? 'selected' : ''}>At the end (exam style)</option>
            <option value="immediate" ${quiz.feedback === 'immediate' ? 'selected' : ''}>After each question (practice style)</option></select></label>
          <label class="check"><input type="checkbox" id="shuffle" ${quiz.shuffleQuestions ? 'checked' : ''}> Shuffle question order</label>
          <label class="check"><input type="checkbox" id="published" ${quiz.published ? 'checked' : ''}> Published (visible to students)</label>
        </div></section>

      <section class="card"><div class="card-head"><h2>Questions in this quiz</h2><span class="secondary small" id="summary"></span></div>
        <div id="items"></div></section>

      <div class="grid grid-2" style="align-items:start">
        <section class="card"><h2>Add a category (random draw)</h2>
          <p class="secondary small">Each student gets <i>N</i> random questions from the category — different students see different questions.</p>
          <div class="form-grid" id="pool-filters">${categoryFilters(m, { prefix: 'pl' })}
            <label class="field">How many<input type="number" id="pool-count" min="1" value="2"></label></div>
          <div class="row" style="margin-top:12px"><button class="btn-primary" id="add-pool">+ Add category</button><span class="secondary small" id="pool-avail"></span></div>
        </section>
        <section class="card"><h2>Add specific questions</h2>
          <div class="form-grid" id="q-filters">${categoryFilters(m, { prefix: 'qf', withDifficulty: false })}</div>
          <div class="table-wrap" style="max-height:360px;overflow:auto;margin-top:10px"><table><tbody id="q-rows"></tbody></table></div>
          <div class="preview-box" id="q-preview" style="margin-top:10px" hidden></div>
        </section>
      </div>
    </div>`;

  const itemsBox = el.querySelector('#items');
  function renderItems() {
    const fixed = new Set(items.filter((i) => i.kind === 'question').map((i) => i.questionId));
    let total = 0; let points = 0;
    itemsBox.innerHTML = items.length ? items.map((it, i) => {
      if (it.kind === 'question') {
        const q = byId.get(it.questionId);
        total += 1; points += Number(it.points || 1);
        return `<div class="item-row"><span class="kind">Question</span>
          <div><b>${esc(q ? q.title : it.questionId)}</b> <span class="muted small">${esc(it.questionId)}</span></div>
          <span></span>
          <label class="row small">pts <input type="number" min="1" value="${it.points || 1}" data-points="${i}"></label>
          <button class="btn-sm btn-ghost" data-rm="${i}" aria-label="Remove">✕</button></div>`;
      }
      const avail = questions.filter((q) => matches(q, it) && !fixed.has(q.id)).length;
      const n = Math.min(Number(it.count), avail);
      total += n; points += n * Number(it.points || 1);
      return `<div class="item-row"><span class="kind pool">Category</span>
        <div>${esc(poolLabel(it))}<br><span class="small ${avail < it.count ? 'warn' : 'muted'}">${avail} question${avail === 1 ? '' : 's'} available${avail < it.count ? ` — only ${avail} will be drawn` : ''}</span></div>
        <label class="row small">draw <input type="number" min="1" value="${it.count}" data-count="${i}"></label>
        <label class="row small">pts each <input type="number" min="1" value="${it.points || 1}" data-points="${i}"></label>
        <button class="btn-sm btn-ghost" data-rm="${i}" aria-label="Remove">✕</button></div>`;
    }).join('') : '<p class="muted">Nothing yet — add categories or specific questions below.</p>';
    el.querySelector('#summary').textContent = `${total} questions per attempt · ${points} points`;
  }
  itemsBox.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.count) items[t.dataset.count].count = Math.max(1, Number(t.value) || 1);
    if (t.dataset.points) items[t.dataset.points].points = Math.max(1, Number(t.value) || 1);
    clearTimeout(renderItems.t);
    renderItems.t = setTimeout(() => { const f = document.activeElement; const key = f && (f.dataset.count ? `[data-count="${f.dataset.count}"]` : f.dataset.points ? `[data-points="${f.dataset.points}"]` : null); renderItems(); if (key) itemsBox.querySelector(key)?.focus(); }, 500);
  });
  itemsBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rm]');
    if (b) { items.splice(Number(b.dataset.rm), 1); renderItems(); renderQRows(); }
  });

  // --- pools ---
  const poolAvail = el.querySelector('#pool-avail');
  const readPool = wireFilters(el.querySelector('#pool-filters'), m, 'pl', (f) => { poolAvail.textContent = `${available(f)} matching questions`; });
  poolAvail.textContent = `${available(readPool())} matching questions`;
  el.querySelector('#add-pool').addEventListener('click', () => {
    const f = readPool();
    if (!available(f)) { toast('No questions match that category'); return; }
    items.push({ kind: 'pool', ...f, difficultyMin: Number(f.difficultyMin || 1), difficultyMax: Number(f.difficultyMax || 5), count: Math.max(1, Number(el.querySelector('#pool-count').value) || 1), points: 1 });
    renderItems();
  });

  // --- specific questions ---
  const qRows = el.querySelector('#q-rows');
  const qPreview = el.querySelector('#q-preview');
  let qFilter = {};
  function renderQRows() {
    const chosen = new Set(items.filter((i) => i.kind === 'question').map((i) => i.questionId));
    qRows.innerHTML = questions.filter((q) => matches(q, qFilter)).map((q) => questionRow(q, m,
      `<td><button class="btn-sm" data-add="${esc(q.id)}" ${chosen.has(q.id) ? 'disabled' : ''}>${chosen.has(q.id) ? 'Added' : 'Add'}</button></td>`)).join('');
  }
  wireFilters(el.querySelector('#q-filters'), m, 'qf', (f) => { qFilter = f; renderQRows(); });
  qRows.addEventListener('click', async (e) => {
    const add = e.target.closest('[data-add]');
    if (add) { items.push({ kind: 'question', questionId: add.dataset.add, points: 1 }); renderItems(); renderQRows(); return; }
    const tr = e.target.closest('tr[data-q]');
    if (tr) { qPreview.hidden = false; await renderPreview(qPreview, tr.dataset.q); }
  });

  el.querySelector('#save').addEventListener('click', async () => {
    const body = {
      title: el.querySelector('#title').value, description: el.querySelector('#desc').value,
      timeLimitMinutes: Number(el.querySelector('#time').value), maxAttempts: Number(el.querySelector('#attempts').value),
      showResults: el.querySelector('#results').value, feedback: el.querySelector('#feedback').value,
      shuffleQuestions: el.querySelector('#shuffle').checked, published: el.querySelector('#published').checked, items,
    };
    try {
      if (existing) await PUT(`/quizzes/${existing.id}`, body); else await POST('/quizzes', body);
      toast('Quiz saved');
      location.hash = '#/quizzes';
    } catch (e) { toast(e.message, 5000); }
  });

  renderItems();
  renderQRows();
}
