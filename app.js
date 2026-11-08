// Counter (Lucian Office, Phase 3): sheets with formulas, custom fields, sections,
// segment graphs and proformas, with the character's undoable edits.
import { api } from '/shared/api.js';
import { apply, changeLog, characterHandler, convert, createDocument, deserialise, redo, serialise, toProlog, undo, undoLastBy } from './lib/core.js';
import { colName, display, isError, parseRef, refName } from './lib/formula.js';
import { FORMATS, cells, compute, fields, fill, formatValue, formats, fromCSV, segmentRows, setCellOps, setFieldOps, setFormatOps, shiftRowsOps, size, toCSV } from './lib/sheet.js';
import { PROFORMAS, sheetFromConversion } from './lib/proformas.js';
import { counterCommands } from './lib/commands.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) n.append(k.nodeType ? k : document.createTextNode(String(k)));
  return n;
};
const COLOURS = ['#3a7bd5', '#e2a03f', '#2e9e6b', '#c0392b', '#8e44ad', '#16a085'];

let doc = newDoc();
let active = 0;
let cur = { col: 0, row: 0 };
let anchor = null;
let tool = 'graph';
let settings = { savePath: '' };
const TOOLS = [['graph', 'Graph'], ['fields', 'Fields'], ['sections', 'Sections'], ['proformas', 'Proformas'], ['describe', 'Describe'], ['changes', 'Changes']];

function newDoc() {
  return createDocument({ app: 'counter', title: 'Untitled', blocks: [{ type: 'sheet', name: 'Sheet 1', sections: [] }] });
}
const sheets = () => doc.blocks.filter((b) => b.type === 'sheet');
const sheet = () => sheets()[Math.min(active, sheets().length - 1)];
const persist = () => { api.state.set('counter', settings).catch(() => {}); api.state.set('counter-doc', doc).catch(() => {}); };
function change(ops, by = 'user', label = '') {
  if (!ops.length) return;
  doc = apply(doc, ops, { by, label });
  persist();
  render();
}

// ------------------------------------------------------------------ the grid
const selection = () => {
  const a = anchor ?? cur;
  return { c1: Math.min(a.col, cur.col), c2: Math.max(a.col, cur.col), r1: Math.min(a.row, cur.row), r2: Math.max(a.row, cur.row) };
};

function render() {
  const s = sheet();
  const c = compute(s);
  const input = cells(s);
  const fmts = formats(s);
  const { cols, rows } = size(s);
  const nc = Math.max(cols + 3, 8), nr = Math.max(rows + 6, 20);
  const sel = selection();
  const starts = new Set((s.sections ?? []).map((x) => x.from));
  const grid = $('grid');
  const head = el('tr', {}, el('th', { className: 'rowh' }), ...Array.from({ length: nc }, (_, i) => el('th', { textContent: colName(i), scope: 'col' })));
  const body = Array.from({ length: nr }, (_, r) => el('tr', { className: starts.has(r) ? 'section-start' : '' },
    el('th', { className: 'rowh', textContent: String(r + 1), scope: 'row' }),
    ...Array.from({ length: nc }, (_, col) => {
      const ref = refName(col, r);
      const v = c.value(ref);
      const raw = input[ref];
      const td = el('td', { textContent: formatValue(v, fmts[ref]) });
      td.dataset.col = col;
      td.dataset.row = r;
      const cls = [];
      if (typeof v === 'number') cls.push('num');
      if (raw?.startsWith('=')) cls.push('formula');
      if (isError(v)) { cls.push('err'); td.title = `${v.code}: ${c.why(ref) || v.why}`; } else if (raw?.startsWith('=')) td.title = raw;
      if (col >= sel.c1 && col <= sel.c2 && r >= sel.r1 && r <= sel.r2 && (sel.c1 !== sel.c2 || sel.r1 !== sel.r2)) cls.push('sel');
      if (col === cur.col && r === cur.row) cls.push('cur');
      td.className = cls.join(' ');
      return td;
    })));
  grid.replaceChildren(el('thead', {}, head), el('tbody', {}, body));
  $('where').textContent = sel.c1 !== sel.c2 || sel.r1 !== sel.r2 ? `${refName(sel.c1, sel.r1)}:${refName(sel.c2, sel.r2)}` : refName(cur.col, cur.row);
  if (document.activeElement !== $('formula')) $('formula').value = input[refName(cur.col, cur.row)] ?? '';
  $('format').value = fmts[refName(cur.col, cur.row)] ?? 'general';
  $('title').value = doc.title;
  $('note').textContent = c.errors.length ? `${c.errors.length} cell${c.errors.length === 1 ? '' : 's'} with errors (hover to see why)` : '';
  renderSheets();
  if (tool !== 'describe' && tool !== 'proformas') renderTool();
}

