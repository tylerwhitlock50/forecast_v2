import React from 'react';
import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import DataImportPage from './DataImportPage';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  apiClient: { get: jest.fn() },
}));

const mockForecast = {
  data: { customers: [{ customer_id: 'C-1' }], products: [], bom: [], router_definitions: [], router_operations: [] },
  scenarios: { 'F-1': { id: 'F-1', name: 'Budget 2027', sales_rows: 3 } },
  activeScenario: 'F-1',
  actions: { fetchAllData: jest.fn() },
};
jest.mock('../../../context/ForecastContext', () => ({ useForecast: () => mockForecast }));

let navigateTo;
const NavigateProbe = () => {
  navigateTo = useNavigate();
  return null;
};

const renderAt = (entry) => render(
  <MemoryRouter initialEntries={[entry]}>
    <NavigateProbe />
    <DataImportPage />
  </MemoryRouter>,
);

describe('DataImportPage deep links', () => {
  let scrollTo;
  beforeEach(() => {
    jest.useFakeTimers();
    scrollTo = jest.spyOn(window, 'scrollTo').mockImplementation(() => {});
    // Template docs and rule counts never answer: these tests are about scrolling.
    api.get.mockReturnValue(new Promise(() => {}));
  });
  afterEach(() => {
    scrollTo.mockRestore();
    jest.useRealTimers();
  });

  it('scrolls to and highlights the step named in the hash, then clears the highlight', () => {
    renderAt('/import#boms');
    const card = screen.getByTestId('import-step-boms');
    expect(card).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('import-step-sales')).not.toHaveAttribute('data-highlighted');
    act(() => { jest.advanceTimersByTime(20); });
    expect(scrollTo).toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(3000); });
    expect(card).not.toHaveAttribute('data-highlighted');
  });

  it('accepts other spellings of a step and follows hash changes', () => {
    renderAt('/import#labor-rates');
    expect(screen.getByTestId('import-step-labor_rates')).toHaveAttribute('data-highlighted', 'true');
    act(() => { navigateTo('/import#sales'); });
    expect(screen.getByTestId('import-step-sales')).toHaveAttribute('data-highlighted', 'true');
    expect(screen.getByTestId('import-step-labor_rates')).not.toHaveAttribute('data-highlighted');
  });

  it('highlights nothing without a step in the hash', () => {
    renderAt('/import');
    act(() => { jest.advanceTimersByTime(20); });
    screen.getAllByTestId(/^import-step-/).forEach((card) => expect(card).not.toHaveAttribute('data-highlighted'));
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
