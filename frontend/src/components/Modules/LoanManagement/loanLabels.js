// Display labels for the loan codes the API stores (loan_routes.py LOAN_TYPES
// and PAYMENT_TYPES). One map for every loan screen, so a code always reads
// the same way: 'real_estate_loan' -> 'Real Estate Loan', never
// 'real estate_loan'.

export const LOAN_TYPE_LABELS = {
  term_loan: 'Term Loan',
  line_of_credit: 'Line of Credit',
  sba_loan: 'SBA Loan',
  equipment_loan: 'Equipment Loan',
  real_estate_loan: 'Real Estate Loan',
};

export const PAYMENT_TYPE_LABELS = {
  amortizing: 'Amortizing',
  interest_only: 'Interest Only',
};

/** 'some_new_code' -> 'Some New Code' for a code the maps do not know yet. */
const titleCase = (code) => String(code || '')
  .split('_')
  .filter(Boolean)
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

export const loanTypeLabel = (code) => LOAN_TYPE_LABELS[code] || titleCase(code);

export const paymentTypeLabel = (code) => PAYMENT_TYPE_LABELS[code] || titleCase(code);