function renderSheets() {
  $('sheets').replaceChildren(...sheets().map((s, i) => el('button', {
    textContent: s.name, className: i === active ? 'on' : '',
    onclick: () => { active = i; cur = { col: 0, row: 0 }; anchor = null; render(); },
    ondblclick: () => { const n = prompt('Rename the sheet', s.name); if (n) change([{ op: 'set', id: s.id, key: 'name', value: n.trim() }], 'user', 'renamed a sheet'); }
  })), el('button', { textContent: '+ Sheet', title: 'Add a blank sheet', onclick: () => { change([{ op: 'insert', block: { type: 'sheet', name: `Sheet ${sheets().length + 1}`, sections: [] } }], 'user', 'added a sheet'); active = sheets().length - 1; render(); } }));
}

function commit(value) {
  const ref = refName(cur.col, cur.row);
  if ((cells(sheet())[ref] ?? '') === value) return;
  change(setCellOps(sheet(), ref, value), 'user', `set ${ref}`);
}

function move(dc, dr, extend = false) {
  if (extend) anchor ??= { ...cur }; else anchor = null;
  cur = { col: Math.max(0, cur.col + dc), row: Math.max(0, cur.row + dr) };
  render();
  const td = $('grid').querySelector('td.cur');
  td?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// ------------------------------------------------------------------ toolbar actions
function totalSelection() {
  const s = sheet();
  const sel = selection();
  const ops = [];
  for (let col = sel.c1; col <= sel.c2; col++) {
    const r1 = sel.r1 === sel.r2 ? 1 : sel.r1;
    let r2 = sel.r2;
    if (sel.r1 === sel.r2) { const c = compute(s); r2 = 1; for (let r = 1; r < size(s).rows; r++) if (typeof c.value(refName(col, r)) === 'number') r2 = r; }
    ops.push(...setCellOps(s, refName(col, r2 + 1), `=SUM(${refName(col, r1)}:${refName(col, r2)})`));
  }
  change(ops, 'user', 'totalled');
}
function fillDown() {
  const s = sheet();
  const sel = selection();
  const ops = [];
  for (let col = sel.c1; col <= sel.c2; col++) {
    const top = cells(s)[refName(col, sel.r1)];
    if (top === undefined) continue;
    for (let r = sel.r1 + 1; r <= sel.r2; r++) ops.push(...setCellOps(s, refName(col, r), fill(top, 0, r - sel.r1)));
  }
  change(ops, 'user', 'filled down');
}

// ------------------------------------------------------------------ side tools
function renderTools() {
  $('tabs').replaceChildren(...TOOLS.map(([id, label]) => el('button', { role: 'tab', textContent: label, className: id === tool ? 'on' : '', 'aria-selected': String(id === tool), onclick: () => { tool = id; renderTools(); renderTool(); } })));
}
function renderTool() {
  $('tool').replaceChildren({ graph: graphView, fields: fieldsView, sections: sectionsView, proformas: proformasView, describe: describeView, changes: changesView }[tool]());
}

function graphView() {
  const s = sheet();
  const { cols } = size(s);
  const c = compute(s);
  const g = s.graph ?? { segment: 'A', variables: [], agg: 'sum' };
  const label = (i) => { const h = c.value(refName(i, 0)); return `${colName(i)}${typeof h === 'string' && h ? `: ${h}` : ''}`; };
  const setGraph = (patch) => change([{ op: 'set', id: s.id, key: 'graph', value: { ...g, ...patch } }], 'user', 'changed the graph');
  const segSel = el('select', { 'aria-label': 'Segment column', onchange: (e) => setGraph({ segment: e.target.value }) }, Array.from({ length: cols }, (_, i) => el('option', { value: colName(i), textContent: label(i), selected: colName(i) === g.segment })));
  const varBoxes = el('div', {}, Array.from({ length: cols }, (_, i) => el('label', { style: 'margin-right:8px;display:inline-block' },
    el('input', { type: 'checkbox', checked: g.variables.includes(colName(i)), onchange: (e) => setGraph({ variables: e.target.checked ? [...g.variables, colName(i)] : g.variables.filter((v) => v !== colName(i)) }) }), ` ${label(i)}`)));
  const scaleBox = el('label', {}, el('input', { type: 'checkbox', checked: !!g.ownScale, onchange: (e) => setGraph({ ownScale: e.target.checked }) }), ' Each variable on its own scale');
  const aggSel = el('select', { 'aria-label': 'Summary', onchange: (e) => setGraph({ agg: e.target.value }) }, ['sum', 'average', 'count', 'max', 'min'].map((a) => el('option', { value: a, textContent: { sum: 'Total', average: 'Average', count: 'Count', max: 'Largest', min: 'Smallest' }[a], selected: a === g.agg })));
  const wrap = el('div', {}, el('p', { className: 'quiet' }, 'Compare variables by segment: rows are grouped by the segment column and each variable is summarised.'),
    el('label', {}, 'Segment ', segSel), el('h3', {}, 'Variables'), varBoxes, el('div', { className: 'row' }, el('label', {}, 'Summary ', aggSel), scaleBox));
  if (!g.variables.length) return wrap;
  let data;
  try { data = segmentRows(s, g); } catch (err) { wrap.append(el('p', { className: 'error' }, err.message)); return wrap; }
  if (!data.rows.length) { wrap.append(el('p', { className: 'quiet' }, 'No rows with a segment and numbers yet.')); return wrap; }
  wrap.append(chart(data, !!g.ownScale), el('div', { className: 'legend' }, data.labels.map((l, i) => el('span', { style: `--c:${COLOURS[i % COLOURS.length]}` }, l))),
    el('table', {}, el('tr', {}, el('th', {}, data.segmentLabel), data.labels.map((l) => el('th', {}, l))), data.rows.map((r) => el('tr', {}, el('td', {}, r.segment), r.values.map((v) => el('td', {}, display(v)))))));
  return wrap;
}

function chart({ rows, labels }, ownScale = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, a) => { const n = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(a)) n.setAttribute(k, v); return n; };
  const W = 420, H = 240, L = 48, B = 36, T = 10;
  // with own scales each variable's bars are drawn as a share of its own largest value
  const varMax = labels.map((_, i) => Math.max(...rows.map((r) => Math.abs(r.values[i]))) || 1);
  const scaled = (v, i) => (ownScale ? v / varMax[i] : v);
  const all = rows.flatMap((r) => r.values.map(scaled));
  const max = Math.max(0, ...all), min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v) => T + 12 + (H - T - 12 - B) * (1 - (v - min) / span);
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': `Bar chart of ${labels.join(', ')} by segment` });
  svg.append(mk('line', { x1: L, x2: W - 8, y1: y(0), y2: y(0), stroke: '#999' }));
  if (!ownScale) for (const v of [max, min].filter((x, i, a) => a.indexOf(x) === i)) { const t = mk('text', { x: L - 6, y: y(v) + 4, 'text-anchor': 'end', fill: '#666' }); t.textContent = display(v); svg.append(t); }
  const groupW = (W - L - 8) / rows.length, barW = Math.max(4, (groupW - 12) / labels.length);
  rows.forEach((r, gi) => {
    r.values.forEach((v, vi) => {
      const x = L + gi * groupW + 6 + vi * barW;
      const sv = scaled(v, vi);
      svg.append(mk('rect', { x, y: Math.min(y(sv), y(0)), width: barW - 2, height: Math.abs(y(sv) - y(0)), fill: COLOURS[vi % COLOURS.length] }));
      const t = mk('text', { x: x + (barW - 2) / 2, y: (sv >= 0 ? y(sv) - 3 : y(sv) + 12), 'text-anchor': 'middle', fill: '#333', 'font-size': '10' });
      t.textContent = display(v);
      svg.append(t);
    });
    const t = mk('text', { x: L + gi * groupW + groupW / 2, y: H - 14, 'text-anchor': 'middle', fill: '#333' });
    t.textContent = r.segment.length > 14 ? `${r.segment.slice(0, 13)}…` : r.segment;
    svg.append(t);
  });
  return svg;
}

