import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import StatementTable, { periodColumns } from '../components/StatementTable';

const rowByLabel = (label) => screen.getAllByRole('row').find(r => within(r).queryByRole('rowheader', { name: label }));

const rows = [
  { key: 'revenue', label: 'Revenue', kind: 'subtotal' },
  { key: 'cogs_header', label: 'Cost of goods sold', kind: 'header' },
  { key: 'cogs_materials', label: 'Materials', kind: 'line', indent: 1 },
  { key: 'net_income', label: 'Net income', kind: 'total' },
  { key: 'net_margin_pct', label: 'Net margin %', kind: 'pct', indent: 1 }
];

const byPeriod = [
  { period: '2026-01', revenue: 100000, cogs_materials: 40000, net_income: 12345.6, net_margin_pct: 12.3456 },
  { period: '2026-02', revenue: 90000, cogs_materials: 35000, net_income: -2500, net_margin_pct: -2.78 }
];
const totals = { revenue: 190000, cogs_materials: 75000, net_income: 9845.6, net_margin_pct: 5.18 };

describe('StatementTable', () => {
  it('renders period headers, a Total column and row labels', () => {
    render(<StatementTable rows={rows} columns={periodColumns(byPeriod, totals)} firstColumnLabel="Income statement" />);

    expect(screen.getByText('Jan 2026')).toBeInTheDocument();
    expect(screen.getByText('Feb 2026')).toBeInTheDocument();
    expect(screen.getByText('Total')).toBeInTheDocument();
    expect(screen.getByText('Revenue')).toBeInTheDocument();
    expect(screen.getByText('Cost of goods sold')).toBeInTheDocument();
    expect(screen.getByText('Materials')).toBeInTheDocument();
    expect(screen.getByText('Net income')).toBeInTheDocument();
  });

  it('formats values, totals and percentages', () => {
    render(<StatementTable rows={rows} columns={periodColumns(byPeriod, totals)} />);
    const revenueRow = rowByLabel('Revenue');
    const revenueCells = within(revenueRow).getAllByRole('cell').map(c => c.textContent);
    expect(revenueCells).toEqual(['100,000', '90,000', '190,000']);

    const pctRow = rowByLabel('Net margin %');
    const pctCells = within(pctRow).getAllByRole('cell').map(c => c.textContent);
    expect(pctCells).toEqual(['12.3%', '-2.8%', '5.2%']);

    // Header rows render no numbers
    const headerRow = rowByLabel('Cost of goods sold');
    within(headerRow).getAllByRole('cell').forEach(c => expect(c.textContent).toBe(''));
  });

  it('shows negatives in parentheses with red styling', () => {
    render(<StatementTable rows={rows} columns={periodColumns(byPeriod, totals)} />);
    const niRow = rowByLabel('Net income');
    const cells = within(niRow).getAllByRole('cell');

    expect(cells[0].textContent).toBe('12,346');
    expect(cells[1].textContent).toBe('(2,500)');
    expect(cells[1]).toHaveClass('text-red-600');
    expect(cells[0]).not.toHaveClass('text-red-600');
    expect(niRow).toHaveAttribute('data-kind', 'total');
  });

  it('supports negate rows and dashes for missing values', () => {
    const negRows = [{ key: 'accumulated_depreciation', label: 'Accumulated depreciation', kind: 'line', negate: true }];
    const cols = [
      { key: '2026-01', values: { accumulated_depreciation: 1200 } },
      { key: '2026-02', values: {} }
    ];
    render(<StatementTable rows={negRows} columns={cols} />);
    const row = rowByLabel('Accumulated depreciation');
    const cells = within(row).getAllByRole('cell').map(c => c.textContent);
    expect(cells).toEqual(['(1,200)', '—']);
  });

  it('does not colour a neutral row (a favourable variance) red', () => {
    const variance = [{ key: 'labor_variance', label: 'Labor variance', kind: 'line', neutral: true }];
    render(<StatementTable rows={variance} columns={[{ key: '2026-01', values: { labor_variance: -1200 } }]} />);
    const cell = within(rowByLabel('Labor variance')).getAllByRole('cell')[0];
    expect(cell).toHaveTextContent('(1,200)');
    expect(cell).not.toHaveClass('text-red-600');
  });

  it('omits the Total column when no totals are passed', () => {
    render(<StatementTable rows={rows} columns={periodColumns(byPeriod)} />);
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });
});
