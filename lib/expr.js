'use strict';
/**
 * Safe math expression parser/evaluator (no `eval`).
 *
 * Used for three things:
 *   - answer formulas / derived variables / constraints in the question bank
 *   - `{{ ... }}` placeholders in question text
 *   - parsing what a student types into a numeric answer box ("3/4", "2sqrt(3)", "pi/6")
 *
 * Grammar (lowest to highest precedence):
 *   ternary   a ? b : c
 *   or        a || b
 *   and       a && b
 *   compare   == != < <= > >=
 *   additive  + -
 *   mult      * / %   and implicit multiplication (2x, 3(x+1), 2pi)
 *   unary     - + !
 *   power     ^  (right associative, binds tighter than unary minus: -2^2 = -4)
 *   postfix   n!
 *   primary   number | identifier | call(args) | ( expr )
 */

class ExprError extends Error {}

const TOKEN_RE = /\s*(?:(\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?)|([A-Za-z_][A-Za-z0-9_]*)|(\*\*|==|!=|<=|>=|&&|\|\||[-+*/%^()!<>?:,]))/y;

function tokenize(src) {
  const tokens = [];
  TOKEN_RE.lastIndex = 0;
  let pos = 0;
  src = String(src);
  while (pos < src.length) {
    if (/^\s*$/.test(src.slice(pos))) break;
    TOKEN_RE.lastIndex = pos;
    const m = TOKEN_RE.exec(src);
    if (!m) throw new ExprError(`Unexpected character "${src.slice(pos).trim()[0]}" in "${src}"`);
    pos = TOKEN_RE.lastIndex;
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] === '**' ? '^' : m[3] });
  }
  tokens.push({ t: 'eof' });
  return tokens;
}

function parse(src) {
  const tokens = tokenize(src);
  let i = 0;
  const peek = () => tokens[i];
  const isOp = (v) => tokens[i].t === 'op' && tokens[i].v === v;
  const expect = (v) => {
    if (!isOp(v)) throw new ExprError(`Expected "${v}" in "${src}"`);
    i++;
  };

  function ternary() {
    const cond = or();
    if (isOp('?')) {
      i++;
      const a = ternary();
      expect(':');
      const b = ternary();
      return { k: 'if', cond, a, b };
    }
    return cond;
  }
  function binaryLevel(next, ops) {
    return function level() {
      let left = next();
      while (peek().t === 'op' && ops.includes(peek().v)) {
        const op = tokens[i++].v;
        left = { k: 'bin', op, l: left, r: next() };
      }
      return left;
    };
  }
  function mult() {
    let left = unary();
    for (;;) {
      const tk = peek();
      if (tk.t === 'op' && (tk.v === '*' || tk.v === '/' || tk.v === '%')) {
        i++;
        left = { k: 'bin', op: tk.v, l: left, r: unary() };
      } else if (tk.t === 'num' || tk.t === 'id' || (tk.t === 'op' && tk.v === '(')) {
        // implicit multiplication: 2x, 2(x+1), (a)(b), 2pi
        left = { k: 'bin', op: '*', l: left, r: power() };
      } else return left;
    }
  }
  const additive = binaryLevel(mult, ['+', '-']);
  const compare = binaryLevel(additive, ['==', '!=', '<', '<=', '>', '>=']);
  const and = binaryLevel(compare, ['&&']);
  const or = binaryLevel(and, ['||']);

  function unary() {
    if (isOp('-')) { i++; return { k: 'neg', x: unary() }; }
    if (isOp('+')) { i++; return unary(); }
    if (isOp('!')) { i++; return { k: 'not', x: unary() }; }
    return power();
  }
  function power() {
    const base = postfix();
    if (isOp('^')) {
      i++;
      return { k: 'bin', op: '^', l: base, r: unary() };
    }
    return base;
  }
  function postfix() {
    let x = primary();
    while (isOp('!')) {
      // `!` followed by `=` would have been tokenized as `!=`, so this is factorial
      i++;
      x = { k: 'call', fn: 'fact', args: [x] };
    }
    return x;
  }
  function primary() {
    const tk = peek();
    if (tk.t === 'num') { i++; return { k: 'num', v: tk.v }; }
    if (tk.t === 'id') {
      i++;
      if (isOp('(')) {
        i++;
        const args = [];
        if (!isOp(')')) {
          args.push(ternary());
          while (isOp(',')) { i++; args.push(ternary()); }
        }
        expect(')');
        return { k: 'call', fn: tk.v, args };
      }
      return { k: 'var', name: tk.v };
    }
    if (isOp('(')) {
      i++;
      const e = ternary();
      expect(')');
      return e;
    }
    throw new ExprError(tk.t === 'eof' ? `Unexpected end of expression "${src}"` : `Unexpected "${tk.v}" in "${src}"`);
  }

  const ast = ternary();
  if (peek().t !== 'eof') throw new ExprError(`Unexpected "${peek().v}" in "${src}"`);
  return ast;
}

