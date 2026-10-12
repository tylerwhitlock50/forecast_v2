import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { DependencyList, summarizeDependencies } from './salesDependencies';

jest.mock('../../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn() } }));

const scenarios = { F001: { name: '2027 Budget' }, F002: { name: 'Upside' } };

test('groups sales rows by scenario with revenue = quantity x price', () => {
  const deps = summarizeDependencies([
    { forecast_id: 'F001', quantity: 10, unit_price: 100 },
    { forecast_id: 'F001', quantity: 5, unit_price: 100 },
    { forecast_id: 'F002', quantity: 1, unit_price: 50 },
  ], scenarios);
  expect(deps.rows).toBe(3);
  expect(deps.revenue).toBe(1550);
  expect(deps.scenarios).toEqual([
    { id: 'F001', name: '2027 Budget', rows: 2, revenue: 1500 },
    { id: 'F002', name: 'Upside', rows: 1, revenue: 50 },
  ]);
});

test('the confirm body names the rows and scenarios that will be deleted', () => {
  const deps = summarizeDependencies(
    Array.from({ length: 24 }, () => ({ forecast_id: 'F001', quantity: 10, unit_price: 1261.26 })),
    scenarios
  );
  render(<DependencyList name="Ridgeline Sports" deps={deps} />);
  expect(screen.getByText(/24 sales rows/)).toBeInTheDocument();
  expect(screen.getByText('2027 Budget')).toBeInTheDocument();
  expect(screen.getByText(/also deletes these sales rows/)).toBeInTheDocument();
});

test('a customer without sales says so', () => {
  render(<DependencyList name="New Dealer" deps={summarizeDependencies([], scenarios)} />);
  expect(screen.getByText(/has no sales in any scenario/)).toBeInTheDocument();
});
