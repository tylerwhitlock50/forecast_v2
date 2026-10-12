import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import {
  cleanCell,
  cleanRows,
  collectHeaders,
  csvMatrixToRecords,
  describeHeaderRow,
  detectHeaderRow,
  detectWideSales,
  excelDateToString,
  fileKind,
  isTotalHeader,
  looksLikeLabel,
  parseExcelBuffer,
  parseMonthLabel,
  prepareSalesRows,
  salesFieldFor,
} from './fileParsing';
import {
  describeColumnMapping,
  describePriceSources,
  errorMessage,
  ignoredColumnsFromWarnings,
  normalizeTemplateDocs,
  setupProgress,
  summarizeImportResult,
} from './importSteps';

describe('parseMonthLabel', () => {
  it.each([
    ['2027-01', '2027-01'],
    ['2027-1', '2027-01'],
    ['2027/01', '2027-01'],
    ['2027-01-15', '2027-01'],
    ['1/2027', '2027-01'],
    ['01/2027', '2027-01'],
    ['1/15/2027', '2027-01'],
    ['12/1/27', '2027-12'],
    ['Jan-27', '2027-01'],
    ['Jan 2027', '2027-01'],
    ['January 2027', '2027-01'],
    ['Sept 2027', '2027-09'],
    ['Dec-2027', '2027-12'],
  ])('%s -> %s', (input, expected) => {
    expect(parseMonthLabel(input)).toBe(expected);
  });

  it.each(['Customer', 'Marketing 2027', '2027-13', 'Q1 2027', '', null, 'Total'])('rejects %p', (input) => {
    expect(parseMonthLabel(input)).toBeNull();
  });

  it('reads a Date whatever the time of day', () => {
    expect(parseMonthLabel(new Date(2027, 0, 1))).toBe('2027-01');
    expect(parseMonthLabel(new Date(2027, 0, 31, 23, 59))).toBe('2027-02');
  });
});

describe('cleanCell / cleanRows', () => {
  it('trims text and turns blanks into null', () => {
    expect(cleanCell('  ACME ')).toBe('ACME');
    expect(cleanCell('   ')).toBeNull();
    expect(cleanCell(undefined)).toBeNull();
  });

  it('strips currency formatting from money text but leaves ids and percents', () => {
    expect(cleanCell('$1,110.00')).toBe('1110.00');
    expect(cleanCell('1,250')).toBe('1250');
    expect(cleanCell('(25.50)')).toBe('-25.50');
    expect(cleanCell('2%')).toBe('2%');
    expect(cleanCell('BOM-100')).toBe('BOM-100');
    expect(cleanCell('2027-01')).toBe('2027-01');
    expect(cleanCell(42)).toBe(42);
  });

  it('turns Excel dates into YYYY-MM-DD', () => {
    expect(excelDateToString(new Date(2027, 2, 31))).toBe('2027-03-31');
    expect(cleanCell(new Date(2027, 2, 31))).toBe('2027-03-31');
  });

  it('drops blank headers, blank cells and empty rows', () => {
    const rows = cleanRows([
      { '﻿customer_id': 'C1', ' name ': 'Acme', '': 'x', __EMPTY: 'y', notes: '' },
      { customer_id: '', name: '  ' },
      { customer_id: 'C2', name: 'Bravo' },
    ]);
    expect(rows).toEqual([
      { customer_id: 'C1', name: 'Acme' },
      { customer_id: 'C2', name: 'Bravo' },
    ]);
  });
});

