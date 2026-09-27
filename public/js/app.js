import { session, GET, POST, esc, pct, humanDuration, dateTime, toast, RESULTS_LABEL, FEEDBACK_LABEL } from './ui.js';
import { playerView } from './player.js';
import { resultView } from './result.js';
import { profileView } from './profile.js';
import { graphView } from './graph.js';
import { bankView } from './bank.js';
import { quizzesView, builderView } from './builder.js';
import { analyticsView } from './analytics.js';

const app = document.getElementById('app');
let cleanup = null;

const ROUTES = [
  [/^\/login$/, loginView, { auth: false }],
  [/^\/$/, homeView],
  [/^\/attempt\/([^/]+)$/, playerView, { role: 'student' }],
  [/^\/result\/([^/]+)$/, resultView],
  [/^\/profile\/([^/]+)$/, profileView],
  [/^\/graph$/, graphView],
  [/^\/bank$/, bankView, { role: 'instructor' }],
  [/^\/quizzes$/, quizzesView, { role: 'instructor' }],
  [/^\/quizzes\/new$/, builderView, { role: 'instructor' }],
  [/^\/quizzes\/([^/]+)\/edit$/, builderView, { role: 'instructor' }],
  [/^\/analytics$/, analyticsView, { role: 'instructor' }],
];

async function ensureUser() {
  if (session.user && session.user.id === session.userId) return session.user;
  if (!session.userId) return null;
  const users = await GET('/users');
  session.user = users.find((u) => u.id === session.userId) || null;
  if (!session.user) session.userId = null;
  return session.user;
}

function renderChrome() {
  const u = session.user;
  const nav = document.getElementById('nav');
  const who = document.getElementById('whoami');
  if (!u) { nav.innerHTML = ''; who.innerHTML = ''; return; }
  const links = u.role === 'instructor'
    ? [['#/quizzes', 'Quizzes'], ['#/bank', 'Question bank'], ['#/analytics', 'Analytics'], ['#/graph', 'Topic graph']]
    : [['#/', 'Quizzes'], [`#/profile/${u.id}`, 'My profile'], ['#/graph', 'Topic graph']];
  const here = location.hash || '#/';
  nav.innerHTML = links.map(([href, label]) => `<a href="${href}" class="${here === href || (href !== '#/' && here.startsWith(href)) ? 'active' : ''}">${label}</a>`).join('');
  who.innerHTML = `<span class="avatar" aria-hidden="true">${esc(u.name[0] || '?')}</span><span class="name">${esc(u.name)}</span>
    <a class="btn btn-sm btn-ghost" href="#/login" title="Switch user">Switch</a>`;
}

async function router() {
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = null; }
  const path = (location.hash || '#/').slice(1).split('?')[0] || '/';
  const found = ROUTES.map(([re, view, opts = {}]) => ({ m: re.exec(path), view, opts })).find((r) => r.m);
  if (!found) { location.hash = '#/'; return; }
  try {
    const user = await ensureUser();
    if (found.opts.auth !== false && !user) { location.hash = '#/login'; return; }
    if (found.opts.role && user.role !== found.opts.role) { location.hash = user.role === 'instructor' ? '#/quizzes' : '#/'; return; }
    renderChrome();
    window.scrollTo(0, 0);
    app.innerHTML = '<div class="empty">Loading…</div>';
    cleanup = (await found.view(app, ...found.m.slice(1))) || null;
  } catch (e) {
    console.error(e);
    app.innerHTML = `<div class="card empty"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Back home</a></div>`;
  }
}
window.addEventListener('hashchange', router);
router();

// ---------------------------------------------------------------- login
async function loginView(el) {
  const users = await GET('/users');
  const group = (role) => users.filter((u) => u.role === role).map((u) => `
    <button class="user-pick" data-id="${esc(u.id)}"><span class="avatar">${esc(u.name[0])}</span><span>${esc(u.name)}</span></button>`).join('');
  el.innerHTML = `
    <div class="page-head"><div><h1>Who's using the system?</h1>
      <p class="secondary">Demo sign-in: pick a user or create one. (No passwords — see README for adding real auth.)</p></div></div>
    <div class="grid grid-2">
      <section class="card"><h2>Students</h2><div class="stack">${group('student') || '<p class="muted">No students yet.</p>'}</div></section>
      <section class="card"><h2>Instructors</h2><div class="stack">${group('instructor') || '<p class="muted">No instructors yet.</p>'}</div>
        <h2 style="margin-top:24px">New user</h2>
        <form id="new-user" class="row">
          <input name="name" placeholder="Name" required style="flex:1">
          <select name="role"><option value="student">Student</option><option value="instructor">Instructor</option></select>
          <button class="btn-primary">Create</button>
        </form>
      </section>
    </div>`;
  const pick = (u) => {
    session.userId = u.id;
    session.user = u;
    location.hash = u.role === 'instructor' ? '#/quizzes' : '#/';
  };
  el.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => pick(users.find((u) => u.id === b.dataset.id))));
  el.querySelector('#new-user').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    pick(await POST('/users', { name: f.get('name'), role: f.get('role') }));
  });
}

