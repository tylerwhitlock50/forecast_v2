import React, { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { validateRoutings } from './routerHelpers';

const SEVERITY_COLORS = { high: '#dc3545', medium: '#ffc107', low: '#17a2b8' };

const StatCard = ({ icon, value, label }) => (
  <Card>
    <CardContent className="p-6">
      <div className="flex items-center space-x-4">
        <div className="text-3xl">{icon}</div>
        <div>
          <p className="text-2xl font-bold">{value}</p>
          <p className="text-sm text-muted-foreground">{label}</p>
        </div>
      </div>
    </CardContent>
  </Card>
);

const CheckList = ({ title, icon, checks, tone }) => (
  <Card>
    <CardHeader>
      <CardTitle className="flex items-center space-x-2">
        <span>{icon}</span>
        <span>{title} ({checks.length})</span>
      </CardTitle>
    </CardHeader>
    <CardContent>
      <div className="space-y-4">
        {checks.map((check) => (
          <div key={check.title} className={`p-4 rounded-lg border ${tone.box}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="font-semibold">{check.title}</span>
              <Badge
                variant="outline"
                className="text-xs"
                style={{ backgroundColor: SEVERITY_COLORS[check.severity] || '#6c757d', color: 'white' }}
              >
                {check.severity}
              </Badge>
            </div>
            <p className="text-sm mb-3">{check.description}</p>
            <details className="text-sm">
              <summary className={`cursor-pointer font-medium ${tone.text}`}>Show {check.items.length === 1 ? 'it' : `all ${check.items.length}`}</summary>
              <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                {check.items.slice(0, 50).map((item, i) => (
                  <div key={`${i}-${item}`} className={tone.item}>• {item}</div>
                ))}
                {check.items.length > 50 && <div className="italic text-gray-500">… and {check.items.length - 50} more</div>}
              </div>
            </details>
          </div>
        ))}
      </div>
    </CardContent>
  </Card>
);

/**
 * Data checks for routings: the routing headers, their operations and the
 * products that use them (validateRoutings). Only what changes a product's
 * labor or machine cost is reported.
 */
const RouterValidation = ({ routers, routerOperations, machines, products, laborRates }) => {
  const result = useMemo(
    () => validateRoutings({ routers, operations: routerOperations, machines, products, laborRates }),
    [routers, routerOperations, machines, products, laborRates]
  );
  const errorCount = result.issues.length;
  const warningCount = result.warnings.length;

  const recommendations = [];
  if (errorCount > 0) {
    recommendations.push({ key: 'errors', icon: '🔧', tone: 'bg-red-50', text: 'Fix the errors first: they leave labor or machine cost out of the products that use these routings.' });
  }
  if (!(machines || []).length) {
    recommendations.push({ key: 'machines', icon: '🏭', tone: 'bg-orange-50', text: 'No machines are set up yet. Operations need a machine with an hourly rate to cost machine time (Import data, step 3).' });
  }
  if (!(laborRates || []).length) {
    recommendations.push({ key: 'labor', icon: '💰', tone: 'bg-indigo-50', text: 'No labor rates are set up yet. Operations need a labor type with an hourly rate to cost labor (Import data, step 4).' });
  }
  if (!(products || []).length) {
    recommendations.push({ key: 'products', icon: '📦', tone: 'bg-purple-50', text: 'No products are set up yet. Link each product to its routing so its labor and machine cost reach COGS.' });
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard icon="🔄" value={result.routings} label={`Routings · ${result.operations} operations`} />
        <StatCard icon="✅" value={result.cleanRoutings} label="Routings without problems" />
        <StatCard icon="⚠️" value={warningCount} label={`Warning ${warningCount === 1 ? 'check' : 'checks'}`} />
        <StatCard icon="❌" value={errorCount} label={`Error ${errorCount === 1 ? 'check' : 'checks'}`} />
      </div>

      {errorCount > 0 && (
        <CheckList
          title="Critical Issues"
          icon="❌"
          checks={result.issues}
          tone={{ box: 'border-red-200 bg-red-50', text: 'text-red-700', item: 'text-red-600' }}
        />
      )}

      {warningCount > 0 && (
        <CheckList
          title="Warnings"
          icon="⚠️"
          checks={result.warnings}
          tone={{ box: 'border-yellow-200 bg-yellow-50', text: 'text-yellow-700', item: 'text-yellow-700' }}
        />
      )}

      {errorCount === 0 && warningCount === 0 && result.routings > 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="space-y-4">
              <div className="text-6xl">🎉</div>
              <h3 className="text-2xl font-bold text-green-600">All Clear!</h3>
              <p className="text-muted-foreground">
                Every routing has operations on machines and labor types that have rates, and every product&apos;s routing exists.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {recommendations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recommendations.map((r) => (
                <div key={r.key} className={`flex items-start space-x-3 p-3 rounded-lg ${r.tone}`}>
                  <span className="text-xl">{r.icon}</span>
                  <span className="text-sm">{r.text}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default RouterValidation;
