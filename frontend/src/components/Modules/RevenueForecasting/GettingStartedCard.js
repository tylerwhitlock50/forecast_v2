import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { goToImport } from '../../Common/importLink';
import useSetupProgress from '../DataImport/useSetupProgress';

/**
 * The setup path for a sales forecast that costs out: the Import data
 * page's steps, in the same order and with the same counts as that page and
 * the sidebar's "Get started" badge (DataImport/importSteps.js
 * setupProgress). Each step links to its import step. A scenario is needed
 * before the sales forecast; without one the card offers to create it.
 *
 * Hidden once every step has data, or when dismissed (remembered per browser).
 */
const DISMISS_KEY = 'revenue_gettingStartedDismissed';

const readDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
};

const GettingStartedCard = ({ onCreateScenario, forceShow = false }) => {
  const { scenarios } = useForecast();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = React.useState(readDismissed);
  const progress = useSetupProgress();

  const scenarioCount = scenarios ? Object.keys(scenarios).length : 0;
  const allDone = progress.done === progress.total;

  if ((dismissed && !forceShow) || (allDone && !forceShow)) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* storage unavailable */ }
  };

  return (
    <Card className="mb-6 border-orange-200 p-5" data-testid="getting-started">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Set up a forecast that costs out</h2>
          <p className="mt-0.5 text-sm text-gray-600">
            Load data in this order on the <Link to="/import" className="font-medium text-orange-700 hover:underline">Import data</Link> page. Each step uses the ones above it.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-44" aria-label="Setup progress">
            <div className="text-right text-xs tabular-nums text-gray-500">{progress.done} of {progress.total} steps have data</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-orange-500" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
            </div>
          </div>
          {!forceShow && <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss</Button>}
        </div>
      </div>

      {scenarioCount === 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>Create a scenario first (for example “Budget 2027”): the sales forecast in step {progress.total} is imported into it.</span>
          {onCreateScenario && (
            <button
              type="button"
              onClick={onCreateScenario}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100"
            >
              Create a scenario
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      )}

      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {progress.steps.map((step) => (
          <li
            key={step.kind}
            data-step={step.kind}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${step.done ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? 'bg-green-100 text-green-700' : 'border border-gray-300 text-gray-600'}`}
                title={step.done ? 'Has data' : undefined}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : step.number}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">
                  {step.done && <span className="mr-1 text-gray-400">{step.number}.</span>}
                  {step.title}
                </div>
                <div
                  className={`truncate text-xs ${step.warning ? 'text-amber-700' : 'text-gray-500'}`}
                  title={step.warning || step.label || step.hint}
                >
                  {step.done ? [step.label, step.warning].filter(Boolean).join(' · ') : step.hint}
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => goToImport(navigate, step.kind)}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50"
            >
              Import
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>

      <div className="mt-3 flex justify-end">
        <Link to="/reporting/cogs-labor" className="inline-flex items-center gap-1 text-sm font-medium text-orange-700 hover:underline">
          Then review COGS and labor
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </Card>
  );
};

export default GettingStartedCard;
