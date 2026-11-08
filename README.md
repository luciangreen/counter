# Counter

Counter is the spreadsheet in Lucian Office, inside [LucianOS](https://github.com/luciangreen/lucianos). It has:

- sheets with formulas;
- **custom fields** (names such as `Price` for a cell, a range, a value or a formula);
- **sections** of rows;
- **segment graphs**, which compare variables by segment;
- **proformas**, ready-made sheets with their formulas in place.

The RetroMR character can make edits, and you can undo them. Counter works in the browser on a computer or a phone.

## Install

Counter is built on the [Lucian Office core](https://github.com/luciangreen/lucianoffice). Clone both into LucianOS's `apps` folder, side by side, and restart LucianOS:

```sh
cd lucianos/apps
git clone https://github.com/luciangreen/lucianoffice
git clone https://github.com/luciangreen/counter
```

## Using it

- **Typing in cells:** click a cell (or move with the arrow keys) and type a number, some text or a `=formula`. Enter moves down and Tab moves right. Delete clears the selection, Shift-click or Shift-arrows select a range, and F2 or a double-click edits the cell.
- **Inputs:** `$1,250` and `12%` are read as numbers, and `TRUE` and `FALSE` as true and false.
- **Toolbar:**
  - **Format** shows a number as General, Number (2 decimal places), Money, Percent or Whole number.
  - **Σ Total** totals each selected column below it.
  - **Fill down** copies the top formula down, adjusting references (`$` fixes one).
  - **Insert row** and **Delete row** move the cells below and keep every formula pointing at the same cells.
  - **Undo** and **Redo**.
- **Sheets:** add more with **+ Sheet**, and double-click a sheet tab to rename it.
- **Side panel:**
  - **Graph:** choose a segment column, the variables to compare, and a summary (total, average, count, largest or smallest). An option puts each variable on its own scale.
  - **Fields:** custom fields.
  - **Sections:** named groups of rows.
  - **Proformas**
  - **Describe:** a sheet from a plain description, through the Lucian Office Converter.
  - **Changes:** the history.
- **Tell Lucian** (or say it to the desktop character while Counter is in front):
  - "set B2 to 5000", "set growth to 12%", "clear C8";
  - "make column sales a total";
  - "add a row for insurance with 900 in expenses";
  - "delete row 6";
  - "add a field called price for B2";
  - "graph sales and units by region";
  - "use the cash flow proforma";
  - "what is B14";
  - "what changed";
  - "undo that", which undoes only Lucian's last change.
- **Save** writes `Name.counter.json` (a Lucian Office document) with its Prolog form, `Name.counter.pl`, beside it. **Open** also reads a `.csv` file as a new sheet. **Export** writes values or formulas as CSV, or the Prolog form.

## Formulas

| Kind | Examples |
| --- | --- |
| Arithmetic | `+ - * / ^`, `%` (as in `50%`), `&` (joins text), `= <> < > <= >=` |
| Ranges | `B2:B9`, whole columns `C:C`; `$B$2` stays fixed when filled |
| Totals | `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `COUNTA`, `PRODUCT` |
| Conditions | `IF`, `IFERROR`, `AND`, `OR`, `NOT`, `SUMIF`, `COUNTIF`, `AVERAGEIF` (criteria such as `">100"` or `"north"`) |
| Lookup | `VLOOKUP(key, range, column)` |
| Numbers | `ROUND`, `ABS`, `SQRT`, `POWER`, `MOD`, `PMT(rate, periods, amount)` |
| Text | `CONCAT`, `LEN`, `UPPER`, `LOWER` |
| Custom fields | `=Price*Quantity*(1+Tax)` |

- **How cells are worked out:** each cell is worked out when it is first needed, so the order follows the formulas.
- **Errors** show their code in the cell, and hovering shows why:
  - `#DIV/0!`
  - `#NAME?` (an unknown function or field)
  - `#VALUE!`
  - `#REF!` (a deleted cell)
  - `#N/A`
  - `#CYCLE!` (a cell that depends on itself)
- **Text and blanks inside a range** are skipped by totals, as in other spreadsheets.

## Proformas

| Proforma | What it works out |
| --- | --- |
| Profit and loss | Total income, gross profit, expenses, tax (from the `TaxRate` field), net profit, margins |
| Cash flow (three months) | Closing cash each month, carried into the next month's opening |
| Budget against actual | The variance and variance % for each category and in total |
| Sales forecast | Six months growing by the `Growth` field, with a running total |
| Break-even | Units and sales needed to cover fixed costs |
| Loan repayments | The monthly repayment (`PMT`), the total repaid and the interest |
| Sales by region | Sample data for a segment graph |

Change the plain numbers, and everything else updates. A new row added "in expenses" goes at the end of that section, inside its total.

## Tests

```sh
npm test
```

The tests need the core beside Counter (`../lucianoffice`). They check:

- formula results against hand-worked sheets, including every proforma;
- errors and loops;
- custom fields;
- inserting and deleting rows;
- fill;
- CSV;
- number formats;
- segment graph rows;
- a sheet from a description;
- Counter's commands, including undoing only the character's change.

GitHub Actions runs them with the core checked out beside Counter.

## Not yet

- Export to .xlsx.
- Books linked to Tabler and to Writer's financial documents.

## Inputs and outputs

`io/ios.txt` lists 200 inputs and the outputs they give, from real runs of this repo's functions (the list of functions is in `io/cases.mjs`; the inputs come from a fixed seed, so they are the same every time). `npm test` runs them again and fails if any output changes. If a change is meant, run `npm run ios` to write the new outputs and check the diff.
