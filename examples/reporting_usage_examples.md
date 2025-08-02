# Reporting & Analysis Module - Usage Examples

This document demonstrates how to use the new Reporting & Analysis module to generate comprehensive financial statements from your forecasts.

## Example Scenarios

### Example 1: Single Product Line Analysis

**Scenario**: Analyze the financial performance of the Pickleball Paddles product line (Forecast F001).

**Steps**:
1. Navigate to the Reporting & Analysis module
2. Select "Individual Selection" mode
3. Check the box for "F001 - Pickleball Paddles Forecast"
4. Set reporting period to "2024-01" to "2024-12"
5. View generated Income Statement, Balance Sheet, and Cash Flow Statement

**Expected Results**:
- **Income Statement**: Shows revenue breakdown by months, COGS from materials/labor/manufacturing, payroll expenses allocated to this product line
- **Balance Sheet**: Estimated working capital based on inventory and receivables for this product line
- **Cash Flow**: Operating cash flow from this product line minus allocated debt service

### Example 2: Product Line Comparison (F001 + F002)

**Scenario**: Compare financial impact of combining Pickleball Paddles and Side-by-Side vehicle forecasts.

**Steps**:
1. Use "Quick Combinations" mode
2. Select "Combined Product Lines" (automatically selects F001 + F002)
3. Set period to current year
4. Compare the combined statements

**Expected Results**:
- **Combined Revenue**: $1,200,000 (F001: $600,000 + F002: $600,000)
- **Combined COGS**: Includes materials, labor, and manufacturing from both product lines
- **Payroll Allocation**: Business unit allocations split between "Customer-Centric Brands" and "OEM Work"

### Example 3: Scenario Analysis (Optimistic vs Conservative)

**Scenario**: Compare optimistic forecasting assumptions against conservative ones.

**Steps**:
1. Create two forecast scenarios:
   - F003: "Optimistic Market Conditions" 
   - F004: "Conservative Market Conditions"
2. Use "Quick Combinations" → "Scenario Comparison"
3. Generate separate reports for each scenario
4. Compare key metrics

**Expected Comparison**:

| Metric | Optimistic (F003) | Conservative (F004) | Variance |
|--------|------------------|-------------------|----------|
| Revenue | $1,500,000 | $800,000 | +$700,000 |
| Gross Margin | 55% | 45% | +10pp |
| Operating Income | $150,000 | $50,000 | +$100,000 |
| Net Cash Flow | $75,000 | -$25,000 | +$100,000 |

## API Usage Examples

### 1. Fetch Combined Data

```javascript
// Get combined data from multiple forecasts
const response = await api.get('/reporting/combined-forecast', {
  params: {
    forecast_ids: ['F001', 'F002'],
    start_period: '2024-01',
    end_period: '2024-12'
  }
});

const combinedData = response.data;
console.log('Total Revenue:', combinedData.revenue.total);
console.log('Revenue by Product:', combinedData.revenue.by_product);
```

### 2. Generate Financial Statements

```javascript
// Generate complete financial statements
const statements = await api.get('/reporting/financial-statements', {
  params: {
    forecast_ids: ['F001', 'F002', 'F003'],
    start_period: '2024-01',  
    end_period: '2024-12'
  }
});

const { income_statement, balance_sheet, cash_flow_statement } = statements.data;

// Income Statement metrics
console.log('Gross Profit:', income_statement.gross_profit);
console.log('Operating Margin:', income_statement.operating_margin);
console.log('Net Margin:', income_statement.net_margin);

// Balance Sheet metrics  
console.log('Working Capital:', balance_sheet.working_capital);
console.log('Current Ratio:', balance_sheet.current_ratio);

// Cash Flow metrics
console.log('Operating Cash Flow:', cash_flow_statement.operating_activities.operating_cash_flow);
console.log('Net Cash Flow:', cash_flow_statement.net_cash_flow);
```

### 3. Component Usage in React

```jsx
import React from 'react';
import { ReportingDashboard } from '../components/Modules/ReportingAnalysis';

const FinancialReportsPage = () => {
  return (
    <div className="p-6">
      <ReportingDashboard />
    </div>
  );
};

// Individual components can also be used standalone
import { IncomeStatement, ForecastSelector } from '../components/Modules/ReportingAnalysis';

const CustomReportPage = () => {
  const [selectedForecasts, setSelectedForecasts] = useState(['F001']);
  const [incomeData, setIncomeData] = useState(null);

  return (
    <div className="space-y-6">
      <ForecastSelector 
        scenarios={scenarios}
        selectedForecasts={selectedForecasts}
        onSelectionChange={setSelectedForecasts}
      />
      
      {incomeData && (
        <IncomeStatement 
          data={incomeData}
          period={{start: '2024-01', end: '2024-12'}}
          selectedForecasts={selectedForecasts}
          scenarios={scenarios}
        />
      )}
    </div>
  );
};
```

## Data Flow Architecture

