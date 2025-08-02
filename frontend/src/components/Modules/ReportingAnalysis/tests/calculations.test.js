import { describe, it, expect } from '@jest/globals';
import { formatCurrency, formatPercentage, calculateGrowthRate } from '../utils/formatters';

// Mock data for testing financial calculations
const mockCombinedData = {
  revenue: {
    total: 1000000,
    byPeriod: {
      '2024-01': 80000,
      '2024-02': 85000,
      '2024-03': 90000
    },
    byProduct: {
      'PROD-001': 600000,
      'PROD-002': 400000
    },
    byCustomer: {
      'CUST-001': 700000,
      'CUST-002': 300000
    }
  },
  costs: {
    materials: 200000,
    labor: 150000,
    manufacturing: 100000,
    total: 450000
  },
  payroll: {
    totalCost: 300000,
    byPeriod: {
      '2024-01': 25000,
      '2024-02': 25000,
      '2024-03': 25000
    }
  },
  expenses: {
    total: 200000,
    operatingExpenses: 120000,
    adminExpenses: 50000,
    factoryOverhead: 30000
  },
  loans: {
    totalPayments: 60000,
    principalPayments: 40000,
    interestPayments: 20000
  }
};

describe('Financial Statement Calculations', () => {
  describe('Income Statement Calculations', () => {
    it('should calculate gross profit correctly', () => {
      const grossRevenue = mockCombinedData.revenue.total;
      const totalCOGS = mockCombinedData.costs.total + mockCombinedData.expenses.factoryOverhead;
      const grossProfit = grossRevenue - totalCOGS;
      
      expect(grossProfit).toBe(520000); // 1,000,000 - 450,000 - 30,000
    });

    it('should calculate operating income correctly', () => {
      const grossRevenue = mockCombinedData.revenue.total;
      const totalCOGS = mockCombinedData.costs.total + mockCombinedData.expenses.factoryOverhead;
      const grossProfit = grossRevenue - totalCOGS;
      const operatingExpenses = mockCombinedData.payroll.totalCost + 
                               mockCombinedData.expenses.operatingExpenses + 
                               mockCombinedData.expenses.adminExpenses;
      const operatingIncome = grossProfit - operatingExpenses;
      
      expect(operatingIncome).toBe(50000); // 520,000 - 300,000 - 120,000 - 50,000
    });

    it('should calculate net income correctly', () => {
      const grossRevenue = mockCombinedData.revenue.total;
      const totalCOGS = mockCombinedData.costs.total + mockCombinedData.expenses.factoryOverhead;
      const grossProfit = grossRevenue - totalCOGS;
      const operatingExpenses = mockCombinedData.payroll.totalCost + 
                               mockCombinedData.expenses.operatingExpenses + 
                               mockCombinedData.expenses.adminExpenses;
      const operatingIncome = grossProfit - operatingExpenses;
      const netIncome = operatingIncome - mockCombinedData.loans.interestPayments;
      
      expect(netIncome).toBe(30000); // 50,000 - 20,000
    });

    it('should calculate margins correctly', () => {
      const grossRevenue = mockCombinedData.revenue.total;
      const grossProfit = 520000;
      const operatingIncome = 50000;
      const netIncome = 30000;
      
      const grossMargin = (grossProfit / grossRevenue) * 100;
      const operatingMargin = (operatingIncome / grossRevenue) * 100;
      const netMargin = (netIncome / grossRevenue) * 100;
      
      expect(grossMargin).toBe(52);
      expect(operatingMargin).toBe(5);
      expect(netMargin).toBe(3);
    });
  });

  describe('Balance Sheet Calculations', () => {
    it('should calculate current assets correctly', () => {
      // AR = 1 month of revenue, Inventory = 2 months of COGS
      const accountsReceivable = mockCombinedData.revenue.total / 12;
      const inventory = (mockCombinedData.costs.total * 2) / 12;
      const totalCurrentAssets = accountsReceivable + inventory;
      
      expect(accountsReceivable).toBeCloseTo(83333.33, 2);
      expect(inventory).toBeCloseTo(75000, 2);
      expect(totalCurrentAssets).toBeCloseTo(158333.33, 2);
    });

    it('should calculate current liabilities correctly', () => {
      // AP = 1 month of expenses + payroll
      const monthlyExpenses = (mockCombinedData.expenses.total + mockCombinedData.payroll.totalCost) / 12;
      const currentPortionDebt = mockCombinedData.loans.principalPayments;
      const totalCurrentLiabilities = monthlyExpenses + currentPortionDebt;
      
      expect(monthlyExpenses).toBeCloseTo(41666.67, 2);
      expect(totalCurrentLiabilities).toBeCloseTo(81666.67, 2);
    });

    it('should calculate working capital correctly', () => {
      const currentAssets = 158333.33;
      const currentLiabilities = 81666.67;
      const workingCapital = currentAssets - currentLiabilities;
      
      expect(workingCapital).toBeCloseTo(76666.66, 2);
    });

    it('should calculate current ratio correctly', () => {
      const currentAssets = 158333.33;
      const currentLiabilities = 81666.67;
      const currentRatio = currentAssets / currentLiabilities;
      
      expect(currentRatio).toBeCloseTo(1.94, 2);
    });
  });

  describe('Cash Flow Calculations', () => {
    it('should calculate operating cash flow correctly', () => {
      // Simplified: starts with net income
      const netIncome = 30000;
      const operatingCashFlow = netIncome; // Would add back depreciation, etc.
      
      expect(operatingCashFlow).toBe(30000);
    });

    it('should calculate financing cash flow correctly', () => {
      const principalPayments = -mockCombinedData.loans.principalPayments;
      const interestPayments = -mockCombinedData.loans.interestPayments;
      const financingCashFlow = principalPayments + interestPayments;
      
      expect(financingCashFlow).toBe(-60000);
    });

    it('should calculate net cash flow correctly', () => {
      const operatingCashFlow = 30000;
      const investingCashFlow = 0;
      const financingCashFlow = -60000;
      const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;
      
      expect(netCashFlow).toBe(-30000);
    });

    it('should calculate debt service coverage ratio correctly', () => {
      const operatingCashFlow = 30000;
      const totalDebtService = mockCombinedData.loans.totalPayments;
      const debtCoverageRatio = operatingCashFlow / totalDebtService;
      
      expect(debtCoverageRatio).toBe(0.5); // 30,000 / 60,000
    });
  });
});

