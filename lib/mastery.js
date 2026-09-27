'use strict';
/**
 * Knowledge profile / mastery model (hierarchical Elo / logistic model).
 *
 * A student's skill on subtopic s (in subject S) is  θ = θ_S + δ_s :
 *   θ_S  — general ability in the subject, learned from every answer in S
 *   δ_s  — how this subtopic deviates from that, learned from answers on s
 * Each question has a difficulty b from its 1..5 rating. After every graded
 * answer, for every subtopic the question is tagged with (weight w):
 *
 *     p     = σ(θ_S + δ_s − b)             predicted chance of a correct answer
 *     e     = w · (correct − p)            surprise
 *     θ_S  += K_S(n_S) · e                 subject-level update
 *     δ_s  += K_s(n_s) · e                 subtopic-level update
 *
 * Learning rates shrink as evidence grows, so early answers move estimates a lot
 * and later ones fine-tune them. Sharing θ_S means a student who is strong across
 * a subject is not dragged to 50% on a subtopic seen only once.
 *
 * Mastery shown to users = σ(θ_S + δ_s) = predicted chance of solving a
 * medium-difficulty (3/5) question on that subtopic. A hard question answered
 * correctly raises it more than an easy one; an easy one missed lowers it more.
 */

const sigmoid = (x) => 1 / (1 + Math.exp(-x));
const difficultyToB = (d) => ((d || 3) - 3) * 0.75;
const subjectRate = (n) => 0.1 + 0.8 / (1 + 0.3 * n);
const learningRate = (n) => 0.15 + 0.85 / (1 + 0.5 * n);

const LEVELS = [
  { min: 0.8, status: 'mastered', label: 'Mastered' },
  { min: 0.6, status: 'proficient', label: 'Proficient' },
  { min: 0.4, status: 'developing', label: 'Developing' },
  { min: -1, status: 'needs-work', label: 'Needs work' },
];
function levelOf(mastery, evidence) {
  if (!evidence) return { status: 'not-assessed', label: 'Not assessed' };
  const { status, label } = LEVELS.find((l) => mastery >= l.min);
  return { status, label };
}
/** 0..1 — how much to trust an estimate given the amount of evidence */
const confidenceOf = (evidence) => evidence / (evidence + 3);

/**
 * events: [{ questionId, correct, at }] in any order (sorted here by `at`).
 * Returns the full profile.
 */
function computeProfile(tax, questions, events) {
  const sorted = events.filter((e) => questions.has(e.questionId)).sort((a, b) => a.at - b.at);
  const st = new Map(); // subtopicId -> { delta, evidence, ... }
  const subj = new Map(); // subjectId -> { theta, n }
  const stateOf = (id) => {
    if (!st.has(id)) st.set(id, { delta: 0, evidence: 0, attempts: 0, correct: 0, lastAt: null });
    return st.get(id);
  };
  const subjOf = (sid) => {
    const id = tax.subtopics.get(sid).subject;
    if (!subj.has(id)) subj.set(id, { theta: 0, n: 0 });
    return subj.get(id);
  };
  const masteryOf = (sid) => sigmoid(subjOf(sid).theta + st.get(sid).delta);

  const timeline = [];
  let answered = 0;
  let correctTotal = 0;
  for (const ev of sorted) {
    const q = questions.get(ev.questionId);
    const b = difficultyToB(q.difficulty);
    const y = ev.correct ? 1 : 0;
    answered++;
    correctTotal += y;
    for (const [sid, w] of Object.entries(q.subtopics)) {
      const s = stateOf(sid);
      const S = subjOf(sid);
      const e = w * (y - sigmoid(S.theta + s.delta - b));
      S.theta += subjectRate(S.n) * e;
      S.n += w;
      s.delta += learningRate(s.evidence) * e;
      s.evidence += w;
      s.attempts++;
      s.correct += y;
      s.lastAt = ev.at;
    }
    timeline.push({
      i: answered,
      at: ev.at,
      questionId: q.id,
      subtopic: q.primarySubtopic,
      correct: !!ev.correct,
      subtopicMastery: round(masteryOf(q.primarySubtopic)),
      overall: round(weightedMean([...st.entries()].map(([sid, s]) => [masteryOf(sid), s.evidence]))),
    });
  }

  // ---- roll up: subtopics -> topics -> subjects ----
  const subtopics = {};
  for (const s of tax.subtopics.values()) {
    const state = st.get(s.id);
    const evidence = state ? state.evidence : 0;
    const mastery = state ? masteryOf(s.id) : null;
    subtopics[s.id] = {
      id: s.id, name: s.name, topic: s.topic, subject: s.subject,
      mastery: mastery === null ? null : round(mastery),
      evidence: round(evidence), confidence: round(confidenceOf(evidence)),
      attempts: state ? state.attempts : 0, correct: state ? state.correct : 0,
      lastAt: state ? state.lastAt : null,
      ...levelOf(mastery, evidence),
    };
  }
  const rollup = (ids) => {
    const parts = ids.map((id) => subtopics[id]);
    const assessed = parts.filter((p) => p.evidence > 0);
    const mastery = assessed.length ? weightedMean(assessed.map((p) => [p.mastery, p.evidence])) : null;
    const evidence = assessed.reduce((a, p) => a + p.evidence, 0);
    return {
      mastery: mastery === null ? null : round(mastery),
      coverage: round(assessed.length / parts.length),
      assessedSubtopics: assessed.length, totalSubtopics: parts.length,
      attempts: parts.reduce((a, p) => a + p.attempts, 0),
      correct: parts.reduce((a, p) => a + p.correct, 0),
      ...levelOf(mastery, evidence),
    };
  };
  const topics = {};
  for (const t of tax.topics.values()) topics[t.id] = { id: t.id, name: t.name, subject: t.subject, ...rollup(t.subtopicIds) };
  const subjects = {};
  for (const s of tax.subjects.values()) {
    const ids = s.topicIds.flatMap((tid) => tax.topics.get(tid).subtopicIds);
    subjects[s.id] = { id: s.id, name: s.name, ...rollup(ids) };
  }
  const overallRoll = rollup([...tax.subtopics.keys()]);

  const assessed = Object.values(subtopics).filter((s) => s.evidence > 0);
  // rank by mastery, but require a little evidence before calling something a strength
  const strengths = assessed.filter((s) => s.mastery >= 0.65 && s.evidence >= 1.5)
    .sort((a, b) => b.mastery - a.mastery || b.evidence - a.evidence).slice(0, 6);
  const weaknesses = assessed.filter((s) => s.mastery < 0.55)
    .sort((a, b) => a.mastery - b.mastery || b.evidence - a.evidence).slice(0, 6);

  return {
    overall: {
      mastery: overallRoll.mastery, coverage: overallRoll.coverage,
      answered, correct: correctTotal, accuracy: answered ? round(correctTotal / answered) : null,
      ...levelOf(overallRoll.mastery, answered),
    },
    subjects, topics, subtopics,
    strengths, weaknesses,
    recommendations: recommend(tax, subtopics),
    timeline,
  };
}

