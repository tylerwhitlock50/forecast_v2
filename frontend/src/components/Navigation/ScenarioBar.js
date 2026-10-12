import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../context/ForecastContext';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { SCOPE_KINDS, scopeForPath } from '../Modules/Scenarios/scenarioScope';
import { LockIcon, approvalLine, isLocked } from '../Modules/Scenarios/governance';
import { unlockScenario } from '../Modules/Scenarios/governanceApi';
import BranchScenarioModal from '../Modules/Scenarios/BranchScenarioModal';
import UnlockScenarioModal from '../Modules/Scenarios/UnlockScenarioModal';

/** Grey placeholder while the first data load is still running (instead of "No scenarios yet"). */
const Skeleton = ({ className }) => (
  <span className={`inline-block animate-pulse rounded-md bg-gray-200 ${className}`} aria-hidden="true" />
);

/**
 * The note shown on an editing screen while the active scenario is approved
 * and locked: what cannot change here, and the two ways forward.
 */
export const LockedScenarioBanner = ({ scenario, scope, onBranch, onUnlock }) => {
  const own = scope === SCOPE_KINDS.scenario
    ? 'Its sales forecast cannot be changed.'
    : 'Rows that belong to this scenario cannot be changed; company-wide rows still can, and they move every scenario, this one included.';
  return (
    <div
      className="flex flex-col gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 sm:px-6 lg:flex-row lg:items-center lg:justify-between"
      role="status"
      data-testid="locked-banner"
    >
      <div className="flex min-w-0 items-start gap-2">
        <LockIcon className="mt-0.5 h-4 w-4 flex-none text-emerald-700" />
        <p className="min-w-0">
          <span className="font-semibold">{scenario.name} is approved and locked</span>
          {approvalLine(scenario) ? ` (${approvalLine(scenario).replace(/^Approved /, 'approved ')})` : ''}. {own}
        </p>
      </div>
      <div className="flex flex-none flex-wrap gap-2">
        <Button size="sm" variant="outline" className="h-8 border-emerald-300 bg-white" onClick={onBranch}>
          Branch it to make changes
        </Button>
        <Button size="sm" variant="ghost" className="h-8 text-emerald-900" onClick={onUnlock}>Unlock…</Button>
      </div>
    </div>
  );
};

/**
 * Persistent bar above every screen: which scenario is active (and whether
 * it is approved and locked), a quick switcher, and how the current screen
 * relates to that scenario.
 */
const ScenarioBar = () => {
  const { scenarios, activeScenario, actions, error, lastUpdated } = useForecast();
  const location = useLocation();
  const navigate = useNavigate();
  const [branchOpen, setBranchOpen] = useState(false);
  const [unlockOpen, setUnlockOpen] = useState(false);

  const list = useMemo(
    () => Object.values(scenarios || {}).sort((a, b) => (b.is_base ? 1 : 0) - (a.is_base ? 1 : 0) || a.name.localeCompare(b.name)),
    [scenarios]
  );
  const active = activeScenario ? scenarios?.[activeScenario] : null;
  const scope = scopeForPath(location.pathname);
  const onScenariosPage = location.pathname.startsWith('/scenarios');
  // First load still running: show placeholders, not "No scenarios yet".
  const firstLoad = !lastUpdated && !error && list.length === 0;
  const locked = isLocked(active);
  const editingScreen = scope === SCOPE_KINDS.scenario || scope === SCOPE_KINDS.mixed;

  return (
    <div className="scenario-bar sticky top-0 z-30" data-testid="scenario-bar">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-gray-200 bg-white/95 px-4 py-2 backdrop-blur sm:px-6 lg:flex-nowrap max-[1024px]:pl-14">
        <div className="flex min-w-0 flex-none items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Scenario</span>
          {firstLoad ? (
            <Skeleton className="h-8 w-48" />
          ) : list.length > 0 ? (
            <select
              aria-label="Active scenario"
              value={activeScenario || ''}
              onChange={(e) => actions.switchScenario(e.target.value || null)}
              className="h-8 max-w-[200px] truncate rounded-md sm:max-w-[300px] border border-gray-300 bg-white px-2 text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-500"
              title={active ? `${active.name} (${active.id})` : undefined}
            >
              {!activeScenario && <option value="">Select a scenario…</option>}
              {list.map(s => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.id}){s.is_base ? ' • base' : ''}{isLocked(s) ? ' • approved' : ''}
                </option>
              ))}
            </select>
          ) : (
            <span className="text-sm text-gray-600">No scenarios yet</span>
          )}
          {active?.is_base && <Badge variant="secondary">Base</Badge>}
          {locked && (
            <span
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800"
              title={`${approvalLine(active)}. Branch it to make changes, or unlock it with a reason.`}
              data-testid="approved-badge"
            >
              <LockIcon className="h-3 w-3" />
              Approved
            </span>
          )}
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
          {firstLoad ? (
            <Skeleton className="h-5 w-28" />
          ) : list.length === 0 ? (
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

      {locked && editingScreen && (
        <LockedScenarioBanner
          scenario={active}
          scope={scope}
          onBranch={() => setBranchOpen(true)}
          onUnlock={() => setUnlockOpen(true)}
        />
      )}

      <BranchScenarioModal
        open={branchOpen}
        onClose={() => setBranchOpen(false)}
        scenarios={scenarios}
        activeScenarioId={activeScenario}
        onSubmit={async (sourceId, scenarioData, overrides) => {
          const result = await actions.duplicateScenario(sourceId, scenarioData, overrides);
          if (result) toast.success(`Branched to "${result.name}": an editable draft, now the active scenario`);
          return result;
        }}
      />
      <UnlockScenarioModal
        open={unlockOpen}
        scenario={active}
        onClose={() => setUnlockOpen(false)}
        onBranchInstead={() => setBranchOpen(true)}
        onSubmit={async (values) => {
          await unlockScenario(active.id, values);
          await actions.fetchScenarios();
          toast.success(`Unlocked "${active.name}": it is an editable draft again`);
        }}
      />
    </div>
  );
};

export default ScenarioBar;
