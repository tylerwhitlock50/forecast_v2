import React from 'react';
import LaborHorizonSelector from '../LaborHorizonSelector';

const LaborTab = ({ laborUtilization, formatCurrency, startDate, endDate, onStartChange, onEndChange }) => (
  <div className="labor-tab">
    <LaborHorizonSelector
      startDate={startDate}
      endDate={endDate}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
    />
    <h3>Labor Utilization</h3>
    <div className="labor-grid">
      {laborUtilization.map((labor, index) => (
        <div key={index} className="labor-card">
          <h4>{labor.labor_type_name}</h4>
          <div className="labor-metrics">
            <div className="metric">
              <span className="metric-label">Required Minutes</span>
              <span className="metric-value">{Math.round(labor.total_minutes_required)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Required Hours</span>
              <span className="metric-value">{Math.round(labor.total_minutes_required / 60)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Hourly Rate</span>
              <span className="metric-value">{formatCurrency(labor.hourly_rate)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Total Cost</span>
              <span className="metric-value">{formatCurrency(labor.total_cost)}</span>
            </div>
          </div>
          <div className="products-involved">
            <strong>Products:</strong>
            <div className="product-tags">
              {labor.products_involved.map((product, i) => (
                <span key={i} className="product-tag">{product}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default LaborTab;
