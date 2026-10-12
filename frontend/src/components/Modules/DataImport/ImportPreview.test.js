import React from 'react';
import { render, screen, within } from '@testing-library/react';
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
    expect(screen.getByText('Will remove 12 monthly rows that are not in this file')).toBeInTheDocument();
    expect(screen.getByText(/Only the months this file covers are touched/)).toBeInTheDocument();
  });

  it('says a whole-scenario replace removes lines in every month', () => {
    render(<ImportPreview result={salesDryRun({ mode: 'replace_all', deleted: 1 })} rows={[]} step={stepByKind('sales')} />);
    expect(screen.getByText('Will remove 1 monthly row that is not in this file')).toBeInTheDocument();
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

  it('shows unchanged sales rows on their own and never as updated', () => {
    const result = salesDryRun({ imported: 10, inserted: 2, updated: 3, unchanged: 5 });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('sales')} />);
    const tiles = Object.fromEntries(screen.getAllByTestId('count-tile').map((t) => [t.firstChild.textContent, t.children[1].textContent]));
    expect(tiles).toMatchObject({ 'New rows': '2', 'Updated rows': '3', Unchanged: '5' });
  });

  it('counts monthly rows and customer x product lines a sales replace removes, with the list behind a toggle', () => {
    const result = salesDryRun({
      mode: 'replace', deleted: 14, removed_line_count: 3,
      removed_lines: [
        { customer_id: 'C-001', customer_name: 'Big Sky Outdoors', unit_id: 'RF-100', unit_name: 'Ridgeline', months: ['2027-01', '2027-02', '2027-03'] },
        { customer_id: 'C-002', customer_name: 'C-002', unit_id: 'PS-200', months: ['2027-05', '2027-07'] },
      ],
    });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('sales')} />);
    expect(screen.getByText('Will remove 14 monthly rows (3 customer × product lines) that are not in this file')).toBeInTheDocument();
    const list = screen.getByTestId('removed-lines');
    expect(list.tagName).toBe('DETAILS');
    expect(list).not.toHaveAttribute('open');
    expect(within(list).getByText('Show the 3 lines that will be removed')).toBeInTheDocument();
    expect(within(list).getByText('Big Sky Outdoors')).toBeInTheDocument();
    expect(within(list).getByText('Jan – Mar 2027')).toBeInTheDocument();
    expect(within(list).getByText('May 2027, Jul 2027')).toBeInTheDocument();
    expect(within(list).getByText(/and 1 more line/)).toBeInTheDocument();
  });

  it('labels a BOM replace as BOMs replaced with the lines it deletes', () => {
    const result = summarizeImportResult({
      data: {
        created: 64, updated: 0, replaced: 8, skipped: 0, mode: 'replace', errors: [], warnings: [], boms_replaced: 8,
        boms: [], summary: { boms: 8, lines_written: 64, lines_deleted: 61 },
      },
    });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('boms')} />);
    expect(screen.getByText('BOMs replaced')).toBeInTheDocument();
    expect(screen.getByText('61 lines deleted first')).toBeInTheDocument();
    expect(screen.queryByText('Replaced BOM lines')).not.toBeInTheDocument();
  });

  it('labels a routing replace as Routings replaced, from replaced when routings_replaced is missing', () => {
    const result = summarizeImportResult({
      data: { created: 35, updated: 0, replaced: 8, skipped: 0, mode: 'replace', errors: [], warnings: [], routings: [], summary: { operations_deleted: 33 } },
    });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('routings')} />);
    const tile = screen.getByText('Routings replaced').parentElement;
    expect(tile).toHaveTextContent('8');
    expect(tile).toHaveTextContent('33 operations deleted first');
  });

  it('shows unchanged records next to new and updated', () => {
    const result = summarizeImportResult({ data: { created: 0, updated: 1, skipped: 0, errors: [], warnings: [], summary: { unchanged: 11 } } });
    render(<ImportPreview result={result} rows={[]} step={stepByKind('customers')} />);
    const tiles = Object.fromEntries(screen.getAllByTestId('count-tile').map((t) => [t.firstChild.textContent, t.children[1].textContent]));
    expect(tiles).toMatchObject({ 'New customers': '0', 'Updated customers': '1', Unchanged: '11' });
  });

  it('keeps the deductions replace summary to its own noun', () => {
    render(<ImportPreview result={pricesDryRun({ replace_blocked: true, errors: [{ row: 1, error: 'rate is required' }] })} rows={[]} step={stepByKind('deductions')} />);
    expect(screen.getByText(/Replacing deletes every existing rule of the/)).toBeInTheDocument();
    expect(screen.queryByText('Row · column')).not.toBeInTheDocument();
  });
});
