import React, { useMemo } from 'react';
import './RevenueForecasting.css';

const RevenueSummary = ({ data, timePeriods, selectedSegment }) => {
  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    // Filter by segment if needed
    let filteredSales = sales;
    if (selectedSegment !== 'all') {
      const segmentCustomers = customers.filter(c => 
        (c.customer_type || c.region || 'General') === selectedSegment
      );
      const segmentCustomerIds = segmentCustomers.map(c => c.customer_id);
      filteredSales = sales.filter(s => segmentCustomerIds.includes(s.customer_id));
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
  }, [data.products, data.customers, data.sales_forecast, selectedSegment]);

  return (
    <div className="revenue-summary">
      <div className="summary-card">
        <h4>Total Revenue</h4>
        <p className="summary-value">${summaryStats.totalRevenue.toLocaleString()}</p>
      </div>
      <div className="summary-card">
        <h4>Total Quantity</h4>
        <p className="summary-value">{summaryStats.totalQuantity.toLocaleString()}</p>
      </div>
      <div className="summary-card">
        <h4>Products</h4>
        <p className="summary-value">{summaryStats.productCount}</p>
      </div>
      <div className="summary-card">
        <h4>Customers</h4>
        <p className="summary-value">{summaryStats.customerCount}</p>
      </div>
      <div className="summary-card">
        <h4>Avg Price</h4>
        <p className="summary-value">${summaryStats.averagePrice.toFixed(2)}</p>
      </div>
    </div>
  );
};

export default RevenueSummary; 