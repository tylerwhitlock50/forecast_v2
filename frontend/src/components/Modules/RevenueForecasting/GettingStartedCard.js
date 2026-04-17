import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';

/**
 * GettingStartedCard
 *
 * Renders a numbered-steps guided onboarding card for the Revenue page
 * when the user has no scenarios / customers / products / forecast lines yet.
 *
 * The card derives its "done" state directly from the ForecastContext, so
 * steps auto-advance as the user completes each action.
 *
 * When all steps are complete OR the user dismisses, the card collapses into
 * a thin strip that can reopen it. The dismissed state is persisted in
 * localStorage under `revenue_gettingStartedDismissed`.
 */
const DISMISS_KEY = 'revenue_gettingStartedDismissed';

const StepIcon = ({ done, index }) => (
  <div
    className={
      'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm font-semibold ' +
      (done
        ? 'bg-green-100 border-green-300 text-green-700'
        : 'bg-orange-50 border-orange-200 text-orange-700')
    }
  >
    {done ? (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42L8.5 12.08l6.79-6.79a1 1 0 011.414 0z"
          clipRule="evenodd"
        />
      </svg>
    ) : (
      <span>{index}</span>
    )}
  </div>
);

const GettingStartedCard = ({
  onCreateScenario,
  onAddCustomers,
  onAddProducts,
  onAddForecastLine,
}) => {
  const { data, scenarios } = useForecast();
  const navigate = useNavigate();

  const [dismissed, setDismissed] = React.useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === 'true';
    } catch {
      return false;
    }
  });
  const [expanded, setExpanded] = React.useState(true);

  const persistDismiss = (value) => {
    try {
      if (value) {
        localStorage.setItem(DISMISS_KEY, 'true');
      } else {
        localStorage.removeItem(DISMISS_KEY);
      }
    } catch {
      // localStorage may be unavailable — ignore
    }
  };

  const scenarioCount = scenarios ? Object.keys(scenarios).length : 0;
  const customerCount = Array.isArray(data?.customers) ? data.customers.length : 0;
  const productCount = Array.isArray(data?.products) ? data.products.length : 0;
  const forecastCount = Array.isArray(data?.sales_forecast) ? data.sales_forecast.length : 0;

  const steps = [
    {
      label: 'Create a scenario',
      description: 'Scenarios group your forecast assumptions.',
      done: scenarioCount > 0,
      action: {
        label: 'Create scenario',
        onClick: () => onCreateScenario && onCreateScenario(),
      },
    },
    {
      label: 'Add customers',
      description: 'Import a customer list or create them one-by-one.',
      done: customerCount > 0,
      action: {
        label: 'Add customers',
        onClick: () =>
          onAddCustomers ? onAddCustomers() : navigate('/customers'),
      },
    },
    {
      label: 'Add products',
      description: 'Define the products or services you sell.',
      done: productCount > 0,
      action: {
        label: 'Add products',
        onClick: () =>
          onAddProducts ? onAddProducts() : navigate('/products'),
      },
    },
    {
      label: 'Add your first forecast line',
      description: 'Pair a customer with a product to start forecasting.',
      done: forecastCount > 0,
      action: {
        label: 'Add forecast line',
        onClick: () => onAddForecastLine && onAddForecastLine(),
        // disabled until steps 1-3 are complete
        disabledWhen: () => !(scenarioCount > 0 && customerCount > 0 && productCount > 0),
      },
    },
  ];

  const allDone = steps.every((s) => s.done);

  // If user has dismissed the card entirely, render nothing.
  if (dismissed) {
    return null;
  }

  // Collapsed strip: shown when everything is done and the user hasn't reopened.
  if ((allDone || !expanded) && !dismissed) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-md border bg-green-50 px-4 py-2 text-sm text-green-800">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path
              fillRule="evenodd"
              d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 111.42-1.42L8.5 12.08l6.79-6.79a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span>{allDone ? 'Getting started: complete' : 'Getting started guide hidden'}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
            Show getting-started guide
          </Button>
          {allDone && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                persistDismiss(true);
              }}
            >
              Dismiss
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card className="mb-6 border-orange-200">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-lg">Start here</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Follow these steps to set up your first revenue forecast.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)}>
              Hide
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDismissed(true);
                persistDismiss(true);
              }}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="space-y-3">
          {steps.map((step, idx) => {
            const index = idx + 1;
            const disabled = step.action.disabledWhen ? step.action.disabledWhen() : false;
            return (
              <li
                key={step.label}
                className={
                  'flex items-center justify-between gap-4 rounded-md border p-3 ' +
                  (step.done ? 'border-green-200 bg-green-50/50' : 'border-gray-200 bg-white')
                }
              >
                <div className="flex items-start gap-3">
                  <StepIcon done={step.done} index={index} />
                  <div>
                    <div
                      className={
                        'text-sm font-medium ' +
                        (step.done ? 'text-green-800 line-through decoration-green-400' : 'text-gray-900')
                      }
                    >
                      {step.label}
                    </div>
                    <div className="text-xs text-muted-foreground">{step.description}</div>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant={step.done ? 'outline' : 'default'}
                  disabled={disabled}
                  onClick={step.action.onClick}
                  className={
                    !step.done && !disabled
                      ? 'bg-orange-600 text-white hover:bg-orange-700'
                      : ''
                  }
                >
                  {step.done ? 'Revisit' : step.action.label}
                </Button>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
};

export default GettingStartedCard;
