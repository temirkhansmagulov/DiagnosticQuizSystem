'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { instantiate, grade, renderTemplate, toFraction } = require('../lib/engine');
const { loadTaxonomy, loadBank } = require('../lib/bank');

const numericQ = {
  id: 't-num', type: 'numeric', difficulty: 2, subtopics: { x: 1 },
  text: 'Solve {{a|coef}}x {{b|signed}} = 0',
  variables: { a: { min: 2, max: 9 }, b: { min: -9, max: 9, exclude: [0] } },
  constraints: ['b % a == 0'],
  answer: '-b/a',
};

test('templates and formats', () => {
  const env = { a: 1, b: -3, c: 0.75 };
  assert.equal(renderTemplate('{{a|coef}}x {{b|signedcoef}}y {{b|signed}}', env), 'x - 3y - 3');
  assert.equal(renderTemplate('{{c|frac}} {{c|pct}}% {{1/3|2}}', env), '\\frac{3}{4} 75% 0.33');
  assert.deepEqual(toFraction(-0.625), { p: -5, q: 8, exact: true });
});

test('instances are deterministic per seed and vary across seeds', () => {
  const a = instantiate(numericQ, 's1');
  assert.deepEqual(instantiate(numericQ, 's1'), a);
  const texts = new Set(Array.from({ length: 30 }, (_, i) => instantiate(numericQ, `s${i}`).public.text));
  assert.ok(texts.size > 5);
  assert.ok(a.key.params.b % a.key.params.a === 0); // constraint respected
});

test('numeric grading with tolerance and expressions', () => {
  const q = { ...numericQ, answer: 'sqrt(2)', tolerance: { abs: 0.01 } };
  const { key } = instantiate(q, 'z');
  assert.ok(grade(q, key, '1.41').correct);
  assert.ok(grade(q, key, 'sqrt(2)').correct);
  assert.ok(!grade(q, key, '1.43').correct);
  assert.ok(grade(q, key, 'banana').invalid);
  assert.ok(grade(q, key, '').blank);
  const rel = { ...q, answer: '1000', tolerance: { rel: 0.01 } };
  assert.ok(grade(rel, instantiate(rel, 'z').key, '1009').correct);
});

test('computed MCQ has unique options and one correct answer', () => {
  const q = {
    id: 't-mcq', type: 'mcq', difficulty: 1, subtopics: { x: 1 }, text: '{{a}}+{{b}}?',
    variables: { a: { min: 1, max: 3 }, b: { min: 1, max: 3 } }, answer: 'a+b', distractors: ['a*b', 'a-b', 'a+b'],
  };
  for (let s = 0; s < 50; s++) {
    const inst = instantiate(q, s);
    const texts = inst.public.options.map((o) => o.text);
    assert.equal(new Set(texts).size, 4);
    assert.ok(grade(q, inst.key, inst.key.correctOption).correct);
    assert.ok(!('correct' in inst.public.options[0]), 'correct flag must not leak to students');
  }
});

test('whole bank loads and every question grades its own answer as correct', () => {
  const tax = loadTaxonomy();
  const { questions, errors } = loadBank(tax, undefined, { smokeSeeds: 50 });
  assert.deepEqual(errors, []);
  assert.ok(questions.size >= 70);
  for (const q of questions.values()) {
    for (let s = 0; s < 20; s++) {
      const inst = instantiate(q, `t${s}`);
      const right = q.type === 'mcq' ? inst.key.correctOption : String(inst.key.answer);
      assert.ok(grade(q, inst.key, right).correct, `${q.id} seed t${s}`);
    }
  }
});
