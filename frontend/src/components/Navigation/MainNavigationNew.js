import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { cn } from '../../lib/utils';
import DatabaseSaveModal from '../DatabaseModals/DatabaseSaveModal';
import DatabaseLoadModal from '../DatabaseModals/DatabaseLoadModal';
import useSetupProgress from '../Modules/DataImport/useSetupProgress';

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
      "Manage Scenarios": "/scenarios",
      "Change History": "/history"
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

/** Grey pill shown instead of a status badge while the first data load runs. */
const BadgeSkeleton = ({ className = '' }) => (
  <span
    className={cn("inline-block h-[18px] w-14 flex-shrink-0 animate-pulse rounded-full bg-gray-200", className)}
    aria-hidden="true"
    data-testid="nav-badge-skeleton"
  />
);

// The section that holds a screen ('/products/RF-100' belongs to Product Setup).
const sectionFor = (pathname) => {
  const entries = Object.entries(navigationModules);
  const exact = entries.find(([, m]) => Object.values(m.routes).includes(pathname));
  if (exact) return exact[0];
  const prefix = entries
    .flatMap(([name, m]) => Object.values(m.routes).map((route) => [name, route]))
    .filter(([, route]) => route !== '/' && pathname.startsWith(`${route}/`))
    .sort((a, b) => b[1].length - a[1].length)[0];
  return prefix ? prefix[0] : null;
};

// Same breakpoint as App.css: at or below it the content column has no left
// margin, so the sidebar floats over the page instead of sitting beside it.
const SMALL_SCREEN = '(max-width: 1024px)';

const useSmallScreen = () => {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia(SMALL_SCREEN).matches;
  const [small, setSmall] = useState(query);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(SMALL_SCREEN);
    const update = () => setSmall(media.matches);
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener(update);
    };
  }, []);
  return small;
};

