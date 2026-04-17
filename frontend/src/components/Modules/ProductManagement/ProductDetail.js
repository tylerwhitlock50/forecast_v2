import React, { useMemo, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { PageHeader } from '../../ui/page-header';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import UnitCostPreview from '../../Common/UnitCostPreview';
import ProductModal from './ProductModal';

const fmtMoney = (n) =>
  n == null || Number.isNaN(Number(n))
    ? '—'
    : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtNum = (n) =>
  n == null ? '—' : Number(n).toLocaleString();

const ProductDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data, actions, activeScenario, loading } = useForecast();
  const [showEditModal, setShowEditModal] = useState(false);

  const product = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    return products.find((p) => p.unit_id === id) || null;
  }, [data.products, id]);

  const bomLines = useMemo(() => {
    if (!product?.bom) return [];
    const bom = Array.isArray(data.bom) ? data.bom : [];
    return bom
      .filter(
        (line) =>
          line.bom_id === product.bom &&
          (line.version || '1.0') === (product.bom_version || '1.0')
      )
      .sort((a, b) => (a.bom_line || 0) - (b.bom_line || 0));
  }, [data.bom, product]);

  const routerOps = useMemo(() => {
    if (!product?.router) return [];
    const ops = Array.isArray(data.router_operations) ? data.router_operations : [];
    return ops
      .filter((op) => op.router_id === product.router)
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
  }, [data.router_operations, product]);

  const productSales = useMemo(() => {
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    return sales
      .filter(
        (s) => s.unit_id === id && (!activeScenario || s.forecast_id === activeScenario)
      )
      .sort((a, b) => (a.period || '').localeCompare(b.period || ''));
  }, [data.sales_forecast, id, activeScenario]);

  const customersById = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return Object.fromEntries(customers.map((c) => [c.customer_id, c]));
  }, [data.customers]);

  const machinesById = useMemo(() => {
    const machines = Array.isArray(data.machines) ? data.machines : [];
    return Object.fromEntries(machines.map((m) => [m.machine_id, m]));
  }, [data.machines]);

  const ratesById = useMemo(() => {
    const rates = Array.isArray(data.labor_rates) ? data.labor_rates : [];
    return Object.fromEntries(rates.map((r) => [r.rate_id, r]));
  }, [data.labor_rates]);

  const opCost = (op) => {
    const m = machinesById[op.machine_id];
    const r = ratesById[op.labor_type_id];
    const machineCost = m ? ((op.machine_minutes || 0) / 60) * (m.machine_rate || 0) : 0;
    const laborCost = r ? ((op.labor_minutes || 0) / 60) * (r.rate_amount || 0) : 0;
    return { machineCost, laborCost, total: machineCost + laborCost };
  };

  const forecastTotals = useMemo(() => {
    const totalQty = productSales.reduce((s, row) => s + (row.quantity || 0), 0);
    const totalRevenue = productSales.reduce((s, row) => s + (row.total_revenue || 0), 0);
    return { totalQty, totalRevenue };
  }, [productSales]);

  if (loading && !product) {
    return (
      <div className="container mx-auto px-6 py-8 text-muted-foreground">Loading…</div>
    );
  }

  if (!product) {
    return (
      <div className="container mx-auto px-6 py-8">
        <PageHeader
          title="Product not found"
          description={`No product with ID ${id}.`}
          actions={[{ label: 'Back to products', onClick: () => navigate('/products'), variant: 'outline' }]}
        />
      </div>
    );
  }

  const headerActions = [
    { label: 'Edit product', onClick: () => setShowEditModal(true), variant: 'default', className: 'bg-orange-600 hover:bg-orange-700' },
    { label: 'Back to products', onClick: () => navigate('/products'), variant: 'outline' },
  ];

  const description = [
    product.unit_type || 'General',
    product.base_price ? `Base price ${fmtMoney(product.base_price)}` : null,
    product.unit_description,
  ].filter(Boolean).join(' · ');

  return (
    <div className="container mx-auto px-6 py-8 space-y-6">
      <PageHeader
        title={product.unit_name || product.unit_id}
        description={description}
        actions={headerActions}
      />

      <div className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
        <Badge variant="outline">{product.unit_id}</Badge>
        {product.bom
          ? <Badge variant="outline">BOM: {product.bom} (v{product.bom_version || '1.0'})</Badge>
          : <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">No BOM</Badge>}
        {product.router
          ? <Badge variant="outline">Router: {product.router}</Badge>
          : <Badge variant="outline" className="border-amber-400 bg-amber-50 text-amber-900">No router</Badge>}
      </div>

      <UnitCostPreview
        bomId={product.bom || null}
        bomVersion={product.bom_version || '1.0'}
        routerId={product.router || null}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* BOM */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Bill of Materials</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                {product.bom
                  ? `${product.bom} · v${product.bom_version || '1.0'} · ${bomLines.length} line${bomLines.length === 1 ? '' : 's'}`
                  : 'No BOM assigned to this product.'}
              </div>
            </div>
            {product.bom && (
              <Button variant="outline" size="sm" onClick={() => navigate('/bom')}>
                Manage BOM
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {bomLines.length === 0 ? (
              <div className="text-sm text-muted-foreground">No lines in this BOM.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2">#</th>
                    <th className="py-2">Material</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2">Unit</th>
                    <th className="py-2 text-right">Unit price</th>
                    <th className="py-2 text-right">Cost / unit</th>
                  </tr>
                </thead>
                <tbody>
                  {bomLines.map((line) => (
                    <tr key={`${line.bom_id}-${line.version}-${line.bom_line}`} className="border-b last:border-0">
                      <td className="py-2">{line.bom_line}</td>
                      <td className="py-2">{line.material_description}</td>
                      <td className="py-2 text-right">{fmtNum(line.qty)}</td>
                      <td className="py-2">{line.unit}</td>
                      <td className="py-2 text-right">{fmtMoney(line.unit_price)}</td>
                      <td className="py-2 text-right">{fmtMoney(line.material_cost)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td colSpan={5} className="py-2 text-right">Material / unit:</td>
                    <td className="py-2 text-right">
                      {fmtMoney(bomLines.reduce((s, l) => s + (l.material_cost || 0), 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Routing */}
        <Card>
          <CardHeader className="flex flex-row items-start justify-between">
            <div>
              <CardTitle>Routing</CardTitle>
              <div className="mt-1 text-sm text-muted-foreground">
                {product.router
                  ? `${product.router} · ${routerOps.length} operation${routerOps.length === 1 ? '' : 's'}`
                  : 'No router assigned to this product.'}
              </div>
            </div>
            {product.router && (
              <Button variant="outline" size="sm" onClick={() => navigate('/routing')}>
                Manage routing
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {routerOps.length === 0 ? (
              <div className="text-sm text-muted-foreground">No operations on this router.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-muted-foreground border-b">
                    <th className="py-2">Seq</th>
                    <th className="py-2">Machine</th>
                    <th className="py-2 text-right">Min</th>
                    <th className="py-2">Labor rate</th>
                    <th className="py-2 text-right">Min</th>
                    <th className="py-2 text-right">$/unit</th>
                  </tr>
                </thead>
                <tbody>
                  {routerOps.map((op) => {
                    const costs = opCost(op);
                    const machine = machinesById[op.machine_id];
                    const rate = ratesById[op.labor_type_id];
                    return (
                      <tr key={op.operation_id || `${op.router_id}-${op.sequence}`} className="border-b last:border-0">
                        <td className="py-2">{op.sequence}</td>
                        <td className="py-2">
                          {machine ? machine.machine_name : (
                            <span className="text-amber-700" title="Machine not found">{op.machine_id} ⚠</span>
                          )}
                        </td>
                        <td className="py-2 text-right">{fmtNum(op.machine_minutes)}</td>
                        <td className="py-2">
                          {op.labor_type_id ? (
                            rate ? rate.rate_name : (
                              <span className="text-amber-700" title="Labor rate not found">{op.labor_type_id} ⚠</span>
                            )
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="py-2 text-right">{fmtNum(op.labor_minutes)}</td>
                        <td className="py-2 text-right">{fmtMoney(costs.total)}</td>
                      </tr>
                    );
                  })}
                  <tr className="font-semibold">
                    <td colSpan={5} className="py-2 text-right">Conversion / unit:</td>
                    <td className="py-2 text-right">
                      {fmtMoney(routerOps.reduce((s, op) => s + opCost(op).total, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Forecast contribution */}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle>Forecast contribution</CardTitle>
            <div className="mt-1 text-sm text-muted-foreground">
              {activeScenario
                ? `Sales for ${product.unit_id} in scenario ${activeScenario}`
                : 'No active scenario selected — showing all scenarios.'}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate('/sales-forecast')}>
            Edit forecast
          </Button>
        </CardHeader>
        <CardContent>
          {productSales.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No forecast rows for this product in the active scenario.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted-foreground border-b">
                  <th className="py-2">Period</th>
                  <th className="py-2">Customer</th>
                  <th className="py-2 text-right">Qty</th>
                  <th className="py-2 text-right">Unit price</th>
                  <th className="py-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {productSales.map((s) => (
                  <tr key={s.sale_id} className="border-b last:border-0">
                    <td className="py-2">{s.period}</td>
                    <td className="py-2">
                      {customersById[s.customer_id]?.customer_name || s.customer_id}
                    </td>
                    <td className="py-2 text-right">{fmtNum(s.quantity)}</td>
                    <td className="py-2 text-right">{fmtMoney(s.unit_price)}</td>
                    <td className="py-2 text-right">{fmtMoney(s.total_revenue)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td colSpan={2} className="py-2 text-right">Totals:</td>
                  <td className="py-2 text-right">{fmtNum(forecastTotals.totalQty)}</td>
                  <td />
                  <td className="py-2 text-right">{fmtMoney(forecastTotals.totalRevenue)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {showEditModal && (
        <ProductModal
          isOpen={showEditModal}
          onClose={() => setShowEditModal(false)}
          onSave={async (updated) => {
            await actions.updateProduct(product.unit_id, updated);
            setShowEditModal(false);
          }}
          product={product}
          bomData={data.bom || []}
          routerData={data.router_definitions || []}
          actions={actions}
        />
      )}
    </div>
  );
};

export default ProductDetail;
