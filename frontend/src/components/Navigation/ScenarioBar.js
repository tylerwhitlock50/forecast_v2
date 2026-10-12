import React, { useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useForecast } from '../../context/ForecastContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { scopeForPath } from '../Modules/Scenarios/scenarioScope';

/**
 * Persistent bar above every screen: which scenario is active, a quick
 * switcher, and how the current screen relates to that scenario.
 */
const ScenarioBar = () => {
  const { scenarios, activeScenario, actions } = useForecast();
  const location = useLocation();
  const navigate = useNavigate();

  const list = useMemo(
    () => Object.values(scenarios || {}).sort((a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0) || a.name.localeCompare(b.name)),
    [scenarios]
  );
  const active = activeScenario ? scenarios?.[activeScenario] : null;
  const scope = scopeForPath(location.pathname);
  const onScenariosPage = location.pathname.startsWith('/scenarios');

  return (
    <div
      className="scenario-bar sticky top-0 z-30 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-white/95 px-6 py-2 backdrop-blur lg:flex-nowrap"
      data-testid="scenario-bar"
    >
      <div className="flex min-w-0 flex-none items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scenario</span>
        {list.length > 0 ? (
          <select
            aria-label="Active scenario"
            value={activeScenario || ''}
            onChange={(e) => actions.switchScenario(e.target.value || null)}
            className="h-8 max-w-[240px] truncate rounded-md border border-gray-300 bg-white px-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
            title={active ? `${active.name} (${active.id})` : undefined}
          >
            {!activeScenario && <option value="">Select a scenario…</option>}
            {list.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.id}){s.is_base ? ' • base' : ''}
              </option>
            ))}
          </select>
        ) : (
          <span className="text-sm text-gray-600">No scenarios yet</span>
        )}
        {active?.is_base && <Badge variant="secondary">Base</Badge>}
      </div>

      {scope && (
        <div className="flex flex-none items-center gap-2" title={scope.help}>
          <span className="whitespace-nowrap text-xs text-gray-400">This screen:</span>
          <span
            className={`inline-flex cursor-help items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium ${scope.tone}`}
            data-testid="scope-badge"
          >
            {scope.label}
          </span>
        </div>
      )}

      <div className="ml-auto flex min-w-0 items-center justify-end gap-3 lg:flex-1">
        {active?.description && !onScenariosPage && (
          <span className="hidden min-w-0 truncate text-xs text-gray-500 xl:block" title={active.description}>
            {active.description}
          </span>
        )}
        {list.length === 0 ? (
          <Button size="sm" onClick={() => navigate('/scenarios')} className="flex-none bg-orange-600 hover:bg-orange-700 text-white">
            Create a scenario
          </Button>
        ) : (
          !onScenariosPage && (
            <Link to="/scenarios" className="flex-none whitespace-nowrap text-sm font-medium text-orange-700 hover:underline">
              Manage scenarios
            </Link>
          )
        )}
      </div>
    </div>
  );
};

export default ScenarioBar;
