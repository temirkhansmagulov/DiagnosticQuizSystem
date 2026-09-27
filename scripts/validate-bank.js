'use strict';
/**
 * Validate every question in data/bank: schema, formulas, subtopic references,
 * and that 500 random instances can be generated and graded correctly.
 *
 *   npm run validate
 */
const { loadTaxonomy, loadBank } = require('../lib/bank');
const { instantiate, grade } = require('../lib/engine');

const tax = loadTaxonomy();
const { questions, errors } = loadBank(tax, undefined, { smokeSeeds: 500 });
for (const q of questions.values()) {
  for (let s = 0; s < 100; s++) {
    const inst = instantiate(q, `grade-${s}`);
    const right = q.type === 'mcq' ? inst.key.correctOption : String(inst.key.answer);
    if (!grade(q, inst.key, right).correct) { errors.push(`${q.id}: its own answer is graded wrong (seed grade-${s})`); break; }
  }
}
const uncovered = [...tax.subtopics.keys()].filter((id) => ![...questions.values()].some((q) => q.subtopics[id] !== undefined));
console.log(`${questions.size} questions, ${tax.subtopics.size} subtopics in ${tax.subjects.size} subjects`);
if (uncovered.length) console.log(`Subtopics with no questions yet: ${uncovered.join(', ')}`);
if (errors.length) {
  console.error(`\n${errors.length} problem(s):\n  ${errors.join('\n  ')}`);
  process.exit(1);
}
console.log('Question bank OK');
