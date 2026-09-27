'use strict';
/**
 * Loads the taxonomy (subjects > topics > subtopics + the subtopic graph) and the
 * question bank (data/bank/*.json), validating every question on load.
 */
const fs = require('fs');
const path = require('path');
const { parse, variablesOf } = require('./expr');
const { instantiate } = require('./engine');

const DATA_DIR = path.join(__dirname, '..', 'data');

function loadTaxonomy(file = path.join(DATA_DIR, 'taxonomy.json')) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const subjects = new Map();
  const topics = new Map();
  const subtopics = new Map();
  for (const s of raw.subjects) {
    subjects.set(s.id, { id: s.id, name: s.name, topicIds: s.topics.map((t) => t.id) });
    for (const t of s.topics) {
      topics.set(t.id, { id: t.id, name: t.name, subject: s.id, subtopicIds: t.subtopics.map((st) => st.id) });
      for (const st of t.subtopics) {
        if (subtopics.has(st.id)) throw new Error(`Duplicate subtopic id ${st.id}`);
        subtopics.set(st.id, {
          id: st.id, name: st.name, topic: t.id, subject: s.id,
          prerequisites: st.prerequisites || [], related: st.related || [],
        });
      }
    }
  }
  const errors = [];
  for (const st of subtopics.values()) {
    for (const ref of [...st.prerequisites, ...st.related]) {
      if (!subtopics.has(ref)) errors.push(`Subtopic ${st.id} references unknown subtopic ${ref}`);
    }
  }
  if (errors.length) throw new Error(errors.join('\n'));
  return { raw, subjects, topics, subtopics };
}

/** Graph of subtopics: nodes + prerequisite (directed) and related (undirected) edges. */
function buildGraph(tax) {
  const nodes = [...tax.subtopics.values()].map((st) => ({
    id: st.id, name: st.name, topic: st.topic, topicName: tax.topics.get(st.topic).name,
    subject: st.subject, subjectName: tax.subjects.get(st.subject).name,
  }));
  const edges = [];
  const seenRelated = new Set();
  for (const st of tax.subtopics.values()) {
    for (const p of st.prerequisites) edges.push({ source: p, target: st.id, kind: 'prerequisite' });
    for (const r of st.related) {
      const key = [st.id, r].sort().join('|');
      if (!seenRelated.has(key)) { seenRelated.add(key); edges.push({ source: st.id, target: r, kind: 'related' }); }
    }
  }
  return { nodes, edges };
}

const QUESTION_KEYS = new Set([
  'id', 'title', 'type', 'difficulty', 'subtopics', 'text', 'variables', 'derived', 'constraints',
  'answer', 'answerDisplay', 'displayDecimals', 'tolerance', 'inputHint', 'unit', 'distractors', 'optionTemplate',
  'numOptions', 'choices', 'shuffle', 'solution', 'tags', 'points',
]);

/** Validate one question; returns a list of error strings (empty = ok). */
function validateQuestion(q, tax, { smokeSeeds = 25 } = {}) {
  const errs = [];
  const where = `Question ${q.id || '(no id)'}`;
  if (!q.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(q.id)) errs.push(`${where}: id must be a slug`);
  for (const k of Object.keys(q)) if (!QUESTION_KEYS.has(k)) errs.push(`${where}: unknown field "${k}"`);
  if (!['numeric', 'mcq'].includes(q.type)) errs.push(`${where}: type must be "numeric" or "mcq"`);
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) errs.push(`${where}: difficulty must be 1..5`);
  if (typeof q.text !== 'string' || !q.text) errs.push(`${where}: text is required`);
  const sts = Object.entries(q.subtopics || {});
  if (!sts.length) errs.push(`${where}: at least one subtopic is required`);
  for (const [st, w] of sts) {
    if (!tax.subtopics.has(st)) errs.push(`${where}: unknown subtopic "${st}"`);
    if (typeof w !== 'number' || w <= 0 || w > 1) errs.push(`${where}: subtopic weight for "${st}" must be in (0, 1]`);
  }
  const known = new Set([...Object.keys(q.variables || {}), ...Object.keys(q.derived || {})]);
  const checkFormula = (f, label, extra = []) => {
    try {
      parse(f);
      for (const v of variablesOf(f)) if (!known.has(v) && !extra.includes(v)) errs.push(`${where}: ${label} uses undefined variable "${v}"`);
    } catch (e) { errs.push(`${where}: ${label}: ${e.message}`); }
  };
  for (const [name, f] of Object.entries(q.derived || {})) checkFormula(f, `derived.${name}`);
  (q.constraints || []).forEach((c, i) => checkFormula(c, `constraints[${i}]`));
  if (q.type === 'numeric') {
    if (!q.answer) errs.push(`${where}: numeric questions need an answer formula`);
    else checkFormula(q.answer, 'answer');
    if (q.tolerance && q.tolerance.abs === undefined && q.tolerance.rel === undefined) errs.push(`${where}: tolerance needs abs or rel`);
  }
  if (q.type === 'mcq') {
    if (!q.choices && !q.answer) errs.push(`${where}: mcq needs either "choices" or an "answer" formula`);
    if (q.answer) checkFormula(q.answer, 'answer');
    (q.distractors || []).forEach((d, i) => checkFormula(d, `distractors[${i}]`));
  }
  if (errs.length) return errs;
  // Smoke test: instance generation must work for many seeds.
  const seen = new Set();
  for (let s = 0; s < smokeSeeds; s++) {
    try {
      const inst = instantiate(q, `validate-${s}`);
      seen.add(inst.public.text);
      if (q.type === 'mcq' && inst.public.options.length < 2) errs.push(`${where}: mcq produced fewer than 2 options`);
    } catch (e) {
      errs.push(`${where}: instance failed for seed ${s}: ${e.message}`);
      break;
    }
  }
  if (!errs.length && smokeSeeds >= 10 && Object.keys(q.variables || {}).length && seen.size < 2) errs.push(`${where}: variables never change the rendered text`);
  return errs;
}

function loadBank(tax, dir = path.join(DATA_DIR, 'bank'), opts = {}) {
  const questions = new Map();
  const errors = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    let doc;
    try { doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')); } catch (e) { errors.push(`${file}: invalid JSON: ${e.message}`); continue; }
    if (!tax.subjects.has(doc.subject)) { errors.push(`${file}: unknown subject "${doc.subject}"`); continue; }
    for (const q of doc.questions || []) {
      const errs = validateQuestion(q, tax, opts);
      if (questions.has(q.id)) errs.push(`Question ${q.id}: duplicate id`);
      const primary = Object.keys(q.subtopics || {})[0];
      if (primary && tax.subtopics.has(primary) && tax.subtopics.get(primary).subject !== doc.subject) {
        errs.push(`Question ${q.id}: primary subtopic "${primary}" is not in subject "${doc.subject}"`);
      }
      if (errs.length) { errors.push(...errs.map((e) => `${file}: ${e}`)); continue; }
      const topicsOf = [...new Set(Object.keys(q.subtopics).map((st) => tax.subtopics.get(st).topic))];
      questions.set(q.id, {
        ...q,
        subject: doc.subject,
        topic: tax.subtopics.get(primary).topic,
        primarySubtopic: primary,
        topics: topicsOf,
        points: q.points || 1,
        file,
      });
    }
  }
  return { questions, errors };
}

module.exports = { loadTaxonomy, loadBank, buildGraph, validateQuestion, DATA_DIR };