### 1. Data Sources
- **Revenue**: `/forecast` endpoint filtered by `forecast_id`
- **Costs**: `/products/cost-summary` with material, labor, machine costs  
- **Payroll**: `/payroll/forecast` with business unit allocations
- **Expenses**: `/expenses/forecast` categorized by type
- **Loans**: `/loans/cash-flow` with payment schedules

### 2. Data Combination Process
```
Selected Forecasts → API Calls → Data Merging → Statement Calculations → UI Rendering
     ↓                ↓            ↓              ↓                    ↓
   F001, F002    Revenue/Cost    Combined      Income/Balance/    Dashboard
                 Data Fetching   Data Object   Cash Flow Calcs    Components
```

### 3. Statement Calculations

**Income Statement**:
```
Revenue (combined forecasts)
- Cost of Goods Sold (materials + labor + manufacturing + factory overhead)
= Gross Profit

Gross Profit  
- Operating Expenses (payroll + admin + operating expenses)
= Operating Income

Operating Income
- Interest Expense (from loans)
= Net Income
```

**Balance Sheet**:
```
Assets:
- Accounts Receivable (1 month of revenue)
- Inventory (2 months of COGS)
= Current Assets

Liabilities:
- Accounts Payable (1 month of expenses + payroll)
- Current Portion Long-term Debt (from loan payments)
= Current Liabilities

Equity:
- Retained Earnings (simplified calculation)
= Total Equity
```

**Cash Flow Statement**:
```
Operating Activities:
- Net Income (from Income Statement)
+ Non-cash adjustments (depreciation, etc.)
= Operating Cash Flow

Financing Activities:
- Loan Principal Payments
- Interest Payments
= Financing Cash Flow

Net Cash Flow = Operating + Investing + Financing
```

## Integration Points

### Frontend Context Integration
The reporting module integrates with the existing `ForecastContext`:

```javascript
const { scenarios, data } = useForecast();
const { fetchCombinedData, calculateFinancialStatements } = useReporting();

// Access existing scenarios for selection
const availableScenarios = Object.values(scenarios);

// Combine with existing data fetching patterns
useEffect(() => {
  if (selectedForecasts.length > 0) {
    fetchCombinedData(selectedForecasts, reportingPeriod);
  }
}, [selectedForecasts]);
```

### API Client Integration
Uses the existing `apiClient` with consistent error handling:

```javascript
// Leverages existing API patterns
const response = await api.get('/reporting/combined-forecast', {
  suppressErrorToast: true // For background loading
});

// Error handling follows existing patterns
try {
  const data = await fetchCombinedData();
} catch (error) {
  // Error toasts handled by apiClient
  console.error('Failed to load reporting data:', error);
}
```

## Testing Examples

### Unit Test Example
```javascript
describe('Financial Statement Calculations', () => {
  it('should calculate income statement correctly', () => {
    const mockData = {
      revenue: { total: 1000000 },
      costs: { total: 450000 },
      expenses: { factoryOverhead: 30000, admin: 50000 },
      payroll: { totalCost: 300000 }
    };
    
    const statement = calculateIncomeStatement(mockData);
    
    expect(statement.grossProfit).toBe(520000); // 1M - 450k - 30k
    expect(statement.operatingIncome).toBe(170000); // 520k - 300k - 50k
  });
});
```

### Integration Test Example  
```javascript
describe('Reporting API Integration', () => {
  it('should combine multiple forecasts correctly', async () => {
    const response = await api.get('/reporting/combined-forecast', {
      params: { forecast_ids: ['F001', 'F002'] }
    });
    
    expect(response.data.revenue.total).toBeGreaterThan(0);
    expect(response.data.costs.total).toBeGreaterThan(0);
    expect(Object.keys(response.data.revenue.by_product)).toHaveLength(2);
  });
});
```

## Key Features Delivered

### ✅ Mix & Match Forecasts
- Select individual forecasts (F001, F002, F003, etc.)
- Quick combinations for common scenarios
- Support for any combination of forecasts

### ✅ Comprehensive Financial Statements
- **Income Statement**: Revenue → COGS → Gross Profit → Operating Income → Net Income
- **Balance Sheet**: Assets = Liabilities + Equity with working capital analysis
- **Cash Flow Statement**: Operating, Investing, Financing activities

### ✅ Data Integration
- **Revenue**: Sales forecasts from selected scenarios
- **Cost of Sales**: Material, labor, manufacturing costs from BOM/routing
- **Payroll**: Employee costs with business unit allocations  
- **Expenses**: Categorized expenses with period allocation
- **Loan Payments**: Principal and interest from amortization schedules

### ✅ Interactive UI
- Tabbed interface for different statements
- Period selection with quick presets
- Show/hide percentage views
- Export capabilities (PDF, Excel ready)

### ✅ Calculation Accuracy
- Proper accounting equation validation (Assets = Liabilities + Equity)
- Cash flow reconciliation across activities
- Margin and ratio calculations
- Unit tested calculation logic

This reporting module provides a complete solution for generating professional financial statements from operational forecasting data, enabling comprehensive business analysis and scenario planning.