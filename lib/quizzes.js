'use strict';
/**
 * Quiz specs, attempt generation and grading.
 *
 * A quiz is a *recipe*: fixed questions and/or "pools" (draw N random questions
 * matching subject/topic/subtopic/difficulty). Every attempt draws its own
 * questions and its own random parameters, so two students (or two attempts by
 * the same student) see different numbers.
 */
const crypto = require('crypto');
const { instantiate, grade, makeRng, shuffle } = require('./engine');

const SHOW_RESULTS = ['never', 'score', 'full'];
const FEEDBACK = ['deferred', 'immediate'];
const GRACE_MS = 30 * 1000; // network slack after the deadline

/** Normalise + validate a quiz spec coming from the builder. Throws on bad input. */
function normalizeQuiz(input, questions) {
  const errs = [];
  const q = {
    title: String(input.title || '').trim(),
    description: String(input.description || '').trim(),
    timeLimitMinutes: input.timeLimitMinutes ? Number(input.timeLimitMinutes) : 0,
    maxAttempts: input.maxAttempts ? Number(input.maxAttempts) : 0,
    showResults: input.showResults || 'full',
    feedback: input.feedback || 'deferred',
    shuffleQuestions: input.shuffleQuestions !== false,
    published: input.published !== false,
    items: [],
  };
  if (!q.title) errs.push('Title is required');
  if (!(q.timeLimitMinutes >= 0 && q.timeLimitMinutes <= 600)) errs.push('Time limit must be 0–600 minutes (0 = no limit)');
  if (!(Number.isInteger(q.maxAttempts) && q.maxAttempts >= 0)) errs.push('Max attempts must be a whole number (0 = unlimited)');
  if (!SHOW_RESULTS.includes(q.showResults)) errs.push(`showResults must be one of ${SHOW_RESULTS.join(', ')}`);
  if (!FEEDBACK.includes(q.feedback)) errs.push(`feedback must be one of ${FEEDBACK.join(', ')}`);
  for (const [i, it] of (input.items || []).entries()) {
    const points = it.points ? Number(it.points) : 1;
    if (it.kind === 'question') {
      if (!questions.has(it.questionId)) errs.push(`Item ${i + 1}: unknown question "${it.questionId}"`);
      q.items.push({ kind: 'question', questionId: it.questionId, points });
    } else if (it.kind === 'pool') {
      const pool = {
        kind: 'pool',
        subject: it.subject || null, topic: it.topic || null, subtopic: it.subtopic || null,
        difficultyMin: Number(it.difficultyMin) || 1, difficultyMax: Number(it.difficultyMax) || 5,
        type: it.type || null,
        count: Number(it.count) || 1, points,
      };
      const available = matchPool(pool, questions).length;
      if (!available) errs.push(`Item ${i + 1}: no questions match this category`);
      q.items.push(pool);
    } else errs.push(`Item ${i + 1}: kind must be "question" or "pool"`);
  }
  if (!q.items.length) errs.push('Add at least one question or category');
  if (errs.length) {
    const e = new Error(errs.join('; '));
    e.status = 400;
    e.details = errs;
    throw e;
  }
  return q;
}

function matchPool(pool, questions) {
  return [...questions.values()].filter((q) =>
    (!pool.subject || q.subject === pool.subject) &&
    (!pool.topic || q.topics.includes(pool.topic)) &&
    (!pool.subtopic || Object.prototype.hasOwnProperty.call(q.subtopics, pool.subtopic)) &&
    (!pool.type || q.type === pool.type) &&
    q.difficulty >= (pool.difficultyMin || 1) && q.difficulty <= (pool.difficultyMax || 5));
}

/** Expected number of questions per attempt (pools may be smaller than requested). */
function questionCount(quiz, questions) {
  return drawQuestions(quiz, questions, 'count').length;
}

/**
 * Choose the concrete questions for one attempt.
 * `seenCount` maps questionId -> how often this student has already seen it, so
 * pools prefer fresh questions on retakes.
 */
function drawQuestions(quiz, questions, seed, seenCount = {}) {
  const rng = makeRng(`draw::${seed}`);
  const chosen = [];
  const used = new Set();
  for (const it of quiz.items) {
    if (it.kind === 'question' && !used.has(it.questionId)) {
      used.add(it.questionId);
      chosen.push({ questionId: it.questionId, points: it.points || 1 });
    }
  }
  // Fill the most specific pools first, so a broad category can't use up the
  // only question a narrow one could have drawn.
  const pools = quiz.items.filter((it) => it.kind === 'pool')
    .map((it) => ({ it, n: matchPool(it, questions).length })).sort((a, b) => a.n - b.n).map((x) => x.it);
  for (const it of pools) {
    const candidates = shuffle(matchPool(it, questions).filter((q) => !used.has(q.id)), rng)
      .sort((a, b) => (seenCount[a.id] || 0) - (seenCount[b.id] || 0));
    for (const q of candidates.slice(0, it.count)) {
      used.add(q.id);
      chosen.push({ questionId: q.id, points: it.points || 1 });
    }
  }
  return quiz.shuffleQuestions ? shuffle(chosen, rng) : chosen;
}

