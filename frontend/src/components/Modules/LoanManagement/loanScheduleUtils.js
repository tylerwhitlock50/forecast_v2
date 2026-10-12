// Plain-language helpers for loan schedule previews, the legacy schedule
// audit and the loan form. Pure functions so they can be unit-tested.
import { formatDateOnly } from '../../../lib/dates';

export const formatMoney = (value, { cents = true } = {}) => {
  const n = Number(value);
  if (value === null || value === undefined || Number.isNaN(n)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(n);
};

export const formatDay = (value, fallback = '-') =>
  formatDateOnly(value, { year: 'numeric', month: 'short', day: 'numeric' }, fallback);

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const ISSUE_LABELS = {
  date_drift: 'Dates off the calendar',
  wrong_month: 'Payments in the wrong month',
  missing_date: 'Missing dates',
  out_of_order: 'Dates out of order',
  numbering_gap: 'Gaps in payment numbers',
  balance_break: "Balances don't add up",
  incomplete: 'Stops before the end of the term',
  no_schedule: 'No schedule saved',
  bad_start_date: 'Start date is not a date',
};

export const issueLabel = (code) => ISSUE_LABELS[code] || String(code || '').replace(/_/g, ' ');

/** Banner text for GET /loans/schedule-audit, or null when nothing needs review. */
export const auditBannerText = (audit) => {
  const count = audit?.loans_with_issues || 0;
  if (!count) return null;
  const affecting = audit.loans_affecting_statements || 0;
  const title = `${plural(count, 'loan')} ${count === 1 ? 'has a payment schedule' : 'have payment schedules'} to review`;
  const who = affecting === count
    ? (count === 1 ? 'It was' : 'They were')
    : `${affecting} of them ${affecting === 1 ? 'was' : 'were'}`;
  const detail = affecting
    ? `${who} saved before payments were dated on calendar months, `
      + 'so some payments land in the wrong month (or are missing) on the cash flow and balance sheet. '
      + 'Paid payments are never changed by a repair.'
    : 'Some unpaid payments are a day or two off their calendar dates. The statements are not affected, '
      + 'but repairing keeps the schedule tidy. Paid payments are never changed.';
  return { title, detail };
};

/** One example from the audit as "#2 due Mar 2, 2026 should be Mar 1, 2026". */
export const describeAuditExample = (example) => {
  if (!example) return '';
  const stored = example.stored_date ? formatDay(example.stored_date) : 'no date';
  return `#${example.payment_number}: ${stored} should be ${formatDay(example.expected_date)}`;
};

/** True when saving a loan edit would rebuild the payment schedule. */
export const needsSchedulePreview = (preview) => Boolean(preview?.schedule?.regenerated);

/** Sentences describing what a preview (loan edit or repair) does to the schedule. */
export const describeScheduleChange = (preview) => {
  const s = preview?.schedule;
  if (!s || (!s.regenerated && !s.redated)) return ['The payment schedule does not change.'];
  const lines = [];
  if (s.kept_paid) {
    lines.push(`${plural(s.kept_paid, 'paid or recorded payment')} ${s.kept_paid === 1 ? 'stays' : 'stay'} exactly as recorded.`);
  }
  if (s.regenerated) {
    const added = preview.new_rows || [];
    const span = added.length
      ? ` (${formatDay(added[0].payment_date)} to ${formatDay(added[added.length - 1].payment_date)})`
      : '';
    if (s.removed && s.added) {
      lines.push(`${plural(s.removed, 'unpaid installment')} ${s.removed === 1 ? 'is' : 'are'} replaced by ${plural(s.added, 'new installment')}${span}.`);
    } else if (s.added) {
      lines.push(`${plural(s.added, 'new installment')} ${s.added === 1 ? 'is' : 'are'} added${span}.`);
    } else if (s.removed) {
      lines.push(`${plural(s.removed, 'unpaid installment')} ${s.removed === 1 ? 'is' : 'are'} removed.`);
    }
  }
  if (s.redated) {
    lines.push(`${plural(s.redated, 'unpaid installment')} ${s.redated === 1 ? 'moves to its calendar date' : 'move to their calendar dates'}; amounts do not change.`);
  }
  return lines;
};

/** Before / after rows for the comparison table. */
export const comparisonRows = (preview) => {
  const before = preview?.before || {};
  const after = preview?.after || {};
  return [
    { key: 'payments', label: 'Installments', before: before.payments, after: after.payments, kind: 'count' },
    { key: 'next', label: 'Next unpaid installment', before: before.next_payment_date, after: after.next_payment_date, kind: 'date' },
    { key: 'payoff', label: 'Payoff date', before: before.payoff_date, after: after.payoff_date, kind: 'date' },
    { key: 'interest', label: 'Total interest', before: before.total_interest, after: after.total_interest, kind: 'money' },
    { key: 'total', label: 'Total of all payments', before: before.total_payments, after: after.total_payments, kind: 'money' },
  ].map(row => ({ ...row, changed: String(row.before ?? '') !== String(row.after ?? '') }));
};

export const formatComparisonValue = (value, kind) => {
  if (value === null || value === undefined || value === '') return '-';
  if (kind === 'money') return formatMoney(value);
  if (kind === 'date') return formatDay(value);
  return String(value);
};

/** Status label for a schedule row: Paid / Skipped / Recorded / Scheduled / Overdue. */
export const paymentStatusLabel = (row) => {
  const status = String(row?.payment_status || 'scheduled').toLowerCase();
  if (status === 'paid') return 'Paid';
  if (status === 'skipped') return 'Skipped';
  if (row?.recorded) return 'Recorded';
  if (status === 'overdue') return 'Overdue';
  return 'Scheduled';
};

/** Loan form values from a loan record; 0 (e.g. a 0% rate) stays 0, not blank. */
export const loanFormValues = (loan) => {
  const keep = (value) => (value === null || value === undefined ? '' : value);
  return {
    loan_name: keep(loan.loan_name),
    lender: keep(loan.lender),
    loan_type: loan.loan_type || 'term_loan',
    principal_amount: keep(loan.principal_amount),
    interest_rate: keep(loan.interest_rate),
    loan_term_months: keep(loan.loan_term_months),
    start_date: loan.start_date ? String(loan.start_date).slice(0, 10) : '',
    payment_type: loan.payment_type || 'amortizing',
    payment_frequency: loan.payment_frequency || 'monthly',
    balloon_payment: keep(loan.balloon_payment),
    balloon_date: loan.balloon_date ? String(loan.balloon_date).slice(0, 10) : '',
    description: keep(loan.description),
    collateral_description: keep(loan.collateral_description),
    guarantor: keep(loan.guarantor),
    loan_officer: keep(loan.loan_officer),
    account_number: keep(loan.account_number),
    is_active: loan.is_active !== undefined ? Boolean(loan.is_active) : true,
  };
};

/** True when a form value is missing (0 is a value). */
export const isBlank = (value) => value === '' || value === null || value === undefined
  || (typeof value === 'string' && value.trim() === '');
