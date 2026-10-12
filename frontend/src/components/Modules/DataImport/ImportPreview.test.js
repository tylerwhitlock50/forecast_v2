import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImportPreview from './ImportPreview';
import { stepByKind, summarizeImportResult } from './importSteps';

describe('ImportPreview', () => {
  it('shows sales totals, where prices came from and row errors with the row values', () => {
    const result = summarizeImportResult({
      data: {
        imported: 2, inserted: 1, updated: 1, dry_run: true,
        created_customers: [], created_products: [],
        errors: [{ row: 3, error: 'Customer CUST-999 does not exist' }],
        warnings: [],
        price_sources: { type_product: 1, explicit: 1 },
        start_period: '2027-01', end_period: '2027-02', total_quantity: 15, total_revenue: 16145,
      },
    });
    const rows = [
      { customer_id: 'CUST-001', unit_id: 'RFL-308', period: '2027-01', quantity: 5 },
      { customer_id: 'CUST-002', unit_id: 'PST-9C', period: '2027-02', quantity: 10, unit_price: 479 },
      { customer_id: 'CUST-999', unit_id: 'RFL-308', period: '2027-02', quantity: 3 },
    ];
    render(<ImportPreview result={result} rows={rows} step={stepByKind('sales')} />);
    expect(screen.getByText(/Jan 2027 – Feb 2027/)).toBeInTheDocument();
    expect(screen.getByText(/priced from the customer-type price list/)).toBeInTheDocument();
    expect(screen.getByText(/kept the price in your file/)).toBeInTheDocument();
    expect(screen.getByText('Customer CUST-999 does not exist')).toBeInTheDocument();
    expect(screen.getByText('CUST-999 · RFL-308 · 2027-02')).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been saved yet/)).toBeInTheDocument();
  });

  it('shows material cost per BOM and labels counts as BOM lines', () => {
    const result = summarizeImportResult({
      data: {
        created: 7, updated: 0, replaced: 0, skipped: 0, errors: [], warnings: [],
        boms: [{ bom_id: 'BOM-RFL-308', version: '1.0', lines: 7, material_cost_per_unit: 605.5, linked_products: ['RFL-308'] }],
      },
    });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('boms')} done />);
    expect(screen.getByText('New BOM lines')).toBeInTheDocument();
    expect(screen.getByText('$605.50')).toBeInTheDocument();
    expect(screen.getByText('RFL-308')).toBeInTheDocument();
    expect(screen.getByText(/Every row was imported/)).toBeInTheDocument();
  });

  const salesDryRun = (extra) => summarizeImportResult({
    data: {
      imported: 3, inserted: 0, updated: 3, dry_run: true, created_customers: [], created_products: [],
      errors: [], warnings: [], price_sources: { explicit: 3 }, start_period: '2027-01', end_period: '2027-03', ...extra,
    },
  });

  it('says how many lines a replace import will remove', () => {
    const result = salesDryRun({ mode: 'replace', deleted: 12, replace_blocked: false });
    expect(result).toMatchObject({ mode: 'replace', deleted: 12, replaceBlocked: false });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('sales')} />);
    expect(screen.getByText('Will remove 12 lines that are not in this file')).toBeInTheDocument();
    expect(screen.getByText(/Only the months this file covers are touched/)).toBeInTheDocument();
  });

  it('says a whole-scenario replace removes lines in every month', () => {
    render(<ImportPreview result={salesDryRun({ mode: 'replace_all', deleted: 1 })} rows={[]} step={stepByKind('sales')} />);
    expect(screen.getByText('Will remove 1 line that is not in this file')).toBeInTheDocument();
    expect(screen.getByText(/afterwards the scenario holds exactly the lines in this file/)).toBeInTheDocument();
  });

  it('says nothing changes when a replace is blocked by row errors', () => {
    const result = salesDryRun({
      mode: 'replace', deleted: 0, replace_blocked: true,
      errors: [{ row: 2, error: 'Customer CUST-999 does not exist' }],
    });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('sales')} />);
    expect(screen.getByText('Nothing will be changed')).toBeInTheDocument();
    expect(screen.getByText(/Replacing only runs when every row is valid/)).toBeInTheDocument();
    expect(screen.getByText(/1 row has a problem: fix it to import this file/)).toBeInTheDocument();
    expect(screen.queryByText(/will be skipped/)).not.toBeInTheDocument();
  });

  it('shows nothing about removals for an add / update import', () => {
    render(<ImportPreview result={salesDryRun({ mode: 'upsert', deleted: 0 })} rows={[]} step={stepByKind('sales')} />);
    expect(screen.queryByTestId('replace-summary')).not.toBeInTheDocument();
  });

  it('leaves the removed-lines count to the headline after the import', () => {
    render(<ImportPreview result={salesDryRun({ mode: 'replace', deleted: 4, dry_run: false })} rows={[]} step={stepByKind('sales')} done />);
    expect(screen.queryByTestId('replace-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/Will remove/)).not.toBeInTheDocument();
  });
  const pricesDryRun = (extra) => summarizeImportResult({
    data: { created: 9, updated: 0, replaced: 15, skipped: 0, dry_run: true, mode: 'replace', warnings: [], errors: [], ...extra },
  });

  it('says a price "Replace all" first deletes the saved rules', () => {
    render(<ImportPreview result={pricesDryRun({})} rows={[]} step={stepByKind('prices')} />);
    expect(screen.getByText('Will first delete 15 price rules already saved')).toBeInTheDocument();
  });

  it('says nothing changes when a rules replace is blocked, and names the matrix column of each error', () => {
    const result = pricesDryRun({
      replace_blocked: true,
      errors: [{ row: 2, column: 'Distributor', error: "unit_price 'call us' is not a number" }],
    });
    const rows = [{ Product: 'RF-100', Dealer: '1110' }, { Product: 'RF-200', Dealer: '1795', Distributor: 'call us' }];
    render(<ImportPreview result={result} rows={rows} step={stepByKind('prices')} />);
    expect(screen.getByText('Nothing will be changed')).toBeInTheDocument();
    expect(screen.getByText(/no price rules are added, updated or deleted until the file is fixed/)).toBeInTheDocument();
    expect(screen.queryByText(/Will first delete/)).not.toBeInTheDocument();
    expect(screen.getByText('Row · column')).toBeInTheDocument();
    expect(screen.getByTestId('error-column')).toHaveTextContent('Distributor column');
    expect(screen.getByText('Distributor: call us ·', { exact: false })).toBeInTheDocument();
    expect(screen.getByText(/1 row has a problem: fix it to import this file/)).toBeInTheDocument();
  });

  it('keeps the deductions replace summary to its own noun', () => {
    render(<ImportPreview result={pricesDryRun({ replace_blocked: true, errors: [{ row: 1, error: 'rate is required' }] })} rows={[]} step={stepByKind('deductions')} />);
    expect(screen.getByText(/Replacing deletes every existing rule of the/)).toBeInTheDocument();
    expect(screen.queryByText('Row · column')).not.toBeInTheDocument();
  });
});
