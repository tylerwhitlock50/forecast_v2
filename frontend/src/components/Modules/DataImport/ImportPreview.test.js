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
});
