import React from 'react';
import { render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import LoanSummary from './LoanSummaryNew';
import LoanTable from './LoanTableNew';
import { loanTypeLabel, paymentTypeLabel } from './loanLabels';

const summary = (overrides = {}) => ({
  total_loans: 2,
  active_loans: 2,
  total_principal: 500000,
  total_current_balance: 490500,
  total_monthly_payments: 9900,
  total_annual_payments: 118800,
  interest_rate_summary: { average: 7, minimum: 6.5, maximum: 7.5 },
  upcoming_payments: [],
  loans_by_type: [
    { loan_type: 'real_estate_loan', count: 1, total_balance: 300000, avg_interest_rate: 6.5 },
    { loan_type: 'line_of_credit', count: 1, total_balance: 190500, avg_interest_rate: 7.5 },
  ],
  ...overrides,
});

const loan = (overrides = {}) => ({
  loan_id: 'L1', loan_name: 'Building mortgage', lender: 'Bank A', loan_type: 'real_estate_loan',
  principal_amount: 500000, current_balance: 490500, interest_rate: 6.5, payment_type: 'interest_only',
  payment_frequency: 'monthly', start_date: '2026-01-01', monthly_payment_amount: 2708, is_active: true,
  ...overrides,
});

describe('loan labels (UI-10)', () => {
  it('maps every loan and payment type code to its label', () => {
    expect(loanTypeLabel('real_estate_loan')).toBe('Real Estate Loan');
    expect(loanTypeLabel('line_of_credit')).toBe('Line of Credit');
    expect(loanTypeLabel('sba_loan')).toBe('SBA Loan');
    expect(loanTypeLabel('term_loan')).toBe('Term Loan');
    expect(loanTypeLabel('equipment_loan')).toBe('Equipment Loan');
    expect(paymentTypeLabel('interest_only')).toBe('Interest Only');
    expect(paymentTypeLabel('amortizing')).toBe('Amortizing');
    // A code the map does not know yet still reads as words.
    expect(loanTypeLabel('bridge_term_loan')).toBe('Bridge Term Loan');
    expect(loanTypeLabel(null)).toBe('');
  });

  it('shows the labels in the overview Loans by Type card', () => {
    render(<LoanSummary summary={summary()} onRefresh={() => {}} />);
    expect(screen.getByText('Real Estate Loan')).toBeInTheDocument();
    expect(screen.getByText('Line of Credit')).toBeInTheDocument();
    expect(screen.queryByText(/estate_loan|of_credit/)).not.toBeInTheDocument();
    // No CSS capitalize: 'SBA' and 'of' render exactly as written.
    expect(screen.getByText('Line of Credit')).not.toHaveClass('capitalize');
  });

  it('shows the labels on the Loan Details badges', () => {
    render(
      <LoanTable
        loans={[loan(), loan({ loan_id: 'L2', loan_name: 'SBA 7(a)', loan_type: 'sba_loan', payment_type: 'amortizing' })]}
        onEdit={() => {}}
        onDelete={() => {}}
        onViewSchedule={() => {}}
      />
    );
    expect(screen.getByText('Real Estate Loan')).toBeInTheDocument();
    expect(screen.getByText('SBA Loan')).toBeInTheDocument();
    expect(screen.getByText('Interest Only')).toBeInTheDocument();
    expect(screen.getByText('Amortizing')).toBeInTheDocument();
    expect(screen.queryByText(/estate_loan|interest only|sba loan/)).not.toBeInTheDocument();
  });
});

describe('Portfolio Metrics (UI-4)', () => {
  it('shows principal repaid as a share of the original principal, not a debt-to-asset ratio', () => {
    render(<LoanSummary summary={summary()} onRefresh={() => {}} />);
    expect(screen.queryByText(/debt-to-asset/i)).not.toBeInTheDocument();
    const tile = screen.getByTestId('principal-repaid-pct');
    expect(within(tile).getByText('Principal Repaid')).toBeInTheDocument();
    expect(within(tile).getByText('% of original principal')).toBeInTheDocument();
    // (500,000 - 490,500) / 500,000 = 1.9%
    expect(within(tile).getByText('1.9%')).toBeInTheDocument();
  });

  it('reads 0.0% for a loan nothing has been repaid on yet', () => {
    render(<LoanSummary summary={summary({ total_current_balance: 500000 })} onRefresh={() => {}} />);
    expect(within(screen.getByTestId('principal-repaid-pct')).getByText('0.0%')).toBeInTheDocument();
  });
});
