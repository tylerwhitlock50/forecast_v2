import { METRICS, withDerivedLines } from '../ScenarioComparison';
import { fillStatementLines } from '../hooks/useScenarioComparison';
import api from '../../../../lib/apiClient';

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

describe('ScenarioComparison below operating income', () => {
  it('lists interest, pre-tax income and income tax between operating income and net income', () => {
    const keys = METRICS.map(m => m.key);
    const from = keys.indexOf('operating_income');
    expect(keys.slice(from, keys.indexOf('net_income') + 1))
      .toEqual(['operating_income', 'interest_expense', 'pre_tax_income', 'income_tax', 'net_income']);
    expect(METRICS.find(m => m.key === 'income_tax')).toMatchObject({ label: 'Income tax', direction: 'expense' });
    ['gross_sales', 'total_sales_deductions', 'commissions'].forEach(k => expect(keys).toContain(k));
  });

  it('fills the lines from each scenario\'s income statement over the same window when the API omits them', async () => {
    api.get.mockImplementation((url) => {
      const id = new URLSearchParams(url.split('?')[1]).get('forecast_ids');
      if (id === 'F002') return Promise.reject(new Error('down'));
      return Promise.resolve({ status: 'success', data: { income_statement: { totals: { interest_expense: 10, pre_tax_income: 990, income_tax: 207.9 } } } });
    });
    const rows = [
      { forecast_id: 'F001', operating_income: 1000, net_income: 782.1 },
      { forecast_id: 'F002', operating_income: 500, net_income: 400 },
      { forecast_id: 'F003', operating_income: 1, net_income: 1, interest_expense: 0, pre_tax_income: 1, income_tax: 0 }
    ];
    const filled = await fillStatementLines(rows, { start_period: '2027-01', end_period: '2027-12' });
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(api.get.mock.calls[0][0]).toBe('/reporting/statements?forecast_ids=F001&start_period=2027-01&end_period=2027-12');
    expect(filled[0]).toMatchObject({ interest_expense: 10, pre_tax_income: 990, income_tax: 207.9 });
    expect(filled[1].income_tax).toBeUndefined();
    expect(filled[2]).toBe(rows[2]);
  });
});
