import React, { useEffect, useState } from 'react';
import api from '../../lib/apiClient';
import { Badge } from '../ui/badge';

const WARNING_LABELS = {
  missing_bom: 'no BOM',
  missing_router: 'no routing',
  router_missing_machine: 'unknown machine on a router op',
  router_missing_labor_rate: 'unknown labor rate on a router op',
};

const fmt = (n) =>
  n == null || Number.isNaN(n)
    ? '—'
    : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Live per-unit cost breakdown for a BOM + router pairing, rendered as a
 * compact row: Material + Labor + Machine = Total, with any data-quality
 * warnings flagged inline.
 *
 * Powered by /products/unit-cost (which in turn uses the same
 * calculate_unit_costs helper as the rollup endpoints), so what shows
 * here matches what shows up in Cost Management and the Reporting
 * Dashboard.
 */
const UnitCostPreview = ({ bomId, bomVersion = '1.0', routerId, className = '' }) => {
  const [state, setState] = useState({ loading: false, data: null });

  useEffect(() => {
    if (!bomId && !routerId) {
      setState({ loading: false, data: null });
      return undefined;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const params = {};
    if (bomId) {
      params.bom_id = bomId;
      params.bom_version = bomVersion || '1.0';
    }
    if (routerId) params.router_id = routerId;

    api
      .get('/products/unit-cost', { params, suppressErrorToast: true })
      .then((res) => {
        if (cancelled) return;
        setState({ loading: false, data: res?.data || null });
      })
      .catch(() => {
        if (!cancelled) setState({ loading: false, data: null });
      });

    return () => {
      cancelled = true;
    };
  }, [bomId, bomVersion, routerId]);

  if (!bomId && !routerId) {
    return (
      <div className={`rounded-md border border-dashed border-gray-300 bg-gray-50 p-3 text-sm text-gray-500 ${className}`}>
        Pick a BOM and a router to see the per-unit cost.
      </div>
    );
  }

  if (state.loading && !state.data) {
    return (
      <div className={`rounded-md border border-gray-200 bg-white p-3 text-sm text-gray-500 ${className}`}>
        Computing per-unit cost…
      </div>
    );
  }

  if (!state.data) return null;

  const { material_per_unit, labor_per_unit, machine_per_unit, total_per_unit, warnings = [] } = state.data;

  return (
    <div className={`rounded-md border bg-white p-3 text-sm ${warnings.length ? 'border-amber-300' : 'border-gray-200'} ${className}`}>
      <div className="flex items-center justify-between gap-4">
        <div className="text-gray-700">
          <span className="font-medium">Material</span> {fmt(material_per_unit)}
          <span className="mx-1 text-gray-400">+</span>
          <span className="font-medium">Labor</span> {fmt(labor_per_unit)}
          <span className="mx-1 text-gray-400">+</span>
          <span className="font-medium">Machine</span> {fmt(machine_per_unit)}
        </div>
        <div className="text-base">
          <span className="text-gray-500">= </span>
          <span className="font-semibold">{fmt(total_per_unit)}</span>
          <span className="ml-1 text-xs text-gray-500">/ unit</span>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {warnings.map((code) => (
            <Badge
              key={code}
              variant="outline"
              className="border-amber-400 bg-amber-50 text-amber-900"
            >
              ⚠ {WARNING_LABELS[code] || code}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
};

export default UnitCostPreview;
