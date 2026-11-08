// Counter's commands for the RetroMR character: each returns ops on the current sheet,
// applied as one step marked as the character's, so "undo that" takes it back.
import { createCommands } from './core.js';
import { colIndex, colName, display, isError, parseRef, refName } from './formula.js';
import { cellKey, cells, compute, fieldKey, fields, setCellOps, setFieldOps, shiftRowsOps, size } from './sheet.js';
import { PROFORMAS } from './proformas.js';

const clean = (s) => String(s).trim().replace(/^["“']|["”']$/g, '');

// A column named by letter ("C") or by its header ("sales").
export function findColumn(sheet, name) {
  const n = clean(name).toLowerCase().replace(/^column\s+/, '');
  if (/^[a-z]{1,2}$/.test(n) && n.length <= 2 && !headerCol(sheet, n)) return colIndex(n);
  const hc = headerCol(sheet, n);
  return hc ?? (/^[a-z]{1,3}$/.test(n) ? colIndex(n) : null);
}
function headerCol(sheet, name) {
  const c = compute(sheet);
  const { cols } = size(sheet);
  const want = name.toLowerCase();
  for (let i = 0; i < cols; i++) {
    const h = c.value(refName(i, 0));
    if (typeof h === 'string' && (h.toLowerCase() === want || h.toLowerCase() === `${want}s` || `${h.toLowerCase()}s` === want)) return i;
  }
  return null;
}

// The last row in a column holding a number before the first gap or label row, from row 2.
function dataEnd(sheet, col) {
  const c = compute(sheet);
  const { rows } = size(sheet);
  let last = -1;
  for (let r = 1; r < rows; r++) {
    const v = c.value(refName(col, r));
    if (typeof v === 'number') last = r;
  }
  return last;
}

// The last row labelled "Total…" in column A: new rows go just above it.
function totalRow(sheet) {
  const c = compute(sheet);
  const { rows } = size(sheet);
  let found = null;
  for (let r = 1; r < rows; r++) { const v = c.value(refName(0, r)); if (typeof v === 'string' && /^total\b/i.test(v)) found = r; }
  return found;
}

export function counterCommands() {
  const reg = createCommands({ app: 'Counter' });
  reg
    .register({
      name: 'set cell', patterns: ['set {ref} to {value}', 'put {value} in {ref}'], help: 'set B2 to 5000',
      run: ({ args, ctx }) => {
        const sheet = ctx.sheet();
        const ref = clean(args.ref).toUpperCase();
        if (!parseRef(ref)) {
          // a custom field by name: "set growth to 12%"
          if (clean(args.ref).toLowerCase() in fields(sheet)) return { ops: setFieldOps(sheet, args.ref, clean(args.value)), say: `${clean(args.ref)} is now ${clean(args.value)}.` };
          return { ops: [], say: `${args.ref} isn't a cell like B2 or a field.` };
        }
        const ops = setCellOps(sheet, ref, clean(args.value));
        return { ops, say: `${ref} is now ${clean(args.value)}.` };
      }
    })
    .register({
      name: 'clear', patterns: ['clear {ref}', 'empty {ref}'],
      run: ({ args, ctx }) => { const ref = clean(args.ref).toUpperCase(); return parseRef(ref) ? { ops: setCellOps(ctx.sheet(), ref, ''), say: `Cleared ${ref}.` } : { ops: [], say: `${args.ref} isn't a cell.` }; }
    })
    .register({
      name: 'total column', patterns: ['make column {col} a total', 'total column {col}', 'sum column {col}', 'add a total to column {col}', 'add a total for {col}'], help: 'make column C a total',
      run: ({ args, ctx }) => {
        const sheet = ctx.sheet();
        const col = findColumn(sheet, args.col);
        if (col === null) return { ops: [], say: `I can't find column ${args.col}.` };
        const end = dataEnd(sheet, col);
        if (end < 1) return { ops: [], say: `There are no numbers in column ${colName(col)} to total.` };
        const at = refName(col, end + 1);
        const existing = cells(sheet)[at];
        if (existing && !/^=SUM\(/i.test(existing)) return { ops: [], say: `${at} already holds something; clear it first.` };
        const ops = setCellOps(sheet, at, `=SUM(${refName(col, 1)}:${refName(col, end)})`);
        if (col > 0 && !cells(sheet)[refName(0, end + 1)]) ops.push(...setCellOps(sheet, refName(0, end + 1), 'Total'));
        return { ops, say: `${at} now totals ${refName(col, 1)} to ${refName(col, end)}.` };
      }
    })
    .register({
      name: 'add row', patterns: ['add a row for {label} with {value} in {section}', 'add a row for {label} in {section}', 'add a row for {label} with {value}', 'add a row for {label}', 'add {label} with {value}'], help: 'add a row for insurance with 900 in expenses',
      run: ({ args, ctx }) => {
        const sheet = ctx.sheet();
        const label = clean(args.label);
        let tr = totalRow(sheet);
        if (args.section) {
          const sec = (sheet.sections ?? []).find((x) => x.name.toLowerCase() === clean(args.section).toLowerCase().replace(/^the\s+/, ''));
          if (!sec) return { ops: [], say: `There is no section called ${args.section}.` };
          tr = sec.to + 1;
        }
        const at = tr ?? size(sheet).rows;
        const ops = tr !== null ? shiftRowsOps(sheet, at, 1, { extend: true }) : [];
        // the new row's cells (after the shift, row "at" is free)
        ops.push({ op: 'set', id: sheet.id, key: cellKey(refName(0, at)), value: label[0].toUpperCase() + label.slice(1) });
        if (args.value !== undefined) ops.push({ op: 'set', id: sheet.id, key: cellKey(refName(1, at)), value: clean(args.value) });
        return { ops, say: `Added a row for ${label} at row ${at + 1}${tr !== null ? ', inside the totals above it' : ''}.` };
      }
    })
    .register({
      name: 'delete row', patterns: ['delete row {n}', 'remove row {n}'],
      run: ({ args, ctx }) => { const n = Number(args.n); return Number.isInteger(n) && n > 0 ? { ops: shiftRowsOps(ctx.sheet(), n - 1, -1), say: `Deleted row ${n}; formulas pointing at it now show #REF!.` } : { ops: [], say: 'Say a row number.' }; }
    })
    .register({
      name: 'name field', patterns: ['call {ref} {name}', 'add a field called {name} for {ref}', 'name {ref} {name}', 'add a field called {name} with {value}'], help: 'add a field called price for B2',
      run: ({ args, ctx }) => {
        const sheet = ctx.sheet();
        const name = clean(args.name).replace(/\s+/g, '_');
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || parseRef(name)) return { ops: [], say: `${args.name} can't be a field name: use letters, and not something like B2.` };
        const def = args.ref ? clean(args.ref).toUpperCase() : clean(args.value);
        return { ops: setFieldOps(sheet, name, def), say: `Field ${name} is ${def}. Use it in formulas, such as =${name}*2.` };
      }
    })
    .register({
      name: 'graph', patterns: ['graph {variables} by {segment}', 'compare {variables} by {segment}', 'chart {variables} by {segment}', 'graph [the] {agg} of {variables} by {segment}'], help: 'graph sales by region',
      run: ({ args, ctx }) => {
        const sheet = ctx.sheet();
        const segCol = findColumn(sheet, args.segment);
        const vars = clean(args.variables).split(/\s*(?:,|\band\b)\s*/).filter(Boolean).map((v) => findColumn(sheet, v));
        if (segCol === null || !vars.length || vars.some((v) => v === null)) return { ops: [], say: "I couldn't find those columns." };
        const agg = { total: 'sum', sum: 'sum', average: 'average', mean: 'average', count: 'count', number: 'count', maximum: 'max', highest: 'max', minimum: 'min', lowest: 'min' }[String(args.agg ?? 'sum').toLowerCase()] ?? 'sum';
        return { ops: [{ op: 'set', id: sheet.id, key: 'graph', value: { segment: colName(segCol), variables: vars.map(colName), agg } }], say: `Graphing ${vars.map(colName).join(' and ')} by ${colName(segCol)}.` };
      }
    })
    .register({
      name: 'proforma', patterns: ['use the {name} proforma', 'start a {name} proforma', 'make a {name}'], help: 'use the cash flow proforma',
      run: ({ args, ctx }) => {
        const want = clean(args.name).toLowerCase().replace(/\s+/g, '-');
        const key = Object.keys(PROFORMAS).find((k) => k === want || k.startsWith(want) || PROFORMAS[k].title.toLowerCase().startsWith(clean(args.name).toLowerCase()));
        if (!key) return { ops: [], say: `There's no ${args.name} proforma. There are: ${Object.values(PROFORMAS).map((p) => p.title.toLowerCase()).join(', ')}.` };
        return { ops: [{ op: 'insert', block: PROFORMAS[key].build() }], say: `Added the ${PROFORMAS[key].title.toLowerCase()} sheet. Change the plain numbers; the rest works itself out.` };
      }
    })
    .register({
      name: 'what is', patterns: ['what is {ref}', "what's {ref}", 'read {ref}'],
      run: ({ args, ctx, doc }) => {
        const sheet = ctx.sheet();
        const c = compute(sheet);
        const r = clean(args.ref);
        if (parseRef(r)) {
          const v = c.value(r.toUpperCase());
          const input = cells(sheet)[r.toUpperCase()];
          return { doc, say: `${r.toUpperCase()} is ${display(v) || 'empty'}${input?.startsWith('=') ? `, from ${input}` : ''}${isError(v) && v.why ? `: ${v.why}` : ''}.` };
        }
        if (r.toLowerCase() in fields(sheet)) return { doc, say: `${r} is ${display(c.field(r))}.` };
        return { doc, say: `I don't know ${r}. Ask about a cell, such as B2, or a field.` };
      }
    });
  return reg;
}
