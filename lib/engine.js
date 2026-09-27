'use strict';
/**
 * Question engine: turns a question *template* from the bank into a concrete
 * *instance* for one student (random parameters, rendered text, computed answer,
 * shuffled MCQ options), and grades responses against that instance.
 *
 * Everything is deterministic given (question.id, seed), so an attempt can be
 * regenerated exactly from its stored seed.
 */
const { evaluate, parseStudentNumber } = require('./expr');

// ---------- seeded randomness ----------
function hashString(str) {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}
function mulberry32(a) {
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function makeRng(seed) {
  return mulberry32(hashString(String(seed)));
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- number formatting ----------
function decimalsOf(x) {
  const s = String(x);
  if (s.includes('e-')) return parseInt(s.split('e-')[1], 10);
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}
function cleanNumber(v) {
  if (!Number.isFinite(v)) return v;
  if (Math.abs(v - Math.round(v)) < 1e-9) return Math.round(v) || 0; // also turns -0 into 0
  return parseFloat(v.toPrecision(12));
}
/** Format a number for display. `decimals` = max decimals (trailing zeros trimmed). */
function formatNumber(v, decimals = 4) {
  if (typeof v !== 'number') return String(v);
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : v < 0 ? '-\\infty' : 'undefined';
  v = cleanNumber(v);
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(decimals);
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
/** Best rational approximation p/q with q <= maxDen (continued fractions). */
function toFraction(x, maxDen = 1000) {
  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x);
  let [h1, h0, k1, k0] = [1, 0, 0, 1];
  let b = x;
  for (let iter = 0; iter < 64; iter++) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > maxDen) break;
    [h0, h1, k0, k1] = [h1, h2, k1, k2];
    if (Math.abs(x - h1 / k1) < 1e-10) break;
    b = 1 / (b - a);
    if (!Number.isFinite(b)) break;
  }
  return { p: sign * h1, q: k1, exact: Math.abs(x - h1 / k1) < 1e-9 };
}

/**
 * Apply a `{{ expr | fmt }}` format.
 *   (none)      -> number, up to 4 decimals
 *   2           -> at most 2 decimals
 *   signed      -> "+ 3" / "- 3" / "" for 0    (for "x {{b|signed}}")
 *   coef        -> "" for 1, "-" for -1, else number   (for "{{a|coef}}x^2")
 *   signedcoef  -> "+ " / "- " / "+ 3" / "- 3"  (for "x^2 {{b|signedcoef}}x")
 *   frac        -> LaTeX fraction \frac{p}{q} (use inside $...$)
 *   pct         -> percentage, e.g. 0.25 -> "25"
 */
function applyFormat(v, fmt) {
  fmt = (fmt || '').trim();
  if (fmt === '') return formatNumber(v);
  if (/^\d+$/.test(fmt)) return formatNumber(v, parseInt(fmt, 10));
  switch (fmt) {
    case 'signed': return v === 0 ? '' : (v < 0 ? '- ' : '+ ') + formatNumber(Math.abs(v));
    case 'coef': return v === 1 ? '' : v === -1 ? '-' : formatNumber(v);
    case 'signedcoef': {
      const a = Math.abs(v);
      return (v < 0 ? '- ' : '+ ') + (a === 1 ? '' : formatNumber(a));
    }
    case 'frac': {
      const { p, q, exact } = toFraction(v);
      if (!exact) return formatNumber(v);
      if (q === 1) return String(p);
      return `${p < 0 ? '-' : ''}\\frac{${Math.abs(p)}}{${q}}`;
    }
    case 'pct': return formatNumber(v * 100, 2);
    default: throw new Error(`Unknown format "${fmt}"`);
  }
}

/** Replace every {{ expr }} / {{ expr | fmt }} in a template string. */
function renderTemplate(tpl, env) {
  return String(tpl).replace(/\{\{([^{}]+?)\}\}/g, (_, inner) => {
    const bar = inner.lastIndexOf('|');
    const expr = bar === -1 ? inner : inner.slice(0, bar);
    const fmt = bar === -1 ? '' : inner.slice(bar + 1);
    // `||` inside the expression is a logical or, not a format separator
    if (bar !== -1 && inner[bar - 1] === '|') return applyFormat(evaluate(inner, env), '');
    return applyFormat(evaluate(expr.trim(), env), fmt);
  });
}

// ---------- parameter sampling ----------
function sampleVariable(name, spec, rng) {
  if (Array.isArray(spec.choices)) {
    const pool = spec.choices.filter((c) => !(spec.exclude || []).includes(c));
    return pool[Math.floor(rng() * pool.length)];
  }
  const { min, max } = spec;
  const step = spec.step ?? 1;
  if (typeof min !== 'number' || typeof max !== 'number' || max < min) {
    throw new Error(`Variable "${name}" needs numeric min <= max or a choices list`);
  }
  const n = Math.floor((max - min) / step + 1e-9) + 1;
  const dec = Math.max(decimalsOf(step), decimalsOf(min));
  for (let tries = 0; tries < 100; tries++) {
    const v = parseFloat((min + Math.floor(rng() * n) * step).toFixed(dec));
    if (!(spec.exclude || []).includes(v)) return v;
  }
  throw new Error(`Variable "${name}": every value in range is excluded`);
}

