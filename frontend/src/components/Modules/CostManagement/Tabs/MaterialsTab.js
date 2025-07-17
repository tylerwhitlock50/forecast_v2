import React from 'react';
import MetricsHorizonSelector from '../MetricsHorizonSelector';

const MaterialsTab = ({ materialsUsage, formatCurrency, startDate, endDate, onStartChange, onEndChange }) => (
  <div className="materials-tab">
    <MetricsHorizonSelector
      startDate={startDate}
      endDate={endDate}
      onStartChange={onStartChange}
      onEndChange={onEndChange}
    />
    <h3>Materials Usage Forecast</h3>
    <div className="materials-grid">
      {materialsUsage.map((material, index) => (
        <div key={index} className="material-card">
          <h4>{material.material_description}</h4>
          <div className="material-metrics">
            <div className="metric">
              <span className="metric-label">Quantity Needed</span>
              <span className="metric-value">{material.total_quantity_needed} {material.unit}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Unit Price</span>
              <span className="metric-value">{formatCurrency(material.unit_price)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Total Cost</span>
              <span className="metric-value">{formatCurrency(material.total_cost)}</span>
            </div>
          </div>
          <div className="products-using">
            <strong>Used by:</strong>
            <div className="product-tags">
              {material.products_using.map((product, i) => (
                <span key={i} className="product-tag">{product}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default MaterialsTab;
