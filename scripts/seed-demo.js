'use strict';
/**
 * Fill var/ with simulated students so the profile and analytics pages have data.
 *
 *   npm run seed          (wipes var/ first)
 *
 * Each simulated student has a hidden skill level per subject (and a few
 * per-subtopic overrides); answers are drawn from the same logistic model the
 * profile uses, so you can check that the profile recovers what we put in.
 */
const fs = require('fs');
const path = require('path');
const { createApp } = require('../server');
const Q = require('../lib/quizzes');
const { makeRng } = require('../lib/engine');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', 'var');
fs.rmSync(dataDir, { recursive: true, force: true });
const { db, questions, tax } = createApp({ dataDir });

// hidden "true" skill per subject (logit scale; 0 = 50% on a medium question)
const STUDENTS = {
  alice: { base: { 'linear-algebra': 2.0, calculus: 1.6, 'differential-equations': 1.2, probability: -1.0, 'discrete-math': -0.3, sat: 1.8, 'analytic-geometry': 1.2 },
    override: { 'pr-bayes': -2.0, 'pr-conditional-prob': -1.5 } },
  bob: { base: { 'linear-algebra': -0.6, calculus: -1.4, 'differential-equations': -1.5, probability: 1.3, 'discrete-math': 1.8, sat: 1.5, 'analytic-geometry': 0.2 },
    override: { 'ca-chain-rule': -2.2 } },
  chen: { base: { 'linear-algebra': 1.5, calculus: 1.8, 'differential-equations': -0.8, probability: 1.2, 'discrete-math': 1.0, sat: 2.2, 'analytic-geometry': 1.5 },
    override: { 'de-char-equation': -2.0 } },
  // Dana's real problem is algebra (quadratics/linear equations), which shows up downstream
  dana: { base: { 'linear-algebra': 0.3, calculus: 0.0, 'differential-equations': -0.3, probability: 0.4, 'discrete-math': 0.5, sat: 0.3, 'analytic-geometry': 0.0 },
    override: { 'sat-quadratics': -2.5, 'sat-linear-equations': -1.5, 'ca-critical-points': -1.5, 'ag-parabola': -1.4 } },
};
const PLAN = [
  ['placement-all', 20], ['diag-linear-algebra', 16], ['sat-warmup', 13], ['calc-derivatives-check', 10],
  ['prob-counting', 7], ['sat-warmup', 5], ['diag-linear-algebra', 3], ['prob-counting', 1],
];

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const DAY = 86400000;
const now = Date.now();

for (const [userId, skill] of Object.entries(STUDENTS)) {
  const user = db.users.get(userId);
  const rng = makeRng(`sim:${userId}`);
  const theta = (sid) => skill.override[sid] ?? skill.base[tax.subtopics.get(sid).subject] ?? 0;
  for (const [quizId, daysAgo] of PLAN) {
    const quiz = db.quizzes.get(quizId);
    const previous = db.attempts.all((a) => a.userId === userId && a.quizId === quizId);
    if (quiz.maxAttempts && previous.length >= quiz.maxAttempts) continue;
    const attempt = Q.createAttempt(quiz, user, questions, previous);
    attempt.startedAt = now - daysAgo * DAY + Math.floor(rng() * 6) * 3600000;
    if (attempt.deadline) attempt.deadline = attempt.startedAt + quiz.timeLimitMinutes * 60000;
    let t = attempt.startedAt;
    for (const slot of attempt.questions) {
      const q = questions.get(slot.questionId);
      const w = Object.entries(q.subtopics);
      const ability = w.reduce((acc, [sid, wt]) => acc + theta(sid) * wt, 0) / w.reduce((acc, [, wt]) => acc + wt, 0);
      const pCorrect = sigmoid(ability - (q.difficulty - 3) * 0.75);
      const spent = Math.round((25 + rng() * 80 + q.difficulty * 25) * 1000);
      t += spent;
      if (rng() < 0.04) continue; // skipped
      const correct = rng() < pCorrect;
      if (q.type === 'mcq') {
        const wrong = slot.public.options.filter((o) => o.id !== slot.key.correctOption);
        slot.response = correct ? slot.key.correctOption : wrong[Math.floor(rng() * wrong.length)].id;
      } else {
        slot.response = String(correct ? slot.key.answer : Math.round((slot.key.answer * 1.5 + 1 + rng() * 3) * 100) / 100);
      }
      slot.answeredAt = t;
      slot.timeSpentMs = spent;
      if (attempt.feedback === 'immediate') slot.graded = { correct, at: t };
    }
    Q.finalizeAttempt(attempt, questions, t + 5000);
    db.attempts.insert(attempt);
  }
}
const n = db.attempts.all().length;
console.log(`Seeded ${n} attempts for ${Object.keys(STUDENTS).length} students into ${dataDir}`);
