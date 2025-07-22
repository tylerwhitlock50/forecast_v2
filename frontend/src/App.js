import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ForecastProvider } from './context/ForecastContext';
import MainNavigation from './components/Navigation/MainNavigationNew';
import ChatPanel from './components/ChatPanel';
import './App.css';

// Module components
import RevenueForecasting from './components/Modules/RevenueForecasting/RevenueForecastingNew';
import CostManagement from './components/Modules/CostManagement/CostManagementNew';
import CustomerManagement from './components/Modules/CustomerManagement/CustomerManagementNew';
import ProductManagement from './components/Modules/ProductManagement/ProductManagementNew';
import MachineManagement from './components/Modules/MachineManagement/MachineManagementNew';
import RouterManagement from './components/Modules/RouterManagement/RouterManagementNew';
import BOMManagement from './components/Modules/BOMManagement/BOMManagementNew';
import LaborRateManagement from './components/Modules/LaborRateManagement/LaborRateManagementNew';
import PayrollManagement from './components/Modules/PayrollManagement/PayrollManagementNew';
import ExpenseManagement from './components/Modules/ExpenseManagement/ExpenseManagementNew';
import LoanManagement from './components/Modules/LoanManagement/LoanManagementNew';
import Dashboard from './components/Dashboard';

// Import Shadcn UI components
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Button } from './components/ui/button';
import { Badge } from './components/ui/badge';

// Placeholder components for modules not yet implemented
const PlaceholderComponent = ({ title, description, icon = "🚧" }) => (
  <div className="min-h-screen bg-gray-50 p-6">
    <div className="max-w-4xl mx-auto">
      <div className="text-center mb-8">
        <div className="text-6xl mb-4">{icon}</div>
        <h1 className="text-3xl font-bold text-gray-900 mb-4">{title}</h1>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto leading-relaxed">
          {description}
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-orange-600">📊</span>
              Data Management
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Import and manage your data with our comprehensive tools.
            </p>
            <Button variant="outline" className="w-full">
              Learn More
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-orange-600">📈</span>
              Analytics
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Get insights and analytics to make informed decisions.
            </p>
            <Button variant="outline" className="w-full">
              Explore
            </Button>
          </CardContent>
        </Card>

        <Card className="hover:shadow-lg transition-shadow">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="text-orange-600">⚙️</span>
              Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-gray-600 mb-4">
              Configure settings and preferences for optimal performance.
            </p>
            <Button variant="outline" className="w-full">
              Configure
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-8 bg-orange-50 border-orange-200">
        <CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Badge variant="secondary" className="bg-orange-100 text-orange-800">
              Coming Soon
            </Badge>
            <p className="text-orange-800 font-medium">
              This module is under development and will be available soon.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>
);

// Module placeholder components
const ProductCustomerSetup = () => (
  <PlaceholderComponent 
    title="Product & Customer Setup" 
    description="Manage your product catalog and customer database. Create product SKUs, define customer segments, and set up the foundational data for your revenue forecasting."
    icon="📦"
  />
);

const SegmentAnalysis = () => (
  <PlaceholderComponent 
    title="Segment Analysis" 
    description="Analyze revenue performance across different customer segments. Compare segment metrics, identify trends, and optimize your forecasting strategy."
    icon="📊"
  />
);

// BillOfMaterials now uses actual BOMManagement component
// const BillOfMaterials = () => (
//   <PlaceholderComponent 
//     title="Bill of Materials" 
//     description="Configure material costs and BOM calculations for your products. Set up component hierarchies and manage cost structures."
//   />
// );

// Work Routing and Machine Utilization now use actual components
// const WorkRouting = () => (
//   <PlaceholderComponent 
//     title="Work Routing" 
//     description="Define manufacturing processes and work routing steps. Configure machine assignments, cycle times, and labor requirements."
//   />
// );

// const MachineUtilization = () => (
//   <PlaceholderComponent 
//     title="Machine Utilization" 
//     description="Monitor machine capacity and utilization rates. Track performance metrics and optimize production scheduling."
//   />
// );

// PayrollAllocation is now implemented as PayrollManagement

const DepartmentManagement = () => (
  <PlaceholderComponent 
    title="Department Management" 
    description="Organize your workforce by departments and cost centers. Define reporting structures and budget allocations."
    icon="🏢"
  />
);

const LaborAnalysis = () => (
  <PlaceholderComponent 
    title="Labor Analysis" 
    description="Analyze labor costs and productivity metrics. Track efficiency trends and identify optimization opportunities."
    icon="👥"
  />
);

// LaborRates now uses actual LaborRateManagement component
// const LaborRates = () => (
//   <PlaceholderComponent 
//     title="Labor Rates Management" 
//     description="Manage labor rates and categories. Define hourly rates, overtime policies, and labor cost structures for accurate costing."
//   />
// );

const UnitManagement = () => (
  <PlaceholderComponent 
    title="Unit Management" 
    description="Manage product units and finished goods. Configure unit specifications, pricing, and product catalog information."
    icon="📦"
  />
);

// LoanSchedules now uses actual LoanManagement component

