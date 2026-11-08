import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colIndex, colName, display, isError, parseFormula, references } from '../lib/formula.js';
import { cells, compute, fill, formatValue, fromCSV, literal, moveRefs, segmentRows, setFormatOps, sheetFromRows, shiftRowsOps, toCSV } from '../lib/sheet.js';
import { PROFORMAS, sheetFromConversion } from '../lib/proformas.js';
import { counterCommands, findColumn } from '../lib/commands.js';
import { apply, convert, createDocument } from '../lib/core.js';

const sheet = (rows, opts) => ({ id: 's1', ...sheetFromRows(rows, opts) });
const value = (rows, ref, opts) => compute(sheet(rows, opts)).value(ref);
const withOps = (s, ops) => apply(createDocument({ blocks: [s] }), ops).blocks[0];

test('addresses', () => {
  assert.equal(colIndex('A'), 0); assert.equal(colIndex('Z'), 25); assert.equal(colIndex('AA'), 26);
  assert.equal(colName(0), 'A'); assert.equal(colName(27), 'AB'); assert.equal(colName(701), 'ZZ');
});

test('arithmetic follows the usual order, and keeps decimals tidy', () => {
  assert.equal(value([['=2+3*4']], 'A1'), 14);
  assert.equal(value([['=(2+3)*4']], 'A1'), 20);
  assert.equal(value([['=2^3^2']], 'A1'), 512);
  assert.equal(value([['=-2^2']], 'A1'), 4);
  assert.equal(value([['=0.1+0.2']], 'A1'), 0.3);
  assert.equal(value([['=50%*80']], 'A1'), 40);
  assert.equal(value([['="Total: "&10']], 'A1'), 'Total: 10');
  assert.equal(value([['=3>2']], 'A1'), true);
  assert.equal(value([['="b"="B"']], 'A1'), true);
});

test('inputs: money, commas, percentages, true and false', () => {
  assert.equal(literal('$1,250.50'), 1250.5);
  assert.equal(literal('12%'), 0.12);
  assert.equal(literal('TRUE'), true);
  assert.equal(literal('North'), 'North');
  assert.equal(literal('-3'), -3);
});

test('functions over ranges, worked by hand', () => {
  const rows = [['Item', 'Qty', 'Price'], ['Pen', 4, 3], ['Book', 2, 12], ['Lamp', 1, 40], ['Note', 'n/a', '']];
  const s = (f) => value([...rows, [f]], 'A6');
  assert.equal(s('=SUM(B2:C5)'), 4 + 3 + 2 + 12 + 1 + 40);
  assert.equal(s('=AVERAGE(C2:C4)'), Number(((3 + 12 + 40) / 3).toPrecision(15)));
  assert.equal(s('=MIN(C2:C5)'), 3);
  assert.equal(s('=MAX(B2:B5)'), 4);
  assert.equal(s('=COUNT(B2:B5)'), 3);
  assert.equal(s('=COUNTA(B2:B5)'), 4);
  assert.equal(s('=SUMIF(C2:C4,">10")'), 52);
  assert.equal(s('=SUMIF(A2:A4,"book",C2:C4)'), 12);
  assert.equal(s('=COUNTIF(C2:C4,"<>12")'), 2);
  assert.equal(s('=AVERAGEIF(B2:B4,">1",C2:C4)'), 7.5);
  assert.equal(s('=VLOOKUP("lamp",A2:C4,3)'), 40);
  assert.equal(display(s('=VLOOKUP("chair",A2:C4,3)')), '#N/A');
  assert.equal(s('=ROUND(2.345,2)'), 2.35);
  assert.equal(s('=IF(B2>3,"many","few")'), 'many');
  assert.equal(s('=IFERROR(1/0,"none")'), 'none');
  assert.equal(s('=AND(B2>1,C2<5)'), true);
  assert.equal(s('=CONCAT(A2," and ",A3)'), 'Pen and Book');
  const other = (f) => value([...rows, ['', '', '', f]], 'D6');
  assert.equal(other('=SUM(A:A)'), 0, 'text in a whole column is skipped');
  assert.equal(other('=SUM(C:C)'), 55);
  assert.equal(display(s('=SUM(A:A)')), '#CYCLE!', 'a total inside its own column is a loop');
});