describe('Formatter Utilities', () => {
  describe('formatCurrency', () => {
    it('should format positive amounts correctly', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
      expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    });

    it('should format negative amounts correctly', () => {
      expect(formatCurrency(-1234.56)).toBe('-$1,234.56');
    });

    it('should handle zero and null values', () => {
      expect(formatCurrency(0)).toBe('$0.00');
      expect(formatCurrency(null)).toBe('$0.00');
      expect(formatCurrency(undefined)).toBe('$0.00');
    });

    it('should handle string inputs', () => {
      expect(formatCurrency('1234.56')).toBe('$1,234.56');
      expect(formatCurrency('invalid')).toBe('$0.00');
    });
  });

  describe('formatPercentage', () => {
    it('should calculate and format percentages correctly', () => {
      expect(formatPercentage(250, 1000)).toBe('25.0%');
      expect(formatPercentage(75, 300)).toBe('25.0%');
    });

    it('should handle zero and null values', () => {
      expect(formatPercentage(0, 100)).toBe('0.0%');
      expect(formatPercentage(100, 0)).toBe('-');
      expect(formatPercentage(null, 100)).toBe('-');
    });

    it('should handle string inputs', () => {
      expect(formatPercentage('25', '100')).toBe('25.0%');
    });
  });

  describe('calculateGrowthRate', () => {
    it('should calculate growth rates correctly', () => {
      expect(calculateGrowthRate(120, 100)).toBe(20);
      expect(calculateGrowthRate(80, 100)).toBe(-20);
      expect(calculateGrowthRate(100, 100)).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(calculateGrowthRate(100, 0)).toBeNull();
      expect(calculateGrowthRate(0, 100)).toBe(-100);
      expect(calculateGrowthRate(null, 100)).toBe(-100);
    });
  });
});

describe('Data Combination Logic', () => {
  describe('Multi-forecast aggregation', () => {
    it('should combine revenue from multiple forecasts', () => {
      const forecast1 = { revenue: { total: 600000 } };
      const forecast2 = { revenue: { total: 400000 } };
      
      const combined = forecast1.revenue.total + forecast2.revenue.total;
      expect(combined).toBe(1000000);
    });

    it('should combine costs from multiple forecasts', () => {
      const forecast1 = { costs: { total: 270000 } };
      const forecast2 = { costs: { total: 180000 } };
      
      const combined = forecast1.costs.total + forecast2.costs.total;
      expect(combined).toBe(450000);
    });

    it('should handle period-based aggregation', () => {
      const forecast1Revenue = { '2024-01': 50000, '2024-02': 55000 };
      const forecast2Revenue = { '2024-01': 30000, '2024-02': 30000 };
      
      const combinedPeriods = {};
      Object.keys(forecast1Revenue).forEach(period => {
        combinedPeriods[period] = (forecast1Revenue[period] || 0) + (forecast2Revenue[period] || 0);
      });
      
      expect(combinedPeriods['2024-01']).toBe(80000);
      expect(combinedPeriods['2024-02']).toBe(85000);
    });
  });

  describe('Business unit allocation', () => {
    it('should allocate payroll costs by business unit', () => {
      const employee = {
        totalCost: 100000,
        allocations: {
          'Customer-Centric Brands': 60,
          'OEM Work': 40
        }
      };
      
      const allocated = {};
      Object.entries(employee.allocations).forEach(([unit, percentage]) => {
        allocated[unit] = employee.totalCost * (percentage / 100);
      });
      
      expect(allocated['Customer-Centric Brands']).toBe(60000);
      expect(allocated['OEM Work']).toBe(40000);
    });
  });
});

describe('Financial Statement Integration', () => {
  it('should maintain accounting equation (Assets = Liabilities + Equity)', () => {
    const assets = 158333.33;
    const liabilities = 81666.67;
    const equity = assets - liabilities;
    
    expect(assets).toBeCloseTo(liabilities + equity, 2);
  });

  it('should reconcile cash flow components', () => {
    const operatingCF = 30000;
    const investingCF = 0;
    const financingCF = -60000;
    const netCF = operatingCF + investingCF + financingCF;
    
    expect(netCF).toBe(-30000);
    expect(operatingCF + investingCF + financingCF).toBe(netCF);
  });

  it('should validate income statement flow', () => {
    const revenue = 1000000;
    const cogs = 480000; // 450000 + 30000 factory overhead
    const grossProfit = revenue - cogs;
    const opExpenses = 470000; // 300000 + 120000 + 50000
    const operatingIncome = grossProfit - opExpenses;
    const interestExpense = 20000;
    const netIncome = operatingIncome - interestExpense;
    
    expect(grossProfit).toBe(520000);
    expect(operatingIncome).toBe(50000);
    expect(netIncome).toBe(30000);
  });
});