function factorial(n) {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n > 170) return Infinity;
  let r = 1;
  for (let k = 2; k <= n; k++) r *= k;
  return r;
}
function comb(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) return NaN;
  if (k > n) return 0;
  k = Math.min(k, n - k);
  let r = 1;
  for (let j = 1; j <= k; j++) r = (r * (n - k + j)) / j;
  return Math.round(r);
}
function perm(n, k) {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) return NaN;
  if (k > n) return 0;
  let r = 1;
  for (let j = 0; j < k; j++) r *= n - j;
  return r;
}
function gcd(a, b) {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b));
  while (b) [a, b] = [b, a % b];
  return a;
}

const FUNCS = {
  sqrt: Math.sqrt, abs: Math.abs, exp: Math.exp, ln: Math.log,
  log: (x, b) => (b === undefined ? Math.log10(x) : Math.log(x) / Math.log(b)),
  log2: Math.log2, log10: Math.log10,
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, atan2: Math.atan2,
  floor: Math.floor, ceil: Math.ceil, sign: Math.sign, pow: Math.pow,
  round: (x, n = 0) => { const f = 10 ** n; return Math.round(x * f) / f; },
  min: Math.min, max: Math.max,
  fact: factorial, factorial,
  C: comb, comb, nCr: comb, P: perm, perm, nPr: perm,
  gcd, lcm: (a, b) => Math.abs(a * b) / gcd(a, b),
  mod: (a, b) => ((a % b) + b) % b,
  // modular exponentiation that stays exact for large exponents
  powmod: (a, k, m) => {
    let r = 1; a = ((a % m) + m) % m;
    for (; k > 0; k = Math.floor(k / 2)) {
      if (k % 2) r = (r * a) % m;
      a = (a * a) % m;
    }
    return r;
  },
};
const CONSTS = { pi: Math.PI, e: Math.E };

function evalAst(n, env) {
  switch (n.k) {
    case 'num': return n.v;
    case 'var':
      if (env && Object.prototype.hasOwnProperty.call(env, n.name)) return env[n.name];
      if (Object.prototype.hasOwnProperty.call(CONSTS, n.name)) return CONSTS[n.name];
      throw new ExprError(`Unknown variable "${n.name}"`);
    case 'neg': return -evalAst(n.x, env);
    case 'not': return evalAst(n.x, env) ? 0 : 1;
    case 'if': return evalAst(n.cond, env) ? evalAst(n.a, env) : evalAst(n.b, env);
    case 'call': {
      const f = Object.prototype.hasOwnProperty.call(FUNCS, n.fn) ? FUNCS[n.fn] : null;
      if (!f) throw new ExprError(`Unknown function "${n.fn}"`);
      return f(...n.args.map((a) => evalAst(a, env)));
    }
    case 'bin': {
      if (n.op === '&&') return evalAst(n.l, env) && evalAst(n.r, env) ? 1 : 0;
      if (n.op === '||') return evalAst(n.l, env) || evalAst(n.r, env) ? 1 : 0;
      const a = evalAst(n.l, env);
      const b = evalAst(n.r, env);
      switch (n.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return ((a % b) + b) % b;
        case '^': return a ** b;
        case '==': return Math.abs(a - b) < 1e-9 ? 1 : 0;
        case '!=': return Math.abs(a - b) >= 1e-9 ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '<=': return a <= b + 1e-12 ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '>=': return a >= b - 1e-12 ? 1 : 0;
      }
    }
  }
  throw new ExprError('Bad expression node');
}

const cache = new Map();
function compile(src) {
  let ast = cache.get(src);
  if (!ast) {
    ast = parse(src);
    if (cache.size > 5000) cache.clear();
    cache.set(src, ast);
  }
  return ast;
}

/** Evaluate an expression string with a variable environment. */
function evaluate(src, env = {}) {
  return evalAst(compile(src), env);
}

/** List the free variable names an expression refers to (excluding constants). */
function variablesOf(src) {
  const out = new Set();
  (function walk(n) {
    if (!n) return;
    if (n.k === 'var' && !(n.name in CONSTS)) out.add(n.name);
    ['x', 'l', 'r', 'cond', 'a', 'b'].forEach((key) => n[key] && typeof n[key] === 'object' && walk(n[key]));
    if (n.args) n.args.forEach(walk);
  })(compile(src));
  return [...out];
}

/**
 * Parse a student's typed numeric answer. Accepts plain numbers, fractions and
 * closed-form expressions (no variables). Returns a finite number or null.
 */
function parseStudentNumber(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim();
  if (!s) return null;
  s = s.replace(/[−–]/g, '-').replace(/π/g, 'pi').replace(/√\s*(\d+(?:\.\d+)?|[A-Za-z]+)/g, 'sqrt($1)').replace(/√/g, 'sqrt').replace(/×/g, '*').replace(/÷/g, '/');
  // strip thousands separators like 12,000 (groups of exactly three digits)...
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '');
  // ...otherwise "1,5" -> "1.5" (comma as decimal separator)
  else if (/^-?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (s.endsWith('%')) {
    const v = parseStudentNumber(s.slice(0, -1));
    return v === null ? null : v / 100;
  }
  try {
    const v = evalAst(parse(s), {});
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

module.exports = { evaluate, parse, variablesOf, parseStudentNumber, ExprError, FUNCS, gcd };