describe('sales rows', () => {
  it('maps common header names to the sales fields', () => {
    expect(salesFieldFor('Customer')).toBe('customer_id');
    expect(salesFieldFor('SKU')).toBe('unit_id');
    expect(salesFieldFor('Product ID')).toBe('unit_id');
    expect(salesFieldFor('Month')).toBe('period');
    expect(salesFieldFor('Qty')).toBe('quantity');
    expect(salesFieldFor('Unit Price')).toBe('unit_price');
    expect(salesFieldFor('Customer Type')).toBe('customer_type');
    expect(salesFieldFor('Region')).toBeNull();
  });

  it('keeps a long layout one row per input row and leaves a blank price blank', () => {
    const out = prepareSalesRows([
      { Customer: 'C1', SKU: 'R-100', Month: 'Jan-27', Qty: '10', Price: '1110' },
      { Customer: 'C2', SKU: 'R-100', Month: '2027-02-01', Qty: '5' },
    ]);
    expect(out.layout).toBe('long');
    expect(out.rows).toEqual([
      { customer_id: 'C1', unit_id: 'R-100', period: '2027-01', quantity: 10, unit_price: 1110 },
      { customer_id: 'C2', unit_id: 'R-100', period: '2027-02', quantity: 5 },
    ]);
  });

  it('derives the price from revenue / quantity when only revenue is given', () => {
    const out = prepareSalesRows([{ customer_id: 'C1', unit_id: 'P1', period: '2027-03', quantity: 4, Revenue: '1000' }]);
    expect(out.rows[0].unit_price).toBe(250);
    expect(out.rows[0]).not.toHaveProperty('total_revenue');
  });

  it('melts a wide month-per-column layout and skips blank / zero months and totals', () => {
    const headers = ['Customer', 'SKU', 'Jan-27', 'Feb-27', 'Mar-27', 'Total'];
    expect(detectWideSales(headers).monthColumns.map((c) => c.period)).toEqual(['2027-01', '2027-02', '2027-03']);
    const out = prepareSalesRows([
      { Customer: 'C1', SKU: 'R-100', 'Jan-27': 10, 'Feb-27': 0, 'Mar-27': '12', Total: 22 },
      { Customer: 'C2', SKU: 'P-200', 'Feb-27': 3 },
    ]);
    expect(out.layout).toBe('wide');
    expect(out.rows).toEqual([
      { customer_id: 'C1', unit_id: 'R-100', period: '2027-01', quantity: 10 },
      { customer_id: 'C1', unit_id: 'R-100', period: '2027-03', quantity: 12 },
      { customer_id: 'C2', unit_id: 'P-200', period: '2027-02', quantity: 3 },
    ]);
    expect(out.sourceRowFor).toEqual([0, 0, 1]);
  });

  it('does not treat a file with a period column as wide', () => {
    expect(detectWideSales(['period', 'Jan-27', 'Feb-27'])).toBeNull();
  });
});

describe('fileKind', () => {
  it('recognises csv and excel files', () => {
    expect(fileKind('sales.CSV')).toBe('csv');
    expect(fileKind('boms.xlsx')).toBe('excel');
    expect(fileKind('old.xls')).toBe('excel');
    expect(fileKind('notes.pdf')).toBeNull();
  });
});

describe('import responses', () => {
  it('summarises an /import response', () => {
    const s = summarizeImportResult({
      status: 'success',
      data: {
        created: 3, updated: 1, replaced: 0, skipped: 2,
        errors: [{ row: 4, error: 'qty must be a number' }],
        warnings: ['labor type LT-9 created as a placeholder'],
        boms: [{ bom_id: 'BOM-R100', version: '1.0', lines: 12, material_cost_per_unit: 412.5, linked_products: ['R-100'] }],
      },
    });
    expect(s).toMatchObject({ created: 3, updated: 1, skipped: 2, imported: 4 });
    expect(s.errors).toEqual([{ row: 4, error: 'qty must be a number', field: null, column: null }]);
    expect(s.warnings[0].message).toMatch(/placeholder/);
    expect(s.boms[0]).toMatchObject({ bom_id: 'BOM-R100', lines: 12, material_cost_per_unit: 412.5 });
  });

  it('keeps the matrix column of a price-import error and reads a blocked replace', () => {
    const s = summarizeImportResult({
      data: {
        mode: 'replace', replace_blocked: true, created: 9, replaced: 15, dry_run: true,
        errors: [{ row: 3, column: 'Dealer', error: "unit_price 'abc' is not a number" }],
      },
    });
    expect(s.errors).toEqual([{ row: 3, column: 'Dealer', field: null, error: "unit_price 'abc' is not a number" }]);
    expect(s).toMatchObject({ mode: 'replace', replaceBlocked: true, replaced: 15 });
  });

  it('labels every price-list source a sales import reports', () => {
    const sources = describePriceSources({ customer_product_type: 2, type_product_type: 3, product_type: 4 });
    expect(sources.map((p) => p.label)).toEqual([
      'priced from the product-type price',
      'priced from the customer-type price for the product type',
      "priced from the customer's price for the product type",
    ]);
  });

  it('summarises the sales import response with price sources', () => {
    const s = summarizeImportResult({ data: { imported: 336, created_customers: ['C9'], created_products: [], errors: [], price_sources: { type_product: 312, base_price: 24, file: 0 } } });
    expect(s.imported).toBe(336);
    expect(s.createdCustomers).toEqual(['C9']);
    expect(describePriceSources(s.priceSources).map((p) => [p.source, p.count])).toEqual([['type_product', 312], ['base_price', 24]]);
  });

  it('reads template docs as a list or a map', () => {
    const fromList = normalizeTemplateDocs({ data: { templates: [{ kind: 'boms', columns: [{ name: 'bom_id', required: true, aliases: ['bom'] }, { name: 'unit', required: false }] }] } });
    expect(fromList.boms.required).toEqual(['bom_id']);
    expect(fromList.boms.optional).toEqual(['unit']);
    expect(fromList.boms.docs.bom_id).toMatch(/bom/);
    const fromMap = normalizeTemplateDocs({ data: { customers: { required: ['customer_name'], optional: ['customer_type'] } } });
    expect(fromMap.customers).toMatchObject({ required: ['customer_name'], optional: ['customer_type'] });
  });

  it('reads FastAPI error details', () => {
    expect(errorMessage({ response: { data: { detail: 'forecast_id is required' } } })).toBe('forecast_id is required');
    expect(errorMessage({ response: { data: { detail: [{ loc: ['body', 'rows'], msg: 'field required' }] } } })).toBe('rows: field required');
    expect(errorMessage({ response: { status: 404, data: {} } })).toMatch(/404/);
  });
});