test('errors say what went wrong', () => {
  const c = compute(sheet([['=1/0', '=NOPE(1)', '=Missing*2', '="a"+1', '=E1', '=D1'], ['=A2']]));
  assert.equal(display(c.value('A1')), '#DIV/0!');
  assert.equal(display(c.value('B1')), '#NAME?');
  assert.equal(display(c.value('C1')), '#NAME?');
  assert.equal(display(c.value('D1')), '#VALUE!');
  assert.equal(display(c.value('E1')), '#CYCLE!');
  assert.equal(display(c.value('A2')), '#CYCLE!');
  assert.ok(c.why('A2').includes('A2'));
  assert.ok(c.errors.length >= 6);
  assert.throws(() => parseFormula('=SUM(A1'), /expected/);
});

test('custom fields: cells, ranges, values and formulas by name', () => {
  const s = sheet([['Price', 20], ['Quantity', 3], ['Total', '=Price*Quantity*(1+Tax)'], ['All', '=SUM(Values)']],
    { fields: { Price: 'B1', Quantity: 'B2', Tax: '10%', Values: 'B1:B2', Double: '=Price*2' } });
  const c = compute(s);
  assert.equal(c.value('B3'), 66);
  assert.equal(c.value('B4'), 23);
  assert.equal(c.field('double'), 40);
  assert.deepEqual([...references(parseFormula('=Price*B2+SUM(C1:C3)')).names], ['price']);
});

test('the proformas give the hand-worked results', () => {
  const pl = compute(PROFORMAS['profit-and-loss'].build());
  // income 50,000 + 2,000; expenses 6,000 + 12,000 + 3,000 + 1,500; tax 25%
  assert.equal(pl.value('B4'), 52000);
  assert.equal(pl.value('B6'), 32000);
  assert.equal(pl.value('B11'), 22500);
  assert.equal(pl.value('B12'), 9500);
  assert.equal(pl.value('B13'), 2375);
  assert.equal(pl.value('B14'), 7125);
  assert.equal(formatValue(pl.value('B16'), 'percent'), '13.7%');

  const cf = compute(PROFORMAS['cash-flow'].build());
  assert.deepEqual(['B7', 'C7', 'D7'].map((r) => cf.value(r)), [9000, 9000, 9500]); // 10000+8000-9000; then +9500-9500; then +11000-10500
  assert.equal(cf.value('C2'), 9000, 'each month opens with the last month\'s closing cash');

  const bva = compute(PROFORMAS['budget-vs-actual'].build());
  assert.equal(bva.value('D6'), -450);
  assert.equal(bva.value('E2'), 0.15);

  const sf = compute(PROFORMAS['sales-forecast'].build());
  assert.equal(sf.value('B7'), 8052.55); // 5000 x 1.1^5
  assert.equal(sf.value('C7'), 38578.05);

  const be = compute(PROFORMAS['break-even'].build());
  assert.equal(be.value('B6'), 400); // 12,000 / (50 - 20)
  assert.equal(be.value('B7'), 20000);

  const loan = compute(PROFORMAS['loan'].build());
  assert.equal(loan.value('B5'), 386.66); // 20,000 at 6% a year over 60 months
  assert.equal(loan.value('B7'), 3199.6);

  for (const p of Object.values(PROFORMAS)) assert.deepEqual(compute(p.build()).errors, [], p.title);
});

test('segment graphs: rows grouped by segment, each variable summarised', () => {
  const s = PROFORMAS['sales-by-region'].build();
  const g = segmentRows(s, { segment: 'B', variables: ['C', 'D'] });
  assert.deepEqual(g.labels, ['Sales', 'Units']);
  assert.equal(g.segmentLabel, 'Region');
  assert.deepEqual(g.rows, [{ segment: 'North', values: [1700, 37] }, { segment: 'South', values: [1850, 60] }]);
  assert.deepEqual(segmentRows(s, { segment: 'A', variables: ['C'], agg: 'average' }).rows.map((r) => [r.segment, r.values[0]]), [['Course', 1000], ['Book', 375], ['Music', 400], ['Total', 3550]]);
  assert.deepEqual(segmentRows(s, { segment: 'B', variables: ['D'], agg: 'max' }).rows.map((r) => r.values[0]), [15, 30]);
  assert.deepEqual(segmentRows(s, { segment: 'B', variables: ['C'], agg: 'count' }).rows.map((r) => r.values[0]), [3, 3]);
});

