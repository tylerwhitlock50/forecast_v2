import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useForecast } from '../../../context/ForecastContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import DeductionsTab from './DeductionsTab';
import PriceListTab from './PriceListTab';
import { distinctValues } from './pricingUtils';

const TABS = [
  { id: 'deductions', label: 'Discounts & allowances' },
  { id: 'prices', label: 'Price list' },
];

/**
 * Pricing & deductions: what customers pay (price list) and what comes off
 * gross sales to get net sales (terms, chargebacks, other allowances,
 * embedded excise tax), plus commissions.
 */
const PricingPage = () => {
  const { data, scenarios, activeScenario, actions } = useForecast();
  const [params, setParams] = useSearchParams();
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'deductions';

  const customers = useMemo(() => (data?.customers || []).slice().sort((a, b) => String(a.customer_name || a.customer_id).localeCompare(String(b.customer_name || b.customer_id))), [data?.customers]);
  const products = useMemo(() => (data?.products || []).slice().sort((a, b) => String(a.unit_name || a.unit_id).localeCompare(String(b.unit_name || b.unit_id))), [data?.products]);
  const customerTypes = useMemo(() => distinctValues(customers, 'customer_type'), [customers]);
  const productTypes = useMemo(() => distinctValues(products, 'unit_type'), [products]);
  const scenario = activeScenario ? scenarios?.[activeScenario] || null : null;

  // Re-priced sales change revenue on every screen; reload the shared data.
  // Rule edits only affect this page, which reloads its own lists.
  const handleChanged = async (info) => {
    if (info?.salesChanged) await actions.fetchAllData();
  };

  const shared = { customers, products, customerTypes, productTypes, scenario, scenarios, onChanged: handleChanged };

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-gray-900">Pricing &amp; deductions</h1>
          <p className="mt-1 text-gray-600">
            Set what each customer type pays, and the discounts, allowances and excise tax that turn gross sales into net sales.
          </p>
        </div>
        {!scenario && (
          <p className="text-sm text-amber-700">
            No active scenario: rules you add are company-wide. <Link to="/scenarios" className="font-medium underline">Scenarios</Link>
          </p>
        )}
      </div>

      <Tabs value={tab} onValueChange={(value) => setParams(value === 'deductions' ? {} : { tab: value }, { replace: true })}>
        <TabsList className="h-11">
          {TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="px-4 py-2">{t.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="deductions" className="mt-6">
          <DeductionsTab {...shared} />
        </TabsContent>
        <TabsContent value="prices" className="mt-6">
          <PriceListTab {...shared} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default PricingPage;
