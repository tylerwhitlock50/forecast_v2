import React from 'react';

const OverviewTab = ({
  costSummary,
  selectedProduct,
  onProductClick,
  bomData,
  routingData,
  formatCurrency,
  formatPercent,
  setSelectedProduct
}) => (
  <div className="overview-tab">
    <div className="product-tiles">
      {costSummary.map((product) => (
        <div
          key={product.product_id}
          className={`product-tile ${selectedProduct?.product_id === product.product_id ? 'selected' : ''}`}
          onClick={() => onProductClick(product)}
        >
          <div className="product-header">
            <h3>{product.product_name}</h3>
            <span className="product-id">{product.product_id}</span>
          </div>
          <div className="product-metrics">
            <div className="metric">
              <span className="metric-label">Revenue</span>
              <span className="metric-value">{formatCurrency(product.forecasted_revenue)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">COGS</span>
              <span className="metric-value">{formatCurrency(product.total_cogs)}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Margin</span>
              <span className="metric-value">{formatPercent(product.gross_margin_percent)}</span>
            </div>
          </div>
          <div className="cost-breakdown">
            <div className="cost-item">
              <span>Materials:</span>
              <span>{formatCurrency(product.material_cost)}</span>
            </div>
            <div className="cost-item">
              <span>Labor:</span>
              <span>{formatCurrency(product.labor_cost)}</span>
            </div>
            <div className="cost-item">
              <span>Machines:</span>
              <span>{formatCurrency(product.machine_cost)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>

    {selectedProduct && (
      <div className="product-details">
        <div className="details-header">
          <h3>Details for {selectedProduct.product_name}</h3>
          <button onClick={() => setSelectedProduct(null)}>×</button>
        </div>

        <div className="details-tabs">
          <div className="detail-section">
            <h4>Bill of Materials</h4>
            <div className="bom-table">
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Material</th>
                    <th>Qty</th>
                    <th>Unit</th>
                    <th>Unit Price</th>
                    <th>Total Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {bomData.map((item, index) => (
                    <tr key={index}>
                      <td>{item.bom_line}</td>
                      <td>{item.material_description}</td>
                      <td>{item.qty}</td>
                      <td>{item.unit}</td>
                      <td>{formatCurrency(item.unit_price)}</td>
                      <td>{formatCurrency(item.material_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="detail-section">
            <h4>Routing</h4>
            <div className="routing-table">
              <table>
                <thead>
                  <tr>
                    <th>Seq</th>
                    <th>Machine</th>
                    <th>Machine Min</th>
                    <th>Labor Min</th>
                    <th>Labor Type</th>
                  </tr>
                </thead>
                <tbody>
                  {routingData.map((item, index) => (
                    <tr key={index}>
                      <td>{item.sequence}</td>
                      <td>{item.machine_name}</td>
                      <td>{item.machine_minutes}</td>
                      <td>{item.labor_minutes}</td>
                      <td>{item.rate_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    )}
  </div>
);

export default OverviewTab;
