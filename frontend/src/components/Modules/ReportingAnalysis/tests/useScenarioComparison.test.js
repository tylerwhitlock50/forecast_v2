import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import ForecastContext from '../../../../context/ForecastContext';
import { comparisonErrorMessage, knownScenarioIds, useScenarioComparison } from '../hooks/useScenarioComparison';
import api from '../../../../lib/apiClient';

// axios ships ESM that jest cannot load; the real error-message helper does not use it.
jest.mock('axios', () => ({
  create: () => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  }),
}));

jest.mock('../../../../lib/apiClient', () => {
  const actual = jest.requireActual('../../../../lib/apiClient');
  return {
    __esModule: true,
    extractErrorMessage: actual.extractErrorMessage,
    default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  };
});

jest.mock('react-hot-toast', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const row = (id, extra = {}) => ({
  forecast_id: id, name: id, operating_income: 1, net_income: 1, interest_expense: 0, pre_tax_income: 1, income_tax: 0, ...extra,
});

const wrapperFor = (scenarios) => ({ children }) => (
  <ForecastContext.Provider value={{ scenarios }}>{children}</ForecastContext.Provider>
);

describe('knownScenarioIds', () => {
  it('drops ids that are no longer scenarios, blanks and repeats', () => {
    const scenarios = { F001: {}, F002: {} };
    expect(knownScenarioIds(['F001', 'F009', 'F002', 'F001', '', null], scenarios)).toEqual(['F001', 'F002']);
    // Until the scenario list has loaded there is nothing to check against.
    expect(knownScenarioIds(['F009', 'F001'], {})).toEqual(['F009', 'F001']);
    expect(knownScenarioIds(['F009'], null)).toEqual(['F009']);
  });
});

describe('comparisonErrorMessage', () => {
  it('shows the API detail, and says what to do on a 404', () => {
    const notFound = { response: { status: 404, data: { detail: 'Unknown scenario id(s): F009' } } };
    expect(comparisonErrorMessage(notFound))
      .toBe('Unknown scenario id(s): F009. The scenario may have been deleted: pick another scenario to compare.');
    const invalid = { response: { status: 422, data: { detail: 'start_period and end_period must be supplied together' } } };
    expect(comparisonErrorMessage(invalid)).toBe('start_period and end_period must be supplied together');
  });
});

describe('useScenarioComparison', () => {
  it('asks only for scenarios that still exist', async () => {
    api.get.mockResolvedValue({ status: 'success', data: { comparison: [row('F001')], window: { start_period: '2027-01', end_period: '2027-12' } } });
    const { result } = renderHook(() => useScenarioComparison(), { wrapper: wrapperFor({ F001: { id: 'F001' } }) });
    await act(async () => { await result.current.fetchComparison(['F001', 'F-DELETED']); });
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(api.get.mock.calls[0][0]).toBe('/forecast/comparison?forecast_ids=F001');
    expect(result.current.data.map((r) => r.forecast_id)).toEqual(['F001']);
    expect(result.current.error).toBeNull();
  });

  it('does not call the API when every selected scenario is gone', async () => {
    const { result } = renderHook(() => useScenarioComparison(), { wrapper: wrapperFor({ F001: { id: 'F001' } }) });
    await act(async () => { await result.current.fetchComparison(['F-DELETED']); });
    expect(api.get).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("shows the API's 404 detail when it still happens", async () => {
    const err = Object.assign(new Error('Request failed with status code 404'), {
      response: { status: 404, data: { detail: 'Unknown scenario id(s): F002' } },
    });
    api.get.mockRejectedValue(err);
    const { result } = renderHook(() => useScenarioComparison(), { wrapper: wrapperFor({ F001: {}, F002: {} }) });
    await act(async () => { await result.current.fetchComparison(['F001', 'F002']); });
    await waitFor(() => expect(result.current.error).toMatch(/^Unknown scenario id\(s\): F002\. The scenario may have been deleted/));
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Unknown scenario id(s): F002'), expect.anything());
    expect(result.current.data).toEqual([]);
  });

  it('drops the row of a scenario deleted after the comparison loaded', async () => {
    api.get.mockResolvedValue({ status: 'success', data: { comparison: [row('F001'), row('F002')], window: null } });
    let scenarios = { F001: {}, F002: {} };
    const wrapper = ({ children }) => <ForecastContext.Provider value={{ scenarios }}>{children}</ForecastContext.Provider>;
    const { result, rerender } = renderHook(() => useScenarioComparison(), { wrapper });
    await act(async () => { await result.current.fetchComparison(['F001', 'F002']); });
    expect(result.current.data).toHaveLength(2);
    scenarios = { F001: {} };
    rerender();
    expect(result.current.data.map((r) => r.forecast_id)).toEqual(['F001']);
  });
});
