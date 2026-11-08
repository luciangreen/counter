// The functions whose inputs and outputs are recorded in io/ios.txt (see io/engine.mjs).
import { colIndex, colName, parseRef, parseFormula, display } from '../lib/formula.js';
import { compute, literal, formatValue } from '../lib/sheet.js';
import { sheetFromRows } from '../lib/sheet.js';

export const title = 'Counter';

const num = (rnd) => rnd.pick([rnd.int(0, 100), rnd.int(-50, 50), rnd.int(0, 9999) / 100]);
const FORMULAS = ['=A1+B1', '=SUM(A1:B2)', '=AVERAGE(A1:A3)', '=MAX(A1:C1)*2', '=IF(A1>B1,"more","less")', '=ROUND(A1/3,2)', '=A1&" units"', '=MIN(A1:A3)-1', '=COUNT(A1:C3)', '=A1/B2', '=ABS(B1)', '=C1', '=SUM(A1:A3)/COUNT(A1:A3)', '=A1^2', '=NOPE(1)', '=A1*'];
const grid = (rnd) => Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => (rnd.chance(0.15) ? rnd.words(1, 1) : num(rnd))));

export const cases = [
  { name: 'colName', run: colName, make: (rnd) => [rnd.pick([rnd.int(0, 25), rnd.int(26, 800), rnd.int(800, 20000)])] },
  { name: 'colIndex', run: colIndex, make: (rnd) => [rnd.pick(['A', 'Z', 'AA', 'AZ', 'BA', 'ZZ', 'AAA', 'XFD', 'C', 'Q'])] },
  { name: 'parseRef', run: parseRef, make: (rnd) => [rnd.pick(['A1', '$B$2', 'c10', 'AA100', '$Z9', 'B$7', 'A0', '1A', 'ZZ999'])] },
  { name: 'parseFormula', run: parseFormula, make: (rnd) => [rnd.pick(FORMULAS).slice(1)] },
  { name: 'compute', run: (rows, ref) => display(compute({ id: 's1', ...sheetFromRows(rows) }).value(ref)), make: (rnd) => { const g = grid(rnd); g[2][2] = rnd.pick(FORMULAS); return [g, 'C3']; } },
  { name: 'literal', run: literal, make: (rnd) => [rnd.pick(['42', '-3.5', '1,200', '$15', '50%', 'TRUE', 'false', 'hello', '2026-11-09', '  7 ', '=A1', '1e3'])] },
  { name: 'formatValue', run: formatValue, make: (rnd) => [num(rnd) * rnd.pick([1, 1000, 0.01]), rnd.pick(['number', 'money', 'percent', 'integer', 'text', 'date', ''])] }
];
