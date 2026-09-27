import { GET, POST, esc, pct, humanDuration, dateTime, masteryBar, statusChip, meta, session, toast } from './ui.js';
import { lineChart } from './charts.js';
import { mountGraph } from './graph.js';

const REC_LABEL = { 'review-prerequisite': 'Fix first', practice: 'Practise', ready: 'Ready next' };

/** Student knowledge profile: strengths, weaknesses, recommendations, trajectory. */
export async function profileView(el, userId) {
  const [p, m, graph] = await Promise.all([GET(`/users/${userId}/profile`), meta(), GET('/graph')]);
  const me = session.user.id === userId;
  const o = p.overall;
  const subName = (id) => (m.subtopics.get(id) || {}).name || id;

  const subjectsHtml = [...m.subjects.values()].map((s) => {
    const sm = p.subjects[s.id];
    return `<details class="subject" ${sm.mastery !== null ? 'open' : ''}>
      <summary>${masteryBar(s.name, sm, { title: `${s.name}: ${sm.mastery === null ? 'not assessed' : `${pct(sm.mastery)} · ${sm.label} · ${sm.assessedSubtopics}/${sm.totalSubtopics} subtopics assessed`}` })}</summary>
      ${s.topics.map((t) => {
        const tm = p.topics[t.id];
        return `<div class="topic-block">${masteryBar(t.name, tm)}
          <div class="sub">${t.subtopics.map((st) => {
            const x = p.subtopics[st.id];
            return masteryBar(st.name, x, { title: `${st.name}: ${x.mastery === null ? 'not assessed' : `${pct(x.mastery)} · ${x.label} · ${x.correct}/${x.attempts} correct`}` });
          }).join('')}</div></div>`;
      }).join('')}
    </details>`;
  }).join('');

  const skillList = (items, empty) => (items.length ? `<ul class="list">${items.map((s) => `
    <li class="row"><span style="flex:1;min-width:0">${esc(s.name)}<br><span class="muted small">${esc(m.subjects.get(s.subject).name)} · ${s.correct}/${s.attempts} correct</span></span>
    <span class="num"><b>${pct(s.mastery)}</b></span> ${statusChip(s)}</li>`).join('')}</ul>` : `<p class="muted">${empty}</p>`);

  el.innerHTML = `
    <div class="page-head">
      <div><div class="muted small">Knowledge profile</div><h1>${esc(p.user.name)}</h1>
        <p class="secondary">Updated after every graded answer. Mastery = estimated chance of solving a medium-difficulty question on that skill.</p></div>
      ${me ? '<button class="btn-primary" id="practice">✦ Practice my weak spots</button>' : ''}
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Overall mastery</div><div class="value">${pct(o.mastery)}</div><div class="sub">${statusChip(o)}</div></div>
      <div class="card tile"><div class="label">Questions answered</div><div class="value num">${o.answered}</div><div class="sub">${o.correct} correct · ${pct(o.accuracy)} accuracy</div></div>
      <div class="card tile"><div class="label">Coverage</div><div class="value">${pct(o.coverage)}</div><div class="sub">of subtopics assessed</div></div>
      <div class="card tile"><div class="label">Quizzes submitted</div><div class="value num">${p.attempts.length}</div>
        <div class="sub">${p.attempts.length ? `avg time ${humanDuration(p.attempts.reduce((a, x) => a + x.durationMs, 0) / p.attempts.length)}` : '—'}</div></div>
    </div>
    ${o.answered ? '' : '<div class="card empty" style="margin-bottom:16px">No graded answers yet — take a quiz (the placement test is a good start) and this page fills in.</div>'}
    <div class="grid grid-2">
      <section class="card"><div class="card-head"><h2>Strong at</h2><span class="muted small">top skills</span></div>
        ${skillList(p.strengths, 'Nothing stands out yet — keep answering.')}</section>
      <section class="card"><div class="card-head"><h2>Needs improvement</h2><span class="muted small">lowest mastery</span></div>
        ${skillList(p.weaknesses, 'No weak spots detected so far.')}</section>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>What to do next</h2><span class="muted small">uses the prerequisite graph to find root causes</span></div>
      ${p.recommendations.length ? `<ul class="list">${p.recommendations.slice(0, 8).map((r) => `
        <li class="rec"><span class="rec-kind ${r.kind}">${REC_LABEL[r.kind]}</span><span>${esc(r.message)}</span></li>`).join('')}</ul>`
        : '<p class="muted">Recommendations appear once there is enough evidence.</p>'}
    </section>
    <div class="grid grid-2" style="margin-top:16px">
      <section class="card"><div class="card-head"><h2>Mastery by subject, topic & subtopic</h2></div>
        <div class="legend" style="margin-bottom:8px">
          <span><span class="status mastered">Mastered ≥80%</span></span><span><span class="status proficient">Proficient ≥60%</span></span>
          <span><span class="status developing">Developing ≥40%</span></span><span><span class="status needs-work">Needs work</span></span>
        </div>
        ${subjectsHtml}</section>
      <div class="stack">
        <section class="card"><div class="card-head"><h2>Profile after each answer</h2><span class="muted small">overall mastery</span></div>
          <div id="traj">${p.timeline.length ? '' : '<p class="muted">No answers yet.</p>'}</div></section>
        <section class="card" style="padding:0;overflow:hidden"><div class="card-head" style="padding:16px 18px 0"><h2>Skill map</h2><a class="small" href="#/graph?user=${esc(userId)}">Open full graph →</a></div>
          <div class="graph-wrap" id="mini-graph" style="border:0;border-radius:0;height:380px;min-height:0"></div></section>
      </div>
    </div>
    <section class="card" style="margin-top:16px"><div class="card-head"><h2>Attempt history</h2></div>
      ${p.attempts.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Quiz</th><th>Submitted</th><th class="num">Score</th><th class="num">Correct</th><th class="num">Time taken</th></tr></thead>
        <tbody>${p.attempts.map((a) => `<tr class="clickable" data-href="#/result/${a.id}"><td>${esc(a.quizTitle)} <span class="muted small">#${a.number}</span></td>
          <td>${dateTime(a.submittedAt)}</td><td class="num">${a.score === null ? '<span class="muted">hidden</span>' : pct(a.score / a.maxScore)}</td>
          <td class="num">${a.correctCount === null ? '—' : `${a.correctCount}/${a.questionCount}`}</td><td class="num">${humanDuration(a.durationMs)}</td></tr>`).join('')}</tbody>
      </table></div>` : '<p class="muted">No submitted attempts yet.</p>'}
    </section>`;

  if (p.timeline.length) {
    lineChart(el.querySelector('#traj'), p.timeline.map((t) => ({
      y: t.overall,
      tip: `<b>Answer ${t.i}</b> · ${t.correct ? '✓ correct' : '✗ wrong'}<br>${esc(subName(t.subtopic))}: ${pct(t.subtopicMastery)}<br>Overall: ${pct(t.overall)}`,
    })), { yLabel: 'Overall mastery after each answer', xLabel: 'Answers, in order' });
  }
  mountGraph(el.querySelector('#mini-graph'), graph, { profile: p, colorBy: 'mastery', compact: true });
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  el.querySelector('#practice')?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const qz = await POST(`/users/${userId}/practice`);
      const attempt = await POST(`/quizzes/${qz.id}/attempts`);
      location.hash = `#/attempt/${attempt.id}`;
    } catch (err) { toast(err.message); e.target.disabled = false; }
  });
}
