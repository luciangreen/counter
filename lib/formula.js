// Counter's formulas: a spreadsheet formula language you can read and check.
//   =B2*C2      =SUM(D2:D10)      =IF(E2>100, "high", "low")      =Price*Quantity (custom fields)
// Values are numbers, text, true/false, or errors (#DIV/0!, #REF!, #NAME?, #VALUE!, #CYCLE!, #N/A).

export class FormulaError extends Error {
  constructor(code, why = '') { super(why || code); this.code = code; this.why = why; }
}
export const isError = (x) => x instanceof FormulaError;
const err = (code, why) => new FormulaError(code, why);

// ------------------------------------------------------------------ cell addresses
export function colIndex(letters) {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
export function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export function parseRef(ref) {
  const m = /^\$?([A-Za-z]{1,3})\$?(\d+)$/.exec(String(ref).trim());
  if (!m) return null;
  return { col: colIndex(m[1]), row: Number(m[2]) - 1 };
}
export const refName = (col, row) => `${colName(col)}${row + 1}`;

// ------------------------------------------------------------------ tokens
function tokenize(src) {
  const out = [];
  const re = /\s+|(\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)|("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?)(?![A-Za-z0-9_(])|([A-Za-z]{1,3}:[A-Za-z]{1,3})(?![A-Za-z0-9_])|([A-Za-z_][A-Za-z0-9_.]*)|(<>|<=|>=|[-+*/^&=<>%(),:;])/y;
  let m;
  while (re.lastIndex < src.length) {
    const at = re.lastIndex;
    m = re.exec(src);
    if (!m) throw err('#VALUE!', `can't read the formula near "${src.slice(at, at + 12)}"`);
    if (m[1] !== undefined) out.push({ k: 'num', v: Number(m[1]) });
    else if (m[2] !== undefined) out.push({ k: 'str', v: m[2].slice(1, -1).replace(/""/g, '"') });
    else if (m[3] !== undefined) out.push({ k: 'ref', v: m[3].replace(/\$/g, '').toUpperCase() });
    else if (m[4] !== undefined) out.push({ k: 'ref', v: m[4].toUpperCase() });
    else if (m[5] !== undefined) out.push({ k: 'name', v: m[5] });
    else if (m[6] !== undefined) out.push({ k: 'op', v: m[6] === ';' ? ',' : m[6] });
  }
  return out;
}

// ------------------------------------------------------------------ parsing (to a tree)
const BIN = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 };

export function parseFormula(src) {
  const ts = tokenize(String(src).replace(/^=/, ''));
  let i = 0;
  const peek = () => ts[i];
  const expect = (v) => { if (ts[i]?.v !== v) throw err('#VALUE!', `expected "${v}"`); i++; };
  function expr(min = 1) {
    let left = unary();
    for (;;) {
      const t = peek();
      if (!t || t.k !== 'op' || !BIN[t.v] || BIN[t.v] < min) break;
      i++;
      const right = expr(t.v === '^' ? BIN[t.v] : BIN[t.v] + 1);
      left = { t: 'bin', op: t.v, a: left, b: right };
    }
    return left;
  }
  function unary() {
    const t = peek();
    if (t?.k === 'op' && (t.v === '-' || t.v === '+')) { i++; const x = unary(); return t.v === '-' ? { t: 'neg', a: x } : x; }
    let x = primary();
    while (peek()?.k === 'op' && peek().v === '%') { i++; x = { t: 'pct', a: x }; }
    return x;
  }
  function primary() {
    const t = ts[i++];
    if (!t) throw err('#VALUE!', 'the formula ends too soon');
    if (t.k === 'num') return { t: 'num', v: t.v };
    if (t.k === 'str') return { t: 'str', v: t.v };
    if (t.k === 'ref') return t.v.includes(':') ? { t: 'range', v: t.v } : { t: 'ref', v: t.v };
    if (t.k === 'op' && t.v === '(') { const x = expr(); expect(')'); return x; }
    if (t.k === 'name') {
      const upper = t.v.toUpperCase();
      if (peek()?.v === '(') {
        i++;
        const args = [];
        if (peek()?.v !== ')') { args.push(expr()); while (peek()?.v === ',') { i++; args.push(expr()); } }
        expect(')');
        return { t: 'call', f: upper, args };
      }
      if (upper === 'TRUE' || upper === 'FALSE') return { t: 'bool', v: upper === 'TRUE' };
      return { t: 'name', v: t.v };
    }
    throw err('#VALUE!', `unexpected "${t.v}"`);
  }
  const tree = expr();
  if (i < ts.length) throw err('#VALUE!', `unexpected "${ts[i].v}"`);
  return tree;
}

// The cells (and names) a formula reads, for recalculation order.
export function references(tree, out = { refs: new Set(), ranges: new Set(), names: new Set() }) {
  if (!tree) return out;
  if (tree.t === 'ref') out.refs.add(tree.v);
  else if (tree.t === 'range') out.ranges.add(tree.v);
  else if (tree.t === 'name') out.names.add(tree.v.toLowerCase());
  for (const k of ['a', 'b']) if (tree[k]) references(tree[k], out);
  if (tree.args) tree.args.forEach((x) => references(x, out));
  return out;
}

// ------------------------------------------------------------------ evaluation
// ctx: { cell(ref) -> value, range(a, b) -> [[values]], name(n) -> value | { range } | undefined }
export function evaluate(tree, ctx) {
  switch (tree.t) {
    case 'num': case 'str': case 'bool': return tree.v;
    case 'ref': return ctx.cell(tree.v) ?? 0;
    case 'range': { const [a, b] = tree.v.split(':'); return ctx.range(a, b); }
    case 'name': {
      const v = ctx.name(tree.v);
      if (v === undefined) return err('#NAME?', `nothing is called ${tree.v}`);
      return v;
    }
    case 'neg': { const x = num(evaluate(tree.a, ctx)); return isError(x) ? x : -x; }
    case 'pct': { const x = num(evaluate(tree.a, ctx)); return isError(x) ? x : x / 100; }
    case 'bin': return binary(tree.op, scalar(evaluate(tree.a, ctx)), scalar(evaluate(tree.b, ctx)));
    case 'call': return call(tree.f, tree.args, ctx);
    default: return err('#VALUE!');
  }
}

const scalar = (v) => (Array.isArray(v) ? (v.length === 1 && v[0].length === 1 ? v[0][0] : err('#VALUE!', 'a range where one value was expected')) : v);
function num(v) {
  v = scalar(v);
  if (isError(v)) return v;
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[$,]/g, ''));
  return Number.isFinite(n) ? n : err('#VALUE!', `"${v}" is not a number`);
}
const text = (v) => { v = scalar(v); return isError(v) ? v : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v === null || v === undefined ? '' : String(v); };
const truthy = (v) => { v = scalar(v); if (isError(v)) return v; if (typeof v === 'string') { if (/^true$/i.test(v)) return true; if (/^false$/i.test(v)) return false; return err('#VALUE!'); } return Boolean(num(v)); };