/** Draw a full parameter set satisfying all constraints. */
function sampleParams(q, rng) {
  const maxTries = 500;
  for (let t = 0; t < maxTries; t++) {
    const env = {};
    for (const [name, spec] of Object.entries(q.variables || {})) env[name] = sampleVariable(name, spec, rng);
    for (const [name, expr] of Object.entries(q.derived || {})) env[name] = cleanNumber(evaluate(expr, env));
    if ((q.constraints || []).every((c) => evaluate(c, env))) return env;
  }
  throw new Error(`Question ${q.id}: could not satisfy constraints after ${maxTries} tries`);
}

// ---------- instancing ----------
const DEFAULT_TOL = { abs: 1e-6 };

function tolerance(q) {
  return q.tolerance || DEFAULT_TOL;
}
function withinTolerance(x, target, tol) {
  const diff = Math.abs(x - target);
  if (tol.abs !== undefined && diff <= tol.abs + 1e-12) return true;
  if (tol.rel !== undefined && diff <= tol.rel * Math.abs(target) + 1e-12) return true;
  return false;
}

/**
 * Create a concrete instance of a question.
 * Returns { public, key } — `public` is safe to send to the student,
 * `key` holds the parameters and the correct answer (server-side only).
 */
function instantiate(q, seed) {
  const rng = makeRng(`${q.id}::${seed}`);
  const params = sampleParams(q, rng);
  const text = renderTemplate(q.text, params);
  const pub = { questionId: q.id, type: q.type, text };
  const key = { params };

  if (q.type === 'numeric') {
    const answer = cleanNumber(evaluate(q.answer, params));
    if (!Number.isFinite(answer)) throw new Error(`Question ${q.id}: answer is not finite for ${JSON.stringify(params)}`);
    key.answer = answer;
    key.answerDisplay = q.answerDisplay ? renderTemplate(q.answerDisplay, { ...params, answer }) : formatNumber(answer, q.displayDecimals ?? 4);
    pub.inputHint = q.inputHint || null;
    if (q.unit) pub.unit = q.unit;
  } else if (q.type === 'mcq') {
    if (q.answer) key.answer = cleanNumber(evaluate(q.answer, params));
    const options = q.choices ? staticOptions(q, params) : computedOptions(q, params, rng);
    const ordered = q.shuffle === false ? options : shuffle(options, rng);
    const labelled = ordered.map((o, i) => ({ ...o, id: String.fromCharCode(97 + i) }));
    pub.options = labelled.map(({ id, text: t }) => ({ id, text: t }));
    const correct = labelled.find((o) => o.correct);
    key.correctOption = correct.id;
    key.answerDisplay = correct.text;
  } else {
    throw new Error(`Question ${q.id}: unknown type "${q.type}"`);
  }
  if (q.solution) key.solution = renderTemplate(q.solution, { ...params, answer: key.answer });
  return { public: pub, key };
}

function staticOptions(q, params) {
  const opts = q.choices.map((c) => ({ text: renderTemplate(c.text, params), correct: !!c.correct }));
  if (opts.filter((o) => o.correct).length !== 1) throw new Error(`Question ${q.id}: exactly one choice must be correct`);
  return opts;
}

/**
 * MCQ from formulas: `answer` is the correct value, `distractors` are formulas for
 * typical mistakes. Each value is rendered with `optionTemplate` (default "{{value}}").
 * Duplicate-looking options are dropped and topped up with nearby values.
 */
function computedOptions(q, params, rng) {
  const want = q.numOptions || 4;
  const tpl = q.optionTemplate || '$ {{value}} $';
  const render = (value) => renderTemplate(tpl, { ...params, value });
  const answer = cleanNumber(evaluate(q.answer, params));
  const seen = new Set();
  const out = [];
  const push = (value, correct) => {
    if (!Number.isFinite(value)) return;
    const text = render(cleanNumber(value));
    if (seen.has(text)) return;
    seen.add(text);
    out.push({ text, correct, value: cleanNumber(value) });
  };
  push(answer, true);
  if (!out.length) throw new Error(`Question ${q.id}: correct answer not finite`);
  for (const d of q.distractors || []) {
    if (out.length >= want) break;
    try { push(evaluate(d, params), false); } catch { /* distractor undefined for these params */ }
  }
  // Top up with plausible nearby values: integers stay integers, decimals keep
  // the answer's precision, so padding options don't stand out.
  const isInt = Number.isInteger(answer);
  const dec = Math.min(3, decimalsOf(answer));
  const unit = isInt ? Math.max(1, Math.round(Math.abs(answer) * 0.1)) : 0;
  for (let i = 0; out.length < want && i < 200; i++) {
    const sign = rng() < 0.5 ? -1 : 1;
    const mag = 1 + Math.floor(rng() * (2 + i / 10));
    const v = isInt
      ? answer + sign * mag * unit
      : parseFloat((answer * (1 + sign * mag * (0.1 + 0.05 * Math.floor(i / 10)))).toFixed(Math.max(dec, 1)));
    push(v, false);
  }
  return out.map(({ text, correct }) => ({ text, correct }));
}

// ---------- grading ----------
/**
 * Grade a response against an instance key.
 * numeric: response is a string/number, parsed with parseStudentNumber
 * mcq:     response is the option id
 */
function grade(q, key, response) {
  if (response === null || response === undefined || response === '') return { correct: false, blank: true };
  if (q.type === 'mcq') return { correct: response === key.correctOption };
  const x = parseStudentNumber(response);
  if (x === null) return { correct: false, invalid: true };
  return { correct: withinTolerance(x, key.answer, tolerance(q)), value: x };
}

module.exports = {
  instantiate, grade, renderTemplate, formatNumber, toFraction, makeRng, shuffle,
  hashString, sampleParams, withinTolerance,
};
