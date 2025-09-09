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
import ReportingDashboard from './components/Modules/ReportingAnalysis/ReportingDashboard';
import ScenarioComparison from './components/Modules/ReportingAnalysis/ScenarioComparison';
import Dashboard from './components/Dashboard';

// Placeholder components for modules not yet implemented
const PlaceholderComponent = ({ title, description }) => (
  <div style={{ 
    padding: '2rem', 
    textAlign: 'center', 
    background: '#f8f9fa', 
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center'
  }}>
    <h2 style={{ color: '#2c3e50', marginBottom: '1rem' }}>{title}</h2>
    <p style={{ color: '#6c757d', fontSize: '1.1rem', maxWidth: '600px', lineHeight: '1.6' }}>
      {description}
    </p>
    <div style={{ 
      marginTop: '2rem', 
      padding: '1rem', 
      background: 'white', 
      borderRadius: '8px',
      border: '1px solid #e9ecef'
    }}>
      <p style={{ margin: 0, color: '#495057', fontSize: '0.9rem' }}>
        🚧 This module is under development and will be available soon.
      </p>
    </div>
  </div>
);

// Module placeholder components
const ProductCustomerSetup = () => (
  <PlaceholderComponent 
    title="Product & Customer Setup" 
    description="Manage your product catalog and customer database. Create product SKUs, define customer segments, and set up the foundational data for your revenue forecasting."
  />
);

const SegmentAnalysis = () => (
  <PlaceholderComponent 
    title="Segment Analysis" 
    description="Analyze revenue performance across different customer segments. Compare segment metrics, identify trends, and optimize your forecasting strategy."
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
  />
);

const LaborAnalysis = () => (
  <PlaceholderComponent 
    title="Labor Analysis" 
    description="Analyze labor costs and productivity metrics. Track efficiency trends and identify optimization opportunities."
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
  />
);

// LoanSchedules now uses actual LoanManagement component

const CashFlow = () => (
  <PlaceholderComponent 
    title="Cash Flow" 
    description="Monitor cash flow projections and liquidity management. Analyze working capital requirements and financial health."
  />
);

const IncomeStatement = () => (
  <PlaceholderComponent 
    title="Income Statement" 
    description="Generate comprehensive income statements from your forecast data. View consolidated financial projections and performance metrics. For the full reporting experience, visit the Financial Reports module."
  />
);

const ScenarioAnalysis = () => (
  <PlaceholderComponent 
    title="Scenario Analysis" 
    description="Compare different forecast scenarios side-by-side. Analyze best case, worst case, and base case projections. For comprehensive scenario mixing and analysis, visit the Financial Reports module."
  />
);

const DataCompleteness = () => (
  <PlaceholderComponent 
    title="Data Completeness" 
    description="Monitor data quality and completeness across all modules. Identify missing information and validation errors."
  />
);

const BulkImport = () => (
  <PlaceholderComponent 
    title="Bulk Import" 
    description="Import large datasets from CSV, Excel, or other formats. Batch process your forecasting data efficiently."
  />
);

const Export = () => (
  <PlaceholderComponent 
    title="Export" 
    description="Export your forecast data and reports in various formats. Generate professional presentations and documentation."
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
              <Route path="/reporting" element={<ReportingDashboard />} />
              <Route path="/reporting/comparison" element={<ScenarioComparison />} />
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
                background: '#363636',
                color: '#fff',
                borderRadius: '8px',
                fontSize: '14px',
                fontWeight: '500'
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
              }
            }}
          />
        </div>
      </Router>
    </ForecastProvider>
  );
}

export default App; 