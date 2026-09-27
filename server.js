'use strict';
/**
 * Diagnostic Quiz System — HTTP server (no external dependencies).
 *
 *   node server.js            -> http://localhost:3000
 *   PORT=8080 DATA_DIR=/tmp/x node server.js
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadTaxonomy, loadBank, buildGraph } = require('./lib/bank');
const { instantiate } = require('./lib/engine');
const { parseStudentNumber } = require('./lib/expr');
const { openStore } = require('./lib/store');
const { computeProfile } = require('./lib/mastery');
const Q = require('./lib/quizzes');

function createApp({ dataDir = process.env.DATA_DIR || path.join(__dirname, 'var') } = {}) {
  const tax = loadTaxonomy();
  const { questions, errors } = loadBank(tax);
  if (errors.length) {
    console.error('Question bank has errors:\n  ' + errors.join('\n  '));
    throw new Error('Invalid question bank (run `npm run validate` for details)');
  }
  const graph = buildGraph(tax);
  for (const n of graph.nodes) n.questionCount = [...questions.values()].filter((q) => q.subtopics[n.id] !== undefined).length;
  const db = openStore(dataDir);
  seedIfEmpty(db, questions);

  // ---------- helpers ----------
  const httpError = (status, message) => Object.assign(new Error(message), { status });
  const quizOf = (id) => db.quizzes.get(id);
  const attemptsOf = (userId, quizId) => db.attempts.all((a) => a.userId === userId && (!quizId || a.quizId === quizId));

  function settle(attempt) {
    // lazily auto-submit attempts whose time has run out
    if (attempt.status === 'in_progress' && Q.isExpired(attempt)) {
      Q.finalizeAttempt(attempt, questions);
      db.attempts.save();
    }
    return attempt;
  }
  function profileFor(userId) {
    const attempts = attemptsOf(userId).map(settle);
    return computeProfile(tax, questions, Q.profileEvents(attempts));
  }
  function questionSummary(q) {
    return {
      id: q.id, title: q.title, type: q.type, difficulty: q.difficulty, subject: q.subject, topic: q.topic,
      subtopics: q.subtopics, topics: q.topics, primarySubtopic: q.primarySubtopic,
      variables: Object.keys(q.variables || {}), file: q.file,
    };
  }
  function quizSummary(quiz, user) {
    const s = {
      ...quiz,
      questionCount: Q.questionCount(quiz, questions),
    };
    if (user) {
      const mine = attemptsOf(user.id, quiz.id).map(settle);
      const submitted = mine.filter((a) => a.status === 'submitted');
      s.myAttempts = mine.length;
      s.attemptsLeft = quiz.maxAttempts ? Math.max(0, quiz.maxAttempts - mine.length) : null;
      s.inProgressAttemptId = (mine.find((a) => a.status === 'in_progress') || {}).id || null;
      s.lastAttemptId = submitted.length ? submitted[submitted.length - 1].id : null;
      if (quiz.showResults !== 'never' && submitted.length) {
        s.bestScorePct = Math.max(...submitted.map((a) => (a.maxScore ? a.score / a.maxScore : 0)));
      }
    }
    return s;
  }

  // ---------- routes ----------
  const routes = [];
  const route = (method, pattern, handler, opts = {}) => {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
    routes.push({ method, re, keys, handler, ...opts });
  };

  route('GET', '/api/meta', () => ({
    taxonomy: tax.raw,
    questionCount: questions.size,
    counts: countBy([...questions.values()], (q) => q.subject),
  }), { auth: false });

  route('GET', '/api/graph', () => graph, { auth: false });

  route('GET', '/api/users', () => db.users.all().map(publicUser), { auth: false });
  route('POST', '/api/users', ({ body }) => {
    const name = String(body.name || '').trim();
    if (!name) throw httpError(400, 'Name is required');
    const role = body.role === 'instructor' ? 'instructor' : 'student';
    return publicUser(db.users.insert({ name, role, createdAt: Date.now() }));
  }, { auth: false });

  // --- question bank ---
  route('GET', '/api/questions', ({ query }) => [...questions.values()]
    .filter((q) => (!query.subject || q.subject === query.subject) && (!query.topic || q.topics.includes(query.topic)) &&
      (!query.subtopic || q.subtopics[query.subtopic] !== undefined))
    .map(questionSummary), { role: 'instructor' });

  route('GET', '/api/questions/:id', ({ params }) => {
    const q = questions.get(params.id);
    if (!q) throw httpError(404, 'No such question');
    return { ...questionSummary(q), source: stripInternal(q) };
  }, { role: 'instructor' });

  route('GET', '/api/questions/:id/preview', ({ params, query }) => {
    const q = questions.get(params.id);
    if (!q) throw httpError(404, 'No such question');
    const seed = query.seed || String(Math.random()).slice(2, 10);
    const inst = instantiate(q, seed);
    return { seed, ...inst.public, answer: inst.key.answerDisplay, correctOption: inst.key.correctOption || null, solution: inst.key.solution || null, params: inst.key.params };
  }, { role: 'instructor' });

  // --- quizzes ---
  route('GET', '/api/quizzes', ({ user }) => db.quizzes.all((qz) =>
    user.role === 'instructor' ? qz.kind !== 'practice' : (qz.kind === 'practice' ? qz.ownerId === user.id : qz.published))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((qz) => quizSummary(qz, user.role === 'student' ? user : null)));

  route('GET', '/api/quizzes/:id', ({ params, user }) => {
    const qz = quizOf(params.id);
    if (!qz || (user.role === 'student' && !(qz.published || qz.ownerId === user.id))) throw httpError(404, 'No such quiz');
    return quizSummary(qz, user.role === 'student' ? user : null);
  });

  route('POST', '/api/quizzes', ({ body, user }) => {
    const spec = Q.normalizeQuiz(body, questions);
    return db.quizzes.insert({ ...spec, kind: 'quiz', createdBy: user.id, createdAt: Date.now() });
  }, { role: 'instructor' });

  route('PUT', '/api/quizzes/:id', ({ params, body }) => {
    if (!quizOf(params.id)) throw httpError(404, 'No such quiz');
    const spec = Q.normalizeQuiz(body, questions);
    return db.quizzes.update(params.id, { ...spec, updatedAt: Date.now() });
  }, { role: 'instructor' });

  route('DELETE', '/api/quizzes/:id', ({ params }) => ({ deleted: db.quizzes.remove(params.id) }), { role: 'instructor' });

  // Preview which categories a pool would draw from (builder helper)
  route('POST', '/api/pool-count', ({ body }) => ({ available: Q.matchPool(body, questions).length }), { role: 'instructor' });

  // --- attempts ---
  route('POST', '/api/quizzes/:id/attempts', ({ params, user }) => {
    const qz = quizOf(params.id);
    if (!qz || (qz.kind === 'practice' ? qz.ownerId !== user.id : !qz.published)) throw httpError(404, 'No such quiz');
    const mine = attemptsOf(user.id, qz.id).map(settle);
    const open = mine.find((a) => a.status === 'in_progress');
    if (open) return Q.studentView(open, qz);
    if (qz.maxAttempts && mine.length >= qz.maxAttempts) throw httpError(403, `No attempts left (limit ${qz.maxAttempts})`);
    const attempt = db.attempts.insert(Q.createAttempt(qz, user, questions, mine));
    return Q.studentView(attempt, qz);
  }, { role: 'student' });

  function ownAttempt(id, user) {
    const a = db.attempts.get(id);
    if (!a || (a.userId !== user.id && user.role !== 'instructor')) throw httpError(404, 'No such attempt');
    return settle(a);
  }

  route('GET', '/api/attempts/:id', ({ params, user }) => {
    const a = ownAttempt(params.id, user);
    return Q.studentView(a, quizOf(a.quizId), { reveal: user.role === 'instructor' });
  });

  route('PUT', '/api/attempts/:id/answers/:index', ({ params, body, user }) => {
    const a = ownAttempt(params.id, user);
    if (a.userId !== user.id) throw httpError(403, 'Not your attempt');
    const slot = Q.saveResponse(a, Number(params.index), body.response, body.timeSpentMs, questions);
    db.attempts.save();
    const out = { index: Number(params.index), response: slot.response, saved: true };
    // echo back how a typed number was interpreted (not whether it is right)
    if (slot.public.type === 'numeric' && slot.response !== null) out.parsed = parseStudentNumber(slot.response);
    if (a.feedback === 'immediate' && slot.graded) Object.assign(out, { correct: slot.graded.correct, correctAnswer: slot.key.answerDisplay, solution: slot.key.solution || null });
    return out;
  }, { role: 'student' });

  route('POST', '/api/attempts/:id/submit', ({ params, user }) => {
    const a = ownAttempt(params.id, user);
    if (a.userId !== user.id) throw httpError(403, 'Not your attempt');
    Q.finalizeAttempt(a, questions);
    db.attempts.save();
    return Q.studentView(a, quizOf(a.quizId));
  }, { role: 'student' });

  // --- profiles ---
  route('GET', '/api/users/:id/profile', ({ params, user }) => {
    if (user.role !== 'instructor' && user.id !== params.id) throw httpError(403, 'You can only view your own profile');
    const target = db.users.get(params.id);
    if (!target) throw httpError(404, 'No such user');
    const attempts = attemptsOf(target.id).map(settle).filter((a) => a.status === 'submitted').sort((a, b) => b.startedAt - a.startedAt);
    return {
      user: publicUser(target),
      ...profileFor(target.id),
      attempts: attempts.map((a) => {
        const qz = quizOf(a.quizId);
        const hidden = a.showResults === 'never' && user.role !== 'instructor';
        return {
          id: a.id, quizId: a.quizId, quizTitle: qz ? qz.title : '(deleted quiz)', number: a.number,
          startedAt: a.startedAt, submittedAt: a.submittedAt, durationMs: a.durationMs, timedOut: a.timedOut,
          questionCount: a.questions.length,
          score: hidden ? null : a.score, maxScore: hidden ? null : a.maxScore, correctCount: hidden ? null : a.correctCount,
        };
      }),
    };
  });

  // Personalised practice quiz aimed at the student's weakest areas
  route('POST', '/api/users/:id/practice', ({ params, user }) => {
    if (user.id !== params.id) throw httpError(403, 'Not your profile');
    const profile = profileFor(user.id);
    const targets = [];
    for (const r of profile.recommendations) if (!targets.includes(r.subtopic)) targets.push(r.subtopic);
    // no data yet (or nothing weak): sample broadly from the least-covered subjects
    if (!targets.length) {
      const untested = Object.values(profile.subtopics).filter((s) => !s.evidence).map((s) => s.id);
      targets.push(...untested.sort(() => Math.random() - 0.5));
    }
    const items = [];
    for (const st of targets) {
      if (items.length >= 4) break;
      if (Q.matchPool({ subtopic: st }, questions).length) items.push({ kind: 'pool', subtopic: st, count: 2 });
    }
    if (!items.length) throw httpError(400, 'Nothing to practise yet');
    const spec = Q.normalizeQuiz({
      title: `Practice: ${items.map((i) => tax.subtopics.get(i.subtopic).name).join(', ')}`,
      description: 'Generated from your knowledge profile. Answers are checked as you go.',
      timeLimitMinutes: 0, maxAttempts: 1, showResults: 'full', feedback: 'immediate', shuffleQuestions: false, items,
    }, questions);
    return db.quizzes.insert({ ...spec, kind: 'practice', ownerId: user.id, createdBy: user.id, createdAt: Date.now() });
  }, { role: 'student' });

  // --- instructor analytics ---
  route('GET', '/api/analytics', () => {
    const students = db.users.all((u) => u.role === 'student');
    const allAttempts = db.attempts.all().map(settle);
    const profiles = new Map(students.map((s) => [s.id, profileFor(s.id)]));

    const studentRows = students.map((s) => {
      const p = profiles.get(s.id);
      const sub = allAttempts.filter((a) => a.userId === s.id && a.status === 'submitted');
      return {
        id: s.id, name: s.name, mastery: p.overall.mastery, answered: p.overall.answered, accuracy: p.overall.accuracy,
        coverage: p.overall.coverage, attempts: sub.length,
        topics: Object.fromEntries(Object.values(p.topics).map((t) => [t.id, t.mastery])),
        subjects: Object.fromEntries(Object.values(p.subjects).map((t) => [t.id, t.mastery])),
      };
    });

    const classBy = (level) => Object.fromEntries(Object.keys(profiles.values().next().value?.[level] || {}).map((id) => {
      const vals = [...profiles.values()].map((p) => p[level][id]).filter((x) => x.mastery !== null);
      const attempts = vals.reduce((a, v) => a + v.attempts, 0);
      const correct = vals.reduce((a, v) => a + v.correct, 0);
      return [id, {
        mastery: vals.length ? round(vals.reduce((a, v) => a + v.mastery, 0) / vals.length) : null,
        students: vals.length, attempts, accuracy: attempts ? round(correct / attempts) : null,
        struggling: vals.filter((v) => v.mastery < 0.5).length,
      }];
    }));

    const quizRows = db.quizzes.all((qz) => qz.kind !== 'practice').map((qz) => {
      const sub = allAttempts.filter((a) => a.quizId === qz.id && a.status === 'submitted');
      const pcts = sub.map((a) => (a.maxScore ? a.score / a.maxScore : 0));
      return {
        id: qz.id, title: qz.title, attempts: sub.length, students: new Set(sub.map((a) => a.userId)).size,
        inProgress: allAttempts.filter((a) => a.quizId === qz.id && a.status === 'in_progress').length,
        avgScorePct: pcts.length ? round(mean(pcts)) : null, minScorePct: pcts.length ? round(Math.min(...pcts)) : null,
        maxScorePct: pcts.length ? round(Math.max(...pcts)) : null,
        avgDurationMs: sub.length ? Math.round(mean(sub.map((a) => a.durationMs))) : null,
        scores: pcts.map(round),
      };
    });

    const qStats = new Map();
    for (const a of allAttempts) {
      if (a.status !== 'submitted') continue;
      for (const s of a.questions) {
        const st = qStats.get(s.questionId) || { seen: 0, answered: 0, correct: 0, time: 0 };
        st.seen++;
        if (s.response !== null) { st.answered++; st.time += s.timeSpentMs || 0; }
        if (s.graded && s.graded.correct) st.correct++;
        qStats.set(s.questionId, st);
      }
    }
    const questionRows = [...qStats.entries()].map(([id, st]) => {
      const q = questions.get(id);
      return {
        id, title: q ? q.title : id, subject: q && q.subject, primarySubtopic: q && q.primarySubtopic, difficulty: q && q.difficulty,
        seen: st.seen, answered: st.answered, pctCorrect: round(st.correct / st.seen),
        avgTimeMs: st.answered ? Math.round(st.time / st.answered) : null,
      };
    }).sort((a, b) => a.pctCorrect - b.pctCorrect);

    return { students: studentRows, subtopics: classBy('subtopics'), topics: classBy('topics'), subjects: classBy('subjects'), quizzes: quizRows, questions: questionRows };
  }, { role: 'instructor' });

  // ---------- request handling ----------
  async function handleApi(req, res, url) {
    const match = routes.map((r) => ({ r, m: r.method === req.method && r.re.exec(url.pathname) })).find((x) => x.m);
    if (!match) throw httpError(404, 'Not found');
    const { r, m } = match;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    let user = null;
    if (r.auth !== false) {
      user = db.users.get(req.headers['x-user-id'] || '');
      if (!user) throw httpError(401, 'Pick a user first');
      if (r.role && user.role !== r.role) throw httpError(403, `Only ${r.role}s can do that`);
    }
    const body = ['POST', 'PUT'].includes(req.method) ? await readJson(req) : {};
    return r.handler({ params, query: Object.fromEntries(url.searchParams), body, user, req });
  }

  const PUBLIC = path.join(__dirname, 'public');
  const MIME = { '.woff2': 'font/woff2', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      try {
        const out = await handleApi(req, res, url);
        send(res, 200, out);
      } catch (e) {
        if (!e.status) console.error(e);
        send(res, e.status || 500, { error: e.message, details: e.details });
      }
      return;
    }
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });

  return { server, db, questions, tax };
}

// ---------- utilities ----------
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) { reject(Object.assign(new Error('Body too large'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
const publicUser = (u) => ({ id: u.id, name: u.name, role: u.role });
const stripInternal = ({ file, topic, topics, primarySubtopic, subject, ...rest }) => rest;
const countBy = (arr, f) => arr.reduce((acc, x) => { acc[f(x)] = (acc[f(x)] || 0) + 1; return acc; }, {});
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const round = (x) => Math.round(x * 1000) / 1000;

/** First run: create demo users and the sample quizzes from data/seed-quizzes.json */
function seedIfEmpty(db, questions) {
  if (!db.users.all().length) {
    db.users.insert({ id: 'instructor', name: 'Dr. Rivera (instructor)', role: 'instructor', createdAt: Date.now() });
    for (const [id, name] of [['alice', 'Alice'], ['bob', 'Bob'], ['chen', 'Chen'], ['dana', 'Dana'], ['eve', 'Eve (new)']]) {
      db.users.insert({ id, name, role: 'student', createdAt: Date.now() });
    }
  }
  if (!db.quizzes.all().length) {
    const seedFile = path.join(__dirname, 'data', 'seed-quizzes.json');
    for (const qz of JSON.parse(fs.readFileSync(seedFile, 'utf8'))) {
      db.quizzes.insert({ id: qz.id, ...Q.normalizeQuiz(qz, questions), kind: 'quiz', createdBy: 'instructor', createdAt: Date.now() });
    }
  }
}

if (require.main === module) {
  const { server } = createApp();
  const port = Number(process.env.PORT) || 3000;
  server.listen(port, () => console.log(`Diagnostic Quiz System running at http://localhost:${port}`));
}

module.exports = { createApp };
