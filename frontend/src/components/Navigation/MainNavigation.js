import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import ScenarioSelector from './ScenarioSelector';
import DatabaseSaveModal from '../DatabaseModals/DatabaseSaveModal';
import DatabaseLoadModal from '../DatabaseModals/DatabaseLoadModal';
import './MainNavigation.css';

const navigationModules = {
  "Revenue Planning": {
    icon: "📊",
    routes: {
      "Sales Forecasting": "/sales-forecast",
      "Customer Setup": "/customers",
      "Product Setup": "/products"
    }
  },
  "Manufacturing Setup": {
    icon: "🏭",
    routes: {
      "Machine Management": "/machines",
      "Work Routing": "/routing",
      "Bill of Materials": "/bom",
      "Labor Rates": "/labor-rates"
    }
  },
  "Cost Management": {
    icon: "⚙️",
    routes: {
      "Cost Overview": "/cost-management",
      "Unit Management": "/units"
    }
  },
  "Resource Planning": {
    icon: "👥",
    routes: {
      "Payroll Allocation": "/payroll",
      "Department Management": "/departments",
      "Labor Analysis": "/labor"
    }
  },
  "Financial Planning": {
    icon: "💰",
    routes: {
      "Expense Management": "/expenses",
      "Loan Schedules": "/loans",
      "Cash Flow": "/cashflow"
    }
  },
  "Reporting & Analysis": {
    icon: "📈",
    routes: {
      "Income Statement": "/income-statement",
      "Scenario Analysis": "/scenarios",
      "Data Completeness": "/data-check"
    }
  }
};

