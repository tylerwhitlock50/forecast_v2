import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/apiClient';
import { useForecast } from '../../context/ForecastContext';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { COST_WARNING_LABELS, COST_WARNING_ACTIONS } from '../Modules/ReportingAnalysis/utils/costWarnings';

export { COST_WARNING_LABELS, COST_WARNING_ACTIONS };

const WARNING_LABELS = COST_WARNING_LABELS;
const ACTION_HINTS = COST_WARNING_ACTIONS;

const CostWarningsBanner = () => {
  const { activeScenario } = useForecast();
  const [summary, setSummary] = useState(null);
  const [products, setProducts] = useState([]);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    let cancelled = false;
    const fetchSummary = async () => {
      try {
        const params = activeScenario ? { forecast_id: activeScenario } : {};
        const res = await api.get('/products/cost-summary', {
          params,
          suppressErrorToast: true,
        });
        if (cancelled) return;
        setSummary(res?.data?.summary || null);
        setProducts(res?.data?.products || []);
      } catch {
        // Silent — banner just won't render.
      }
    };
    fetchSummary();
    return () => {
      cancelled = true;
    };
  }, [activeScenario]);

  if (dismissed || !summary || summary.products_with_warnings === 0) {
    return null;
  }

  const flagged = products.filter((p) => p.warnings && p.warnings.length > 0);

  return (
    <Card className="border-amber-300 bg-amber-50 mb-4">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="text-lg">⚠️</span>
              <span className="font-medium text-amber-900">
                {summary.products_with_warnings} of {summary.product_count} products
                have incomplete cost data — their COGS may be understated.
              </span>
            </div>
            <div className="mt-1 text-sm text-amber-800">
              Fix the underlying data so the budget-by-product numbers are trustworthy.
            </div>
            {expanded && (
              <ul className="mt-3 space-y-2">
                {flagged.map((p) => (
                  <li key={p.product_id} className="text-sm">
                    <span className="font-medium">{p.product_name}</span>
                    <span className="text-muted-foreground"> ({p.product_id})</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {p.warnings.map((code) => {
                        const hint = ACTION_HINTS[code];
                        const badge = (
                          <Badge
                            variant="outline"
                            className="border-amber-400 text-amber-900 hover:bg-amber-100"
                            title={hint?.label}
                          >
                            {WARNING_LABELS[code] || code}
                          </Badge>
                        );
                        return hint ? <Link key={code} to={hint.path}>{badge}</Link> : <span key={code}>{badge}</span>;
                      })}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-col items-end gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((e) => !e)}
            >
              {expanded ? 'Hide details' : 'Show details'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDismissed(true)}
            >
              Dismiss
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default CostWarningsBanner;
