// A Counter sheet is an Office document block:
//   { id, type: 'sheet', name, 'c:A1': '=SUM(B2:B4)', ..., 'f:price': 'B2', sections: [{ name, from, to }] }
// Cells are keys "c:<ref>" holding what you typed; custom fields are keys "f:<name>" holding a
// cell, a range, a formula or a value. Storing each cell as its own key makes every edit a
// single undoable op in the document's history.
import { FormulaError, colIndex, colName, display, evaluate, isError, parseFormula, parseRef, refName } from './formula.js';

export const cellKey = (ref) => `c:${ref.toUpperCase()}`;
export const formatKey = (ref) => `n:${ref.toUpperCase()}`;
export const formats = (sheet) => Object.fromEntries(Object.entries(sheet).filter(([k]) => k.startsWith('n:')).map(([k, v]) => [k.slice(2), v]));

// Number formats: 'general', 'number' (2 decimal places), 'money' ($1,234.50), 'percent' (61.5%), 'whole' (1,235).
export const FORMATS = { general: 'General', number: 'Number', money: 'Money', percent: 'Percent', whole: 'Whole number' };
export function formatValue(v, fmt) {
  if (typeof v !== 'number' || !fmt || fmt === 'general') return display(v);
  const group = (x, dp) => x.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  switch (fmt) {
    case 'number': return group(v, 2);
    case 'whole': return group(Math.round(v), 0);
    case 'money': return `${v < 0 ? '-' : ''}$${group(Math.abs(v), 2)}`;
    case 'percent': return `${(Math.round(v * 1000) / 10).toLocaleString('en-AU', { maximumFractionDigits: 1 })}%`;
    default: return display(v);
  }
}
export const setFormatOps = (sheet, refs, fmt) => refs.map((ref) => ({ op: 'set', id: sheet.id, key: formatKey(ref), value: !fmt || fmt === 'general' ? undefined : fmt }));
export const fieldKey = (name) => `f:${name.toLowerCase()}`;
export const cells = (sheet) => Object.fromEntries(Object.entries(sheet).filter(([k]) => k.startsWith('c:')).map(([k, v]) => [k.slice(2), v]));
export const fields = (sheet) => Object.fromEntries(Object.entries(sheet).filter(([k]) => k.startsWith('f:')).map(([k, v]) => [k.slice(2), v]));

export function size(sheet) {
  let cols = 0, rows = 0;
  for (const ref of Object.keys(cells(sheet))) { const p = parseRef(ref); if (p) { cols = Math.max(cols, p.col + 1); rows = Math.max(rows, p.row + 1); } }
  return { cols, rows };
}

// What you typed, as a value: numbers (with $ , and %), TRUE/FALSE, text, or a formula.
export function literal(input) {
  const s = String(input ?? '').trim();
  if (s === '') return '';
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  const pct = /^(-?[\d,]*\.?\d+)\s*%$/.exec(s);
  if (pct) return Number(pct[1].replace(/,/g, '')) / 100;
  const n = /^-?\$?-?[\d,]*\.?\d+(?:[eE][-+]?\d+)?$/.test(s) ? Number(s.replace(/[$,]/g, '')) : NaN;
  return Number.isFinite(n) ? n : s;
}

