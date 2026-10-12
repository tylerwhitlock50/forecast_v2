import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScheduleChangePreview from './ScheduleChangePreview';
import ScheduleRepairModal from './ScheduleRepairModal';
import ScheduleAuditBanner from './ScheduleAuditBanner';
import { PaymentScheduleTable } from './AmortizationScheduleModalNew';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({ __esModule: true, default: { get: jest.fn(), post: jest.fn(), put: jest.fn() } }));

const paidRow = {
  payment_id: 'L-1', payment_number: 1, payment_date: '2026-01-31', payment_amount: 100, principal_payment: 100,
  interest_payment: 0, remaining_balance: 1100, payment_status: 'paid', actual_payment_date: '2026-02-02',
  actual_payment_amount: 100, notes: 'Paid by ACH', recorded: true,
};
const newRows = Array.from({ length: 11 }, (_, i) => ({
  payment_id: `L-${i + 2}`, payment_number: i + 2, payment_date: `2026-${String(i + 3).padStart(2, '0')}-01`,
  payment_amount: 103.04, principal_payment: 97.54, interest_payment: 5.5, remaining_balance: 1000 - i * 90,
  payment_status: 'scheduled', recorded: false,
}));
const updatePreview = {
  action: 'regenerate',
  schedule: { regenerated: true, kept_paid: 1, kept: 1, removed: 2, added: 11, redated: 0 },
  before: { payments: 3, total_interest: 0, total_payments: 300, payoff_date: '2026-04-02', next_payment_date: '2026-03-02' },
  after: { payments: 12, total_interest: 33.37, total_payments: 1233.37, payoff_date: '2027-01-01', next_payment_date: '2026-03-01' },
  kept_rows: [paidRow], removed_rows: [], new_rows: newRows, redated_rows: [], warnings: [],
};

describe('ScheduleChangePreview', () => {
  it('shows the kept paid row, the new payoff and samples the new installments', () => {
    render(<ScheduleChangePreview preview={updatePreview} />);
    const kept = screen.getByTestId('kept-rows');
    expect(within(kept).getByText('Paid')).toBeInTheDocument();
    expect(within(kept).getByText('Paid by ACH')).toBeInTheDocument();
    expect(within(kept).getByText('Feb 2, 2026')).toBeInTheDocument();
    const comparison = screen.getByTestId('schedule-comparison');
    expect(within(comparison).getByText('Jan 1, 2027')).toBeInTheDocument();
    expect(within(comparison).getByText('$33.37')).toBeInTheDocument();
    expect(screen.getByText(/1 paid or recorded payment stays exactly as recorded/)).toBeInTheDocument();
    expect(screen.getByText(/\.\.\. 5 more installments \.\.\./)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Show all 11 installments'));
    expect(screen.queryByText(/more installments/)).not.toBeInTheDocument();
  });

  it('lists re-dated rows and warnings', () => {
    render(<ScheduleChangePreview preview={{
      ...updatePreview, action: 'redate', new_rows: [], warnings: ['The start date moved.'],
      schedule: { regenerated: false, kept_paid: 1, kept: 1, removed: 0, added: 0, redated: 1 },
      redated_rows: [{ payment_number: 2, from_date: '2026-03-02', to_date: '2026-03-01' }],
    }} />);
    const redated = screen.getByTestId('redated-rows');
    expect(within(redated).getByText('Mar 2, 2026')).toHaveClass('line-through');
    expect(within(redated).getByText('Mar 1, 2026')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('The start date moved.');
  });
});

describe('PaymentScheduleTable', () => {
  it('shades history rows and shows what was actually paid', () => {
    render(<PaymentScheduleTable
      payments={[paidRow, newRows[0]]}
      formatCurrency={(v) => `$${Number(v).toFixed(2)}`}
      formatDate={(d) => d}
    />);
    const history = screen.getByTestId('history-row');
    expect(history).toHaveClass('bg-green-50/70');
    expect(within(history).getByText('Paid')).toBeInTheDocument();
    expect(within(history).getByText('Paid 2026-02-02 - $100.00')).toBeInTheDocument();
    expect(within(screen.getByTestId('schedule-row')).getByText('Scheduled')).toBeInTheDocument();
  });
});

const audit = {
  loans_with_issues: 1, loans_affecting_statements: 0, loans_checked: 2,
  loans: [{
    loan_id: 'DRIFT', loan_name: 'Legacy term loan', lender: 'Bank', is_active: true, statement_impact: false,
    issues: ['date_drift'], proposed_action: 'redate', drifted: 2,
    summary: "2 unpaid payments not on the loan's calendar dates. 1 paid payment will be kept as recorded.",
    examples: [{ payment_number: 2, stored_date: '2026-03-02', expected_date: '2026-03-01', issue: 'date_drift' }],
  }],
};

describe('Schedule audit banner and repair modal', () => {
  beforeEach(() => jest.clearAllMocks());

  it('banner opens the review', () => {
    const onReview = jest.fn();
    const { rerender } = render(<ScheduleAuditBanner audit={audit} onReview={onReview} />);
    expect(screen.getByText('1 loan has a payment schedule to review')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Review & repair'));
    expect(onReview).toHaveBeenCalled();
    rerender(<ScheduleAuditBanner audit={{ loans_with_issues: 0, loans: [] }} onReview={onReview} />);
    expect(screen.queryByTestId('schedule-audit-banner')).not.toBeInTheDocument();
  });

  it('previews with a dry run, then repairs only on confirm', async () => {
    api.post.mockImplementation((url, body) => Promise.resolve({ data: {
      loan_id: 'DRIFT', loan_name: 'Legacy term loan', dry_run: body.dry_run, action: 'redate',
      schedule: { regenerated: false, kept_paid: 1, kept: 1, removed: 0, added: 0, redated: 2 },
      before: { payments: 3, payoff_date: '2026-04-02' }, after: { payments: 3, payoff_date: '2026-04-01' },
      kept_rows: [paidRow], removed_rows: [], new_rows: [], warnings: [],
      redated_rows: [{ payment_number: 2, from_date: '2026-03-02', to_date: '2026-03-01' },
        { payment_number: 3, from_date: '2026-04-02', to_date: '2026-04-01' }],
    } }));
    const onRepaired = jest.fn();
    render(<ScheduleRepairModal audit={audit} onClose={() => {}} onRepaired={onRepaired} />);
    expect(screen.getByText('#2: Mar 2, 2026 should be Mar 1, 2026')).toBeInTheDocument();
    expect(screen.getByText('Dates off the calendar')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Preview repair'));
    await waitFor(() => expect(screen.getByTestId('repair-preview')).toBeInTheDocument());
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.mock.calls[0][0]).toBe('/loans/DRIFT/repair-schedule');
    expect(api.post.mock.calls[0][1]).toEqual({ dry_run: true });
    expect(screen.getByText('Preview - nothing saved yet')).toBeInTheDocument();
    expect(onRepaired).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Repair this schedule'));
    await waitFor(() => expect(onRepaired).toHaveBeenCalled());
    expect(api.post.mock.calls[1][1]).toEqual({ dry_run: false });
  });

  it('says so when nothing is left to repair', () => {
    render(<ScheduleRepairModal audit={{ loans: [], loans_with_issues: 0 }} onClose={() => {}} />);
    expect(screen.getByTestId('repair-all-clear')).toBeInTheDocument();
  });
});
