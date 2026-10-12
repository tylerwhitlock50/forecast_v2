import {
  cleanCell,
  cleanRows,
  detectWideSales,
  excelDateToString,
  fileKind,
  parseMonthLabel,
  prepareSalesRows,
  salesFieldFor,
} from './fileParsing';
import { describePriceSources, errorMessage, normalizeTemplateDocs, summarizeImportResult } from './importSteps';

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
    expect(s.errors).toEqual([{ row: 4, error: 'qty must be a number', field: null }]);
    expect(s.warnings[0].message).toMatch(/placeholder/);
    expect(s.boms[0]).toMatchObject({ bom_id: 'BOM-R100', lines: 12, material_cost_per_unit: 412.5 });
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