test('inserting and deleting rows keeps formulas pointing at the same cells', () => {
  const s = sheet([['a', 1], ['b', 2], ['c', 3], ['Total', '=SUM(B1:B3)'], ['Double', '=B4*2']]);
  const ins = withOps(s, shiftRowsOps(s, 1, 1));
  assert.equal(cells(ins).B5, '=SUM(B1:B4)');
  assert.equal(compute(ins).value('B6'), 12);
  const del = withOps(s, shiftRowsOps(s, 0, -1));
  assert.equal(cells(del).B3, '=SUM(#REF!:B2)'.replace('#REF!', '#REF!'));
  assert.equal(display(compute(del).value('B3')), '#VALUE!');
  // inserting just above the total with extend grows the total's range
  const ext = withOps(s, [...shiftRowsOps(s, 3, 1, { extend: true }), { op: 'set', id: 's1', key: 'c:B4', value: '10' }]);
  assert.equal(cells(ext).B5, '=SUM(B1:B4)');
  assert.equal(compute(ext).value('B5'), 16);
  assert.equal(moveRefs('=A1&"B2"', () => ({ col: 1, row: 1 })), '=B2&"B2"', 'text in quotes is left alone');
});

test('fill copies formulas with relative references, keeping $-fixed ones', () => {
  assert.equal(fill('=B2*$C$1+B$1', 0, 2), '=B4*$C$1+B$1');
  assert.equal(fill('=B2', 1, 0), '=C2');
});

test('CSV out and back in', () => {
  const s = sheet([['Name', 'Note'], ['Ann', 'says "hi", ok'], ['Total', '=1+1']]);
  const csv = toCSV(s);
  assert.equal(csv, 'Name,Note\nAnn,"says ""hi"", ok"\nTotal,2\n');
  assert.equal(toCSV(s, { formulas: true }).split('\n')[2], 'Total,=1+1');
  const back = fromCSV(csv);
  assert.equal(back['c:B2'], 'says "hi", ok');
});

test('number formats', () => {
  assert.equal(formatValue(1234.5, 'money'), '$1,234.50');
  assert.equal(formatValue(-3, 'money'), '-$3.00');
  assert.equal(formatValue(0.615384, 'percent'), '61.5%');
  assert.equal(formatValue(1234.567, 'number'), '1,234.57');
  assert.equal(formatValue('text', 'money'), 'text');
  const s = sheet([['x', 1], ['y', 2]], { formats: { B2: 'money' } });
  const moved = withOps(s, shiftRowsOps(s, 0, 1));
  assert.equal(moved['n:B3'], 'money', 'formats move with their rows');
  assert.equal(setFormatOps(s, ['B1'], 'general')[0].value, undefined);
});

test('a sheet from a plain description, through the Converter', () => {
  const r = convert('The pen costs $3. The book costs $12. The pen is an item. The book is an item. The total price is the sum of the price of every item.');
  const s = { id: 'x', ...sheetFromConversion(r.formats.counter) };
  const c = compute(s);
  assert.equal(c.value('A1'), 'Name');
  assert.equal(c.value('B2'), 3);
  assert.equal(c.value('A4'), 'Total price');
  assert.equal(c.value('B4'), 15);
});

test("Counter's commands, done as the character and undone", async () => {
  const reg = counterCommands();
  let d = createDocument({ app: 'counter', blocks: [PROFORMAS['profit-and-loss'].build()] });
  const ctx = { sheet: () => d.blocks.find((b) => b.type === 'sheet') };
  const run = async (t) => { const r = await reg.perform(t, d, { ctx }); d = r.doc; return r.say; };
  await run('add a row for insurance with 900 in expenses');
  await run('add a row for grants with 1000 in income');
  let c = compute(ctx.sheet());
  assert.equal(c.value('B5'), 53000, 'total income includes grants');
  assert.equal(c.value('B13'), 23400, 'total expenses include insurance');
  assert.equal(c.value('B15'), 2400, 'tax on 9,600');
  assert.match(await run('set taxrate to 30%'), /30%/);
  assert.equal(compute(ctx.sheet()).value('B15'), 2880);
  assert.match(await run('what is B14'), /9600, from =B7-B13/);
  await run('set D2 to 7');
  assert.equal(cells(ctx.sheet()).D2, '7');
  await run('undo that');
  assert.equal(cells(ctx.sheet()).D2, undefined);
  assert.match(await run('use the cash flow proforma'), /cash flow/);
  assert.equal(d.blocks.filter((b) => b.type === 'sheet').length, 2);
  // graphs and totals on the sales sheet
  d = createDocument({ app: 'counter', blocks: [PROFORMAS['sales-by-region'].build()] });
  assert.match(await run('graph sales and units by region'), /C and D by B/);
  assert.deepEqual(ctx.sheet().graph, { segment: 'B', variables: ['C', 'D'], agg: 'sum' });
  assert.equal(findColumn(ctx.sheet(), 'units'), 3);
  await run('clear C8');
  assert.match(await run('make column sales a total'), /C8 now totals C2 to C7/);
  assert.equal(compute(ctx.sheet()).value('C8'), 3550);
});
