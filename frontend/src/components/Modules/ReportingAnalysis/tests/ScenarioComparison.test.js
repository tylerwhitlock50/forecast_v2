import { METRICS, withDerivedLines } from '../ScenarioComparison';

jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() }
}));

describe('ScenarioComparison lines', () => {
  it('labels revenue as net sales and lists commissions above payroll', () => {
    const keys = METRICS.map(m => m.key);
    expect(METRICS.find(m => m.key === 'revenue').label).toBe('Net sales');
    expect(keys.indexOf('commissions')).toBe(keys.indexOf('gross_profit') + 1);
  });

  it('derives commissions so the operating lines foot when the API omits them', () => {
    const row = { gross_profit: 2805549.49, payroll: 633032.4, expenses: 0, operating_income: 2093969.62 };
    expect(withDerivedLines(row).commissions).toBeCloseTo(78547.47, 2);
    expect(withDerivedLines({ ...row, commissions: 5 }).commissions).toBe(5);
  });
});