function binary(op, a, b) {
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === '&') return text(a) + text(b);
  if (['=', '<>', '<', '>', '<=', '>='].includes(op)) {
    const both = typeof a === 'number' && typeof b === 'number';
    const x = both ? a : typeof a === 'string' ? a.toLowerCase() : a;
    const y = both ? b : typeof b === 'string' ? b.toLowerCase() : b;
    switch (op) {
      case '=': return x === y || (x === '' && y === 0) || (x === 0 && y === '');
      case '<>': return !(x === y);
      case '<': return x < y; case '>': return x > y; case '<=': return x <= y; case '>=': return x >= y;
    }
  }
  const x = num(a), y = num(b);
  if (isError(x)) return x;
  if (isError(y)) return y;
  switch (op) {
    case '+': return round(x + y);
    case '-': return round(x - y);
    case '*': return round(x * y);
    case '/': return y === 0 ? err('#DIV/0!', 'division by zero') : round(x / y);
    case '^': return round(x ** y);
  }
  return err('#VALUE!');
}
// Keeps sums like 0.1 + 0.2 at 0.3, as spreadsheets show them.
const round = (x) => (Number.isFinite(x) ? Number(x.toPrecision(15)) : err('#VALUE!', 'the number is too large'));

// All values from arguments, ranges flattened. Text and blanks inside ranges are skipped
// by the numeric functions, as in other spreadsheets; text typed directly is an error.
function values(args, ctx) {
  const out = [];
  for (const a of args) {
    const v = evaluate(a, ctx);
    if (Array.isArray(v)) for (const row of v) for (const c of row) out.push({ v: c, fromRange: true });
    else out.push({ v, fromRange: false });
  }
  return out;
}
function numbers(args, ctx) {
  const out = [];
  for (const { v, fromRange } of values(args, ctx)) {
    if (isError(v)) return v;
    if (typeof v === 'number') out.push(v);
    else if (!fromRange) { const n = num(v); if (isError(n)) return n; out.push(n); }
  }
  return out;
}
function flat(v) { return Array.isArray(v) ? v.flat() : [v]; }

// Criteria for SUMIF/COUNTIF: ">100", "<>0", "north", 5.
function matcher(crit) {
  crit = scalar(crit);
  if (typeof crit === 'number') return (v) => v === crit;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(String(crit));
  const op = m[1] ?? '=', rhs = m[2];
  const n = rhs !== '' && Number.isFinite(Number(rhs)) ? Number(rhs) : null;
  return (v) => {
    if (n !== null && typeof v === 'number') return binary(op, v, n) === true;
    if (n !== null && typeof v !== 'number') return op === '<>';
    return binary(op, String(v ?? '').toLowerCase(), rhs.toLowerCase()) === true;
  };
}

