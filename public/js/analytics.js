import { GET, esc, pct, meta, humanDuration, masteryBar, difficulty } from './ui.js';
import { seqColor } from './charts.js';
import { levelOf } from './levels.js';

/** Instructor: class-wide statistics — who struggles with what. */
export async function analyticsView(el) {
  const [a, m] = await Promise.all([GET('/analytics'), meta()]);
  const subjects = [...m.subjects.values()];
  const withData = a.students.filter((s) => s.answered);
  const totalAttempts = a.quizzes.reduce((x, q) => x + q.attempts, 0);
  const scored = a.quizzes.filter((q) => q.avgScorePct !== null);
  const avgScore = scored.length ? scored.reduce((x, q) => x + q.avgScorePct * q.attempts, 0) / scored.reduce((x, q) => x + q.attempts, 0) : null;
  const classMastery = withData.length ? withData.reduce((x, s) => x + s.mastery, 0) / withData.length : null;

  const weakest = Object.entries(a.subtopics).filter(([, v]) => v.mastery !== null)
    .sort((x, y) => x[1].mastery - y[1].mastery).slice(0, 8);

  el.innerHTML = `
    <div class="page-head"><div><h1>Class analytics</h1><p class="secondary">How students are doing across subjects, topics and individual questions.</p></div></div>
    <div class="tiles">
      <div class="card tile"><div class="label">Students</div><div class="value num">${a.students.length}</div><div class="sub">${withData.length} with answers</div></div>
      <div class="card tile"><div class="label">Submitted attempts</div><div class="value num">${totalAttempts}</div><div class="sub">across ${a.quizzes.length} quizzes</div></div>
      <div class="card tile"><div class="label">Average score</div><div class="value">${pct(avgScore)}</div><div class="sub">all submitted attempts</div></div>
      <div class="card tile"><div class="label">Average mastery</div><div class="value">${pct(classMastery)}</div><div class="sub">per student, then averaged</div></div>
    </div>

    <section class="card"><div class="card-head"><h2>Student × topic mastery</h2>
      <div class="row"><label class="field">Show<select id="level"><option value="topics">Topics</option><option value="subjects">Subjects</option></select></label></div></div>
      <div class="legend" style="margin-bottom:10px"><span>Mastery:</span>
        ${[0.1, 0.3, 0.5, 0.7, 0.9].map((v) => { const [bg] = seqColor(v); return `<span><span class="sw" style="background:${bg}"></span>${Math.round((v - 0.1) * 100)}–${Math.round((v + 0.1) * 100)}%</span>`; }).join('')}
        <span><span class="sw" style="background:repeating-linear-gradient(45deg,var(--seq-0),var(--seq-0) 2px,transparent 2px,transparent 4px);border:1px solid var(--grid)"></span>not assessed</span></div>
      <div class="table-wrap" id="heat"></div>
      <p class="muted small">Click a student to open their profile. Hover a cell for details.</p></section>

    <div class="grid grid-2" style="margin-top:16px;align-items:start">
      <section class="card"><div class="card-head"><h2>Weakest subtopics (class)</h2><span class="muted small">avg mastery · students below 50%</span></div>
        ${weakest.length ? weakest.map(([id, v]) => {
          const st = m.subtopics.get(id);
          const lvl = levelOf(v.mastery);
          return `<div>${masteryBar(`${st.name}`, { mastery: v.mastery, ...lvl }, { title: `${st.name}: class average ${pct(v.mastery)}, ${v.struggling}/${v.students} students below 50%, ${pct(v.accuracy)} of ${v.attempts} answers correct` })}
            <div class="muted small" style="margin:-4px 0 6px">${esc(m.subjects.get(st.subject).name)} · ${v.struggling} of ${v.students} struggling · ${pct(v.accuracy)} correct</div></div>`;
        }).join('') : '<p class="muted">No data yet.</p>'}</section>
      <section class="card"><div class="card-head"><h2>Subjects (class average)</h2></div>
        ${subjects.map((s) => { const v = a.subjects[s.id]; return masteryBar(s.name, { mastery: v.mastery, ...levelOf(v.mastery) }, { title: `${s.name}: ${pct(v.mastery)} across ${v.students} students` }); }).join('')}</section>
    </div>

    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Quizzes</h2></div><div class="table-wrap"><table>
      <thead><tr><th>Quiz</th><th class="num">Attempts</th><th class="num">Students</th><th class="num">In progress</th><th class="num">Avg score</th><th class="num">Range</th><th class="num">Avg time</th><th>Score distribution</th></tr></thead>
      <tbody>${a.quizzes.map((q) => `<tr><td>${esc(q.title)}</td><td class="num">${q.attempts}</td><td class="num">${q.students}</td><td class="num">${q.inProgress}</td>
        <td class="num">${pct(q.avgScorePct)}</td><td class="num">${q.attempts ? `${pct(q.minScorePct)}–${pct(q.maxScorePct)}` : '—'}</td><td class="num">${humanDuration(q.avgDurationMs)}</td>
        <td>${strip(q.scores)}</td></tr>`).join('')}</tbody></table></div></section>

    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Question analysis</h2><span class="muted small">hardest first — flags questions that play harder or easier than their rating</span></div>
      <div class="table-wrap"><table>
      <thead><tr><th>Question</th><th>Subtopic</th><th>Rated</th><th class="num">Times seen</th><th class="num">% correct</th><th class="num">Avg time</th><th></th></tr></thead>
      <tbody id="qrows">${a.questions.map((q, i) => {
        const expected = 1 / (1 + Math.exp(((q.difficulty || 3) - 3) * 0.75)); // what the rating predicts for an average student
        const flag = q.seen >= 4 && q.pctCorrect < expected - 0.3 ? '<span class="chip">plays harder than rated</span>'
          : q.seen >= 4 && q.pctCorrect > expected + 0.3 ? '<span class="chip">plays easier than rated</span>' : '';
        return `<tr ${i >= 15 ? 'hidden' : ''}><td>${esc(q.title)}<br><span class="muted small">${esc(q.id)}</span></td><td class="small">${esc((m.subtopics.get(q.primarySubtopic) || {}).name || '')}</td>
          <td>${q.difficulty ? difficulty(q.difficulty) : ''}</td><td class="num">${q.seen}</td><td class="num">${pct(q.pctCorrect)}</td><td class="num">${humanDuration(q.avgTimeMs)}</td><td>${flag}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">No answers yet.</td></tr>'}</tbody></table></div>
      ${a.questions.length > 15 ? `<button id="allq" style="margin-top:10px">Show all ${a.questions.length} questions</button>` : ''}</section>`;

  const heat = el.querySelector('#heat');
  const renderHeat = (level) => {
    const cols = level === 'subjects' ? subjects.map((s) => ({ id: s.id, name: s.name })) : [...m.topics.values()].map((t) => ({ id: t.id, name: t.name, subject: t.subject }));
    heat.innerHTML = `<table class="heat"><thead><tr><th></th><th class="num" style="vertical-align:bottom">Overall</th>${cols.map((c) => `<th class="col" title="${esc(c.name)}">${esc(c.name)}</th>`).join('')}</tr></thead>
      <tbody>${a.students.map((s) => `<tr class="clickable" data-href="#/profile/${esc(s.id)}"><td class="name"><a href="#/profile/${esc(s.id)}">${esc(s.name)}</a></td>
        ${cell(s.mastery, `${s.name} overall: ${pct(s.mastery)} · ${s.answered} answers`)}
        ${cols.map((c) => cell(s[level][c.id], `${s.name} — ${c.name}: ${s[level][c.id] === null ? 'not assessed' : pct(s[level][c.id])}`)).join('')}</tr>`).join('')}
      </tbody></table>`;
    heat.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  };
  el.querySelector('#allq')?.addEventListener('click', (e) => { el.querySelectorAll('#qrows tr[hidden]').forEach((tr) => { tr.hidden = false; }); e.target.remove(); });
  renderHeat('topics');
  el.querySelector('#level').addEventListener('change', (e) => renderHeat(e.target.value));
}

function cell(v, title) {
  if (v === null || v === undefined) return `<td class="na" title="${esc(title)}">·</td>`;
  const [bg, fg] = seqColor(v);
  return `<td style="background:${bg};color:${fg}" title="${esc(title)}">${Math.round(v * 100)}</td>`;
}

/** Tiny dot strip of attempt scores on a 0–100% axis. */
function strip(scores) {
  if (!scores.length) return '<span class="muted small">—</span>';
  const W = 140; const H = 18;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scores: ${scores.map((s) => Math.round(s * 100) + '%').join(', ')}">
    <line x1="4" x2="${W - 4}" y1="${H / 2}" y2="${H / 2}" stroke="var(--grid)" stroke-width="2"/>
    ${scores.map((s) => `<circle cx="${4 + s * (W - 8)}" cy="${H / 2}" r="4" fill="var(--accent)" fill-opacity="0.55" stroke="var(--surface)" stroke-width="1"><title>${Math.round(s * 100)}%</title></circle>`).join('')}
  </svg>`;
}
