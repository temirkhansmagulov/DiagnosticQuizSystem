import { GET, esc, pct, humanDuration, dateTime, renderMath, session } from './ui.js';

/** Result screen after submitting: score, time taken, per-question review (if allowed). */
export async function resultView(el, attemptId) {
  const a = await GET(`/attempts/${attemptId}`);
  if (a.status === 'in_progress') { location.hash = `#/attempt/${attemptId}`; return; }
  const isInstructor = session.user.role === 'instructor';
  const hasScore = a.score !== undefined;

  const reviewItem = (q) => {
    let yours;
    if (q.type === 'mcq') {
      const chosen = q.options.find((o) => o.id === q.response);
      yours = chosen ? `${q.response.toUpperCase()}) ${esc(chosen.text)}` : '<span class="muted">no answer</span>';
    } else yours = q.response === null || q.response === '' ? '<span class="muted">no answer</span>' : esc(q.response);
    return `<div class="review-item">
      <div class="row"><b>Question ${q.index + 1}</b>
        <span class="verdict ${q.correct ? 'right' : 'wrong'}">${q.correct ? '✓ Correct' : '✗ Incorrect'}</span>
        <span class="spacer"></span><span class="muted small">${q.points} pt · ${humanDuration(q.timeSpentMs)}</span></div>
      <div class="qtext" style="font-size:15px;margin:6px 0 10px">${esc(q.text)}</div>
      <dl class="kv">
        <dt>Your answer</dt><dd>${yours}</dd>
        ${q.correct ? '' : `<dt>Correct answer</dt><dd>${esc(q.correctAnswer)}</dd>`}
        ${q.solution ? `<dt>Solution</dt><dd class="secondary">${esc(q.solution)}</dd>` : ''}
      </dl>
    </div>`;
  };

  el.innerHTML = `
    <div class="page-head"><div>
      <div class="muted small">Attempt #${a.number} · submitted ${dateTime(a.submittedAt)}</div>
      <h1>${esc(a.quizTitle)}</h1></div>
      <div class="row">
        ${isInstructor ? '' : `<a class="btn" href="#/">Back to quizzes</a><a class="btn btn-primary" href="#/profile/${session.user.id}">See my updated profile →</a>`}
      </div>
    </div>
    <section class="card">
      <div class="hero">
        ${hasScore ? `
          <div><div class="muted small">Score</div><div class="big">${pct(a.maxScore ? a.score / a.maxScore : 0)}</div></div>
          <div><div class="muted small">Correct answers</div><div class="big num">${a.correctCount}<span class="muted" style="font-size:28px">/${a.questionCount}</span></div></div>
          <div><div class="muted small">Points</div><div class="big num">${a.score}<span class="muted" style="font-size:28px">/${a.maxScore}</span></div></div>`
        : '<div><h2>Submission recorded</h2><p class="secondary">Your instructor has hidden the results for this quiz. Your answers still feed your knowledge profile.</p></div>'}
        <div><div class="muted small">Time taken</div><div class="big num">${humanDuration(a.durationMs)}</div>
          ${a.timedOut ? '<span class="chip">Auto-submitted when time ran out</span>' : ''}</div>
      </div>
      ${hasScore && !a.questions ? '<p class="secondary" style="margin-top:14px">This quiz shows your score only — individual answers are not revealed.</p>' : ''}
    </section>
    ${a.questions ? `<section class="card" style="margin-top:16px"><h2>Review</h2>${a.questions.map(reviewItem).join('')}</section>` : ''}`;
  renderMath(el);
}