const CashFlow = () => (
  <PlaceholderComponent 
    title="Cash Flow" 
    description="Monitor cash flow projections and liquidity management. Analyze working capital requirements and financial health."
    icon="💰"
  />
);

const IncomeStatement = () => (
  <PlaceholderComponent 
    title="Income Statement" 
    description="Generate comprehensive income statements from your forecast data. View consolidated financial projections and performance metrics."
    icon="📊"
  />
);

const ScenarioAnalysis = () => (
  <PlaceholderComponent 
    title="Scenario Analysis" 
    description="Compare different forecast scenarios side-by-side. Analyze best case, worst case, and base case projections."
    icon="📈"
  />
);

const DataCompleteness = () => (
  <PlaceholderComponent 
    title="Data Completeness" 
    description="Monitor data quality and completeness across all modules. Identify missing information and validation errors."
    icon="✅"
  />
);

const BulkImport = () => (
  <PlaceholderComponent 
    title="Bulk Import" 
    description="Import large datasets from CSV, Excel, or other formats. Batch process your forecasting data efficiently."
    icon="📥"
  />
);

const Export = () => (
  <PlaceholderComponent 
    title="Export" 
    description="Export your forecast data and reports in various formats. Generate professional presentations and documentation."
    icon="📤"
  />
);

// Main App Layout Component
const AppLayout = ({ children }) => {
  const [navCollapsed, setNavCollapsed] = useState(false);
  const [chatExpanded, setChatExpanded] = useState(false);

  return (
    <div className="app-layout">
      <MainNavigation 
        isCollapsed={navCollapsed}
        onToggle={() => setNavCollapsed(!navCollapsed)}
      />
      
      {/* Floating Hamburger Menu Button - Always Visible */}
      <button
        onClick={() => setNavCollapsed(!navCollapsed)}
        className="fixed top-4 left-4 z-50 h-12 w-12 bg-orange-600 hover:bg-orange-700 text-white rounded-lg shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-105 lg:hidden"
        title={navCollapsed ? "Show Navigation" : "Hide Navigation"}
      >
        <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      
      <div 
        className={`main-content ${navCollapsed ? 'nav-collapsed' : ''}`}
      >
        {children}
      </div>
      
      {/* Chat Panel - positioned as fixed overlay */}
      <ChatPanel 
        expanded={chatExpanded}
        onToggle={() => setChatExpanded(!chatExpanded)}
      />
    </div>
  );
};

function App() {
  return (
    <ForecastProvider>
      <Router>
        <div className="App">
          <AppLayout>
            <Routes>
              {/* Default route */}
              <Route path="/" element={<Navigate to="/sales-forecast" replace />} />
              
              {/* Revenue Planning */}
              <Route path="/products-customers" element={<ProductCustomerSetup />} />
              <Route path="/customers" element={<CustomerManagement />} />
              <Route path="/products" element={<ProductManagement />} />
              <Route path="/sales-forecast" element={<RevenueForecasting />} />
              <Route path="/segments" element={<SegmentAnalysis />} />
              
              {/* Manufacturing Setup */}
              <Route path="/machines" element={<MachineManagement />} />
              <Route path="/routing" element={<RouterManagement />} />
              <Route path="/bom" element={<BOMManagement />} />
              <Route path="/labor-rates" element={<LaborRateManagement />} />
              
              {/* Cost Management */}
              <Route path="/cost-management" element={<CostManagement />} />
              <Route path="/units" element={<UnitManagement />} />
              
              {/* Resource Planning */}
              <Route path="/payroll" element={<PayrollManagement />} />
              <Route path="/departments" element={<DepartmentManagement />} />
              <Route path="/labor" element={<LaborAnalysis />} />
              
              {/* Financial Planning */}
              <Route path="/expenses" element={<ExpenseManagement />} />
              <Route path="/loans" element={<LoanManagement />} />
              <Route path="/cashflow" element={<CashFlow />} />
              
              {/* Reporting & Analysis */}
              <Route path="/income-statement" element={<IncomeStatement />} />
              <Route path="/scenarios" element={<ScenarioAnalysis />} />
              <Route path="/data-check" element={<DataCompleteness />} />
              
              {/* Utility Routes */}
              <Route path="/bulk-import" element={<BulkImport />} />
              <Route path="/export" element={<Export />} />
              
              {/* Legacy Dashboard Route */}
              <Route path="/dashboard" element={<Dashboard />} />
              
              {/* Catch-all route */}
              <Route path="*" element={<Navigate to="/sales-forecast" replace />} />
            </Routes>
          </AppLayout>
          
          {/* Toast notifications */}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 4000,
              style: {
                background: '#1f2937',
                color: '#fff',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500',
                border: '1px solid #374151'
              },
              success: {
                iconTheme: {
                  primary: '#10B981',
                  secondary: '#fff'
                }
              },
              error: {
                iconTheme: {
                  primary: '#EF4444',
                  secondary: '#fff'
                }
              },
              loading: {
                iconTheme: {
                  primary: '#c2410c',
                  secondary: '#fff'
                }
              }
            }}
          />
        </div>
      </Router>
    </ForecastProvider>
  );
}

export default App; 