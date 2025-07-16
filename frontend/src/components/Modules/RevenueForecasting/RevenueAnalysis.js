import React, { useMemo } from 'react';
import './RevenueForecasting.css';

const RevenueAnalysis = ({ data, timePeriods }) => {
  // Get unique segments
  const segments = useMemo(() => {
    const customers = Array.isArray(data.customers) ? data.customers : [];
    return [...new Set(customers.map(c => c.customer_type || c.region || 'General'))];
  }, [data.customers]);

  // Generate matrix data for analysis
  const matrixData = useMemo(() => {
    const matrix = [];
    
    const products = Array.isArray(data.products) ? data.products : [];
    const customers = Array.isArray(data.customers) ? data.customers : [];
    const sales = Array.isArray(data.sales_forecast) ? data.sales_forecast : [];
    
    products.forEach(product => {
      customers.forEach(customer => {
        const baseRow = {
          id: `${product.id}-${customer.customer_id}`,
          product_id: product.id,
          product_name: product.name || product.unit_name,
          customer_id: customer.customer_id,
          customer_name: customer.customer_name,
          segment: customer.customer_type || customer.region || 'General',
          total_quantity: 0,
          total_revenue: 0
        };

        // Add time period columns
        timePeriods.forEach(period => {
          const existingSale = sales.find(s => 
            s.unit_id === product.id && 
            s.customer_id === customer.customer_id && 
            s.period === period.key
          );
          
          baseRow[`quantity_${period.key}`] = existingSale?.quantity || 0;
          baseRow[`price_${period.key}`] = existingSale?.unit_price || 0; // Only use actual sale price, not base price
          baseRow[`revenue_${period.key}`] = (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
          
          baseRow.total_quantity += existingSale?.quantity || 0;
          baseRow.total_revenue += (existingSale?.quantity || 0) * (existingSale?.unit_price || 0);
        });

        matrix.push(baseRow);
      });
    });

    return matrix;
  }, [data.products, data.customers, data.sales_forecast, timePeriods]);

  return (
    <div className="analysis-tab">
      <h3>Segment Analysis</h3>
      <div className="segment-charts">
        {segments.map(segment => {
          const segmentData = matrixData.filter(row => row.segment === segment);
          const segmentRevenue = segmentData.reduce((sum, row) => sum + row.total_revenue, 0);
          const segmentQuantity = segmentData.reduce((sum, row) => sum + row.total_quantity, 0);
          
          return (
            <div key={segment} className="segment-card">
              <h4>{segment}</h4>
              <div className="segment-metrics">
                <p>Revenue: ${segmentRevenue.toLocaleString()}</p>
                <p>Quantity: {segmentQuantity.toLocaleString()}</p>
                <p>Products: {new Set(segmentData.map(row => row.product_id)).size}</p>
                <p>Customers: {new Set(segmentData.map(row => row.customer_id)).size}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default RevenueAnalysis; 