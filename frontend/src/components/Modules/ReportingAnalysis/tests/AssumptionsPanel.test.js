jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import api from '../../../../lib/apiClient';
import AssumptionsPanel, { toForm, fromForm } from '../components/AssumptionsPanel';

describe('AssumptionsPanel form mapping', () => {
  it('round-trips the excise tax payable days', () => {
    const form = toForm({ excise_payable_days: 45, income_tax_rate: 0.21, dso_days: 30 });
    expect(form.excise_payable_days).toBe('45');
    expect(form.income_tax_rate).toBe('21');
    const payload = fromForm(form);
    expect(payload.excise_payable_days).toBe(45);
    expect(payload.income_tax_rate).toBeCloseTo(0.21);
  });

  it('defaults a blank excise payable days to 30, not 0', () => {
    const payload = fromForm(toForm({}));
    expect(payload.excise_payable_days).toBe(30);
    expect(payload.dso_days).toBe(0);
    expect(payload.opening_equity).toBeNull();
  });
});

// UI-6: an approved and locked scenario's assumptions and its own capex
// cannot change (the server answers 409 SCENARIO_LOCKED). The panel says so
// once and disables what would be refused; company-wide capex stays editable.
const LOCKED_NOTE = 'Approved and locked: branch it to make changes';
const LOCK_MESSAGE = "Scenario '2027 Budget' is approved and locked: branch it to make changes, or unlock it with a reason.";

const assumptions = {
  forecast_id: 'F001', found: true, opening_period: '2026-12', opening_cash: 1000000, dso_days: 30, dio_days: 45,
  dpo_days: 30, excise_payable_days: 30, income_tax_rate: 0.21, minimum_cash_balance: 50000, notes: null,
};
const capex = [
  { capex_id: 'CAPEX-OWN', forecast_id: 'F001', asset_name: 'CNC mill', amount: 50000, purchase_period: '2027-02',
    useful_life_months: 60, salvage_value: 0, depreciation_method: 'straight_line', is_active: true },
  { capex_id: 'CAPEX-CO', forecast_id: null, asset_name: 'Forklift', category: 'Vehicles', amount: 30000,
    purchase_period: '2027-03', useful_life_months: 60, salvage_value: 0, depreciation_method: 'straight_line', is_active: true },
];

const renderPanel = async (props = {}) => {
  render(
    <MemoryRouter>
      <AssumptionsPanel forecastId="F001" forecastName="2027 Budget" period={{ start: '2027-01', end: '2027-12' }} {...props} />
    </MemoryRouter>
  );
  await screen.findByText('CNC mill');
  await waitFor(() => expect(screen.getByLabelText('DSO (days sales outstanding)')).toHaveValue(30));
};

const capexRow = (name) => screen.getByText(name).closest('tr');

describe('AssumptionsPanel on an approved and locked scenario (UI-6)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockImplementation((url) => Promise.resolve(url.startsWith('/reporting/capex')
      ? { data: { capex } }
      : { data: { assumptions, defaults: { ...assumptions, found: false } } }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => console.error.mockRestore());

  it('shows one locked note and disables the inputs, save, reset and the scenario’s own capex', async () => {
    await renderPanel({ locked: true });
    expect(screen.getAllByText(new RegExp(LOCKED_NOTE))).toHaveLength(1);
    expect(screen.getByTestId('assumptions-locked-note')).toHaveTextContent(LOCKED_NOTE);

    const inputs = document.querySelectorAll('input[id^="assump-"]');
    expect(inputs).toHaveLength(17);
    inputs.forEach(input => expect(input).toBeDisabled());
    expect(screen.getByRole('button', { name: 'Reset to defaults' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Save assumptions|Saved/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add capex' })).toBeDisabled();

    // The scenario's own capex row is read-only; the company-wide one is not.
    const own = within(capexRow('CNC mill'));
    expect(own.getByRole('button', { name: 'Edit' })).toBeDisabled();
    expect(own.getByRole('button', { name: 'Delete' })).toBeDisabled();
    const shared = within(capexRow('Forklift'));
    expect(shared.getByRole('button', { name: 'Edit' })).toBeEnabled();
    expect(shared.getByRole('button', { name: 'Delete' })).toBeEnabled();
    expect(shared.getByText('Company-wide')).toBeInTheDocument();
  });

  it('keeps a company-wide capex row company-wide when it is edited from a locked scenario', async () => {
    api.put.mockResolvedValue({ status: 'success', data: { capex_id: 'CAPEX-CO' } });
    await renderPanel({ locked: true });
    fireEvent.click(within(capexRow('Forklift')).getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Amount'), { target: { value: '32000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/reporting/capex/CAPEX-CO', expect.objectContaining({ amount: 32000, forecast_id: null })));
  });

  it('leaves a draft scenario editable, with no locked note', async () => {
    await renderPanel({ locked: false });
    expect(screen.queryByTestId('assumptions-locked-note')).not.toBeInTheDocument();
    document.querySelectorAll('input[id^="assump-"]').forEach(input => expect(input).toBeEnabled());
    expect(screen.getByRole('button', { name: 'Add capex' })).toBeEnabled();
    expect(within(capexRow('CNC mill')).getByRole('button', { name: 'Edit' })).toBeEnabled();
  });

  it('shows a refused save as one message: the server’s reason, no toast and no second error line', async () => {
    // The lock landed after the page loaded (another tab, another user).
    api.put.mockRejectedValue(Object.assign(new Error('Request failed with status code 409'), {
      response: { status: 409, data: { detail: LOCK_MESSAGE, code: 'SCENARIO_LOCKED' } },
      userMessage: LOCK_MESSAGE,
    }));
    await renderPanel({ locked: false });
    fireEvent.change(screen.getByLabelText('DSO (days sales outstanding)'), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save assumptions' }));
    await screen.findByText(LOCK_MESSAGE);
    expect(api.put).toHaveBeenCalledWith(
      '/reporting/assumptions?forecast_id=F001', expect.objectContaining({ dso_days: 45 }), { suppressErrorToast: true });
    expect(screen.getAllByText(/approved and locked|Failed to save/i)).toHaveLength(1);
  });
});