function fieldsView() {
  const s = sheet();
  const c = compute(s);
  const f = fields(s);
  const name = el('input', { type: 'text', placeholder: 'name, e.g. Price' });
  const def = el('input', { type: 'text', placeholder: 'B2, B2:B9, 10% or =B2*2', value: refName(cur.col, cur.row) });
  return el('div', {},
    el('p', { className: 'quiet' }, 'Custom fields name a cell, a range, a value or a formula, so formulas can say =Price*Quantity.'),
    Object.keys(f).length ? el('table', {}, el('tr', {}, el('th', {}, 'Field'), el('th', {}, 'Is'), el('th', {}, 'Value')),
      Object.entries(f).map(([k, v]) => el('tr', {}, el('td', {}, k),
        el('td', {}, el('input', { type: 'text', value: v, onchange: (e) => change(setFieldOps(s, k, e.target.value.trim()), 'user', `changed field ${k}`) })),
        el('td', {}, (() => { const x = c.field(k); return Array.isArray(x) ? `${x.flat().length} cells` : display(x); })())))) : null,
    el('form', { className: 'row', onsubmit: (e) => { e.preventDefault(); if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name.value.trim()) && !parseRef(name.value.trim())) change(setFieldOps(s, name.value.trim(), def.value.trim()), 'user', `added field ${name.value.trim()}`); else $('reply').textContent = 'A field name uses letters and underscores, and is not a cell like B2.'; } },
      name, def, el('button', { textContent: 'Add' })));
}