function createAttempt(quiz, user, questions, previousAttempts) {
  const seed = crypto.randomBytes(8).toString('hex');
  const seenCount = {};
  for (const a of previousAttempts) for (const s of a.questions) seenCount[s.questionId] = (seenCount[s.questionId] || 0) + 1;
  const now = Date.now();
  const slots = drawQuestions(quiz, questions, seed, seenCount).map((s, i) => {
    const qSeed = `${seed}:${i}`;
    const inst = instantiate(questions.get(s.questionId), qSeed);
    return {
      questionId: s.questionId, seed: qSeed, points: s.points,
      public: inst.public, key: inst.key,
      response: null, answeredAt: null, timeSpentMs: 0, graded: null,
    };
  });
  return {
    quizId: quiz.id,
    userId: user.id,
    number: previousAttempts.length + 1,
    seed,
    startedAt: now,
    deadline: quiz.timeLimitMinutes ? now + quiz.timeLimitMinutes * 60000 : null,
    status: 'in_progress',
    feedback: quiz.feedback,
    showResults: quiz.showResults,
    questions: slots,
  };
}

const isExpired = (attempt, now = Date.now()) => attempt.deadline && now > attempt.deadline + GRACE_MS;

/** Save a response. In immediate-feedback mode the answer is graded and locked. */
function saveResponse(attempt, index, response, timeSpentMs, questions) {
  const slot = attempt.questions[index];
  if (!slot) throw Object.assign(new Error('No such question'), { status: 404 });
  if (attempt.status !== 'in_progress') throw Object.assign(new Error('Attempt already submitted'), { status: 409 });
  if (isExpired(attempt)) throw Object.assign(new Error('Time is up'), { status: 409 });
  if (attempt.feedback === 'immediate' && slot.graded) throw Object.assign(new Error('This question is already checked'), { status: 409 });
  slot.response = response === '' || response === undefined ? null : response;
  slot.answeredAt = Date.now();
  slot.timeSpentMs = Math.max(slot.timeSpentMs || 0, Number(timeSpentMs) || 0);
  if (attempt.feedback === 'immediate' && slot.response !== null) {
    const g = grade(questions.get(slot.questionId), slot.key, slot.response);
    if (g.invalid) throw Object.assign(new Error('Could not read that as a number — try e.g. 3/4, -2.5 or sqrt(2)'), { status: 400 });
    slot.graded = { correct: g.correct, at: slot.answeredAt };
  }
  return slot;
}

function finalizeAttempt(attempt, questions, now = Date.now()) {
  if (attempt.status !== 'in_progress') return attempt;
  let score = 0; let max = 0; let correct = 0;
  for (const slot of attempt.questions) {
    if (!slot.graded) {
      const g = grade(questions.get(slot.questionId), slot.key, slot.response);
      // unanswered questions count as wrong for the score, but only answered ones feed the profile
      slot.graded = { correct: g.correct, at: slot.answeredAt || now, blank: !!g.blank };
    }
    max += slot.points;
    if (slot.graded.correct) { score += slot.points; correct++; }
  }
  const end = attempt.deadline ? Math.min(now, attempt.deadline) : now;
  Object.assign(attempt, {
    status: 'submitted', submittedAt: now, score, maxScore: max, correctCount: correct,
    durationMs: Math.max(0, end - attempt.startedAt),
    timedOut: !!(attempt.deadline && now > attempt.deadline),
  });
  return attempt;
}

/** The view of an attempt that a student is allowed to see. */
function studentView(attempt, quiz, { reveal = false } = {}) {
  const inProgress = attempt.status === 'in_progress';
  const mode = reveal ? 'full' : attempt.showResults;
  const base = {
    id: attempt.id, quizId: attempt.quizId, quizTitle: quiz ? quiz.title : '(deleted quiz)',
    number: attempt.number, status: attempt.status, feedback: attempt.feedback, showResults: attempt.showResults,
    startedAt: attempt.startedAt, deadline: attempt.deadline, submittedAt: attempt.submittedAt || null,
    serverNow: Date.now(), questionCount: attempt.questions.length,
  };
  if (inProgress) {
    base.questions = attempt.questions.map((s, i) => ({
      index: i, points: s.points, ...s.public, response: s.response,
      // immediate mode: tell them right away whether they got it
      ...(s.graded && attempt.feedback === 'immediate' ? { correct: s.graded.correct, correctAnswer: s.key.answerDisplay, solution: s.key.solution || null } : {}),
    }));
    return base;
  }
  base.durationMs = attempt.durationMs;
  base.timedOut = attempt.timedOut;
  if (mode === 'never') return base;
  Object.assign(base, { score: attempt.score, maxScore: attempt.maxScore, correctCount: attempt.correctCount });
  if (mode === 'full') {
    base.questions = attempt.questions.map((s, i) => ({
      index: i, points: s.points, ...s.public, response: s.response, timeSpentMs: s.timeSpentMs,
      correct: s.graded ? s.graded.correct : false,
      correctAnswer: s.key.answerDisplay, correctOption: s.key.correctOption || null, solution: s.key.solution || null,
    }));
  }
  return base;
}

/** Graded answers that feed the knowledge profile. */
function profileEvents(attempts) {
  const out = [];
  for (const a of attempts) {
    for (const s of a.questions) {
      if (!s.graded || s.graded.blank) continue;
      if (a.status !== 'submitted' && a.feedback !== 'immediate') continue; // don't leak deferred grades mid-quiz
      out.push({ questionId: s.questionId, correct: s.graded.correct, at: s.graded.at || s.answeredAt || a.startedAt, attemptId: a.id, timeSpentMs: s.timeSpentMs });
    }
  }
  return out;
}

module.exports = {
  normalizeQuiz, matchPool, questionCount, drawQuestions, createAttempt, saveResponse,
  finalizeAttempt, studentView, profileEvents, isExpired, SHOW_RESULTS, FEEDBACK,
};
