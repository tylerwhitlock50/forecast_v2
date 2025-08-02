import { useState, useCallback, useMemo } from 'react';
import api from '../../../../lib/apiClient';
import { toast } from 'react-hot-toast';

export const useReporting = () => {
  const [combinedData, setCombinedData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Fetch combined data from multiple forecasts
  const fetchCombinedData = useCallback(async (forecastIds, period) => {
    if (!forecastIds || forecastIds.length === 0) return;

    setLoading(true);
    setError(null);

    try {
      // Fetch data from all modules for selected forecasts
      const dataPromises = forecastIds.map(async (forecastId) => {
        const [
          salesForecastRes,
          payrollRes,
          expensesRes,
          loansRes
        ] = await Promise.all([
          // Revenue and cost data from source tables (NEW - includes both revenue and COGS)
          api.get(`/source-data/sales-forecast?forecast_id=${forecastId}&start_period=${period.start}&end_period=${period.end}`, { suppressErrorToast: true }),
          // Payroll forecast data
          api.get('/payroll/forecast?periods=26', { suppressErrorToast: true }),
          // Expense forecast for the period
          api.get(`/expenses/forecast?start_period=${period.start}&end_period=${period.end}`, { suppressErrorToast: true }),
          // Loan cash flow projection
          api.get(`/loans/cash-flow?start_period=${period.start}&end_period=${period.end}`, { suppressErrorToast: true })
        ]);

        return {
          forecastId,
          salesForecast: salesForecastRes?.data || {},
          payroll: payrollRes?.data || {},
          expenses: expensesRes?.data || [],
          loans: loansRes?.data || {}
        };
      });

      const forecastData = await Promise.all(dataPromises);
      
      // Combine data from all selected forecasts
      const combined = combineMultipleForecastData(forecastData, period);
      setCombinedData(combined);

    } catch (err) {
      console.error('Error fetching combined data:', err);
      setError(err.message || 'Failed to fetch financial data');
      toast.error('Failed to load financial data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Calculate financial statements from combined data
  const calculateFinancialStatements = useCallback((data, period) => {
    if (!data) return { incomeStatement: null, balanceSheet: null, cashFlowStatement: null };

    try {
      const incomeStatement = calculateIncomeStatement(data, period);
      const balanceSheet = calculateBalanceSheet(data, period);
      const cashFlowStatement = calculateCashFlowStatement(data, period);

      return {
        incomeStatement,
        balanceSheet,
        cashFlowStatement
      };
    } catch (err) {
      console.error('Error calculating financial statements:', err);
      setError('Failed to calculate financial statements');
      return { incomeStatement: null, balanceSheet: null, cashFlowStatement: null };
    }
  }, []);

  return {
    combinedData,
    loading,
    error,
    fetchCombinedData,
    calculateFinancialStatements
  };
};

// Helper function to combine data from multiple forecasts
const combineMultipleForecastData = (forecastDataArray, period) => {
  const combined = {
    revenue: { total: 0, byPeriod: {}, byProduct: {}, byCustomer: {} },
    costs: { 
      materials: 0, 
      labor: 0, 
      manufacturing: 0, 
      total: 0,
      byProduct: {}
    },
    payroll: { 
      totalCost: 0, 
      byPeriod: {}, 
      byDepartment: {},
      byBusinessUnit: {}
    },
    expenses: {
      total: 0,
      byCategory: {},
      byPeriod: {},
      operatingExpenses: 0,
      adminExpenses: 0,
      factoryOverhead: 0
    },
    loans: {
      totalPayments: 0,
      principalPayments: 0,
      interestPayments: 0,
      byPeriod: {}
    },
    metadata: {
      forecastIds: forecastDataArray.map(f => f.forecastId),
      period,
      generatedAt: new Date().toISOString()
    }
  };

  // Combine revenue and cost data from sales forecast (NEW - single source)
  forecastDataArray.forEach(forecast => {
    if (forecast.salesForecast.sales_forecast) {
      forecast.salesForecast.sales_forecast.forEach(sale => {
        // Revenue data
        combined.revenue.total += sale.total_revenue || 0;
        
        // By period
        const period = sale.period;
        if (period) {
          combined.revenue.byPeriod[period] = (combined.revenue.byPeriod[period] || 0) + (sale.total_revenue || 0);
        }
        
        // By product
        const productId = sale.unit_id;
        if (productId) {
          combined.revenue.byProduct[productId] = (combined.revenue.byProduct[productId] || 0) + (sale.total_revenue || 0);
        }
        
        // By customer
        const customerId = sale.customer_id;
        if (customerId) {
          combined.revenue.byCustomer[customerId] = (combined.revenue.byCustomer[customerId] || 0) + (sale.total_revenue || 0);
        }
        
        // Cost data (from same record)
        combined.costs.materials += sale.material_cost || 0;
        combined.costs.labor += sale.labor_cost || 0;
        combined.costs.manufacturing += sale.machine_cost || 0;
        combined.costs.total += sale.total_cogs || 0;
        
        // By product costs
        if (productId) {
          if (!combined.costs.byProduct[productId]) {
            combined.costs.byProduct[productId] = {
              materials: 0,
              labor: 0,
              manufacturing: 0,
              total: 0
            };
          }
          combined.costs.byProduct[productId].materials += sale.material_cost || 0;
          combined.costs.byProduct[productId].labor += sale.labor_cost || 0;
          combined.costs.byProduct[productId].manufacturing += sale.machine_cost || 0;
          combined.costs.byProduct[productId].total += sale.total_cogs || 0;
        }
      });
    }
  });

  // Combine payroll data (use first forecast's payroll as it's company-wide)
  if (forecastDataArray.length > 0 && forecastDataArray[0].payroll.forecast) {
    forecastDataArray[0].payroll.forecast.forEach(period => {
      combined.payroll.totalCost += period.total_cost || 0;
      combined.payroll.byPeriod[period.date] = period.total_cost || 0;
      
      // By department and business unit
      if (period.employee_details) {
        period.employee_details.forEach(emp => {
          const dept = emp.department || 'Unassigned';
          combined.payroll.byDepartment[dept] = (combined.payroll.byDepartment[dept] || 0) + (emp.total_cost || 0);
          
          // Business unit allocations
          if (emp.allocations) {
            Object.entries(emp.allocations).forEach(([unit, percentage]) => {
              const allocatedCost = (emp.total_cost || 0) * (percentage / 100);
              combined.payroll.byBusinessUnit[unit] = (combined.payroll.byBusinessUnit[unit] || 0) + allocatedCost;
            });
          }
        });
      }
    });
  }

  // Combine expense data
  forecastDataArray.forEach(forecast => {
    if (Array.isArray(forecast.expenses)) {
      forecast.expenses.forEach(expense => {
        combined.expenses.total += expense.total_amount || 0;
        
        // By category
        const category = expense.category_type || 'Other';
        combined.expenses.byCategory[category] = (combined.expenses.byCategory[category] || 0) + (expense.total_amount || 0);
        
        // By period
        const period = expense.period;
        if (period) {
          combined.expenses.byPeriod[period] = (combined.expenses.byPeriod[period] || 0) + (expense.total_amount || 0);
        }
        
        // Categorize expenses
        if (expense.category_type === 'admin_expense') {
          combined.expenses.adminExpenses += expense.total_amount || 0;
        } else if (expense.category_type === 'factory_overhead') {
          combined.expenses.factoryOverhead += expense.total_amount || 0;
        } else {
          combined.expenses.operatingExpenses += expense.total_amount || 0;
        }
      });
    }
  });

  // Combine loan data
  forecastDataArray.forEach(forecast => {
    if (forecast.loans.projections) {
      forecast.loans.projections.forEach(projection => {
        combined.loans.totalPayments += projection.total_payment || 0;
        combined.loans.principalPayments += projection.total_principal || 0;
        combined.loans.interestPayments += projection.total_interest || 0;
        
        combined.loans.byPeriod[projection.period] = {
          totalPayment: projection.total_payment || 0,
          principal: projection.total_principal || 0,
          interest: projection.total_interest || 0
        };
      });
    }
  });

  return combined;
};

// Calculate Income Statement
const calculateIncomeStatement = (data, period) => {
  const grossRevenue = data.revenue.total;
  const totalCOGS = data.costs.total;
  const grossProfit = grossRevenue - totalCOGS;
  const grossMargin = grossRevenue > 0 ? (grossProfit / grossRevenue) * 100 : 0;

  // Operating expenses include payroll and operating expenses (exclude factory overhead from expenses as it's in COGS)
  const payrollExpenses = data.payroll.totalCost;
  const operatingExpenses = data.expenses.operatingExpenses + data.expenses.adminExpenses;
  const totalOperatingExpenses = payrollExpenses + operatingExpenses;
  
  const operatingIncome = grossProfit - totalOperatingExpenses;
  const operatingMargin = grossRevenue > 0 ? (operatingIncome / grossRevenue) * 100 : 0;

  // Interest expense from loans
  const interestExpense = data.loans.interestPayments;
  
  const netIncome = operatingIncome - interestExpense;
  const netMargin = grossRevenue > 0 ? (netIncome / grossRevenue) * 100 : 0;

  return {
    period,
    revenue: {
      grossRevenue,
      byPeriod: data.revenue.byPeriod,
      byProduct: data.revenue.byProduct,
      byCustomer: data.revenue.byCustomer
    },
    costOfGoodsSold: {
      materials: data.costs.materials,
      labor: data.costs.labor,
      manufacturing: data.costs.manufacturing,
      factoryOverhead: data.expenses.factoryOverhead,
      total: totalCOGS + data.expenses.factoryOverhead
    },
    grossProfit,
    grossMargin,
    operatingExpenses: {
      payroll: payrollExpenses,
      adminExpenses: data.expenses.adminExpenses,
      operatingExpenses: data.expenses.operatingExpenses,
      total: totalOperatingExpenses
    },
    operatingIncome,
    operatingMargin,
    otherExpenses: {
      interestExpense
    },
    netIncome,
    netMargin,
    metadata: data.metadata
  };
};

// Calculate Balance Sheet (simplified)
const calculateBalanceSheet = (data, period) => {
  // This is a simplified balance sheet focused on key operational data
  // In a full implementation, you'd need more detailed asset/liability tracking
  
  const currentAssets = {
    // Estimate accounts receivable as 1 month of revenue
    accountsReceivable: data.revenue.total / 12,
    // Estimate inventory as 2 months of COGS
    inventory: (data.costs.total * 2) / 12,
    total: 0
  };
  currentAssets.total = currentAssets.accountsReceivable + currentAssets.inventory;

  const currentLiabilities = {
    // Estimate accounts payable as 1 month of expenses
    accountsPayable: (data.expenses.total + data.payroll.totalCost) / 12,
    // Current portion of long-term debt
    currentPortionLongTermDebt: data.loans.principalPayments,
    total: 0
  };
  currentLiabilities.total = currentLiabilities.accountsPayable + currentLiabilities.currentPortionLongTermDebt;

  const workingCapital = currentAssets.total - currentLiabilities.total;

  return {
    period,
    assets: {
      currentAssets,
      // Add fixed assets, etc. as needed
      totalAssets: currentAssets.total
    },
    liabilities: {
      currentLiabilities,
      // Add long-term debt, etc. as needed
      totalLiabilities: currentLiabilities.total
    },
    equity: {
      // Simplified equity calculation
      retainedEarnings: currentAssets.total - currentLiabilities.total,
      totalEquity: currentAssets.total - currentLiabilities.total
    },
    workingCapital,
    metadata: data.metadata
  };
};

// Calculate Cash Flow Statement
const calculateCashFlowStatement = (data, period) => {
  // Operating cash flow starts with net income and adjusts for non-cash items
  const netIncome = data.revenue.total - data.costs.total - data.payroll.totalCost - data.expenses.total - data.loans.interestPayments;
  
  // Operating cash flow adjustments (simplified)
  const operatingCashFlow = netIncome; // In reality, you'd adjust for depreciation, changes in working capital, etc.

  // Investing cash flow (simplified - would include capital expenditures)
  const investingCashFlow = 0;

  // Financing cash flow
  const financingCashFlow = -data.loans.principalPayments; // Principal payments are cash outflows

  const netCashFlow = operatingCashFlow + investingCashFlow + financingCashFlow;

  return {
    period,
    operatingActivities: {
      netIncome,
      adjustments: {
        // Add depreciation, amortization, etc. as needed
      },
      operatingCashFlow
    },
    investingActivities: {
      capitalExpenditures: 0, // Add as needed
      investingCashFlow
    },
    financingActivities: {
      loanPayments: -data.loans.totalPayments,
      principalPayments: -data.loans.principalPayments,
      interestPayments: -data.loans.interestPayments,
      financingCashFlow
    },
    netCashFlow,
    byPeriod: {
      // Calculate monthly cash flows
      ...Object.keys(data.revenue.byPeriod).reduce((acc, period) => {
        const periodRevenue = data.revenue.byPeriod[period] || 0;
        const periodExpenses = (data.expenses.byPeriod[period] || 0) + (data.payroll.byPeriod[period] || 0);
        const periodLoanPayments = data.loans.byPeriod[period]?.totalPayment || 0;
        
        acc[period] = periodRevenue - periodExpenses - periodLoanPayments;
        return acc;
      }, {})
    },
    metadata: data.metadata
  };
};