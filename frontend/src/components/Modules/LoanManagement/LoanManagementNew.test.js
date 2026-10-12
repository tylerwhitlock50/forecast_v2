import React from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoanManagement from './LoanManagementNew';
import LoanModal from './LoanModalNew';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));
jest.mock('react-hot-toast', () => {
  const toast = jest.fn();
  toast.error = jest.fn();
  toast.success = jest.fn();
  return { toast };
});
jest.mock('../../Common/ConfirmDialog', () => ({ useConfirm: () => () => Promise.resolve(true) }));
const mockActions = { setLoading: jest.fn(), setError: jest.fn(), fetchAllData: jest.fn() };
jest.mock('../../../context/ForecastContext', () => ({ useForecast: () => ({ actions: mockActions }) }));

const loan = {
  loan_id: 'LEGACY', loan_name: 'Legacy term loan', lender: 'Bank', loan_type: 'term_loan', principal_amount: 1200,
  interest_rate: 0, loan_term_months: 12, start_date: '2026-01-01', payment_type: 'amortizing',
  payment_frequency: 'monthly', is_active: true, current_balance: 1100, next_payment_date: '2026-03-02',
  monthly_payment_amount: 100, payments_made: 1, payments_remaining: 2, total_interest_paid: 0,
  total_interest_remaining: 0,
};
const audit = {
  loans_checked: 1, loans_with_issues: 1, loans_affecting_statements: 1,
  loans: [{ loan_id: 'LEGACY', loan_name: 'Legacy term loan', lender: 'Bank', is_active: true, statement_impact: true,
    issues: ['date_drift', 'incomplete'], proposed_action: 'regenerate', summary: 'Stops early.', examples: [] }],
};
const regenPreview = {
  loan_id: 'LEGACY', preview: true, changed_fields: ['interest_rate'], action: 'regenerate',
  schedule: { regenerated: true, kept_paid: 1, kept: 1, removed: 2, added: 11, redated: 0 },
  before: { payments: 3, total_interest: 0, payoff_date: '2026-04-02' },
  after: { payments: 12, total_interest: 33.37, payoff_date: '2027-01-01' },
  kept_rows: [{ payment_id: 'P1', payment_number: 1, payment_date: '2026-01-31', payment_status: 'paid', recorded: true,
    payment_amount: 100, actual_payment_date: '2026-02-02', actual_payment_amount: 100, notes: 'Paid by ACH' }],
  removed_rows: [], new_rows: [], redated_rows: [], warnings: [],
};

beforeEach(() => {
  jest.clearAllMocks();
  api.get.mockImplementation((url) => {
    if (url === '/loans/') return Promise.resolve({ data: { loans: [loan] } });
    if (url === '/loans/summary') return Promise.resolve({ data: { total_loans: 1, active_loans: 1 } });
    if (url === '/loans/schedule-audit') return Promise.resolve({ data: audit });
    return Promise.resolve({ data: {} });
  });
});

const openEdit = async () => {
  render(<LoanManagement />);
  await waitFor(() => expect(screen.getByTestId('schedule-audit-banner')).toBeInTheDocument());
  fireEvent.click(screen.getByText('Loan Details'));
  fireEvent.click(await screen.findByText('Edit'));
};

// Let the reload after a save (loans, summary, audit) finish inside the test.
const settleReload = async (calls) => {
  await waitFor(() => expect(api.get).toHaveBeenCalledTimes(calls));
  await act(() => new Promise(resolve => setTimeout(resolve, 0)));
  await screen.findByText('Dates to review');
};