// The QA owner's BOM export: a title on row 1, the header on row 2.
const BOM_TITLE = 'Ridgeline Precision Arms - Indented BOM Export (run 10/11/2026)';
const BOM_HEADER = ['BOM Number', 'Assembly Name', 'Rev', 'Find No', 'Component Part', 'Component Description',
  'Qty Per', 'UOM', 'Unit Cost', 'Extended Cost', 'FG Part Number'];
const BOM_ROWS = [
  ['BOM-RF100', 'RF-100 assembly', 'A', 10, 'BRL-308-22', 'Barrel blank 416R 22in .308', 1, 'EA', '$118.00', '$118.00', 'RF-100'],
  ['BOM-RF100', 'RF-100 assembly', 'A', 20, 'RCV-SA-01', 'Receiver forging, short action', 1, 'EA', '$142.50', '$142.50', 'RF-100'],
  ['BOM-RF100', 'RF-100 assembly', 'A', 30, 'BLT-SA-01', 'Bolt body, short action', 1, 'EA', '$64.25', '$64.25', 'RF-100'],
];
const bomMatrix = () => [[BOM_TITLE, null, null, null, null, null, null, null, null, null, null], BOM_HEADER, ...BOM_ROWS];

describe('header row detection', () => {
  it('tells column names from values', () => {
    expect(looksLikeLabel('Qty Per')).toBe(true);
    expect(looksLikeLabel('Jan-27')).toBe(true);
    expect(looksLikeLabel('C1001')).toBe(true);
    expect(looksLikeLabel(new Date(2027, 0, 1))).toBe(true);
    expect(looksLikeLabel(10)).toBe(false);
    expect(looksLikeLabel('$1,110.00')).toBe(false);
    expect(looksLikeLabel('2%')).toBe(false);
    expect(looksLikeLabel('(25.50)')).toBe(false);
    expect(looksLikeLabel('  ')).toBe(false);
  });

  it('skips a title row above the header (the QA BOM export)', () => {
    expect(detectHeaderRow(bomMatrix())).toEqual({ index: 1, skipped: 1 });
  });

  it('keeps the first row when it is the header', () => {
    expect(detectHeaderRow([BOM_HEADER, ...BOM_ROWS])).toEqual({ index: 0, skipped: 0 });
    expect(detectHeaderRow([['Customer No', 'Customer Name', 'Class', 'Territory'], ['C1001', 'Big Sky Outfitters', 'Dealer', 'Mountain West']]))
      .toEqual({ index: 0, skipped: 0 });
  });

  it('skips blank lines and a two-cell run-date line above a wide header', () => {
    const matrix = [
      [],
      ['Ridgeline Precision Arms', 'Run 10/11/2026'],
      [null, null],
      BOM_HEADER,
      ...BOM_ROWS,
    ];
    expect(detectHeaderRow(matrix)).toEqual({ index: 3, skipped: 1 });
  });

  it('falls back to the first non-blank row when nothing looks like a header', () => {
    expect(detectHeaderRow([[], [1, 2, 3], [4, 5, 6]])).toEqual({ index: 1, skipped: 0 });
  });

  it('says where the header was found', () => {
    expect(describeHeaderRow({ row: 2, skipped: 1 })).toBe('Header found on row 2; 1 title row skipped');
    expect(describeHeaderRow({ row: 4, skipped: 2 })).toBe('Header found on row 4; 2 title rows skipped');
    expect(describeHeaderRow({ row: 1, skipped: 0 })).toBeNull();
    expect(describeHeaderRow(null)).toBeNull();
  });

  it('reads the QA BOM workbook from its second row', () => {
    const sheet = XLSX.utils.aoa_to_sheet(bomMatrix());
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'BOM Export');
    const buffer = XLSX.write(book, { type: 'array', bookType: 'xlsx' });
    const { records, header, sheetName, columns } = parseExcelBuffer(XLSX, buffer);
    expect(sheetName).toBe('BOM Export');
    expect(header).toEqual({ row: 2, skipped: 1 });
    expect(columns).toEqual(BOM_HEADER);
    const rows = cleanRows(records);
    expect(rows).toHaveLength(3);
    expect(collectHeaders(rows)).toEqual(BOM_HEADER);
    expect(rows[0]).toMatchObject({ 'BOM Number': 'BOM-RF100', 'Qty Per': 1, 'Unit Cost': '118.00', 'FG Part Number': 'RF-100' });
    expect(Object.keys(rows[0])).not.toContain(BOM_TITLE);
  });

  it('reads a CSV with a title row the same way', () => {
    const text = `${BOM_TITLE},,,,,,,,,,\n${BOM_HEADER.join(',')}\n${BOM_ROWS.map((r) => r.map((c) => (String(c).includes(',') ? `"${c}"` : c)).join(',')).join('\n')}\n`;
    const { data } = Papa.parse(text, { header: false, skipEmptyLines: false });
    const { records, header } = csvMatrixToRecords(data);
    expect(header).toEqual({ row: 2, skipped: 1 });
    const rows = cleanRows(records);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toMatchObject({ 'BOM Number': 'BOM-RF100', 'Component Description': 'Receiver forging, short action', 'Extended Cost': '142.50' });
  });

  it('keeps repeated and blank header cells apart', () => {
    const { records } = csvMatrixToRecords([['Item', 'Item', '', 'Qty'], ['A', 'B', 'x', '3']]);
    expect(cleanRows(records)).toEqual([{ Item: 'A', 'Item (2)': 'B', Qty: '3' }]);
  });
});

