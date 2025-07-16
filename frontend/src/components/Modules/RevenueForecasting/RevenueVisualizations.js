import React, { useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import './RevenueForecasting.css';

const RevenueVisualizations = ({ data, timePeriods }) => {
  const { activeScenario } = useForecast();
  // Generate matrix data for visualizations
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
            s.period === period.key &&
            s.forecast_id === (activeScenario || 'F001')
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
  }, [data.products, data.customers, data.sales_forecast, timePeriods, activeScenario]);

  return (
    <div className="visualization-tab">
      <h3>Revenue Visualizations</h3>
      <div className="visualization-grid">
        <div className="chart-container">
          <h4>Revenue by Product</h4>
          <div className="simple-chart">
            {Array.from(new Set(matrixData.map(row => row.product_name))).map(product => {
              const productRevenue = matrixData
                .filter(row => row.product_name === product)
                .reduce((sum, row) => sum + row.total_revenue, 0);
              const maxRevenue = Math.max(...Array.from(new Set(matrixData.map(row => row.product_name))).map(p => 
                matrixData.filter(row => row.product_name === p).reduce((sum, row) => sum + row.total_revenue, 0)
              ));
              const width = maxRevenue > 0 ? (productRevenue / maxRevenue) * 100 : 0;
              
              return (
                <div key={product} className="chart-bar">
                  <div className="bar-label">{product}</div>
                  <div className="bar-container">
                    <div className="bar" style={{ width: `${width}%` }}></div>
                    <span className="bar-value">${productRevenue.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="chart-container">
          <h4>Revenue by Customer</h4>
          <div className="simple-chart">
            {Array.from(new Set(matrixData.map(row => row.customer_name))).map(customer => {
              const customerRevenue = matrixData
                .filter(row => row.customer_name === customer)
                .reduce((sum, row) => sum + row.total_revenue, 0);
              const maxRevenue = Math.max(...Array.from(new Set(matrixData.map(row => row.customer_name))).map(c => 
                matrixData.filter(row => row.customer_name === c).reduce((sum, row) => sum + row.total_revenue, 0)
              ));
              const width = maxRevenue > 0 ? (customerRevenue / maxRevenue) * 100 : 0;
              
              return (
                <div key={customer} className="chart-bar">
                  <div className="bar-label">{customer}</div>
                  <div className="bar-container">
                    <div className="bar" style={{ width: `${width}%` }}></div>
                    <span className="bar-value">${customerRevenue.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        
        <div className="chart-container">
          <h4>Revenue by Time Period</h4>
          <div className="simple-chart">
            {timePeriods.map(period => {
              const periodRevenue = matrixData.reduce((sum, row) => sum + (row[`revenue_${period.key}`] || 0), 0);
              const maxRevenue = Math.max(...timePeriods.map(p => 
                matrixData.reduce((sum, row) => sum + (row[`revenue_${p.key}`] || 0), 0)
              ));
              const width = maxRevenue > 0 ? (periodRevenue / maxRevenue) * 100 : 0;
              
              return (
                <div key={period.key} className="chart-bar">
                  <div className="bar-label">{period.label}</div>
                  <div className="bar-container">
                    <div className="bar" style={{ width: `${width}%` }}></div>
                    <span className="bar-value">${periodRevenue.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RevenueVisualizations; 