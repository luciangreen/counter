// Proformas: ready-made sheets with their formulas in place. Inputs are the plain numbers;
// everything else is worked out, so changing an input updates the whole sheet. Each one is
// kept small: only the formulas it needs, and named fields where a number is used in many
// places (a growth rate, a tax rate).
import { sheetFromRows } from './sheet.js';

export const PROFORMAS = {
  'profit-and-loss': {
    title: 'Profit and loss',
    about: 'Income less the cost of sales and expenses, with gross and net profit and margins.',
    build: () => sheetFromRows([
      ['Profit and loss', 'Amount'],
      ['Sales', 50000],
      ['Other income', 2000],
      ['Total income', '=SUM(B2:B3)'],
      ['Cost of sales', 20000],
      ['Gross profit', '=B4-B5'],
      ['Rent', 6000],
      ['Wages', 12000],
      ['Advertising', 3000],
      ['Other expenses', 1500],
      ['Total expenses', '=SUM(B7:B10)'],
      ['Net profit before tax', '=B6-B11'],
      ['Tax', '=MAX(0, B12*TaxRate)'],
      ['Net profit', '=B12-B13'],
      ['Gross margin', '=IFERROR(B6/B4, 0)'],
      ['Net margin', '=IFERROR(B14/B4, 0)']
    ], { name: 'Profit and loss', fields: { TaxRate: '25%' }, formats: { B15: 'percent', B16: 'percent' }, sections: [{ name: 'Income', from: 1, to: 2 }, { name: 'Expenses', from: 6, to: 9 }] })
  },
  'cash-flow': {
    title: 'Cash flow (three months)',
    about: 'Opening cash, money in and out each month, and the closing cash carried to the next month.',
    build: () => sheetFromRows([
      ['Cash flow', 'Month 1', 'Month 2', 'Month 3'],
      ['Opening cash', 10000, '=B7', '=C7'],
      ['Receipts from customers', 8000, 9000, 11000],
      ['Other receipts', 0, 500, 0],
      ['Payments to suppliers', 5000, 5500, 6000],
      ['Other payments', 4000, 4000, 4500],
      ['Closing cash', '=B2+B3+B4-B5-B6', '=C2+C3+C4-C5-C6', '=D2+D3+D4-D5-D6'],
      ['Net cash flow', '=B7-B2', '=C7-C2', '=D7-D2']
    ], { name: 'Cash flow' })
  },
  'budget-vs-actual': {
    title: 'Budget against actual',
    about: 'Each category with its budget, what was spent, the difference and the difference as a share of the budget.',
    build: () => sheetFromRows([
      ['Category', 'Budget', 'Actual', 'Variance', 'Variance %'],
      ['Marketing', 4000, 4600, '=C2-B2', '=IFERROR(D2/B2, 0)'],
      ['Wages', 15000, 14200, '=C3-B3', '=IFERROR(D3/B3, 0)'],
      ['Rent', 6000, 6000, '=C4-B4', '=IFERROR(D4/B4, 0)'],
      ['Software', 1200, 950, '=C5-B5', '=IFERROR(D5/B5, 0)'],
      ['Total', '=SUM(B2:B5)', '=SUM(C2:C5)', '=C6-B6', '=IFERROR(D6/B6, 0)']
    ], { name: 'Budget against actual', formats: { E2: 'percent', E3: 'percent', E4: 'percent', E5: 'percent', E6: 'percent' } })
  },
  'sales-forecast': {
    title: 'Sales forecast',
    about: 'Six months of sales growing by a monthly rate, with a running total.',
    build: () => sheetFromRows([
      ['Month', 'Sales', 'Running total'],
      [1, 5000, '=B2'],
      [2, '=B2*(1+Growth)', '=C2+B3'],
      [3, '=B3*(1+Growth)', '=C3+B4'],
      [4, '=B4*(1+Growth)', '=C4+B5'],
      [5, '=B5*(1+Growth)', '=C5+B6'],
      [6, '=B6*(1+Growth)', '=C6+B7']
    ], { name: 'Sales forecast', fields: { Growth: '10%' }, formats: Object.fromEntries(['B3', 'B4', 'B5', 'B6', 'B7', 'C3', 'C4', 'C5', 'C6', 'C7'].map((r) => [r, 'number'])) })
  },
  'break-even': {
    title: 'Break-even',
    about: 'How many units must be sold to cover fixed costs, and the sales that takes.',
    build: () => sheetFromRows([
      ['Break-even', 'Value'],
      ['Fixed costs', 12000],
      ['Price per unit', 50],
      ['Variable cost per unit', 20],
      ['Contribution per unit', '=B3-B4'],
      ['Break-even units', '=IFERROR(ROUND(B2/B5, 2), "price must exceed cost")'],
      ['Break-even sales', '=IFERROR(B6*B3, "")']
    ], { name: 'Break-even' })
  },
  'loan': {
    title: 'Loan repayments',
    about: 'The monthly repayment for a loan, and the total paid and interest over its term.',
    build: () => sheetFromRows([
      ['Loan', 'Value'],
      ['Amount borrowed', 20000],
      ['Yearly interest rate', '6%'],
      ['Years', 5],
      ['Monthly repayment', '=ROUND(-PMT(B3/12, B4*12, B2), 2)'],
      ['Total repaid', '=ROUND(B5*B4*12, 2)'],
      ['Total interest', '=ROUND(B6-B2, 2)']
    ], { name: 'Loan', formats: { B2: 'money', B3: 'percent', B5: 'money', B6: 'money', B7: 'money' } })
  },
  'sales-by-region': {
    title: 'Sales by region',
    about: 'Sales and units by product and region, ready for a segment graph.',
    build: () => sheetFromRows([
      ['Product', 'Region', 'Sales', 'Units'],
      ['Course', 'North', 1200, 12],
      ['Course', 'South', 800, 8],
      ['Book', 'North', 300, 15],
      ['Book', 'South', 450, 22],
      ['Music', 'North', 200, 10],
      ['Music', 'South', 600, 30],
      ['Total', '', '=SUM(C2:C7)', '=SUM(D2:D7)']
    ], { name: 'Sales by region' })
  }
};

// A sheet drafted from a plain description by the Lucian Office Converter: one row per named
// thing, one column per measure, and SUM/AVERAGE rows for totals and averages it found.
export function sheetFromConversion(counterFormat, name = 'From a description') {
  const { columns, rows, formulas } = counterFormat;
  const header = columns.map((c) => c[0].toUpperCase() + c.slice(1).replace(/_/g, ' '));
  const body = rows.map((r) => r.map((v) => (v === '' ? '' : v)));
  const extra = formulas.map((f) => [f.label[0].toUpperCase() + f.label.slice(1), f.formula, ...Array(Math.max(0, columns.length - 2)).fill('')]);
  return sheetFromRows([header, ...body, ...extra], { name });
}
