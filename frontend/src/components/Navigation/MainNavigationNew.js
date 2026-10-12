import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import DatabaseSaveModal from '../DatabaseModals/DatabaseSaveModal';
import DatabaseLoadModal from '../DatabaseModals/DatabaseLoadModal';

const navigationModules = {
  "Get Started": {
    icon: "🚀",
    routes: {
      "Import Data": "/import"
    }
  },
  "Scenarios": {
    icon: "🗂️",
    routes: {
      "Manage Scenarios": "/scenarios"
    }
  },
  "Revenue Planning": {
    icon: "📊",
    routes: {
      "Sales Forecasting": "/sales-forecast",
      "Customer Setup": "/customers",
      "Product Setup": "/products",
      "Pricing & Deductions": "/pricing"
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
      "Cost Overview": "/cost-management"
    }
  },
  "Resource Planning": {
    icon: "👥",
    routes: {
      "Payroll Allocation": "/payroll"
    }
  },
  "Financial Planning": {
    icon: "💰",
    routes: {
      "Expense Management": "/expenses",
      "Loan Schedules": "/loans"
    }
  },
  "Reporting & Analysis": {
    icon: "📈",
    routes: {
      "Statements": "/reporting",
      "COGS & Labor Forecast": "/reporting/cogs-labor",
      "Compare Scenarios": "/reporting/comparison"
    }
  }
};

const MainNavigation = ({ isCollapsed, onToggle }) => {
  const navigate = useNavigate();
  const location = useLocation();
  // Open the section that holds the current screen.
  const [expandedModules, setExpandedModules] = useState(() => {
    const current = Object.entries(navigationModules).find(([, m]) => Object.values(m.routes).includes(location.pathname));
    return current ? { [current[0]]: true } : {};
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const { data, actions, scenarios, activeScenario, lastUpdated } = useForecast();

  // Keep the current screen's section open when navigating from a page link.
  useEffect(() => {
    const current = Object.entries(navigationModules).find(([, m]) => Object.values(m.routes).includes(location.pathname));
    if (current) setExpandedModules(prev => (prev[current[0]] ? prev : { ...prev, [current[0]]: true }));
  }, [location.pathname]);

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

  // Setup status per module, from the data already loaded in context.
  // Returns null when the module has nothing meaningful to report.
  const getModuleStatus = (moduleName) => {
    const list = (value) => (Array.isArray(value) ? value : []);
    const customers = list(safeData.customers);
    const products = list(safeData.products);
    const machines = list(safeData.machines);
    const laborRates = list(safeData.labor_rates);
    const routers = list(safeData.router_definitions);
    const bomIds = new Set(list(safeData.bom).map(b => b.bom_id).filter(Boolean));
    const payroll = list(safeData.payroll);
    const scenarioList = Object.values(scenarios || {});
    const active = activeScenario ? scenarios?.[activeScenario] : null;
    const salesRows = active ? (active.sales_rows ?? list(safeData.sales_forecast).length) : 0;

    const checks = (items) => ({ done: items.filter(Boolean).length, total: items.length });
    switch (moduleName) {
      case 'Get Started':
        return checks([customers.length, products.length, machines.length, laborRates.length, routers.length, bomIds.size, salesRows]);
      case 'Scenarios':
        return scenarioList.length
          ? { label: `${scenarioList.length} scenario${scenarioList.length === 1 ? '' : 's'}`, tone: 'neutral' }
          : { label: 'None yet', tone: 'empty' };
      case 'Revenue Planning':
        return checks([customers.length, products.length, salesRows]);
      case 'Manufacturing Setup':
        return checks([machines.length, routers.length, bomIds.size, laborRates.length]);
      case 'Cost Management': {
        if (!products.length) return { done: 0, total: 1 };
        const costed = products.filter(p => p.bom).length;
        return costed === products.length
          ? { done: 1, total: 1 }
          : { label: `${costed} of ${products.length} products costed`, tone: costed ? 'partial' : 'empty' };
      }
      case 'Resource Planning':
        return payroll.length
          ? { label: `${payroll.length} employee${payroll.length === 1 ? '' : 's'}`, tone: 'neutral' }
          : { label: 'Optional', tone: 'empty' };
      default:
        return null;
    }
  };

  const describeStatus = (status) => {
    if (!status) return null;
    if (status.label) return status;
    if (status.done >= status.total) return { label: 'Ready', tone: 'complete' };
    if (status.done === 0) return { label: 'Not started', tone: 'empty' };
    return { label: `${status.done} of ${status.total} set up`, tone: 'partial' };
  };

  const STATUS_TONES = {
    complete: 'border-green-200 bg-green-50 text-green-700',
    partial: 'border-amber-200 bg-amber-50 text-amber-800',
    empty: 'border-gray-200 bg-gray-50 text-gray-500',
    neutral: 'border-gray-200 bg-white text-gray-600',
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
            <p className="text-xs text-muted-foreground">Budget &amp; cash flow model</p>
          </div>
        )}
      </div>

      {/* Navigation Content */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-2">
          {Object.entries(navigationModules).map(([moduleName, module]) => {
            const isExpanded = expandedModules[moduleName];
            const status = describeStatus(getModuleStatus(moduleName));
            const routes = Object.entries(module.routes);
            const single = routes.length === 1 ? routes[0] : null;
            const sectionActive = routes.some(([, route]) => isRouteActive(route));

            // Get started: one prominent entry straight to the import screen.
            if (moduleName === 'Get Started') {
              const [routeName, route] = single;
              return (
                <button
                  key={moduleName}
                  type="button"
                  onClick={() => navigate(route)}
                  title={isCollapsed ? `${moduleName}: ${routeName}` : undefined}
                  className={cn(
                    "mb-2 flex w-full items-center rounded-lg border p-3 text-left transition-colors",
                    isRouteActive(route)
                      ? "border-orange-300 bg-orange-50"
                      : "border-orange-200 bg-orange-50/50 hover:bg-orange-50"
                  )}
                >
                  <span className="text-lg mr-3">{module.icon}</span>
                  {!isCollapsed && (
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900">Get started</div>
                      <div className="text-xs text-gray-600">Import your data</div>
                    </div>
                  )}
                  {!isCollapsed && status && (
                    <span className={cn("ml-2 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONES[status.tone])}>
                      {status.label}
                    </span>
                  )}
                </button>
              );
            }

            return (
              <div key={moduleName}>
                <Button
                  variant="ghost"
                  className={cn(
                    "w-full justify-start p-3 h-auto text-left",
                    (isExpanded || (single && sectionActive)) && "bg-accent"
                  )}
                  title={isCollapsed ? moduleName : undefined}
                  onClick={() => (single ? navigate(single[1]) : toggleModule(moduleName))}
                >
                  <div className="flex items-center w-full">
                    <span className="text-lg mr-3">{module.icon}</span>
                    {!isCollapsed && (
                      <>
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm">{moduleName}</div>
                          {status && (
                            <span className={cn("mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONES[status.tone])}>
                              {status.label}
                            </span>
                          )}
                        </div>
                        {!single && (
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
                        )}
                      </>
                    )}
                  </div>
                </Button>

                {!single && isExpanded && !isCollapsed && (
                  <div className="ml-6 mt-1 space-y-1">
                    {routes.map(([routeName, route]) => (
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
                {lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'Never'}
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