import React, { useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { ForecastProvider } from './context/ForecastContext';
import { ConfirmProvider } from './components/Common/ConfirmDialog';
import GlobalLoadingBar from './components/Common/GlobalLoadingBar';
import MainNavigation from './components/Navigation/MainNavigationNew';
import ScenarioBar from './components/Navigation/ScenarioBar';
import './App.css';

// Module components
import RevenueForecasting from './components/Modules/RevenueForecasting/RevenueForecastingNew';
import CostManagement from './components/Modules/CostManagement/CostManagementNew';
import CustomerManagement from './components/Modules/CustomerManagement/CustomerManagementNew';
import ProductManagement from './components/Modules/ProductManagement/ProductManagementNew';
import ProductDetail from './components/Modules/ProductManagement/ProductDetail';
import MachineManagement from './components/Modules/MachineManagement/MachineManagementNew';
import RouterManagement from './components/Modules/RouterManagement/RouterManagementNew';
import BOMManagement from './components/Modules/BOMManagement/BOMManagementNew';
import LaborRateManagement from './components/Modules/LaborRateManagement/LaborRateManagementNew';
import PayrollManagement from './components/Modules/PayrollManagement/PayrollManagementNew';
import ExpenseManagement from './components/Modules/ExpenseManagement/ExpenseManagementNew';
import LoanManagement from './components/Modules/LoanManagement/LoanManagementNew';
import ReportingDashboard from './components/Modules/ReportingAnalysis/ReportingDashboard';
import ScenarioComparison from './components/Modules/ReportingAnalysis/ScenarioComparison';
import ScenariosPage from './components/Modules/Scenarios/ScenariosPage';
import DataImportPage from './components/Modules/DataImport/DataImportPage';
import PricingPage from './components/Modules/Pricing/PricingPage';
import CogsLaborForecast from './components/Modules/ReportingAnalysis/CogsLaborForecast';

const AppLayout = ({ children }) => {
  const [navCollapsed, setNavCollapsed] = useState(false);

  return (
    <div className="app-layout">
      <MainNavigation
        isCollapsed={navCollapsed}
        onToggle={() => setNavCollapsed(!navCollapsed)}
      />

      <div className={`main-content ${navCollapsed ? 'nav-collapsed' : ''}`}>
        <ScenarioBar />
        {children}
      </div>
    </div>
  );
};

function App() {
  return (
    <ForecastProvider>
      <ConfirmProvider>
      <Router>
        <div className="App">
          <GlobalLoadingBar />
          <AppLayout>
            <Routes>
              <Route path="/" element={<Navigate to="/sales-forecast" replace />} />

              {/* Getting started: one place to import every kind of data */}
              <Route path="/import" element={<DataImportPage />} />

              {/* Scenarios */}
              <Route path="/scenarios" element={<ScenariosPage />} />

              {/* Revenue Planning */}
              <Route path="/customers" element={<CustomerManagement />} />
              <Route path="/products" element={<ProductManagement />} />
              <Route path="/products/:id" element={<ProductDetail />} />
              <Route path="/sales-forecast" element={<RevenueForecasting />} />
              <Route path="/pricing" element={<PricingPage />} />

              {/* Manufacturing Setup */}
              <Route path="/machines" element={<MachineManagement />} />
              <Route path="/routing" element={<RouterManagement />} />
              <Route path="/bom" element={<BOMManagement />} />
              <Route path="/labor-rates" element={<LaborRateManagement />} />

              {/* Cost Management */}
              <Route path="/cost-management" element={<CostManagement />} />

              {/* Resource Planning */}
              <Route path="/payroll" element={<PayrollManagement />} />

              {/* Financial Planning */}
              <Route path="/expenses" element={<ExpenseManagement />} />
              <Route path="/loans" element={<LoanManagement />} />

              {/* Reporting & Analysis */}
              <Route path="/reporting" element={<ReportingDashboard />} />
              <Route path="/reporting/comparison" element={<ScenarioComparison />} />
              <Route path="/reporting/cogs-labor" element={<CogsLaborForecast />} />

              <Route path="*" element={<Navigate to="/sales-forecast" replace />} />
            </Routes>
          </AppLayout>
          
          {/* Toast notifications */}
          <Toaster
            position="top-right"
            toastOptions={{
              duration: 2000,
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
                },
                duration: 2000
              },
              error: {
                iconTheme: {
                  primary: '#EF4444',
                  secondary: '#fff'
                },
                duration: 3000
              }
            }}
          />
        </div>
      </Router>
      </ConfirmProvider>
    </ForecastProvider>
  );
}

export default App; 