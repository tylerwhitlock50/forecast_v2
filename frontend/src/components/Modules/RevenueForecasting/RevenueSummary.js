import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

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

  const summaryCards = [
    {
      title: "Total Revenue",
      value: `$${summaryStats.totalRevenue.toLocaleString()}`,
      icon: "💰",
      color: "text-green-600"
    },
    {
      title: "Total Quantity",
      value: summaryStats.totalQuantity.toLocaleString(),
      icon: "📦",
      color: "text-blue-600"
    },
    {
      title: "Products",
      value: summaryStats.productCount,
      icon: "🏷️",
      color: "text-purple-600"
    },
    {
      title: "Customers",
      value: summaryStats.customerCount,
      icon: "👥",
      color: "text-orange-600"
    },
    {
      title: "Avg Price",
      value: `$${summaryStats.averagePrice.toFixed(2)}`,
      icon: "💵",
      color: "text-indigo-600"
    }
  ];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      {summaryCards.map((card, index) => (
        <Card key={index} className="hover:shadow-lg transition-shadow">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-gray-600 flex items-center gap-2">
              <span>{card.icon}</span>
              {card.title}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={`text-2xl font-bold ${card.color}`}>
              {card.value}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default RevenueSummary; 