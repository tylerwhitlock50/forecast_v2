// The CSV templates shipped in public/templates must use the column names the
// Import data page and the server expect, and next-year example months.
import fs from 'fs';
import path from 'path';
import Papa from 'papaparse';
import { prepareSalesRows } from '../DataImport/fileParsing';

const read = (name) => {
  const text = fs.readFileSync(path.join(__dirname, '../../../../public/templates', name), 'utf8');
  return Papa.parse(text, { header: true, skipEmptyLines: true });
};

test('products template keeps unit_id, bom_id and router_id as separate columns', () => {
  const { data, meta, errors } = read('products_template.csv');
  expect(errors).toEqual([]);
  expect(meta.fields).toEqual(expect.arrayContaining(['unit_id', 'unit_name', 'base_price', 'unit_type', 'bom_id', 'router_id']));
  data.forEach(row => {
    expect(row.unit_id).not.toBe(row.router_id);
    expect(row.bom_id).toBeTruthy();
  });
});

test('customers template has a customer type for every row', () => {
  const { data, meta } = read('customers_template.csv');
  expect(meta.fields).toEqual(['customer_id', 'customer_name', 'customer_type', 'region']);
  data.forEach(row => expect(row.customer_type).toBeTruthy());
});

test('sales template maps to canonical fields and uses 2027 months', () => {
  const { data } = read('sales_forecast_template.csv');
  const { rows } = prepareSalesRows(data);
  rows.forEach(row => {
    expect(row.customer_id).toMatch(/^CUST-/);
    expect(row.unit_id).toBeTruthy();
    expect(row.period).toMatch(/^2027-\d{2}$/);
    expect(typeof row.quantity).toBe('number');
  });
  // the customer_name / unit_name columns never overwrite the ids
  expect(rows[0].customer_name).not.toBe(rows[0].customer_id);
});
