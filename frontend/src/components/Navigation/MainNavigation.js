import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import ScenarioSelector from './ScenarioSelector';
import './MainNavigation.css';

const navigationModules = {
  "Revenue Planning": {
    icon: "📊",
    routes: {
      "Product & Customer Setup": "/products-customers",
      "Sales Forecasting": "/sales-forecast",
      "Segment Analysis": "/segments"
    }
  },
  "Cost Management": {
    icon: "⚙️",
    routes: {
      "Bill of Materials": "/bom",
      "Work Routing": "/routing",
      "Machine Utilization": "/machines"
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
  const { data, loading, error } = useForecast();

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
    // Calculate completion status for each module
    const completionStatus = {
      "Revenue Planning": {
        total: data.products.length + data.customers.length + data.forecasts.length,
        completed: data.forecasts.filter(f => f.customer_id && f.product_id && f.quantity > 0).length
      },
      "Cost Management": {
        total: data.products.length,
        completed: data.bom.filter(b => b.material_cost > 0).length
      },
      "Resource Planning": {
        total: data.employees.length,
        completed: data.payroll.filter(p => p.allocation_percentage > 0).length
      },
      "Financial Planning": {
        total: data.expenses.length + data.loans.length,
        completed: data.expenses.filter(e => e.amount > 0).length + data.loans.filter(l => l.principal > 0).length
      },
      "Reporting & Analysis": {
        total: 1,
        completed: data.validation.errors.length === 0 ? 1 : 0
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
            onClick={() => navigate('/bulk-import')}
          >
            📥 Bulk Import
          </button>
          <button 
            className="quick-action"
            onClick={() => navigate('/export')}
          >
            📤 Export
          </button>
        </div>
      )}

      {/* Status Bar */}
      {!isCollapsed && (
        <div className="nav-status">
          <div className="status-item">
            <span className="status-label">Errors:</span>
            <span className={`status-value ${data.validation.errors.length > 0 ? 'error' : 'success'}`}>
              {data.validation.errors.length}
            </span>
          </div>
          <div className="status-item">
            <span className="status-label">Last Updated:</span>
            <span className="status-value">
              {data.lastUpdated ? new Date(data.lastUpdated).toLocaleTimeString() : 'Never'}
            </span>
          </div>
        </div>
      )}
    </nav>
  );
};

export default MainNavigation;