/**
 * Diagnostic recommendations using the prerequisite graph:
 *  - a weak subtopic whose prerequisite is also weak/untested -> fix the prerequisite first
 *  - a weak subtopic with solid prerequisites -> practise it directly
 *  - an untested subtopic whose prerequisites are all solid -> ready to learn next
 */
function recommend(tax, subtopics) {
  const isWeak = (s) => s.evidence > 0 && s.mastery < 0.55;
  const isSolid = (s) => s.evidence > 0 && s.mastery >= 0.65;
  const shaky = (s) => isWeak(s) || s.evidence === 0;
  const prereqsOf = (id) => tax.subtopics.get(id).prerequisites.map((p) => subtopics[p]);
  const pctOf = (s) => `${Math.round(s.mastery * 100)}%`;
  const names = (xs) => {
    const q = xs.map((x) => `"${x.name}"`);
    return q.length <= 2 ? q.join(' and ') : `${q.slice(0, 2).join(', ')} and ${q.length - 2} more`;
  };

  // For every weak skill, find prerequisites that are weak or untested: those are
  // likely root causes and should be fixed before the skill that depends on them.
  const weak = Object.values(subtopics).filter(isWeak);
  const blocks = new Map(); // prerequisite id -> weak skills it underpins
  for (const w of weak) {
    for (const p of prereqsOf(w.id)) {
      if (!shaky(p)) continue;
      if (!blocks.has(p.id)) blocks.set(p.id, []);
      blocks.get(p.id).push(w);
    }
  }

  const recs = [];
  for (const [id, dependents] of blocks) {
    const p = subtopics[id];
    // a true root cause (its own prerequisites are fine) comes before one that is itself blocked
    const isRoot = !prereqsOf(id).some(shaky);
    recs.push({
      kind: 'review-prerequisite', subtopic: id, because: dependents.map((d) => d.id),
      priority: (isRoot ? 10 : 5) + dependents.length + (p.evidence ? 1 - p.mastery : 0.5),
      message: p.evidence
        ? `Review "${p.name}" (${pctOf(p)}) first — it underpins ${names(dependents)}, where you are also struggling.`
        : `Check "${p.name}" (not assessed yet) — it underpins ${names(dependents)}, where you are struggling.`,
    });
  }
  for (const w of weak) {
    if (blocks.has(w.id)) continue; // already covered above as a root cause
    const gaps = prereqsOf(w.id).filter(shaky);
    recs.push({
      kind: 'practice', subtopic: w.id, priority: 1 + (1 - w.mastery),
      message: gaps.length
        ? `Then practise "${w.name}" (${pctOf(w)}) once its prerequisites are in place.`
        : `Practise "${w.name}" (${pctOf(w)}) — its prerequisites look solid, so the gap is in this skill itself.`,
    });
  }
  for (const s of Object.values(subtopics)) {
    if (s.evidence > 0) continue;
    const prereqs = prereqsOf(s.id);
    if (prereqs.length && prereqs.every(isSolid)) {
      recs.push({ kind: 'ready', subtopic: s.id, priority: 0.2, message: `You're ready for "${s.name}" — you've shown the prerequisites (${prereqs.map((p) => p.name).join(', ')}).` });
    }
  }
  return recs.sort((a, b) => b.priority - a.priority);
}

function weightedMean(pairs) {
  const W = pairs.reduce((a, [, w]) => a + w, 0);
  return W ? pairs.reduce((a, [v, w]) => a + v * w, 0) / W : null;
}
function round(x) { return x === null || x === undefined ? x : Math.round(x * 1000) / 1000; }

module.exports = { computeProfile, levelOf, sigmoid, difficultyToB, learningRate, subjectRate };
