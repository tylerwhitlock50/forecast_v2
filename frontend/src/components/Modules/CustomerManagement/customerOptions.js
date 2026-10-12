// Suggestions for the customer form. Customer type is free text (it is matched
// by the price list and the discount rules), so the form suggests the types
// already in use first, then the usual channels.

import { canonicalChoice, suggestionList } from '../ProductManagement/productOptions';

export const DEFAULT_CUSTOMER_TYPES = ['Dealer', 'Distributor', 'Direct', 'OEM', 'Government', 'Export'];

export const DEFAULT_REGIONS = ['West', 'Midwest', 'South', 'Northeast', 'National', 'International'];

export const customerTypeOptions = (customers) => suggestionList((customers || []).map(c => c.customer_type), DEFAULT_CUSTOMER_TYPES);

export const regionOptions = (customers) => suggestionList((customers || []).map(c => c.region), DEFAULT_REGIONS);

/**
 * Trimmed value in the spelling already used ('dealer ' -> 'Dealer' when
 * customers already use 'Dealer'), so one channel never splits into
 * 'Dealer', 'dealer' and 'DEALER ' price groups.
 */
export const normalizeChoice = canonicalChoice;

/** Next free CUST-### id. */
export const nextCustomerId = (customers) => {
  let next = 1;
  (customers || []).forEach(c => {
    const m = /^CUST-(\d+)$/.exec(String(c?.customer_id || ''));
    if (m) next = Math.max(next, Number(m[1]) + 1);
  });
  return `CUST-${String(next).padStart(3, '0')}`;
};