function sectionsView() {
  const s = sheet();
  const sel = selection();
  const name = el('input', { type: 'text', placeholder: 'name, e.g. Expenses' });
  return el('div', {},
    el('p', { className: 'quiet' }, 'Sections name groups of rows. New rows added "in" a section go at its end, inside its totals.'),
    (s.sections ?? []).length ? el('ul', {}, s.sections.map((x, i) => el('li', {}, `${x.name}: rows ${x.from + 1} to ${x.to + 1} `,
      el('button', { className: 'small', textContent: 'Remove', onclick: () => change([{ op: 'set', id: s.id, key: 'sections', value: s.sections.filter((_, j) => j !== i) }], 'user', `removed section ${x.name}`) })))) : null,
    el('form', { className: 'row', onsubmit: (e) => { e.preventDefault(); if (name.value.trim()) change([{ op: 'set', id: s.id, key: 'sections', value: [...(s.sections ?? []), { name: name.value.trim(), from: sel.r1, to: sel.r2 }] }], 'user', `added section ${name.value.trim()}`); } },
      name, el('button', { textContent: `Make rows ${sel.r1 + 1}–${sel.r2 + 1} a section` })));
}

function proformasView() {
  return el('div', {}, el('p', { className: 'quiet' }, 'Ready-made sheets with their formulas in place. Change the plain numbers; everything else updates.'),
    Object.entries(PROFORMAS).map(([k, p]) => el('div', { className: 'proforma' }, el('strong', {}, p.title), el('p', {}, p.about),
      el('button', { textContent: 'Add as a new sheet', onclick: () => { change([{ op: 'insert', block: p.build() }], 'user', `added the ${p.title} proforma`); active = sheets().length - 1; cur = { col: 1, row: 1 }; render(); } }))));
}

function describeView() {
  const text = el('textarea', { rows: 7, placeholder: "Describe the numbers in plain English, for example:\nThe pen costs $3. The book costs $12. The pen is an item. The book is an item.\nThe total price is the sum of the price of every item." });
  const out = el('div');
  return el('div', {}, el('p', { className: 'quiet' }, 'The Lucian Office Converter turns a description into a sheet: one row per thing, one column per measure, and total or average rows.'),
    text,
    el('div', { className: 'row' }, el('button', { className: 'primary', textContent: 'Make a sheet', onclick: () => {
      const r = convert(text.value);
      out.replaceChildren();
      if (!r.formats.counter.rows.length) { out.append(el('p', { className: 'quiet' }, 'No measures found. Give numbers, such as "The pen costs $3."')); return; }
      change([{ op: 'insert', block: sheetFromConversion(r.formats.counter) }], 'user', 'made a sheet from a description');
      active = sheets().length - 1;
      render();
      out.append(el('p', { className: r.proof.ok ? 'ok' : 'error' }, r.proof.ok ? 'Made a sheet from the proved conversion.' : 'Made a sheet, but the conversion is not proved: check the description.'));
      if (r.program.leftOut.length) out.append(el('ul', {}, r.program.leftOut.map((l) => el('li', {}, `Left out: "${l.sentence}" (${l.reason})`))));
    } })), out);
}