// ---------------------------------------------------------------- student home
async function homeView(el) {
  const u = session.user;
  if (u.role === 'instructor') { location.hash = '#/quizzes'; return; }
  const [quizzes, profile] = await Promise.all([GET('/quizzes'), GET(`/users/${u.id}/profile`)]);
  const o = profile.overall;
  const practice = quizzes.filter((q) => q.kind === 'practice');
  const regular = quizzes.filter((q) => q.kind !== 'practice');

  const card = (q) => {
    const noneLeft = q.attemptsLeft === 0 && !q.inProgressAttemptId;
    const action = q.inProgressAttemptId
      ? `<a class="btn btn-primary" href="#/attempt/${q.inProgressAttemptId}">Resume</a>`
      : noneLeft ? '<button disabled>No attempts left</button>'
        : `<button class="btn-primary" data-start="${esc(q.id)}">${q.myAttempts ? 'Retake' : 'Start'}</button>`;
    return `<article class="card quiz-card">
      <div class="row"><h3 style="margin:0">${esc(q.title)}</h3>${q.kind === 'practice' ? '<span class="chip accent">Personal practice</span>' : ''}</div>
      <div class="desc">${esc(q.description || '')}</div>
      <div class="chips">
        <span class="chip">${q.questionCount} questions</span>
        <span class="chip">${q.timeLimitMinutes ? `⏱ ${q.timeLimitMinutes} min` : 'No time limit'}</span>
        <span class="chip">${q.maxAttempts ? `${q.attemptsLeft} of ${q.maxAttempts} attempts left` : 'Unlimited attempts'}</span>
        <span class="chip">${RESULTS_LABEL[q.showResults]}</span>
        <span class="chip">${FEEDBACK_LABEL[q.feedback]}</span>
      </div>
      <div class="row">
        ${action}
        ${q.lastAttemptId ? `<a class="btn" href="#/result/${q.lastAttemptId}">Last result</a>` : ''}
        <span class="spacer"></span>
        ${q.bestScorePct !== undefined ? `<span class="secondary small">Best: <b>${pct(q.bestScorePct)}</b></span>` : ''}
      </div>
    </article>`;
  };

  el.innerHTML = `
    <div class="page-head">
      <div><h1>Hi ${esc(u.name)}</h1><p class="secondary">Every answer you submit updates your knowledge profile.</p></div>
      <div class="row">
        <a class="btn" href="#/profile/${u.id}">View my profile</a>
        <button class="btn-primary" id="practice">✦ Practice my weak spots</button>
      </div>
    </div>
    <div class="tiles">
      <div class="card tile"><div class="label">Overall mastery</div><div class="value">${pct(o.mastery)}</div><div class="sub">${esc(o.label)}</div></div>
      <div class="card tile"><div class="label">Questions answered</div><div class="value num">${o.answered}</div><div class="sub">${o.correct} correct</div></div>
      <div class="card tile"><div class="label">Accuracy</div><div class="value">${pct(o.accuracy)}</div><div class="sub">across all quizzes</div></div>
      <div class="card tile"><div class="label">Topics covered</div><div class="value">${pct(o.coverage)}</div><div class="sub">of all subtopics assessed</div></div>
    </div>
    ${practice.length ? `<h2>Your practice sets</h2><div class="grid grid-3" style="margin-bottom:24px">${practice.map(card).join('')}</div>` : ''}
    <h2>Available quizzes</h2>
    <div class="grid grid-3">${regular.map(card).join('') || '<div class="card empty">No quizzes published yet.</div>'}</div>
    ${profile.attempts.length ? `
    <section class="card" style="margin-top:24px"><div class="card-head"><h2>Recent attempts</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Quiz</th><th>Finished</th><th class="num">Score</th><th class="num">Correct</th><th class="num">Time taken</th></tr></thead>
        <tbody>${profile.attempts.slice(0, 8).map((a) => `<tr class="clickable" data-href="#/result/${a.id}">
          <td>${esc(a.quizTitle)} <span class="muted small">#${a.number}</span></td><td>${dateTime(a.submittedAt)}</td>
          <td class="num">${a.score === null ? '<span class="muted">hidden</span>' : pct(a.score / a.maxScore)}</td>
          <td class="num">${a.correctCount === null ? '—' : `${a.correctCount}/${a.questionCount}`}</td>
          <td class="num">${humanDuration(a.durationMs)}${a.timedOut ? ' <span class="chip">timed out</span>' : ''}</td></tr>`).join('')}
        </tbody></table></div></section>` : ''}`;

  el.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      const attempt = await POST(`/quizzes/${b.dataset.start}/attempts`);
      location.hash = `#/attempt/${attempt.id}`;
    } catch (e) { toast(e.message); b.disabled = false; }
  }));
  el.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', () => { location.hash = tr.dataset.href; }));
  el.querySelector('#practice').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const qz = await POST(`/users/${u.id}/practice`);
      const attempt = await POST(`/quizzes/${qz.id}/attempts`);
      location.hash = `#/attempt/${attempt.id}`;
    } catch (err) { toast(err.message); e.target.disabled = false; }
  });
}
