import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { toast } from 'react-hot-toast';
import api from '../lib/apiClient';
import { ForecastProvider, useForecast } from './ForecastContext';

// UI-8: saving an employee showed the success toast twice (the API client's,
// from the server message, and the Payroll screen's). The context now asks
// the client for no toast of its own; the screen shows the one toast.
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

describe('ForecastContext employees: one toast per action', () => {
  beforeEach(() => {
    api.get.mockResolvedValue({ status: 'success', data: [] });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    console.error.mockRestore();
    console.log.mockRestore();
  });

  it('creates, updates and deletes an employee without an API-client toast', async () => {
    api.post.mockResolvedValue({ status: 'success', message: 'Employee created successfully', data: { employee_id: 'E1' } });
    api.put.mockResolvedValue({ status: 'success', message: 'Employee updated successfully', data: { employee_id: 'E1' } });
    api.delete.mockResolvedValue({ status: 'success', message: 'Employee deleted successfully', data: { employee_id: 'E1' } });
    await renderProvider();
    toast.success.mockClear();
    await act(async () => {
      await ctx.actions.createEmployee({ employee_name: 'Ben', department: 'Production', forecast_id: null });
      await ctx.actions.updateEmployee('E1', { employee_name: 'Ben', department: 'Production', labor_class: 'indirect' });
      await ctx.actions.deleteEmployee('E1');
    });
    expect(api.post).toHaveBeenCalledWith('/payroll/employees', expect.objectContaining({ employee_name: 'Ben' }), quietRequest);
    expect(api.put).toHaveBeenCalledWith('/payroll/employees/E1', expect.objectContaining({ labor_class: 'indirect' }), quietRequest);
    expect(api.delete).toHaveBeenCalledWith('/payroll/employees/E1', quietRequest);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
