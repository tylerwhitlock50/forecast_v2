import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { StatsCard } from '../../ui/stats-card';
import { TrendingUp, Package, Users, DollarSign, BarChart3 } from 'lucide-react';

const RevenueSummary = ({ data, timePeriods, selectedSegment }) => {
  const { activeScenario } = useForecast();
  
  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    // Filter sales by active scenario first
    let filteredSales = sales.filter(sale => sale.forecast_id === (activeScenario || 'F001'));
    
    // Then filter by segment if needed
    if (selectedSegment !== 'all') {
      const segmentCustomers = customers.filter(c => 
        (c.customer_type || c.region || 'General') === selectedSegment
      );
      const segmentCustomerIds = segmentCustomers.map(c => c.customer_id);
      filteredSales = filteredSales.filter(s => segmentCustomerIds.includes(s.customer_id));
    }
    
    const totalQuantity = filteredSales.reduce((sum, sale) => sum + (sale.quantity || 0), 0);
    const totalRevenue = filteredSales.reduce((sum, sale) => sum + (sale.total_revenue || 0), 0);
    const productCount = new Set(filteredSales.map(sale => sale.unit_id)).size;
    const customerCount = new Set(filteredSales.map(sale => sale.customer_id)).size;

    return {
      totalQuantity,
      totalRevenue,
      productCount,
      customerCount,
      averagePrice: totalQuantity > 0 ? totalRevenue / totalQuantity : 0
    };
  }, [data.products, data.customers, data.sales_forecast, selectedSegment, activeScenario]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <StatsCard
        title="Total Revenue"
        value={`$${summaryStats.totalRevenue.toLocaleString()}`}
        variant="primary"
        className="border-l-4 border-l-blue-500"
      >
        <DollarSign className="h-4 w-4 text-blue-600 mt-2" />
      </StatsCard>
      
      <StatsCard
        title="Total Quantity"
        value={summaryStats.totalQuantity.toLocaleString()}
        variant="success"
        className="border-l-4 border-l-green-500"
      >
        <Package className="h-4 w-4 text-green-600 mt-2" />
      </StatsCard>
      
      <StatsCard
        title="Products"
        value={summaryStats.productCount}
        variant="warning"
        className="border-l-4 border-l-yellow-500"
      >
        <BarChart3 className="h-4 w-4 text-yellow-600 mt-2" />
      </StatsCard>
      
      <StatsCard
        title="Customers"
        value={summaryStats.customerCount}
        variant="default"
        className="border-l-4 border-l-gray-500"
      >
        <Users className="h-4 w-4 text-gray-600 mt-2" />
      </StatsCard>
      
      <StatsCard
        title="Avg Price"
        value={`$${summaryStats.averagePrice.toFixed(2)}`}
        variant="danger"
        className="border-l-4 border-l-red-500"
      >
        <TrendingUp className="h-4 w-4 text-red-600 mt-2" />
      </StatsCard>
    </div>
  );
};

export default RevenueSummary; 