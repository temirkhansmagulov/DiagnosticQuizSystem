import { GET, PUT, POST, esc, duration, renderMath, toast, FEEDBACK_LABEL } from './ui.js';

/** Quiz-taking screen: timer, question navigator, autosave, instant feedback. */
export async function playerView(el, attemptId) {
  let attempt = await GET(`/attempts/${attemptId}`);
  if (attempt.status !== 'in_progress') { location.hash = `#/result/${attemptId}`; return; }

  const offset = attempt.serverNow - Date.now(); // client/server clock skew
  const now = () => Date.now() + offset;
  const qs = attempt.questions;
  const immediate = attempt.feedback === 'immediate';
  let current = Math.max(0, qs.findIndex((q) => q.response === null));
  let shownAt = Date.now();
  const spent = qs.map(() => 0);
  const pending = new Map(); // index -> timer
  let submitting = false;

  el.innerHTML = `
    <div class="player-bar">
      <div><div class="small muted">Attempt #${attempt.number} · ${FEEDBACK_LABEL[attempt.feedback]}</div><b>${esc(attempt.quizTitle)}</b></div>
      <span class="spacer"></span>
      ${attempt.deadline ? '<div class="clock" id="left"><span class="label">Time left</span><span class="time">--:--</span></div>' : ''}
      <div class="clock" id="elapsed"><span class="label">Time taken</span><span class="time">0:00</span></div>
      <div class="clock"><span class="label">Answered</span><span class="time" id="progress"></span></div>
      <button class="btn-primary" id="submit">Submit quiz</button>
    </div>
    <div class="navdots" id="dots" aria-label="Questions"></div>
    <section class="card" id="qcard"></section>`;

  const dots = el.querySelector('#dots');
  const card = el.querySelector('#qcard');

  function answeredCount() { return qs.filter((q) => q.response !== null && q.response !== '').length; }

  function renderDots() {
    dots.innerHTML = qs.map((q, i) => {
      const cls = q.correct === true ? 'right' : q.correct === false ? 'wrong' : q.response !== null && q.response !== '' ? 'answered' : '';
      const label = `Question ${i + 1}${cls === 'right' ? ', correct' : cls === 'wrong' ? ', incorrect' : cls ? ', answered' : ''}`;
      return `<button class="navdot ${cls} ${i === current ? 'current' : ''}" data-i="${i}" aria-label="${label}">${i + 1}</button>`;
    }).join('');
    el.querySelector('#progress').textContent = `${answeredCount()}/${qs.length}`;
  }

  function feedbackHtml(q) {
    if (q.correct === undefined) return '';
    return `<div class="feedback ${q.correct ? 'right' : 'wrong'}">
      <div class="verdict ${q.correct ? 'right' : 'wrong'}">${q.correct ? '✓ Correct' : '✗ Not quite'}</div>
      ${q.correct ? '' : `<div>Correct answer: ${esc(q.correctAnswer)}</div>`}
      ${q.solution ? `<div class="secondary small" style="margin-top:6px">${esc(q.solution)}</div>` : ''}
    </div>`;
  }

  function renderQuestion() {
    const q = qs[current];
    const locked = immediate && q.correct !== undefined;
    let input;
    if (q.type === 'mcq') {
      input = `<div class="options" role="radiogroup">${q.options.map((o) => {
        let cls = q.response === o.id ? 'selected' : '';
        if (locked && q.response === o.id) cls += q.correct ? ' correct' : ' incorrect';
        return `<label class="option ${cls}"><input type="radio" name="opt" value="${esc(o.id)}" ${q.response === o.id ? 'checked' : ''} ${locked ? 'disabled' : ''}>
          <span class="letter">${esc(o.id.toUpperCase())}</span><span>${esc(o.text)}</span></label>`;
      }).join('')}</div>`;
    } else {
      input = `<div class="row">
          <input class="answer-input" id="ans" autocomplete="off" inputmode="text" placeholder="Your answer" value="${esc(q.response ?? '')}" ${locked ? 'disabled' : ''} aria-label="Your answer">
          ${q.unit ? `<span class="secondary">${esc(q.unit)}</span>` : ''}
        </div>
        <div class="help" style="margin-top:6px">${esc(q.inputHint || 'Enter a number. Fractions (3/4) and expressions like sqrt(2), pi/6 or 2^10 are accepted.')}</div>`;
    }
    card.innerHTML = `
      <div class="row"><span class="muted small">Question ${current + 1} of ${qs.length} · ${q.points} pt${q.points === 1 ? '' : 's'}</span></div>
      <div class="qtext">${esc(q.text)}</div>
      ${input}
      <div class="row" style="margin-top:12px"><span class="save-state" id="save-state"></span></div>
      <div id="fb">${feedbackHtml(q)}</div>
      <div class="row" style="margin-top:20px">
        <button id="prev" ${current === 0 ? 'disabled' : ''}>← Previous</button>
        ${immediate && !locked ? '<button class="btn-primary" id="check">Check answer</button>' : ''}
        <span class="spacer"></span>
        ${current < qs.length - 1 ? '<button id="next">Next →</button>' : '<button class="btn-primary" id="finish">Finish & submit</button>'}
      </div>`;
    renderMath(card);

    if (q.type === 'mcq') {
      card.querySelectorAll('input[name=opt]').forEach((r) => r.addEventListener('change', () => {
        q.response = r.value;
        card.querySelectorAll('.option').forEach((o) => o.classList.toggle('selected', o.querySelector('input').checked));
        renderDots();
        if (!immediate) save(current);
      }));
    } else if (!locked) {
      const inp = card.querySelector('#ans');
      inp.addEventListener('input', () => {
        q.response = inp.value;
        renderDots();
        if (!immediate) scheduleSave(current);
      });
      inp.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        if (immediate) check(); else { save(current); if (current < qs.length - 1) go(current + 1); }
      });
      inp.focus();
    }
    card.querySelector('#prev').addEventListener('click', () => go(current - 1));
    card.querySelector('#next')?.addEventListener('click', () => go(current + 1));
    card.querySelector('#finish')?.addEventListener('click', submit);
    card.querySelector('#check')?.addEventListener('click', check);
  }

  function setSaveState(text) {
    const s = card.querySelector('#save-state');
    if (s) s.textContent = text;
  }
  function trackTime() {
    spent[current] += Date.now() - shownAt;
    shownAt = Date.now();
  }
  function scheduleSave(i) {
    clearTimeout(pending.get(i));
    setSaveState('Saving…');
    pending.set(i, setTimeout(() => save(i), 700));
  }
  async function save(i) {
    clearTimeout(pending.get(i));
    pending.delete(i);
    if (i === current) trackTime();
    const q = qs[i];
    try {
      const r = await PUT(`/attempts/${attemptId}/answers/${i}`, { response: q.response, timeSpentMs: spent[i] });
      if (i === current) {
        if (q.type === 'numeric' && q.response && r.parsed === null) setSaveState('⚠ Saved, but this doesn\'t look like a number — check the format.');
        else setSaveState(q.response ? `Saved${r.parsed !== undefined && r.parsed !== null && String(r.parsed) !== String(q.response).trim() ? ` · read as ${r.parsed}` : ''}` : '');
      }
      return r;
    } catch (e) {
      if (i === current) setSaveState(`Not saved: ${e.message}`);
      if (e.status === 409) finishExpired();
      throw e;
    }
  }
  async function check() {
    const q = qs[current];
    if (q.response === null || q.response === '') { toast('Enter an answer first'); return; }
    try {
      const r = await save(current);
      Object.assign(q, { correct: r.correct, correctAnswer: r.correctAnswer, solution: r.solution });
      renderDots();
      renderQuestion();
    } catch { /* message already shown */ }
  }
  function go(i) {
    if (i < 0 || i >= qs.length) return;
    if (pending.has(current)) save(current);
    trackTime();
    current = i;
    renderDots();
    renderQuestion();
  }
  async function flush() {
    await Promise.allSettled([...pending.keys()].map((i) => save(i)));
  }
  async function submit() {
    if (submitting) return;
    const missing = qs.length - answeredCount();
    if (!confirm(missing ? `You have ${missing} unanswered question${missing > 1 ? 's' : ''}. Submit anyway?` : 'Submit your answers? You cannot change them afterwards.')) return;
    await doSubmit();
  }
  async function doSubmit() {
    submitting = true;
    await flush();
    try {
      await POST(`/attempts/${attemptId}/submit`);
    } catch (e) { if (e.status !== 409) { toast(e.message); submitting = false; return; } }
    location.hash = `#/result/${attemptId}`;
  }
  function finishExpired() {
    if (submitting) return;
    toast('Time is up — submitting your answers.');
    doSubmit();
  }

  dots.addEventListener('click', (e) => { const b = e.target.closest('[data-i]'); if (b) go(Number(b.dataset.i)); });
  el.querySelector('#submit').addEventListener('click', submit);

  const tick = () => {
    el.querySelector('#elapsed .time').textContent = duration(now() - attempt.startedAt);
    if (attempt.deadline) {
      const left = attempt.deadline - now();
      const box = el.querySelector('#left');
      box.querySelector('.time').textContent = duration(Math.max(0, left));
      box.classList.toggle('low', left < 60000);
      if (left <= 0) finishExpired();
    }
  };
  tick();
  const timer = setInterval(tick, 500);
  const beforeUnload = () => { trackTime(); for (const i of pending.keys()) save(i); };
  window.addEventListener('beforeunload', beforeUnload);

  renderDots();
  renderQuestion();

  return () => {
    clearInterval(timer);
    window.removeEventListener('beforeunload', beforeUnload);
    if (!submitting) flush();
  };
}
