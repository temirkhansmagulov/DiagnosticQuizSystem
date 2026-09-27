'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluate, parseStudentNumber, variablesOf } = require('../lib/expr');

test('arithmetic, precedence and functions', () => {
  assert.equal(evaluate('2 + 3 * 4'), 14);
  assert.equal(evaluate('-2^2'), -4);
  assert.equal(evaluate('2^3^2'), 512);
  assert.equal(evaluate('2x^2', { x: 3 }), 18);
  assert.equal(evaluate('3(x + 1)', { x: 2 }), 9);
  assert.equal(evaluate('C(5, 2) * P(4, 2)'), 120);
  assert.equal(evaluate('5!'), 120);
  assert.equal(evaluate('gcd(84, 36) + lcm(4, 6)'), 24);
  assert.equal(evaluate('powmod(9, 60, 13)'), 1);
  assert.equal(evaluate('mod(-7, 3)'), 2);
  assert.ok(Math.abs(evaluate('sqrt(2) * sin(pi/4)') - 1) < 1e-12);
});

test('comparisons, logic and ternary', () => {
  assert.equal(evaluate('a != b && b > 0', { a: 1, b: 2 }), 1);
  assert.equal(evaluate('0.1 + 0.2 == 0.3'), 1); // tolerant equality
  assert.equal(evaluate('t == 0 ? 3 : t == 1 ? 5 : 8', { t: 1 }), 5);
});

test('rejects unknown identifiers and junk', () => {
  assert.throws(() => evaluate('x + 1'));
  assert.throws(() => evaluate('alert(1)'));
  assert.throws(() => evaluate('constructor'));
  assert.throws(() => evaluate('1 +'));
});

test('student answers', () => {
  assert.equal(parseStudentNumber('3/4'), 0.75);
  assert.equal(parseStudentNumber(' -2.5 '), -2.5);
  assert.equal(parseStudentNumber('1,5'), 1.5);
  assert.equal(parseStudentNumber('12,000'), 12000);
  assert.equal(parseStudentNumber('25%'), 0.25);
  assert.equal(parseStudentNumber('2π'), 2 * Math.PI);
  assert.ok(Math.abs(parseStudentNumber('√2/2') - Math.SQRT1_2) < 1e-12);
  assert.equal(parseStudentNumber('abc'), null);
  assert.equal(parseStudentNumber(''), null);
  assert.equal(parseStudentNumber('1/0'), null);
});

test('variablesOf ignores constants', () => {
  assert.deepEqual(variablesOf('a*x^2 + pi*e + b').sort(), ['a', 'b', 'x']);
});