describe('LoanManagement', () => {
  it('shows the audit banner and marks the loan in the table', async () => {
    render(<LoanManagement />);
    expect(await screen.findByText('1 loan has a payment schedule to review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Loan Details'));
    expect(await screen.findByText('Dates to review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Review & repair'));
    expect(screen.getByText('Review & repair loan schedules')).toBeInTheDocument();
    await waitFor(() => expect(api.get).toHaveBeenCalledTimes(3));
  });

  it('previews a terms change and saves only after confirming', async () => {
    api.put.mockImplementation((url, body, config) => Promise.resolve(
      config?.params?.preview ? { data: regenPreview } : { data: { ...regenPreview, preview: false } }));
    await openEdit();
    fireEvent.change(screen.getByLabelText('Interest Rate * (%)'), { target: { value: '6' } });
    fireEvent.click(screen.getByText('Update Loan'));

    expect(await screen.findByText('Rebuild the payment schedule?')).toBeInTheDocument();
    expect(api.put).toHaveBeenCalledTimes(1);
    expect(api.put.mock.calls[0][2].params).toEqual({ preview: true });
    expect(api.put.mock.calls[0][1].interest_rate).toBe(6);
    expect(screen.getByText('Paid by ACH')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Save and rebuild schedule'));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(api.put.mock.calls[1][2]).toBeUndefined();
    await waitFor(() => expect(screen.queryByText('Rebuild the payment schedule?')).not.toBeInTheDocument());
    expect(mockActions.fetchAllData).toHaveBeenCalled();
    await settleReload(6);
  });

  it('saves a change that keeps the schedule without asking, and skips no-op saves', async () => {
    api.put.mockImplementation((url, body, config) => Promise.resolve({ data: {
      preview: Boolean(config?.params?.preview), changed_fields: body.loan_name === 'Legacy term loan' ? [] : ['loan_name'],
      schedule: { regenerated: false, kept_paid: 0, kept: 0, removed: 0, added: 0, redated: 0 },
    } }));
    await openEdit();
    fireEvent.click(screen.getByText('Update Loan'));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));   // preview only: nothing changed
    await waitFor(() => expect(screen.queryByText('Edit Loan')).not.toBeInTheDocument());

    fireEvent.click(screen.getByText('Edit'));
    fireEvent.change(screen.getByLabelText('Loan Name *'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByText('Update Loan'));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(3));
    expect(screen.queryByText('Rebuild the payment schedule?')).not.toBeInTheDocument();
    await settleReload(6);
  });
});

describe('LoanModal', () => {
  it('saves a 0% loan (0 is a rate, not a missing value)', () => {
    const onSave = jest.fn();
    render(<LoanModal loan={loan} onSave={onSave} onClose={() => {}} />);
    expect(screen.getByLabelText('Interest Rate * (%)')).toHaveValue(0);
    expect(screen.getByTestId('loan-terms-note')).toHaveTextContent(/Paid and recorded payments are kept/);
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ interest_rate: 0, loan_name: 'Legacy term loan' }));
  });

  it('shows the balloon fields for an amortizing loan and clears a removed balloon', () => {
    // The schedule now uses a balloon on amortizing loans too, so it must be visible and removable.
    const onSave = jest.fn();
    render(<LoanModal loan={{ ...loan, balloon_date: '2026-12-01', balloon_payment: 500 }} onSave={onSave}
                      onClose={() => {}} />);
    expect(screen.getByLabelText('Balloon Due Date')).toHaveValue('2026-12-01');
    expect(screen.getByTestId('balloon-note')).toHaveTextContent(/repays the balance still owed/);
    fireEvent.change(screen.getByLabelText('Balloon Due Date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Balloon Payment Amount ($)'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ balloon_date: '', balloon_payment: 0 }));
  });

  it('does not invent a balloon for a loan that has none', () => {
    const onSave = jest.fn();
    render(<LoanModal loan={loan} onSave={onSave} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ balloon_date: '', balloon_payment: null }));
  });

  it('refuses a term that is not whole quarters and a balloon after maturity, as the API does', () => {
    const onSave = jest.fn();
    render(<LoanModal loan={loan} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Payment Frequency'), { target: { value: 'quarterly' } });
    fireEvent.change(screen.getByLabelText('Loan Term * (months)'), { target: { value: '10' } });
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/whole number of quarters: use 9 or 12 months/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Loan Term * (months)'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('Balloon Due Date'), { target: { value: '2027-06-01' } });
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/on or before the loan's maturity \(Jan 1, 2027\)/)).toBeInTheDocument();
  });

  it('still requires a rate', () => {
    const onSave = jest.fn();
    render(<LoanModal loan={loan} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Interest Rate * (%)'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Update Loan'));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/enter 0 for an interest-free loan/)).toBeInTheDocument();
  });
});
