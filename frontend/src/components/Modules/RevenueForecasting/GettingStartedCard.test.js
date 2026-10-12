import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import GettingStartedCard from './GettingStartedCard';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

const mockForecast = {
  data: {
    customers: [{ customer_id: 'C1001', customer_type: 'Dealer' }],
    products: [{ unit_id: 'RF-100', bom: 'BOM-RF100', router: 'RT-RF100' }],
    machines: [{ machine_id: 'WC-MILL1' }],
    labor_rates: [{ rate_id: 'MACH' }],
    router_definitions: [{ router_id: 'RT-RF100' }],
    router_operations: [{ router_id: 'RT-RF100' }],
    bom: [],
  },
  scenarios: { F001: { id: 'F001', name: 'Budget 2027', sales_rows: 0 } },
  activeScenario: 'F001',
  lastUpdated: 1,
};
jest.mock('../../../context/ForecastContext', () => ({ useForecast: () => mockForecast }));

describe('GettingStartedCard', () => {
  it('lists the Import data steps in page order with the same counts', async () => {
    api.get.mockImplementation((url) => Promise.resolve(
      url.startsWith('/pricing/prices') ? { data: { prices: [{}, {}] } } : { data: { rules: [] } },
    ));
    render(<MemoryRouter><GettingStartedCard forceShow /></MemoryRouter>);
    const card = screen.getByTestId('getting-started');
    const steps = Array.from(card.querySelectorAll('li[data-step]')).map((li) => li.getAttribute('data-step'));
    expect(steps).toEqual(['customers', 'products', 'machines', 'labor_rates', 'routings', 'boms', 'prices', 'deductions', 'sales']);
    await waitFor(() => expect(within(card).getByText('6 of 9 steps have data')).toBeInTheDocument());
    expect(within(card.querySelector('li[data-step="prices"]')).getByText('2 prices')).toBeInTheDocument();
  });
});