const FUNCTIONS = {
  SUM: (a, c) => { const ns = numbers(a, c); return isError(ns) ? ns : round(ns.reduce((s, x) => s + x, 0)); },
  AVERAGE: (a, c) => { const ns = numbers(a, c); if (isError(ns)) return ns; return ns.length ? round(ns.reduce((s, x) => s + x, 0) / ns.length) : err('#DIV/0!', 'nothing to average'); },
  MIN: (a, c) => { const ns = numbers(a, c); return isError(ns) ? ns : ns.length ? Math.min(...ns) : 0; },
  MAX: (a, c) => { const ns = numbers(a, c); return isError(ns) ? ns : ns.length ? Math.max(...ns) : 0; },
  COUNT: (a, c) => values(a, c).filter(({ v }) => typeof v === 'number').length,
  COUNTA: (a, c) => values(a, c).filter(({ v }) => v !== '' && v !== null && v !== undefined).length,
  PRODUCT: (a, c) => { const ns = numbers(a, c); return isError(ns) ? ns : round(ns.reduce((s, x) => s * x, 1)); },
  ROUND: (a, c) => { const x = num(evaluate(a[0], c)), d = a[1] ? num(evaluate(a[1], c)) : 0; if (isError(x)) return x; if (isError(d)) return d; const f = 10 ** d; return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f; },
  ABS: (a, c) => { const x = num(evaluate(a[0], c)); return isError(x) ? x : Math.abs(x); },
  SQRT: (a, c) => { const x = num(evaluate(a[0], c)); return isError(x) ? x : x < 0 ? err('#VALUE!', 'square root of a negative number') : Math.sqrt(x); },
  POWER: (a, c) => binary('^', evaluate(a[0], c), evaluate(a[1], c)),
  MOD: (a, c) => { const x = num(evaluate(a[0], c)), y = num(evaluate(a[1], c)); if (isError(x)) return x; if (isError(y)) return y; return y === 0 ? err('#DIV/0!') : ((x % y) + y) % y; },
  IF: (a, c) => { const t = truthy(evaluate(a[0], c)); if (isError(t)) return t; return t ? (a[1] ? scalar(evaluate(a[1], c)) : true) : (a[2] ? scalar(evaluate(a[2], c)) : false); },
  IFERROR: (a, c) => { const v = scalar(evaluate(a[0], c)); return isError(v) ? scalar(evaluate(a[1], c)) : v; },
  AND: (a, c) => { for (const { v } of values(a, c)) { const t = truthy(v); if (isError(t)) return t; if (!t) return false; } return true; },
  OR: (a, c) => { for (const { v } of values(a, c)) { const t = truthy(v); if (isError(t)) return t; if (t) return true; } return false; },
  NOT: (a, c) => { const t = truthy(evaluate(a[0], c)); return isError(t) ? t : !t; },
  CONCAT: (a, c) => values(a, c).map(({ v }) => text(v)).join(''),
  LEN: (a, c) => { const t = text(evaluate(a[0], c)); return isError(t) ? t : t.length; },
  UPPER: (a, c) => { const t = text(evaluate(a[0], c)); return isError(t) ? t : t.toUpperCase(); },
  LOWER: (a, c) => { const t = text(evaluate(a[0], c)); return isError(t) ? t : t.toLowerCase(); },
  SUMIF: (a, c) => {
    const range = flat(evaluate(a[0], c)), test = matcher(evaluate(a[1], c)), sum = a[2] ? flat(evaluate(a[2], c)) : range;
    return round(range.reduce((s, v, i) => (test(v) && typeof sum[i] === 'number' ? s + sum[i] : s), 0));
  },
  COUNTIF: (a, c) => { const range = flat(evaluate(a[0], c)), test = matcher(evaluate(a[1], c)); return range.filter((v) => test(v)).length; },
  AVERAGEIF: (a, c) => {
    const range = flat(evaluate(a[0], c)), test = matcher(evaluate(a[1], c)), avg = a[2] ? flat(evaluate(a[2], c)) : range;
    const picked = range.map((v, i) => (test(v) && typeof avg[i] === 'number' ? avg[i] : null)).filter((x) => x !== null);
    return picked.length ? round(picked.reduce((s, x) => s + x, 0) / picked.length) : err('#DIV/0!');
  },
  VLOOKUP: (a, c) => {
    const key = scalar(evaluate(a[0], c)), table = evaluate(a[1], c), col = num(evaluate(a[2], c));
    if (!Array.isArray(table)) return err('#VALUE!', 'VLOOKUP needs a range');
    if (isError(col) || col < 1 || col > table[0].length) return err('#REF!', 'column number outside the range');
    const row = table.find((r) => binary('=', r[0], key) === true);
    return row ? row[col - 1] : err('#N/A', `${key} was not found`);
  },
  PMT: (a, c) => { // PMT(rate per period, number of periods, present value)
    const [r, n, pv] = a.map((x) => num(evaluate(x, c)));
    for (const x of [r, n, pv]) if (isError(x)) return x;
    if (n === 0) return err('#DIV/0!');
    return round(r === 0 ? -pv / n : (-pv * r) / (1 - (1 + r) ** -n));
  }
};
export const FUNCTION_NAMES = Object.keys(FUNCTIONS);

function call(f, args, ctx) {
  const fn = FUNCTIONS[f];
  if (!fn) return err('#NAME?', `there is no function ${f}`);
  return fn(args, ctx);
}

// What a cell shows: numbers without float noise, errors by code, true/false in capitals.
export function display(v) {
  if (isError(v)) return v.code;
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(12)));
  return v ?? '';
}
