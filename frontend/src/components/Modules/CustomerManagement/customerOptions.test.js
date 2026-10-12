import { customerTypeOptions, DEFAULT_CUSTOMER_TYPES, nextCustomerId, normalizeChoice, regionOptions } from './customerOptions';

describe('customer type and region suggestions', () => {
  test('existing types (as spelled in the data) plus the owner channels, without case duplicates', () => {
    const options = customerTypeOptions([
      { customer_type: 'OEM' },
      { customer_type: 'dealer' },
      { customer_type: 'Mass Merchant' },
      { customer_type: null },
    ]);
    expect(options.slice(0, 3)).toEqual(['dealer', 'Mass Merchant', 'OEM']);
    DEFAULT_CUSTOMER_TYPES.forEach(t => expect(options.map(o => o.toLowerCase())).toContain(t.toLowerCase()));
    expect(options.filter(o => o.toLowerCase() === 'dealer')).toHaveLength(1);
    expect(options.filter(o => o.toLowerCase() === 'oem')).toHaveLength(1);
  });

  test('an edited OEM / National customer keeps its values in the suggestions', () => {
    expect(customerTypeOptions([{ customer_type: 'OEM' }])).toContain('OEM');
    expect(regionOptions([{ region: 'National' }])).toContain('National');
    expect(regionOptions([])).toEqual(expect.arrayContaining(['West', 'Midwest', 'South', 'National']));
  });

  test('normalizeChoice maps "dealer " onto the existing "Dealer"', () => {
    expect(normalizeChoice('dealer ', ['Dealer', 'Distributor'])).toBe('Dealer');
    expect(normalizeChoice('Export', ['Dealer'])).toBe('Export');
  });

  test('nextCustomerId', () => {
    expect(nextCustomerId([{ customer_id: 'CUST-009' }, { customer_id: 'C-1001' }])).toBe('CUST-010');
    expect(nextCustomerId([])).toBe('CUST-001');
  });
});