const MainNavigation = ({ isCollapsed, onToggle }) => {
  const navigate = useNavigate();
  // Phones and narrow windows: the sidebar is a drawer behind a menu button,
  // closed at first and after picking a screen, so it never covers the page.
  const smallScreen = useSmallScreen();
  const autoClosed = useRef(false);
  useEffect(() => {
    if (autoClosed.current) return;
    autoClosed.current = true;
    if (smallScreen && !isCollapsed) onToggle();
  }, [smallScreen, isCollapsed, onToggle]);
  const location = useLocation();
  // Only the section that holds the current screen is open, so every
  // section (down to Reporting & Analysis) fits without scrolling.
  const [expandedModules, setExpandedModules] = useState(() => {
    const current = sectionFor(location.pathname);
    return current ? { [current]: true } : {};
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [showLoadModal, setShowLoadModal] = useState(false);
  const { data, actions, scenarios, lastUpdated, error } = useForecast();
  // Nothing has loaded yet: badges would read "None yet" / "To do" for data
  // that is simply not loaded yet, so show placeholders instead.
  const firstLoad = !lastUpdated && !error;
  // The same steps and counts as the Import data page and the Sales Forecast
  // checklist; the path refreshes the price / deduction rule counts.
  const setup = useSetupProgress(location.pathname);

  // On navigation, collapse the sections not in use and open the current one.
  useEffect(() => {
    const current = sectionFor(location.pathname);
    setExpandedModules(current ? { [current]: true } : {});
  }, [location.pathname]);

  // Ensure data is always an object with expected properties
  const safeData = data || {};

  const go = (route) => {
    navigate(route);
    if (smallScreen && !isCollapsed) onToggle();
  };

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
    const products = list(safeData.products);
    const payroll = list(safeData.payroll);
    const scenarioList = Object.values(scenarios || {});
    const has = (kind) => Boolean(setup.byKind[kind]?.done);

    const checks = (items) => ({ done: items.filter(Boolean).length, total: items.length });
    switch (moduleName) {
      case 'Get Started':
        return { done: setup.done, total: setup.total };
      case 'Scenarios': {
        if (!scenarioList.length) return { label: 'None yet', tone: 'empty' };
        const approved = scenarioList.filter(s => s.locked).length;
        return {
          label: `${scenarioList.length} scenario${scenarioList.length === 1 ? '' : 's'}`,
          title: approved ? `${approved} approved and locked` : undefined,
          tone: 'neutral',
        };
      }
      case 'Revenue Planning':
        return checks([has('customers'), has('products'), has('prices'), has('sales')]);
      case 'Manufacturing Setup':
        return checks([has('machines'), has('routings'), has('boms'), has('labor_rates')]);
      case 'Cost Management': {
        if (!products.length) return { done: 0, total: 1 };
        const costed = products.filter(p => p.bom).length;
        return costed === products.length
          ? { done: 1, total: 1 }
          : { label: `${costed} of ${products.length} costed`, tone: costed ? 'partial' : 'empty' };
      }
      case 'Resource Planning':
        return payroll.length
          ? { label: `${payroll.length} employee${payroll.length === 1 ? '' : 's'}`, tone: 'neutral' }
          : { label: 'Optional', tone: 'empty' };
      default:
        return null;
    }
  };

  // `short` keeps section badges narrow so long section names are not cut off.
  const describeStatus = (status, short = false) => {
    if (!status) return null;
    if (status.label) return status;
    if (status.done >= status.total) return { label: 'Ready', tone: 'complete' };
    if (status.done === 0) return { label: short ? 'To do' : 'Not started', title: 'Not started', tone: 'empty' };
    const full = `${status.done} of ${status.total} set up`;
    return { label: short ? `${status.done} of ${status.total}` : full, title: full, tone: 'partial' };
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

  if (smallScreen && isCollapsed) {
    // Only the menu button; the page underneath stays fully visible.
    return (
      <nav
        className="fixed left-0 top-0 z-40 p-2"
        style={{ height: 'auto', width: 'auto', background: 'transparent', borderRight: 'none', boxShadow: 'none' }}
        data-testid="nav-menu-button"
      >
        <Button variant="outline" size="sm" onClick={onToggle} className="h-9 w-9 bg-white p-0 shadow-sm" aria-label="Open navigation">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </Button>
      </nav>
    );
  }

  return (
    <nav className={cn(
      "fixed left-0 top-0 h-full bg-background border-r border-border flex flex-col transition-all duration-300 ease-in-out z-40",
      isCollapsed ? "w-16" : "w-80"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="h-8 w-8 p-0"
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
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
            <h1 className="text-xl font-bold leading-tight text-foreground">Forecast AI</h1>
            <p className="text-xs text-muted-foreground">Budget &amp; cash flow model</p>
          </div>
        )}
      </div>

      {/* Navigation Content */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-0.5">
          {Object.entries(navigationModules).map(([moduleName, module]) => {
            const isExpanded = expandedModules[moduleName];
            const status = describeStatus(getModuleStatus(moduleName), moduleName !== 'Get Started');
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
                  onClick={() => go(route)}
                  title={isCollapsed ? `${moduleName}: ${routeName}` : `${setup.done} of ${setup.total} import steps have data`}
                  className={cn(
                    "mb-1.5 flex w-full items-center rounded-lg border px-2.5 py-2 text-left transition-colors",
                    isRouteActive(route)
                      ? "border-orange-300 bg-orange-50"
                      : "border-orange-200 bg-orange-50/50 hover:bg-orange-50"
                  )}
                >
                  <span className="mr-2.5 w-6 text-center text-lg">{module.icon}</span>
                  {!isCollapsed && (
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-gray-900">Get started</div>
                      <div className="text-xs text-gray-600">Import your data</div>
                    </div>
                  )}
                  {!isCollapsed && firstLoad && <BadgeSkeleton className="ml-2" />}
                  {!isCollapsed && !firstLoad && status && (
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
                    "h-auto w-full justify-start px-2.5 py-2 text-left",
                    (isExpanded || (single && sectionActive)) && "bg-accent"
                  )}
                  title={isCollapsed ? moduleName : undefined}
                  aria-expanded={single ? undefined : Boolean(isExpanded)}
                  onClick={() => (single ? go(single[1]) : toggleModule(moduleName))}
                >
                  <div className="flex w-full items-center gap-2">
                    <span className="mr-0.5 w-6 flex-shrink-0 text-center text-lg">{module.icon}</span>
                    {!isCollapsed && (
                      <>
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">{moduleName}</span>
                        {firstLoad && status && <BadgeSkeleton />}
                        {!firstLoad && status && (
                          <span title={status.title} className={cn("flex-shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium", STATUS_TONES[status.tone])}>
                            {status.label}
                          </span>
                        )}
                        {!single && (
                          <svg
                            className={cn(
                              "h-4 w-4 flex-shrink-0 transition-transform",
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
                  <div className="mb-1 ml-9 mt-0.5 space-y-0.5">
                    {routes.map(([routeName, route]) => (
                      <Button
                        key={route}
                        variant={isRouteActive(route) ? "secondary" : "ghost"}
                        size="sm"
                        className="h-8 w-full justify-start px-2.5 text-sm"
                        onClick={() => go(route)}
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
        <div className="px-3 py-2.5 border-t border-border">
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center px-2"
              onClick={() => setShowLoadModal(true)}
            >
              📥 Load database
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-center px-2"
              onClick={() => setShowSaveModal(true)}
            >
              💾 Save database
            </Button>
          </div>
        </div>
      )}

      {/* Status Bar */}
      {!isCollapsed && (
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-border bg-muted/30 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            Errors:
            {firstLoad ? (
              <BadgeSkeleton className="w-6" />
            ) : (
              <Badge
                variant={(safeData.validation?.errors || []).length > 0 ? 'destructive' : 'success'}
                className="text-xs"
              >
                {(safeData.validation?.errors || []).length}
              </Badge>
            )}
          </span>
          <span className="text-muted-foreground">
            {firstLoad ? 'Loading…' : `Updated ${lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : 'never'}`}
          </span>
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
        onAfterReset={() => actions.fetchAllData()}
      />
    </nav>
  );
};

export default MainNavigation;