function changesView() {
  const log = changeLog(doc);
  return el('div', {},
    el('button', { textContent: "Undo Lucian's last change", disabled: !log.some((e) => e.by === 'character'), onclick: () => { const r = undoLastBy(doc, 'character'); doc = r.doc; persist(); render(); $('reply').textContent = r.undone ? `Undone: ${r.undone.label}` : r.reason; } }),
    log.length ? el('ol', { reversed: true }, log.map((e) => el('li', {}, `${e.by === 'character' ? 'Lucian' : 'You'}: ${e.label}`))) : el('p', { className: 'quiet' }, 'No changes yet.'));
}

// ------------------------------------------------------------------ the character
const commands = counterCommands();
const ctx = { sheet: () => sheet() };
const handle = characterHandler(commands, () => doc, (d) => { doc = d; persist(); if (active >= sheets().length) active = sheets().length - 1; render(); }, ctx);
async function sayDo(text) {
  const before = sheets().length;
  const reply = await handle({ intent: 'unknown', text }, text);
  if (sheets().length > before) { active = sheets().length - 1; render(); }
  if (sheet().graph && /graph|chart|compare/i.test(text)) { tool = 'graph'; renderTools(); renderTool(); }
  $('reply').textContent = reply ?? `I don't know how to do that in Counter. ${commands.help()}`;
  return reply;
}
$('say').addEventListener('submit', async (e) => { e.preventDefault(); await sayDo($('sayText').value); $('sayText').value = ''; });
addEventListener('message', async (e) => {
  if (e.origin !== location.origin || e.data?.type !== 'lucianos.command') return;
  const reply = await handle({ intent: 'unknown', text: e.data.text }, e.data.text);
  e.source.postMessage({ type: 'lucianos.reply', id: e.data.id, text: reply }, location.origin);
});
if (parent !== window) parent.postMessage({ type: 'lucianos.commands', names: commands.list().map((c) => c.name) }, location.origin);

// ------------------------------------------------------------------ files
async function save() {
  const path = prompt('Save as (relative to your home folder)', settings.savePath || `Documents/${(doc.title || 'Untitled').replace(/[^\w -]/g, '')}.counter.json`);
  if (!path) return;
  await api.files.write(path, serialise(doc), { mkdirs: true, force: true });
  await api.files.write(path.replace(/\.json$/, '') + '.pl', toProlog(doc), { mkdirs: true, force: true });
  settings.savePath = path;
  persist();
  $('reply').textContent = `Saved ${path}, with its Prolog form beside it.`;
}
async function open(path) {
  path ??= prompt('Open a .counter.json file, or a .csv file', settings.savePath || '');
  if (!path) return;
  try {
    const content = (await api.files.read(path)).content;
    if (/\.csv$/i.test(path)) {
      change([{ op: 'insert', block: { type: 'sheet', name: path.split('/').pop().replace(/\.csv$/i, ''), sections: [], ...fromCSV(content) } }], 'user', `imported ${path}`);
      active = sheets().length - 1;
    } else { doc = deserialise(content); active = 0; settings.savePath = path; }
    persist();
    render();
  } catch (err) { $('reply').textContent = `Couldn't open it: ${err.message}`; }
}
async function exportAs(kind) {
  const base = (settings.savePath || `Documents/${doc.title || 'Untitled'}.counter.json`).replace(/\.counter\.json$|\.json$/, '');
  const ext = kind === 'pl' ? 'pl' : 'csv';
  const path = prompt('Export as', `${base}${sheets().length > 1 ? ` - ${sheet().name}` : ''}.${ext}`);
  if (!path) return;
  const content = kind === 'csv' ? toCSV(sheet()) : kind === 'csvf' ? toCSV(sheet(), { formulas: true }) : toProlog(doc);
  await api.files.write(path, content, { mkdirs: true, force: true });
  $('reply').textContent = `Exported ${path}.`;
}