describe('column mapping', () => {
  const templates = normalizeTemplateDocs({ data: { templates: [
    { kind: 'customers', columns: [
      { name: 'customer_id', required: false, aliases: ['id', 'customer_number', 'customer_no'] },
      { name: 'customer_name', required: true, aliases: ['name'] },
      { name: 'customer_type', required: true, aliases: ['type', 'channel', 'class'] },
      { name: 'region', required: false, aliases: ['territory', 'state'] },
    ] },
    { kind: 'prices', columns: [
      { name: 'unit_id', required: false, aliases: ['product', 'item'] },
      { name: 'customer_type', required: false, aliases: ['type', 'class'] },
      { name: 'customer_id', required: false, aliases: ['customer'] },
      { name: 'unit_price', required: false, aliases: ['price'] },
      { name: 'discount_pct', required: false, aliases: ['discount'] },
      { name: 'start_period', required: false, aliases: ['start', 'effective'] },
      { name: 'notes', required: false, aliases: ['note'] },
    ] },
  ] } });

  it('matches file columns to fields like the server (case, spaces, dashes ignored)', () => {
    const m = describeColumnMapping({ kind: 'customers', headers: ['Customer No', 'Customer Name', 'Class', 'Territory'], template: templates.customers });
    expect(m.mapped.map((x) => `${x.column} -> ${x.label}`)).toEqual([
      'Customer No -> customer id', 'Customer Name -> customer name', 'Class -> customer type', 'Territory -> region',
    ]);
    expect(m.ignored).toEqual([]);
  });

  it('names unused columns and prefers the field\'s own name over an alias', () => {
    const m = describeColumnMapping({ kind: 'prices', headers: ['Customer Type', 'Class', 'Item', 'Price', 'Effective', 'UOM'], template: templates.prices });
    expect(m.mapped.map((x) => `${x.column} -> ${x.label}`)).toEqual([
      'Customer Type -> customer type', 'Item -> product id', 'Price -> price', 'Effective -> start month',
    ]);
    expect(m.ignored).toEqual(['Class', 'UOM']);
  });

  it('trusts the server: a column it did not report as ignored is used', () => {
    const ignored = ignoredColumnsFromWarnings([{ message: 'Ignored columns (not recognised): UOM' }]);
    expect(ignored).toEqual(['UOM']);
    const m = describeColumnMapping({ kind: 'prices', headers: ['Item', 'Price', 'Capacity Minutes', 'UOM'], template: templates.prices, ignoredByServer: ignored });
    expect(m.mapped.find((x) => x.column === 'Capacity Minutes').label).toBe('read by the server');
    expect(m.ignored).toEqual(['UOM']);
  });

  it('uses the server\'s column map when the response has one', () => {
    const result = summarizeImportResult({ data: { created: 1, column_map: { Class: 'customer_type', Junk: null } } });
    const m = describeColumnMapping({ kind: 'customers', headers: ['Class', 'Junk'], template: templates.customers, serverMap: result.columnMap });
    expect(m.mapped).toEqual([{ column: 'Class', field: 'customer_type', label: 'customer type' }]);
    expect(m.ignored).toEqual(['Junk']);
  });

  it('describes a wide sales file: ids, month columns and the dropped total', () => {
    const headers = ['Customer', 'Customer Name', 'Item', 'Description', 'Jan-27', 'Feb-27', 'Mar-27', 'Total'];
    const sales = prepareSalesRows([{ Customer: 'C1001', 'Customer Name': 'Big Sky', Item: 'RF-100', Description: 'Hunter', 'Jan-27': 1, 'Feb-27': 2, 'Mar-27': 3, Total: 6 }]);
    const m = describeColumnMapping({
      kind: 'sales', headers, template: null,
      sales: { layout: sales.layout, monthColumns: sales.monthColumns, fieldFor: salesFieldFor, isTotal: isTotalHeader },
    });
    expect(m.mapped.map((x) => `${x.column} -> ${x.label}`)).toEqual([
      'Customer -> customer id', 'Customer Name -> customer name', 'Item -> product id', 'Description -> product name',
    ]);
    expect(m.months).toMatchObject({ count: 3, first: '2027-01', last: '2027-03' });
    expect(m.dropped).toEqual(['Total']);
    expect(m.ignored).toEqual([]);
  });
});

