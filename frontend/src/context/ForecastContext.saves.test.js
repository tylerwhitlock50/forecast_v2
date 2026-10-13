import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import api from '../lib/apiClient';
import { ForecastProvider, useForecast } from './ForecastContext';

// UI-5: a refused grid save (e.g. 409 SCENARIO_LOCKED) showed the toast and
// rolled the cell back, then rethrew into the debounced save's promise, which
// nobody awaits: an unhandled rejection (a full-screen overlay under
// `npm start`). The save must report the error once and settle.
jest.mock('axios', () => ({
  create: () => ({
    interceptors: { request: { use: () => {} }, response: { use: () => {} } },
  }),
}));
jest.mock('../lib/apiClient', () => {
  const actual = jest.requireActual('../lib/apiClient');
  return {
    __esModule: true,
    ...actual,
    default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn(), upload: jest.fn() },
  };
});

jest.mock('react-hot-toast', () => {
  const t = jest.fn();
  t.success = jest.fn();
  t.error = jest.fn();
  t.dismiss = jest.fn();
  return { __esModule: true, toast: t, default: t, Toaster: () => null };
});

// Record what each run of the debounced save returns: lodash hands that
// promise to callers that drop it, so a rejection there is unhandled.
const mockSaveResults = [];
jest.mock('lodash', () => {
  const actual = jest.requireActual('lodash');
  return {
    ...actual,
    debounce: (fn, wait, options) => actual.debounce((...args) => {
      const result = fn(...args);
      mockSaveResults.push(result);
      return result;
    }, wait, options),
  };
});

let ctx;
const Probe = () => {
  ctx = useForecast();
  return null;
};

const LOCK_MESSAGE = "Scenario '2027 Budget' is approved and locked: branch it to make changes, or unlock it with a reason.";
const lockRefusal = () => Object.assign(new Error('Request failed with status code 409'), {
  response: { status: 409, data: { detail: LOCK_MESSAGE, code: 'SCENARIO_LOCKED' } },
  userMessage: LOCK_MESSAGE,
});

const savedRow = {
  sale_id: 'S1', unit_id: 'P1', customer_id: 'C1', period: '2027-03', quantity: 12, unit_price: 50,
  total_revenue: 600, forecast_id: 'F001',
};

describe('ForecastContext grid saves', () => {
  beforeEach(() => {
    mockSaveResults.length = 0;
    toast.error.mockClear();
    api.get.mockImplementation((url) => Promise.resolve(
      url.startsWith('/data/sales') ? { status: 'success', data: [savedRow] } : { status: 'success', data: [] }
    ));
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
    console.warn.mockRestore();
    console.log.mockRestore();
  });

  it('reports a refused save once, rolls back and leaves no rejected promise behind', async () => {
    api.post.mockRejectedValue(lockRefusal());
    render(<ForecastProvider><Probe /></ForecastProvider>);
    await waitFor(() => expect(ctx.data.sales_forecast).toHaveLength(1));

    await act(async () => {
      ctx.actions.updateSalesForecastOptimistic([{ ...savedRow, quantity: 99, total_revenue: 4950 }], 'replace');
    });

    expect(api.post).toHaveBeenCalledWith(
      '/forecast/bulk_update',
      expect.objectContaining({ operation: 'replace' }),
      { suppressSuccessToast: true, suppressErrorToast: true }
    );
    const runs = mockSaveResults.filter(Boolean);
    expect(runs.length).toBeGreaterThan(0);
    // Every run of the debounced save settles; none rejects.
    const settled = await Promise.allSettled(runs);
    expect(settled.map(s => s.status)).toEqual(runs.map(() => 'fulfilled'));

    // One message, with the server's reason, and the cell back at 12.
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toContain('approved and locked');
    await waitFor(() => expect(ctx.data.sales_forecast[0].quantity).toBe(12));
  });

  it('bulkUpdateForecast resolves for a queued edit even when the flush is refused', async () => {
    jest.useFakeTimers();
    try {
      api.post.mockRejectedValue(lockRefusal());
      render(<ForecastProvider><Probe /></ForecastProvider>);
      await waitFor(() => expect(ctx.data.sales_forecast).toHaveLength(1));

      await act(async () => {
        await ctx.actions.bulkUpdateForecast([{ ...savedRow, quantity: 99, total_revenue: 4950 }], 'replace');
      });
      await act(async () => {
        jest.advanceTimersByTime(1600);
      });
      const runs = mockSaveResults.filter(Boolean);
      expect(runs).toHaveLength(1);
      await expect(runs[0]).resolves.toBeUndefined();
      expect(toast.error).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(ctx.data.sales_forecast[0].quantity).toBe(12));
    } finally {
      jest.useRealTimers();
    }
  });
});
