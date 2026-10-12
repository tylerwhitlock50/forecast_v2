import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Papa from 'papaparse';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import api from '../../../lib/apiClient';
import CustomerModal from '../CustomerManagement/CustomerModal';
import ProductModal from '../ProductManagement/ProductModal';

const blank = (v) => v === null || v === undefined || String(v).trim() === '';

const IssueCard = ({ title, tone = 'amber', help, children, count }) => (
  <Card>
    <CardHeader className="pb-2">
      <CardTitle className={`flex items-center gap-2 text-base ${tone === 'red' ? 'text-red-700' : 'text-gray-900'}`}>
        {title}
        <Badge variant="secondary">{count}</Badge>
      </CardTitle>
      {help && <p className="text-sm text-gray-600">{help}</p>}
    </CardHeader>
    <CardContent className="space-y-2">{children}</CardContent>
  </Card>
);

const Row = ({ title, subtitle, badges, action }) => (
  <div className="flex items-center justify-between gap-3 rounded-md border border-gray-200 px-3 py-2 hover:bg-gray-50">
    <div className="min-w-0">
      <div className="truncate text-sm font-medium text-gray-900">{title}</div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-gray-500">
        {subtitle}
        {badges}
      </div>
    </div>
    {action}
  </div>
);

/**
 * Checks that matter for the sales forecast: customers without a type
 * (customer-type prices and discounts cannot apply), products without a
 * list price, BOM or routing (no fallback price, no COGS), sales rows that
 * point at missing records, and unreadable periods.
 */