// Works out every cell. Cells are evaluated when first needed (with memory), so the order
// follows the formulas; a cell that needs itself, directly or not, is #CYCLE!.
export function compute(sheet) {
  const inputs = cells(sheet);
  const named = fields(sheet);
  const done = new Map();
  const busy = new Set();
  const trees = new Map();
  const why = new Map();
  const { rows } = size(sheet);

  const cell = (ref) => {
    ref = ref.toUpperCase();
    if (done.has(ref)) return done.get(ref);
    const input = inputs[ref];
    if (input === undefined || input === '') return '';
    if (typeof input !== 'string' || !input.startsWith('=')) { const v = literal(input); done.set(ref, v); return v; }
    if (busy.has(ref)) return new FormulaError('#CYCLE!', `${ref} depends on itself`);
    busy.add(ref);
    let v;
    try {
      if (!trees.has(ref)) trees.set(ref, parseFormula(input));
      v = evaluate(trees.get(ref), ctx);
      if (Array.isArray(v)) v = v.length === 1 && v[0].length === 1 ? v[0][0] : new FormulaError('#VALUE!', 'a range cannot fit in one cell');
    } catch (e) {
      v = e instanceof FormulaError ? e : new FormulaError('#VALUE!', e.message);
    }
    busy.delete(ref);
    // a cell caught in a cycle reports it, so the whole loop is marked
    if (isError(v) && v.code === '#CYCLE!' && !v.why.startsWith(ref)) v = new FormulaError('#CYCLE!', `${ref} is part of a loop: ${v.why}`);
    if (isError(v)) why.set(ref, v.why);
    done.set(ref, v);
    return v;
  };
  const range = (a, b) => {
    // whole columns ("A:A") run to the last used row
    const pa = parseRef(/\d/.test(a) ? a : `${a}1`), pb = parseRef(/\d/.test(b) ? b : `${b}${Math.max(rows, 1)}`);
    if (!pa || !pb) return new FormulaError('#REF!', `${a}:${b} is not a range`);
    const out = [];
    for (let r = Math.min(pa.row, pb.row); r <= Math.max(pa.row, pb.row); r++) {
      const row = [];
      for (let c = Math.min(pa.col, pb.col); c <= Math.max(pa.col, pb.col); c++) row.push(cell(refName(c, r)));
      out.push(row);
    }
    return out;
  };
  const nameBusy = new Set();
  const name = (n) => {
    const key = n.toLowerCase();
    if (!(key in named)) return undefined;
    const def = String(named[key]).trim();
    if (nameBusy.has(key)) return new FormulaError('#CYCLE!', `the field ${n} refers to itself`);
    nameBusy.add(key);
    try {
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(def)) return cell(def.replace(/\$/g, ''));
      if (/^\$?[A-Za-z]{1,3}\$?\d*:\$?[A-Za-z]{1,3}\$?\d*$/.test(def)) { const [a, b] = def.replace(/\$/g, '').toUpperCase().split(':'); return range(a, b); }
      if (def.startsWith('=')) { try { return evaluate(parseFormula(def), ctx); } catch (e) { return e instanceof FormulaError ? e : new FormulaError('#VALUE!'); } }
      return literal(def);
    } finally { nameBusy.delete(key); }
  };
  const ctx = { cell, range, name };
  const values = {};
  for (const ref of Object.keys(inputs)) values[ref] = cell(ref);
  return {
    values,
    value: (ref) => cell(ref),
    shown: (ref) => display(cell(ref)),
    field: (n) => name(n),
    why: (ref) => why.get(ref.toUpperCase()) ?? '',
    errors: Object.entries(values).filter(([, v]) => isError(v)).map(([ref, v]) => ({ ref, code: v.code, why: v.why }))
  };
}

// ------------------------------------------------------------------ edits as ops
export const setCellOps = (sheet, ref, input) => [{ op: 'set', id: sheet.id, key: cellKey(ref), value: input === '' || input === undefined || input === null ? undefined : String(input) }];
export const setFieldOps = (sheet, name, def) => [{ op: 'set', id: sheet.id, key: fieldKey(name), value: def === '' || def === undefined ? undefined : String(def) }];

// Rewrites the cell references in a formula (outside quotes) with f({ col, row }) -> { col, row } | null.
export function moveRefs(formula, f) {
  if (!String(formula).startsWith('=')) return formula;
  return String(formula).replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, str, d1, col, d2, row) => {
    if (str) return str;
    const p = f({ col: colIndex(col), row: Number(row) - 1 });
    if (!p) return '#REF!';
    return `${d1}${colName(p.col)}${d2}${p.row + 1}`;
  });
}

// Insert (count > 0) or delete (count < 0) rows at a row index, moving cells and adjusting
// every formula and field so they still point at the same cells.
// With extend, a range that ends just above an inserted row grows to include it, so a new
// expense row added above "Total" is counted in the total.
export function shiftRowsOps(sheet, at, count, { extend = false } = {}) {
  const grow = (f) => (!extend || count <= 0 ? f : String(f).replace(/("(?:[^"]|"")*")|(\$?[A-Za-z]{1,3}\$?)(\d+):(\$?[A-Za-z]{1,3}\$?)(\d+)/g,
    (m, str, c1, r1, c2, r2) => (str ? str : Number(r2) - 1 === at - 1 && Number(r1) - 1 <= at - 1 ? `${c1}${r1}:${c2}${at + count}` : m)));
  const now = cells(sheet);
  const move = (p) => {
    if (p.row < at) return p;
    if (count < 0 && p.row < at - count) return null; // a deleted row
    return { col: p.col, row: p.row + count };
  };
  const next = {};
  for (const [ref, input] of Object.entries(now)) {
    const p = move(parseRef(ref));
    if (!p) continue;
    next[refName(p.col, p.row)] = typeof input === 'string' && input.startsWith('=') ? grow(moveRefs(input, move)) : input;
  }
  const ops = [];
  for (const ref of Object.keys(now)) if (!(ref in next)) ops.push({ op: 'set', id: sheet.id, key: cellKey(ref), value: undefined });
  for (const [ref, input] of Object.entries(next)) if (now[ref] !== input) ops.push({ op: 'set', id: sheet.id, key: cellKey(ref), value: input });
  const fmtNow = formats(sheet), fmtNext = {};
  for (const [ref, f] of Object.entries(fmtNow)) { const p = move(parseRef(ref)); if (p) fmtNext[refName(p.col, p.row)] = f; }
  for (const ref of Object.keys(fmtNow)) if (!(ref in fmtNext)) ops.push({ op: 'set', id: sheet.id, key: formatKey(ref), value: undefined });
  for (const [ref, f] of Object.entries(fmtNext)) if (fmtNow[ref] !== f) ops.push({ op: 'set', id: sheet.id, key: formatKey(ref), value: f });
  for (const [name, def] of Object.entries(fields(sheet))) {
    const moved = String(def).startsWith('=') ? grow(moveRefs(def, move)) : grow(moveRefs(`=${def}`, move)).slice(1);
    if (moved !== def) ops.push({ op: 'set', id: sheet.id, key: fieldKey(name), value: moved });
  }
  if (sheet.sections?.length) {
    const sections = sheet.sections.map((s) => ({
      ...s,
      from: s.from >= at ? Math.max(at, s.from + count) : s.from,
      to: s.to >= at || (extend && count > 0 && s.to === at - 1) ? Math.max(at - 1, s.to + count) : s.to
    })).filter((s) => s.to >= s.from);
    ops.push({ op: 'set', id: sheet.id, key: 'sections', value: sections });
  }
  return ops;
}

