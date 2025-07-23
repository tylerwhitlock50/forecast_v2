import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Card, CardContent } from '../ui/card';
import { cn } from '../../lib/utils';
import ScenarioSelector from './ScenarioSelectorNew';
import DatabaseSaveModal from '../DatabaseModals/DatabaseSaveModal';
import DatabaseLoadModal from '../DatabaseModals/DatabaseLoadModal';

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

  const getStatusVariant = (status) => {
    switch (status) {
      case 'complete': return 'success';
      case 'partial': return 'warning';
      case 'started': return 'destructive';
      case 'empty': return 'secondary';
      default: return 'secondary';
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
    <nav className={cn(
      "fixed left-0 top-0 h-full bg-background border-r border-border flex flex-col transition-all duration-300 ease-in-out z-40",
      isCollapsed ? "w-16" : "w-80"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="h-8 w-8 p-0"
        >
          {isCollapsed ? (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          ) : (
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          )}
        </Button>
        {!isCollapsed && (
          <div className="flex flex-col items-start">
            <h1 className="text-xl font-bold text-foreground">Forecast AI</h1>
            <div className="mt-2 w-full">
              <ScenarioSelector />
            </div>
          </div>
        )}
      </div>

      {/* Navigation Content */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {Object.entries(navigationModules).map(([moduleName, module]) => {
            const isExpanded = expandedModules[moduleName];
            const moduleStatus = getModuleStatus(moduleName);
            
            return (
              <div key={moduleName}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start p-3 h-auto text-left",
                    isExpanded && "bg-accent"
                  )}
                  onClick={() => toggleModule(moduleName)}
                >
                  <div className="flex items-center w-full">
                    <span className="text-lg mr-3">{module.icon}</span>
                    {!isCollapsed && (
                      <>
                        <div className="flex-1">
                          <div className="font-medium text-sm">{moduleName}</div>
                          <Badge 
                            variant={getStatusVariant(moduleStatus)} 
                            className="mt-1 text-xs"
                          >
                            {moduleStatus}
                          </Badge>
                        </div>
                        <svg 
                          className={cn(
                            "h-4 w-4 transition-transform",
                            isExpanded && "transform rotate-180"
                          )}
                          fill="none" 
                          viewBox="0 0 24 24" 
                          stroke="currentColor"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </>
                    )}
                  </div>
                </Button>

                {isExpanded && !isCollapsed && (
                  <div className="ml-6 mt-1 space-y-1">
                    {Object.entries(module.routes).map(([routeName, route]) => (
                      <Button
                        key={route}
                        variant={isRouteActive(route) ? "secondary" : "ghost"}
                        size="sm"
                        className="w-full justify-start text-sm"
                        onClick={() => navigate(route)}
                      >
                        {routeName}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      {!isCollapsed && (
        <div className="p-4 border-t border-border">
          <div className="space-y-2">
            <Button 
              variant="outline" 
              size="sm"
              className="w-full justify-start"
              onClick={() => navigate('/data-check')}
            >
              🔍 Data Check
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowLoadModal(true)}
            >
              📥 Load Database
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              className="w-full justify-start"
              onClick={() => setShowSaveModal(true)}
            >
              💾 Save Database
            </Button>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {!isCollapsed && (
        <div className="p-4 border-t border-border bg-muted/30">
          <div className="space-y-2 text-xs">
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Errors:</span>
              <Badge 
                variant={(safeData.validation?.errors || []).length > 0 ? 'destructive' : 'success'}
                className="text-xs"
              >
                {(safeData.validation?.errors || []).length}
              </Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Last Updated:</span>
              <span className="text-muted-foreground">
                {safeData.lastUpdated ? new Date(safeData.lastUpdated).toLocaleTimeString() : 'Never'}
              </span>
            </div>
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