const MainNavigation = ({ isCollapsed, onToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [expandedModules, setExpandedModules] = useState({});
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const { data, loading, error, actions } = useForecast();

  // Ensure data is always an object with expected properties
  const safeData = data || {};

  const toggleModule = (moduleName) => {
    setExpandedModules(prev => ({
      ...prev,
      [moduleName]: !prev[moduleName]
    }));
  };

  const isRouteActive = (route) => {
    return location.pathname === route;
  };

  const getModuleStatus = (moduleName) => {
    // Ensure all data arrays exist and are actually arrays
    const forecasts = Array.isArray(safeData.forecasts) ? safeData.forecasts : [];
    const products = Array.isArray(safeData.products) ? safeData.products : [];
    const customers = Array.isArray(safeData.customers) ? safeData.customers : [];
    const machines = Array.isArray(safeData.machines) ? safeData.machines : [];
    const routers = Array.isArray(safeData.routers) ? safeData.routers : [];
    const bom = Array.isArray(safeData.bom) ? safeData.bom : [];
    const laborRates = Array.isArray(safeData.labor_rates) ? safeData.labor_rates : [];
    const employees = Array.isArray(safeData.employees) ? safeData.employees : [];
    const payroll = Array.isArray(safeData.payroll) ? safeData.payroll : [];
    const expenses = Array.isArray(safeData.expenses) ? safeData.expenses : [];
    const loans = Array.isArray(safeData.loans) ? safeData.loans : [];
    const validationErrors = Array.isArray(safeData.validation?.errors) ? safeData.validation.errors : [];

    // Calculate completion status for each module
    const completionStatus = {
      "Revenue Planning": {
        total: products.length + customers.length + forecasts.length,
        completed: forecasts.filter(f => f.customer_id && f.product_id && f.quantity > 0).length
      },
      "Manufacturing Setup": {
        total: machines.length + routers.length + bom.length + laborRates.length,
        completed: machines.filter(m => m.machine_rate > 0).length + 
                  routers.filter(r => r.machine_minutes > 0 || r.labor_minutes > 0).length +
                  bom.filter(b => b.material_cost > 0).length +
                  laborRates.filter(lr => lr.rate_amount > 0).length
      },
      "Cost Management": {
        total: products.length,
        completed: bom.filter(b => b.material_cost > 0).length
      },
      "Resource Planning": {
        total: employees.length,
        completed: payroll.filter(p => p.allocation_percentage > 0).length
      },
      "Financial Planning": {
        total: expenses.length + loans.length,
        completed: expenses.filter(e => e.amount > 0).length + loans.filter(l => l.principal > 0).length
      },
      "Reporting & Analysis": {
        total: 1,
        completed: validationErrors.length === 0 ? 1 : 0
      }
    };

    const status = completionStatus[moduleName] || { total: 0, completed: 0 };
    const percentage = status.total > 0 ? (status.completed / status.total) * 100 : 0;
    
    if (percentage >= 100) return 'complete';
    if (percentage >= 50) return 'partial';
    if (percentage > 0) return 'started';
    return 'empty';
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'complete': return '#10B981';
      case 'partial': return '#F59E0B';
      case 'started': return '#EF4444';
      case 'empty': return '#6B7280';
      default: return '#6B7280';
    }
  };

  // Handle database save
  const handleSaveDatabase = async (name) => {
    try {
      const response = await fetch('/api/database/save', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name }),
      });

      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(data.message);
      } else {
        toast.error('Failed to save database');
      }
    } catch (error) {
      console.error('Error saving database:', error);
      toast.error('Failed to save database');
    }
  };

  // Handle database load
  const handleLoadDatabase = async (filename) => {
    try {
      const response = await fetch('/api/database/load', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ filename }),
      });

      const data = await response.json();
      
      if (data.status === 'success') {
        toast.success(data.message);
        // Refresh all data after loading a new database
        await actions.fetchAllData();
      } else {
        toast.error('Failed to load database');
      }
    } catch (error) {
      console.error('Error loading database:', error);
      toast.error('Failed to load database');
    }
  };

  return (
    <nav className={`main-navigation ${isCollapsed ? 'collapsed' : ''}`}>
      <div className="nav-header">
        <button className="nav-toggle" onClick={onToggle}>
          {isCollapsed ? '☰' : '✕'}
        </button>
        {!isCollapsed && (
          <>
            <h1>Forecast AI</h1>
            <ScenarioSelector />
          </>
        )}
      </div>

      <div className="nav-content">
        {Object.entries(navigationModules).map(([moduleName, module]) => {
          const isExpanded = expandedModules[moduleName];
          const moduleStatus = getModuleStatus(moduleName);
          
          return (
            <div key={moduleName} className="nav-module">
              <div 
                className={`nav-module-header ${isExpanded ? 'expanded' : ''}`}
                onClick={() => toggleModule(moduleName)}
              >
                <div className="nav-module-info">
                  <span className="nav-module-icon">{module.icon}</span>
                  {!isCollapsed && (
                    <>
                      <span className="nav-module-title">{moduleName}</span>
                      <div 
                        className="nav-module-status"
                        style={{ backgroundColor: getStatusColor(moduleStatus) }}
                        title={`Status: ${moduleStatus}`}
                      />
                    </>
                  )}
                </div>
                {!isCollapsed && (
                  <span className={`nav-module-toggle ${isExpanded ? 'expanded' : ''}`}>
                    ▼
                  </span>
                )}
              </div>

              {isExpanded && !isCollapsed && (
                <div className="nav-module-routes">
                  {Object.entries(module.routes).map(([routeName, route]) => (
                    <button
                      key={route}
                      className={`nav-route ${isRouteActive(route) ? 'active' : ''}`}
                      onClick={() => navigate(route)}
                    >
                      {routeName}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Quick Actions */}
      {!isCollapsed && (
        <div className="nav-footer">
          <button 
            className="quick-action"
            onClick={() => navigate('/data-check')}
          >
            🔍 Data Check
          </button>
          <button 
            className="quick-action"
            onClick={() => setShowLoadModal(true)}
          >
            📥 Load Database
          </button>
          <button 
            className="quick-action"
            onClick={() => setShowSaveModal(true)}
          >
            💾 Save Database
          </button>
        </div>
      )}

      {/* Status Bar */}
      {!isCollapsed && (
        <div className="nav-status">
          <div className="status-item">
            <span className="status-label">Errors:</span>
            <span className={`status-value ${(safeData.validation?.errors || []).length > 0 ? 'error' : 'success'}`}>
              {(safeData.validation?.errors || []).length}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Last Updated:</span>
            <span className="status-value">
              {safeData.lastUpdated ? new Date(safeData.lastUpdated).toLocaleTimeString() : 'Never'}
            </span>
          </div>
        </div>
      )}

      {/* Database Modals */}
      <DatabaseSaveModal
        isOpen={showSaveModal}
        onClose={() => setShowSaveModal(false)}
        onSave={handleSaveDatabase}
      />
      
      <DatabaseLoadModal
        isOpen={showLoadModal}
        onClose={() => setShowLoadModal(false)}
        onLoad={handleLoadDatabase}
      />
    </nav>
  );
};

export default MainNavigation;