// Copy a formula down or across, adjusting relative references (not $-fixed ones).
export function fill(formula, dCol, dRow) {
  if (!String(formula).startsWith('=')) return formula;
  return String(formula).replace(/("(?:[^"]|"")*")|(\$?)([A-Za-z]{1,3})(\$?)(\d+)(?![A-Za-z0-9_(])/g, (m, str, d1, col, d2, row) => {
    if (str) return str;
    const c = d1 ? colIndex(col) : colIndex(col) + dCol;
    const r = d2 ? Number(row) - 1 : Number(row) - 1 + dRow;
    if (c < 0 || r < 0) return '#REF!';
    return `${d1}${colName(c)}${d2}${r + 1}`;
  });
}

// ------------------------------------------------------------------ segment graphs
// Compares variables by segment: rows grouped by the text in the segment column, each
// variable (column) totalled, averaged, counted, or its largest or smallest taken.
// The first row is taken as headers when it holds text in the variable columns.
export function segmentRows(sheet, { segment, variables, agg = 'sum', from = null, to = null }) {
  const c = compute(sheet);
  const { rows } = size(sheet);
  const sc = colIndex(segment);
  const vcs = variables.map(colIndex);
  const header = vcs.every((vc) => typeof c.value(refName(vc, 0)) === 'string' && c.value(refName(vc, 0)) !== '');
  const first = from ?? (header ? 1 : 0), last = to ?? rows - 1;
  const groups = new Map();
  for (let r = first; r <= last; r++) {
    const seg = c.value(refName(sc, r));
    if (seg === '' || isError(seg)) continue;
    const key = String(seg);
    if (!groups.has(key)) groups.set(key, vcs.map(() => []));
    vcs.forEach((vc, i) => { const v = c.value(refName(vc, r)); if (typeof v === 'number') groups.get(key)[i].push(v); });
  }
  const f = {
    sum: (xs) => Number(xs.reduce((a, b) => a + b, 0).toPrecision(15)),
    average: (xs) => (xs.length ? Number((xs.reduce((a, b) => a + b, 0) / xs.length).toPrecision(15)) : 0),
    count: (xs) => xs.length,
    max: (xs) => (xs.length ? Math.max(...xs) : 0),
    min: (xs) => (xs.length ? Math.min(...xs) : 0)
  }[agg];
  if (!f) throw new Error(`unknown summary ${agg}`);
  const labels = variables.map((col, i) => (header ? String(c.value(refName(vcs[i], 0))) : col.toUpperCase()));
  return {
    labels,
    segmentLabel: header ? String(c.value(refName(sc, 0)) || segment) : segment.toUpperCase(),
    agg,
    rows: [...groups].map(([seg, lists]) => ({ segment: seg, values: lists.map(f) }))
  };
}

// ------------------------------------------------------------------ CSV
export function toCSV(sheet, { formulas = false } = {}) {
  const c = compute(sheet);
  const { cols, rows } = size(sheet);
  const q = (s) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let col = 0; col < cols; col++) {
      const ref = refName(col, r);
      row.push(q(formulas ? String(cells(sheet)[ref] ?? '') : display(c.value(ref))));
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}

export function fromCSV(text) {
  const rows = [];
  let row = [], cur = '', inQ = false;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQ) {
      if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') inQ = false; else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && s[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const out = {};
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v !== '') out[cellKey(refName(ci, ri))] = v; }));
  return out;
}

// A sheet block from rows of inputs (an array of arrays), top-left at A1.
export function sheetFromRows(rows, { name = 'Sheet 1', fields: f = {}, sections = [], formats: fm = {} } = {}) {
  const block = { type: 'sheet', name, sections };
  for (const [ref, fmt] of Object.entries(fm)) block[formatKey(ref)] = fmt;
  rows.forEach((r, ri) => r.forEach((v, ci) => { if (v !== '' && v !== null && v !== undefined) block[cellKey(refName(ci, ri))] = String(v); }));
  for (const [k, v] of Object.entries(f)) block[fieldKey(k)] = String(v);
  return block;
}
