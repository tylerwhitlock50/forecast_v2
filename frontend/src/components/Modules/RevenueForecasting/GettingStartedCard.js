import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';
import { useForecast } from '../../../context/ForecastContext';
import { Card } from '../../ui/card';
import { Button } from '../../ui/button';
import { goToImport } from '../../Common/importLink';

/**
 * The setup path for a sales forecast that costs out: customers (with their
 * type), labor rates and machines, routings, BOMs, products linked to both,
 * then the sales file for the scenario, then the COGS & labor review. Each
 * step shows what is already loaded and links to its import step.
 *
 * Hidden once every step has data, or when dismissed (remembered per browser).
 */
const DISMISS_KEY = 'revenue_gettingStartedDismissed';

const readDismissed = () => {
  try { return localStorage.getItem(DISMISS_KEY) === 'true'; } catch { return false; }
};

const count = (list) => (Array.isArray(list) ? list.length : 0);
const plural = (n, one, many) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

const GettingStartedCard = ({ onCreateScenario, forceShow = false }) => {
  const { data, scenarios, activeScenario } = useForecast();
  const navigate = useNavigate();
  const [dismissed, setDismissed] = React.useState(readDismissed);

  const scenarioCount = scenarios ? Object.keys(scenarios).length : 0;
  const scenario = activeScenario ? scenarios?.[activeScenario] : null;
  const customers = data?.customers || [];
  const products = data?.products || [];
  const untyped = customers.filter(c => !String(c.customer_type || '').trim()).length;
  const unlinked = products.filter(p => !p.bom || !p.router).length;
  const bomCount = new Set((data?.bom || []).map(b => b.bom_id)).size;
  const salesRows = scenario?.sales_rows ?? count(data?.sales_forecast);

  const steps = [
    {
      key: 'scenario',
      label: 'Create a scenario',
      detail: scenarioCount ? `${plural(scenarioCount, 'scenario', 'scenarios')}${scenario ? ` · active: ${scenario.name}` : ''}` : 'For example “Budget 2027”.',
      done: scenarioCount > 0,
      action: scenarioCount ? { label: 'Scenarios', to: '/scenarios' } : { label: 'Create', onClick: onCreateScenario },
    },
    {
      key: 'customers',
      label: 'Customers, with their type',
      detail: customers.length
        ? `${plural(customers.length, 'customer', 'customers')}${untyped ? ` · ${untyped} without a type` : ''}`
        : 'Dealer, Distributor, Direct… drives prices and discounts.',
      done: customers.length > 0,
      warn: untyped > 0,
      action: { label: 'Import', step: 'customers' },
    },
    {
      key: 'labor',
      label: 'Labor rates and machines',
      detail: `${plural(count(data?.labor_rates), 'labor rate', 'labor rates')} · ${plural(count(data?.machines), 'machine', 'machines')}`,
      done: count(data?.labor_rates) > 0 && count(data?.machines) > 0,
      action: { label: 'Import', step: 'labor_rates' },
    },
    {
      key: 'routings',
      label: 'Routings',
      detail: count(data?.router_definitions) ? plural(count(data?.router_definitions), 'routing', 'routings') : 'Machine and labor minutes per unit.',
      done: count(data?.router_definitions) > 0,
      action: { label: 'Import', step: 'routings' },
    },
    {
      key: 'boms',
      label: 'Bills of materials',
      detail: bomCount ? plural(bomCount, 'BOM', 'BOMs') : 'Material cost per unit.',
      done: bomCount > 0,
      action: { label: 'Import', step: 'boms' },
    },
    {
      key: 'products',
      label: 'Products linked to a BOM and routing',
      detail: products.length
        ? `${plural(products.length, 'product', 'products')}${unlinked ? ` · ${unlinked} missing a BOM or routing` : ''}`
        : 'List price, product type, BOM and routing.',
      done: products.length > 0,
      warn: unlinked > 0,
      action: { label: 'Import', step: 'products' },
    },
    {
      key: 'sales',
      label: 'Sales forecast',
      detail: salesRows ? `${plural(salesRows, 'row', 'rows')} in ${scenario?.name || 'the active scenario'}` : 'Units by customer, product and month.',
      done: salesRows > 0,
      action: { label: 'Import', step: 'sales' },
    },
    {
      key: 'review',
      label: 'Review COGS and labor',
      detail: 'Gross to net sales, COGS, gross margin, labor hours.',
      done: false,
      optional: true,
      action: { label: 'Open', to: '/reporting/cogs-labor' },
    },
  ];

  const required = steps.filter(s => !s.optional);
  const doneCount = required.filter(s => s.done).length;
  const allDone = doneCount === required.length;

  if ((dismissed && !forceShow) || (allDone && !forceShow)) return null;

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem(DISMISS_KEY, 'true'); } catch { /* storage unavailable */ }
  };

  const runAction = (action) => {
    if (action.step) goToImport(navigate, action.step);
    else if (action.to) navigate(action.to);
    else if (action.onClick) action.onClick();
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
          <div className="w-40" aria-label="Setup progress">
            <div className="text-right text-xs tabular-nums text-gray-500">{doneCount} of {required.length} done</div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
              <div className="h-full rounded-full bg-orange-500" style={{ width: `${(doneCount / required.length) * 100}%` }} />
            </div>
          </div>
          {!forceShow && <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss</Button>}
        </div>
      </div>
      <ol className="mt-4 grid gap-2 md:grid-cols-2">
        {steps.map((step, i) => (
          <li
            key={step.key}
            className={`flex items-center justify-between gap-3 rounded-md border px-3 py-2 ${step.done ? 'border-green-200 bg-green-50/40' : 'border-gray-200 bg-white'}`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? 'bg-green-100 text-green-700' : 'border border-gray-300 text-gray-600'}`}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className="text-sm font-medium text-gray-900">{step.label}</div>
                <div className={`truncate text-xs ${step.warn ? 'text-amber-700' : 'text-gray-500'}`}>{step.detail}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => runAction(step.action)}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-orange-700 hover:bg-orange-50"
            >
              {step.action.label}
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ol>
    </Card>
  );
};

export default GettingStartedCard;
