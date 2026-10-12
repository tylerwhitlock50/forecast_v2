jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

import { toForm, fromForm } from '../components/AssumptionsPanel';

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
