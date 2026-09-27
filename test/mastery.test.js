'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadTaxonomy, loadBank } = require('../lib/bank');
const { computeProfile } = require('../lib/mastery');

const tax = loadTaxonomy();
const { questions } = loadBank(tax, undefined, { smokeSeeds: 1 });
const ev = (questionId, correct, at) => ({ questionId, correct, at });

test('empty profile', () => {
  const p = computeProfile(tax, questions, []);
  assert.equal(p.overall.answered, 0);
  assert.equal(p.overall.mastery, null);
  assert.equal(p.subtopics['la-det-2x2'].status, 'not-assessed');
  assert.deepEqual(p.recommendations, []);
});

test('mastery moves after every answer, in the right direction', () => {
  const p1 = computeProfile(tax, questions, [ev('la-det2-001', true, 1)]);
  assert.ok(p1.subtopics['la-det-2x2'].mastery > 0.5);
  const p2 = computeProfile(tax, questions, [ev('la-det2-001', true, 1), ev('la-det2-001', false, 2)]);
  assert.ok(p2.subtopics['la-det-2x2'].mastery < p1.subtopics['la-det-2x2'].mastery);
  assert.equal(p2.timeline.length, 2);
  // secondary subtopic gets (weaker) evidence too
  const p3 = computeProfile(tax, questions, [ev('la-det3-001', true, 1)]);
  assert.ok(p3.subtopics['la-det-2x2'].evidence > 0 && p3.subtopics['la-det-2x2'].evidence < 1);
});

test('hard questions right count for more than easy ones', () => {
  const easy = computeProfile(tax, questions, [ev('la-det2-001', true, 1)]); // difficulty 1
  const hard = computeProfile(tax, questions, [ev('la-eig-001', true, 1)]); // difficulty 4
  assert.ok(hard.subtopics['la-eigenvalues'].mastery > easy.subtopics['la-det-2x2'].mastery);
});

test('recommends fixing a weak prerequisite before the skill built on it', () => {
  const events = [];
  let t = 0;
  for (let i = 0; i < 3; i++) events.push(ev('sat-linear-001', false, t++), ev('sat-quadratic-002', false, t++));
  const p = computeProfile(tax, questions, events);
  const first = p.recommendations[0];
  assert.equal(first.kind, 'review-prerequisite');
  assert.equal(first.subtopic, 'sat-linear-equations');
  assert.ok(first.because.includes('sat-quadratics'));
  assert.ok(p.weaknesses.some((w) => w.id === 'sat-quadratics'));
});

test('strong answers lead to strengths and "ready" suggestions', () => {
  const events = [];
  for (let i = 0; i < 4; i++) events.push(ev('dm-perm-001', true, i));
  const p = computeProfile(tax, questions, events);
  assert.equal(p.strengths[0].id, 'dm-permutations');
  assert.ok(p.recommendations.some((r) => r.kind === 'ready' && r.subtopic === 'dm-combinations'));
});
