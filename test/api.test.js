'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../server');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dq-'));
const { server } = createApp({ dataDir: dir });
let base;
test.before(() => new Promise((r) => server.listen(0, () => { base = `http://127.0.0.1:${server.address().port}/api`; r(); })));
test.after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

async function call(user, method, p, body) {
  const res = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(user ? { 'X-User-Id': user } : {}) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

test('roles are enforced and answers never leak', async () => {
  assert.equal((await call(null, 'GET', '/quizzes')).status, 401);
  assert.equal((await call('alice', 'GET', '/questions')).status, 403);
  const start = await call('alice', 'POST', '/quizzes/sat-warmup/attempts');
  assert.equal(start.status, 200);
  const text = JSON.stringify(start.body);
  assert.ok(!/correctOption|"answer"|"key"|"params"/.test(text), 'attempt payload must not include answers');
});

test('full flow: build quiz, take it, see score and profile', async () => {
  const created = await call('instructor', 'POST', '/quizzes', {
    title: 'Test quiz', timeLimitMinutes: 5, maxAttempts: 1, showResults: 'full', feedback: 'deferred', shuffleQuestions: false,
    items: [{ kind: 'question', questionId: 'la-det2-001' }, { kind: 'pool', subtopic: 'dm-gcd', count: 1, points: 2 }],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const qid = created.body.id;

  const a = (await call('bob', 'POST', `/quizzes/${qid}/attempts`)).body;
  assert.equal(a.questions.length, 2);
  assert.ok(a.deadline > a.startedAt);
  // answer the first one wrong on purpose, leave the second blank
  const saved = await call('bob', 'PUT', `/attempts/${a.id}/answers/0`, { response: '999999' });
  assert.equal(saved.body.parsed, 999999);
  assert.equal(saved.body.correct, undefined, 'deferred mode must not reveal correctness');
  const done = await call('bob', 'POST', `/attempts/${a.id}/submit`);
  assert.equal(done.body.status, 'submitted');
  assert.equal(done.body.score, 0);
  assert.equal(done.body.maxScore, 3);
  assert.ok(done.body.questions[0].correctAnswer !== undefined);
  assert.ok(done.body.durationMs >= 0);

  // attempt limit
  assert.equal((await call('bob', 'POST', `/quizzes/${qid}/attempts`)).status, 403);
  // profile only counts the answered question
  const prof = (await call('bob', 'GET', '/users/bob/profile')).body;
  assert.equal(prof.overall.answered, 1);
  assert.ok(prof.subtopics['la-det-2x2'].mastery < 0.5);
  // students cannot see other students
  assert.equal((await call('bob', 'GET', '/users/alice/profile')).status, 403);
});

test('immediate feedback grades and locks each answer', async () => {
  const a = (await call('chen', 'POST', '/quizzes/sat-warmup/attempts')).body;
  const q = a.questions[0];
  const r = await call('chen', 'PUT', `/attempts/${a.id}/answers/0`, { response: q.type === 'mcq' ? q.options[0].id : '1' });
  assert.equal(typeof r.body.correct, 'boolean');
  assert.equal((await call('chen', 'PUT', `/attempts/${a.id}/answers/0`, { response: '2' })).status, 409);
  const prof = (await call('chen', 'GET', '/users/chen/profile')).body;
  assert.equal(prof.overall.answered, 1, 'profile updates right after an instantly-graded answer');
});

test('hidden results show neither score nor answers', async () => {
  const a = (await call('dana', 'POST', '/quizzes/prob-counting/attempts')).body;
  const done = (await call('dana', 'POST', `/attempts/${a.id}/submit`)).body;
  assert.equal(done.score, undefined);
  assert.equal(done.questions, undefined);
  assert.ok(done.durationMs >= 0);
});

test('invalid quiz specs are rejected', async () => {
  const r = await call('instructor', 'POST', '/quizzes', { title: '', items: [{ kind: 'pool', subtopic: 'nope', count: 1 }] });
  assert.equal(r.status, 400);
});

test('personal practice quiz targets weak spots', async () => {
  const qz = (await call('bob', 'POST', '/users/bob/practice')).body;
  assert.equal(qz.kind, 'practice');
  assert.equal(qz.feedback, 'immediate');
  assert.ok(qz.items.some((i) => i.subtopic === 'la-det-2x2' || i.subtopic === 'la-matrix-ops'));
  // other students don't see it
  const list = (await call('alice', 'GET', '/quizzes')).body;
  assert.ok(!list.some((q) => q.id === qz.id));
});
