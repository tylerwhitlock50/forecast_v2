import {
  addMonthsToDay, auditBannerText, comparisonRows, describeAuditExample, describeScheduleChange,
  formatComparisonValue, isBlank, issueLabel, loanFormValues, loanTermErrors, needsSchedulePreview,
  paymentStatusLabel,
} from './loanScheduleUtils';

const preview = {
  schedule: { regenerated: true, kept_paid: 1, kept: 1, removed: 2, added: 11, redated: 0 },
  before: { payments: 3, total_interest: 0, total_payments: 300, payoff_date: '2026-04-02', next_payment_date: '2026-03-02' },
  after: { payments: 12, total_interest: 33.37, total_payments: 1233.37, payoff_date: '2027-01-01', next_payment_date: '2026-03-01' },
  new_rows: [{ payment_number: 2, payment_date: '2026-03-01' }, { payment_number: 12, payment_date: '2027-01-01' }],
};

describe('describeScheduleChange', () => {
  it('says history stays and what is replaced, with the new date span', () => {
    expect(describeScheduleChange(preview)).toEqual([
      '1 paid or recorded payment stays exactly as recorded.',
      '2 unpaid installments are replaced by 11 new installments (Mar 1, 2026 to Jan 1, 2027).',
    ]);
  });

  it('describes a re-date repair and a no-op', () => {
    expect(describeScheduleChange({ schedule: { regenerated: false, redated: 2, kept_paid: 1 } })).toEqual([
      '1 paid or recorded payment stays exactly as recorded.',
      '2 unpaid installments move to their calendar dates; amounts do not change.',
    ]);
    expect(describeScheduleChange({ schedule: { regenerated: false, redated: 0 } }))
      .toEqual(['The payment schedule does not change.']);
  });

  it('only asks for confirmation when the schedule is rebuilt', () => {
    expect(needsSchedulePreview(preview)).toBe(true);
    expect(needsSchedulePreview({ schedule: { regenerated: false } })).toBe(false);
    expect(needsSchedulePreview(undefined)).toBe(false);
  });
});

describe('comparisonRows', () => {
  it('compares payoff date and interest before and after', () => {
    const rows = Object.fromEntries(comparisonRows(preview).map(r => [r.key, r]));
    expect(rows.payoff).toMatchObject({ before: '2026-04-02', after: '2027-01-01', changed: true });
    expect(rows.interest).toMatchObject({ before: 0, after: 33.37, changed: true, kind: 'money' });
    expect(rows.owed).toBeUndefined();
  });

  it('shows what is still owed when the last installment does not pay the loan off', () => {
    const unpaid = {
      before: { payments: 12, payoff_date: null, last_payment_date: '2028-01-15', final_balance: 100000 },
      after: { payments: 12, payoff_date: '2028-01-15', last_payment_date: '2028-01-15', final_balance: 0 },
    };
    const rows = Object.fromEntries(comparisonRows(unpaid).map(r => [r.key, r]));
    expect(rows.payoff).toMatchObject({ before: null, after: '2028-01-15', changed: true });
    expect(rows.owed).toMatchObject({ before: 100000, after: 0, kind: 'money', changed: true });
    expect(formatComparisonValue(rows.payoff.before, 'date')).toBe('-');
  });
});

describe('loan form checks shared with the API', () => {
  it('adds calendar months with the day clamped to month end', () => {
    expect(addMonthsToDay('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDay('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsToDay('2027-01-01', 240)).toBe('2047-01-01');
    expect(addMonthsToDay('', 3)).toBeNull();
  });

  it('flags terms that are not whole periods and balloons outside the term', () => {
    const base = { loan_term_months: '12', payment_frequency: 'quarterly', start_date: '2027-01-15',
      principal_amount: '30000', balloon_date: '', balloon_payment: '' };
    expect(loanTermErrors(base)).toEqual({});
    expect(loanTermErrors({ ...base, loan_term_months: '10' }).loan_term_months).toMatch(/use 9 or 12 months/);
    expect(loanTermErrors({ ...base, loan_term_months: '2' }).loan_term_months).toMatch(/use 3 months/);
    expect(loanTermErrors({ ...base, payment_frequency: 'annually', loan_term_months: '18' }).loan_term_months)
      .toMatch(/whole number of years: use 12 or 24 months/);
    expect(loanTermErrors({ ...base, balloon_date: '2027-01-15' }).balloon_date).toMatch(/after start date/);
    expect(loanTermErrors({ ...base, balloon_date: '2028-02-01' }).balloon_date).toMatch(/maturity \(Jan 15, 2028\)/);
    expect(loanTermErrors({ ...base, balloon_date: '2028-01-15' })).toEqual({});
    expect(loanTermErrors({ ...base, balloon_payment: '30000.01' }).balloon_payment).toMatch(/more than the principal/);
  });
});

describe('audit text', () => {
  it('builds the banner only when loans need review', () => {
    expect(auditBannerText({ loans_with_issues: 0 })).toBeNull();
    expect(auditBannerText(null)).toBeNull();
    const one = auditBannerText({ loans_with_issues: 1, loans_affecting_statements: 1 });
    expect(one.title).toBe('1 loan has a payment schedule to review');
    expect(one.detail).toMatch(/wrong month/);
    expect(one.detail).toMatch(/Paid payments are never changed/);
    expect(auditBannerText({ loans_with_issues: 2, loans_affecting_statements: 1 }).detail).toMatch(/^1 of them was saved/);
    const dayOnly = auditBannerText({ loans_with_issues: 2, loans_affecting_statements: 0 });
    expect(dayOnly.title).toBe('2 loans have payment schedules to review');
    expect(dayOnly.detail).toMatch(/statements are not affected/);
  });

  it('labels issues and examples in plain words', () => {
    expect(issueLabel('wrong_month')).toBe('Payments in the wrong month');
    expect(issueLabel('something_new')).toBe('something new');
    expect(describeAuditExample({ payment_number: 2, stored_date: '2026-03-02', expected_date: '2026-03-01' }))
      .toBe('#2: Mar 2, 2026 should be Mar 1, 2026');
    expect(describeAuditExample({ payment_number: 3, stored_date: null, expected_date: '2026-04-01' }))
      .toBe('#3: no date should be Apr 1, 2026');
  });
});

describe('loan form values', () => {
  it('keeps a 0% rate as 0 so the form does not call it missing', () => {
    const values = loanFormValues({ loan_name: 'Shareholder loan', lender: 'Owner', interest_rate: 0,
      principal_amount: 5000, loan_term_months: 12, start_date: '2026-01-01T00:00:00', is_active: 1 });
    expect(values.interest_rate).toBe(0);
    expect(values.start_date).toBe('2026-01-01');
    expect(values.is_active).toBe(true);
    expect(values.balloon_payment).toBe('');
    expect(isBlank(values.interest_rate)).toBe(false);
    expect(isBlank('')).toBe(true);
    expect(isBlank('  ')).toBe(true);
  });

  it('labels statuses, treating rows with actuals as recorded', () => {
    expect(paymentStatusLabel({ payment_status: 'paid' })).toBe('Paid');
    expect(paymentStatusLabel({ payment_status: 'scheduled', recorded: true })).toBe('Recorded');
    expect(paymentStatusLabel({ payment_status: 'scheduled' })).toBe('Scheduled');
    expect(paymentStatusLabel({ payment_status: 'overdue' })).toBe('Overdue');
  });
});