const RevenueValidation = ({ data }) => {
  const { actions } = useForecast();
  const [validationData, setValidationData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);

  const fetchValidationData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await api.get('/data/validation/issues', { suppressErrorToast: true });
      setValidationData(response?.data || {});
    } catch (error) {
      toast.error('Could not load the data checks');
      setValidationData({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchValidationData(); }, [fetchValidationData]);

  const checks = useMemo(() => {
    const customers = data.customers || [];
    const products = data.products || [];
    return {
      untypedCustomers: customers.filter(c => blank(c.customer_type)),
      unpricedProducts: products.filter(p => !(Number(p.base_price) > 0)),
      uncostedProducts: products.filter(p => blank(p.bom) || blank(p.router)),
      orphanedSales: validationData?.orphaned_sales || [],
      invalidPeriods: validationData?.invalid_periods || [],
    };
  }, [data.customers, data.products, validationData]);

  const total = checks.untypedCustomers.length + checks.unpricedProducts.length + checks.uncostedProducts.length
    + checks.orphanedSales.length + checks.invalidPeriods.length;

  const refreshAll = async () => {
    await Promise.all([fetchValidationData(), actions.fetchAllData()]);
  };

  const handleSaveCustomer = async (customerData) => {
    await actions.updateCustomer(editingCustomer.customer_id, customerData);
    setEditingCustomer(null);
    await refreshAll();
  };

  const handleSaveProduct = async (productData) => {
    await actions.updateProduct(editingProduct.unit_id, productData);
    setEditingProduct(null);
    await refreshAll();
  };

  const handleExportIssues = () => {
    const rows = [
      ...checks.untypedCustomers.map(c => ({ check: 'Customer without a type', id: c.customer_id, name: c.customer_name, detail: '' })),
      ...checks.unpricedProducts.map(p => ({ check: 'Product without a list price', id: p.unit_id, name: p.unit_name, detail: '' })),
      ...checks.uncostedProducts.map(p => ({
        check: 'Product without BOM or routing',
        id: p.unit_id,
        name: p.unit_name,
        detail: [blank(p.bom) && 'no BOM', blank(p.router) && 'no routing'].filter(Boolean).join(', '),
      })),
      ...checks.orphanedSales.map(s => ({ check: 'Sales row for a missing customer or product', id: s.sale_id, name: `${s.customer_id || ''} / ${s.unit_id || ''}`, detail: s.period || '' })),
      ...checks.invalidPeriods.map(s => ({ check: 'Unreadable period', id: s.sale_id, name: '', detail: s.period || '' })),
    ];
    if (rows.length === 0) {
      toast('Nothing to export: no issues found.', { icon: 'ℹ️' });
      return;
    }
    const csv = Papa.unparse(rows, { columns: ['check', 'id', 'name', 'detail'] });
    const url = URL.createObjectURL(new Blob([`﻿${csv}\n`], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-data-checks_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.success(`Exported ${rows.length} issue${rows.length === 1 ? '' : 's'}`);
  };

  if (loading && !validationData) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-orange-600" />
      </div>
    );
  }

  const editButton = (onClick) => <Button size="sm" variant="outline" onClick={onClick}>Edit</Button>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          {total === 0 ? 'No problems found in customers, products or sales rows.' : `${total} item${total === 1 ? '' : 's'} need attention before the forecast prices and costs out fully.`}
        </p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleExportIssues} disabled={total === 0}>Export list</Button>
          <Button variant="outline" size="sm" onClick={refreshAll}>Check again</Button>
        </div>
      </div>

      {checks.untypedCustomers.length > 0 && (
        <IssueCard
          title="Customers without a customer type"
          count={checks.untypedCustomers.length}
          help="Customer-type prices and discounts (Dealer, Distributor…) cannot apply to these customers."
        >
          {checks.untypedCustomers.map(c => (
            <Row key={c.customer_id} title={c.customer_name || c.customer_id} subtitle={<span>ID {c.customer_id}</span>} action={editButton(() => setEditingCustomer(c))} />
          ))}
        </IssueCard>
      )}

      {checks.unpricedProducts.length > 0 && (
        <IssueCard
          title="Products without a list price"
          count={checks.unpricedProducts.length}
          help="Sales rows without a price fall back to the list price; with none they import at $0 only when you allow it."
        >
          {checks.unpricedProducts.map(p => (
            <Row key={p.unit_id} title={p.unit_name || p.unit_id} subtitle={<span>ID {p.unit_id}</span>} action={editButton(() => setEditingProduct(p))} />
          ))}
        </IssueCard>
      )}

      {checks.uncostedProducts.length > 0 && (
        <IssueCard
          title="Products without a BOM or routing"
          count={checks.uncostedProducts.length}
          help={<>These products have no material or labor cost, so COGS is understated. <Link className="font-medium text-orange-700 hover:underline" to="/import">Import BOMs and routings</Link>, then link them here.</>}
        >
          {checks.uncostedProducts.map(p => (
            <Row
              key={p.unit_id}
              title={p.unit_name || p.unit_id}
              subtitle={<span>ID {p.unit_id}</span>}
              badges={<>
                {blank(p.bom) && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">No BOM</Badge>}
                {blank(p.router) && <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">No routing</Badge>}
              </>}
              action={editButton(() => setEditingProduct(p))}
            />
          ))}
        </IssueCard>
      )}

      {checks.orphanedSales.length > 0 && (
        <IssueCard
          tone="red"
          title="Sales rows for a missing customer or product"
          count={checks.orphanedSales.length}
          help="Add the customer or product back, or delete these rows."
        >
          {checks.orphanedSales.slice(0, 50).map((s, i) => (
            <Row key={s.sale_id || i} title={`${s.customer_id || '—'} · ${s.unit_id || '—'}`} subtitle={<span>{s.period || ''} · {s.sale_id}</span>} />
          ))}
          {checks.orphanedSales.length > 50 && <p className="text-xs text-gray-500">…and {checks.orphanedSales.length - 50} more (Export list for all).</p>}
        </IssueCard>
      )}

      {checks.invalidPeriods.length > 0 && (
        <IssueCard tone="red" title="Unreadable periods" count={checks.invalidPeriods.length} help="Periods must be months (YYYY-MM).">
          {checks.invalidPeriods.slice(0, 50).map((s, i) => (
            <Row key={s.sale_id || i} title={String(s.period)} subtitle={<span>{s.sale_id}</span>} />
          ))}
        </IssueCard>
      )}

      {total === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <div className="mb-2 text-3xl text-green-600">✓</div>
            <div className="text-base font-semibold text-gray-900">All checks pass</div>
          </CardContent>
        </Card>
      )}

      <CustomerModal
        isOpen={Boolean(editingCustomer)}
        onClose={() => setEditingCustomer(null)}
        onSave={handleSaveCustomer}
        customer={editingCustomer}
        existingCustomers={data.customers || []}
      />
      <ProductModal
        isOpen={Boolean(editingProduct)}
        onClose={() => setEditingProduct(null)}
        onSave={handleSaveProduct}
        product={editingProduct}
      />
    </div>
  );
};

export default RevenueValidation;
