import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import api from '../lib/apiClient';
import { ForecastProvider, useForecast } from './ForecastContext';

// The real toast helpers (showSuccessToast / showErrorToast) run; only the
// HTTP calls and the toast library are stubbed.
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

let ctx;
const Probe = () => {
  ctx = useForecast();
  return null;
};

const renderProvider = async () => {
  render(<ForecastProvider><Probe /></ForecastProvider>);
  await waitFor(() => expect(api.get).toHaveBeenCalled());
  await act(async () => { await Promise.resolve(); });
};

const quietRequest = { suppressSuccessToast: true, suppressErrorToast: true };

describe('ForecastContext customers: one toast per action', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ status: 'success', data: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
    console.log.mockRestore();
  });

  it('creates a customer with one success toast and no client toast', async () => {
    api.post.mockResolvedValue({ status: 'success', message: 'Record created' });
    await renderProvider();
    toast.success.mockClear();
    await act(async () => {
      await ctx.actions.createCustomer({ customer_id: 'CUST-010', customer_name: 'Scheels', customer_type: 'Dealer' });
    });
    expect(api.post).toHaveBeenCalledWith('/forecast/create', {
      table: 'customers', data: { customer_id: 'CUST-010', customer_name: 'Scheels', customer_type: 'Dealer' },
    }, quietRequest);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success.mock.calls[0][0]).toBe('Customer Scheels added');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('updates a customer with one success toast', async () => {
    api.post.mockResolvedValue({ status: 'success', message: 'Record updated' });
    await renderProvider();
    toast.success.mockClear();
    await act(async () => {
      await ctx.actions.updateCustomer('CUST-010', { customer_name: 'Scheels', region: 'Midwest' });
    });
    expect(api.post).toHaveBeenCalledWith('/forecast/update', {
      table: 'customers', id: 'CUST-010', updates: { customer_name: 'Scheels', region: 'Midwest' },
    }, quietRequest);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.success.mock.calls[0][0]).toBe('Customer Scheels saved');
  });

  it("shows the server's reason once when saving fails, and rethrows for the form", async () => {
    const failure = Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { detail: 'Customer CUST-010 already exists' } },
    });
    failure.userMessage = 'Customer CUST-010 already exists';
    api.post.mockRejectedValue(failure);
    await renderProvider();
    toast.success.mockClear();
    let thrown = null;
    await act(async () => {
      try {
        await ctx.actions.createCustomer({ customer_id: 'CUST-010', customer_name: 'Scheels' });
      } catch (err) {
        thrown = err;
      }
    });
    expect(thrown).toBe(failure);
    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0][0]).toBe('Could not create customer: Customer CUST-010 already exists');
  });
});
