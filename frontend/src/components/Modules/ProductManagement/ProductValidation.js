import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../../lib/apiClient';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { productCostChecks } from './productOptions';

const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt = (v) => (v === null || v === undefined ? '—' : money2.format(Number(v) || 0));

/**
 * Costing checks per product, from the same cost rollup the COGS forecast
 * uses (GET /products/cost-summary): does the BOM (and its version) exist
 * and cost something, does the routing have operations, machines and labor
 * rates, and what does one unit cost.
 */
const ProductValidation = ({ products }) => {
  const [costRows, setCostRows] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await api.get('/products/cost-summary', { suppressErrorToast: true });
      setCostRows(res?.data?.products || []);
    } catch (err) {
      setLoadError(err?.userMessage || 'Could not load unit costs');
      setCostRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, products]);

  const rows = useMemo(() => {
    const byId = new Map((costRows || []).map(r => [r.product_id, r]));
    return (products || []).map(p => {
      const cost = byId.get(p.unit_id) || null;
      const { problems, unitCost } = productCostChecks(p, cost);
      return { product: p, cost, problems, unitCost, errors: problems.filter(x => x.level === 'error').length };
    }).sort((a, b) => b.errors - a.errors || b.problems.length - a.problems.length
      || String(a.product.unit_name || '').localeCompare(String(b.product.unit_name || '')));
  }, [products, costRows]);

  const ok = rows.filter(r => r.problems.length === 0).length;
  const withErrors = rows.filter(r => r.errors > 0).length;
  const withWarnings = rows.length - ok - withErrors;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-green-200 bg-green-50/50 px-4 py-3">
          <div className="text-sm font-medium text-gray-600">Cost out fully</div>
          <div className="mt-1 text-2xl font-bold text-green-700 tabular-nums">{ok}</div>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50/50 px-4 py-3">
          <div className="text-sm font-medium text-gray-600">Missing cost (COGS understated)</div>
          <div className="mt-1 text-2xl font-bold text-red-700 tabular-nums">{withErrors}</div>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3">
          <div className="text-sm font-medium text-gray-600">Worth a look</div>
          <div className="mt-1 text-2xl font-bold text-amber-700 tabular-nums">{withWarnings}</div>
        </div>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle className="text-lg">Unit cost by product</CardTitle>
            <div className="flex items-center gap-3 text-sm">
              <Link to="/bom" className="font-medium text-orange-700 hover:underline">BOMs</Link>
              <Link to="/routing" className="font-medium text-orange-700 hover:underline">Routings</Link>
              <Button variant="outline" size="sm" onClick={load} disabled={loading}>{loading ? 'Checking…' : 'Check again'}</Button>
            </div>
          </div>
          <p className="text-sm text-gray-600">Material from the product's BOM version, labor and machine time from its routing: the same numbers the COGS forecast uses.</p>
          {loadError && <p className="text-sm text-red-700">{loadError}</p>}
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="min-w-full text-sm tabular-nums">
              <thead className="bg-gray-50 text-gray-600">
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Product</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">BOM</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Material</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Labor</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Machine</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Unit cost</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">List price</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Checks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(({ product: p, cost, problems, unitCost }) => (
                  <tr key={p.unit_id} className="align-top hover:bg-gray-50">
                    <td className="px-3 py-2">
                      <Link to={`/products/${encodeURIComponent(p.unit_id)}`} className="font-medium text-gray-900 hover:text-orange-700 hover:underline">
                        {p.unit_name || p.unit_id}
                      </Link>
                      <div className="font-mono text-xs text-gray-500">{p.unit_id}{p.unit_type ? ` · ${p.unit_type}` : ''}</div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700">
                      {p.bom ? `${p.bom} v${cost?.bom_version_used || p.bom_version || '1.0'}` : '—'}
                    </td>
                    <td className="px-3 py-2 text-right">{cost ? fmt(cost.unit_material_cost) : '—'}</td>
                    <td className="px-3 py-2 text-right">{cost ? fmt(cost.unit_labor_cost) : '—'}</td>
                    <td className="px-3 py-2 text-right">{cost ? fmt(cost.unit_machine_cost) : '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-gray-900">{unitCost === null ? '—' : fmt(unitCost)}</td>
                    <td className="px-3 py-2 text-right">{Number(p.base_price) > 0 ? fmt(p.base_price) : '—'}</td>
                    <td className="px-3 py-2">
                      {problems.length === 0 ? (
                        <span className="text-xs font-medium text-green-700">OK</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {problems.map(pr => (
                            <li key={pr.text} className={`text-xs ${pr.level === 'error' ? 'font-medium text-red-700' : 'text-amber-800'}`}>{pr.text}</li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ProductValidation;