describe('setup progress', () => {
  it('lists the import steps in page order with the same counts everywhere', () => {
    const p = setupProgress({
      data: {
        customers: [{ customer_id: 'C1', customer_type: 'Dealer' }, { customer_id: 'C2', customer_type: '' }],
        products: [{ unit_id: 'P1', bom: 'B1', router: 'R1' }],
        machines: [{ machine_id: 'M1' }],
        labor_rates: [],
        router_definitions: [{ router_id: 'R1' }],
        router_operations: [{ router_id: 'R1' }, { router_id: 'R1' }],
        bom: [{ bom_id: 'B1' }, { bom_id: 'B1' }],
      },
      scenario: { id: 'F001', name: 'Budget 2027', sales_rows: 744 },
      ruleCounts: { prices: 15, deductions: 0 },
    });
    expect(p.steps.map((s) => s.kind)).toEqual(['customers', 'products', 'machines', 'labor_rates', 'routings', 'boms', 'prices', 'deductions', 'sales']);
    expect(p.total).toBe(9);
    expect(p.done).toBe(7);
    expect(p.byKind.customers.warning).toBe('1 customer has no type');
    expect(p.byKind.routings.label).toBe('1 routing · 2 operations');
    expect(p.byKind.boms.label).toBe('1 BOM · 2 lines');
    expect(p.byKind.sales.label).toBe('744 sales rows in Budget 2027');
    expect(p.byKind.labor_rates.done).toBe(false);
    expect(p.byKind.deductions.done).toBe(false);
  });

  it('counts nothing while the rule counts are unknown and without a scenario', () => {
    const p = setupProgress({ data: {}, scenario: null, ruleCounts: {} });
    expect(p.done).toBe(0);
    expect(p.byKind.prices.count).toBeNull();
    expect(p.byKind.sales.count).toBeNull();
  });
});