// ------------------------------------------------------------------ start
async function init() {
  settings = { ...settings, ...((await api.state.get('counter').catch(() => null)) ?? {}) };
  const saved = await api.state.get('counter-doc').catch(() => null);
  if (saved?.format === 'lucianoffice/1' && saved.app === 'counter') doc = saved;
  const params = new URLSearchParams(location.search);
  if (params.get('proforma') && PROFORMAS[params.get('proforma')]) { doc = createDocument({ app: 'counter', title: PROFORMAS[params.get('proforma')].title, blocks: [PROFORMAS[params.get('proforma')].build()] }); }
  if (TOOLS.some(([id]) => id === params.get('tool'))) tool = params.get('tool');
  renderTools();
  render();
  renderTool();

  const grid = $('grid');
  grid.addEventListener('mousedown', (e) => {
    const td = e.target.closest('td');
    if (!td) return;
    const p = { col: Number(td.dataset.col), row: Number(td.dataset.row) };
    if (e.shiftKey) { anchor ??= { ...cur }; cur = p; } else { anchor = null; cur = p; }
    render();
    grid.focus();
  });
  grid.addEventListener('dblclick', () => { $('formula').focus(); $('formula').select(); });
  grid.addEventListener('keydown', (e) => {
    const k = e.key;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && k.toLowerCase() === 'z') { e.preventDefault(); doc = (e.shiftKey ? redo(doc) : undo(doc)).doc; persist(); render(); return; }
    if (mod && k.toLowerCase() === 'y') { e.preventDefault(); doc = redo(doc).doc; persist(); render(); return; }
    const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], Enter: [0, 1], Tab: [e.shiftKey ? -1 : 1, 0] };
    if (moves[k]) { e.preventDefault(); move(...moves[k], e.shiftKey && k.startsWith('Arrow')); return; }
    if (k === 'Delete' || k === 'Backspace') {
      e.preventDefault();
      const sel = selection();
      const ops = [];
      for (let c = sel.c1; c <= sel.c2; c++) for (let r = sel.r1; r <= sel.r2; r++) if (cells(sheet())[refName(c, r)] !== undefined) ops.push(...setCellOps(sheet(), refName(c, r), ''));
      change(ops, 'user', 'cleared');
      return;
    }
    if (k === 'F2') { $('formula').focus(); return; }
    if (k.length === 1 && !mod) { e.preventDefault(); $('formula').value = k; $('formula').focus(); }
  });
  $('formula').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); commit($('formula').value); grid.focus(); move(e.key === 'Tab' ? 1 : 0, e.key === 'Enter' ? 1 : 0); }
    if (e.key === 'Escape') { $('formula').value = cells(sheet())[refName(cur.col, cur.row)] ?? ''; grid.focus(); }
  });
  $('format').replaceChildren(...Object.entries(FORMATS).map(([k, label]) => el('option', { value: k, textContent: label })));
  $('format').onchange = () => {
    const sel = selection();
    const refs = [];
    for (let c = sel.c1; c <= sel.c2; c++) for (let r = sel.r1; r <= sel.r2; r++) refs.push(refName(c, r));
    change(setFormatOps(sheet(), refs, $('format').value), 'user', `formatted as ${FORMATS[$('format').value].toLowerCase()}`);
    $('grid').focus();
  };
  $('sum').onclick = totalSelection;
  $('fill').onclick = fillDown;
  $('insRow').onclick = () => change(shiftRowsOps(sheet(), cur.row, 1), 'user', `inserted row ${cur.row + 1}`);
  $('delRow').onclick = () => change(shiftRowsOps(sheet(), cur.row, -1), 'user', `deleted row ${cur.row + 1}`);
  $('undo').onclick = () => { doc = undo(doc).doc; persist(); render(); };
  $('redo').onclick = () => { doc = redo(doc).doc; persist(); render(); };
  $('title').onchange = () => change([{ op: 'title', value: $('title').value.trim() || 'Untitled' }], 'user', 'renamed');
  $('new').onclick = () => { if (confirm('Start a new workbook? The current one stays saved if you saved it.')) { doc = newDoc(); active = 0; settings.savePath = ''; persist(); render(); } };
  $('save').onclick = save;
  $('open').onclick = () => open();
  $('export').onchange = async (e) => { const k = e.target.value; e.target.value = ''; if (k) await exportAs(k); };
  if (params.get('do')) await sayDo(params.get('do'));
  grid.focus();
}
init();
