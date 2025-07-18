import React, { useState, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import {
  calculateProductCostSummary,
  calculateMaterialsUsage,
  calculateMachineUtilization,
  calculateLaborUtilization,
  getBOMDetails,
  getRoutingDetails
} from './CostCalculations';
import './CostManagement.css';

const CostManagement = () => {
  const { data, loading, activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedPeriod, setSelectedPeriod] = useState('all');
  const [recalculateTrigger, setRecalculateTrigger] = useState(0);

  // Get unique periods from forecast data
  const availablePeriods = useMemo(() => {
    const periods = [...new Set((data.sales_forecast || []).map(f => f.period))].sort();
    return periods;
  }, [data.sales_forecast]);

  // Calculate cost summary
  const costSummary = useMemo(() => {
    if (!data || !data.products || !data.sales_forecast) return [];
    
    try {
      const summary = calculateProductCostSummary(data);
      return summary.filter(product => product.forecast_quantity > 0); // Only show products with forecasts
    } catch (error) {
      console.error('Error calculating cost summary:', error);
      toast.error('Error calculating cost summary');
      return [];
    }
  }, [data]);

  // Calculate materials usage
  const materialsUsage = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateMaterialsUsage(data);
    } catch (error) {
      console.error('Error calculating materials usage:', error);
      toast.error('Error calculating materials usage');
      return {};
    }
  }, [data]);

  // Calculate machine utilization
  const machineUtilization = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateMachineUtilization(data);
    } catch (error) {
      console.error('Error calculating machine utilization:', error);
      toast.error('Error calculating machine utilization');
      return {};
    }
  }, [data]);

  // Calculate labor utilization
  const laborUtilization = useMemo(() => {
    if (!data || !data.sales_forecast) return {};
    
    try {
      return calculateLaborUtilization(data);
    } catch (error) {
      console.error('Error calculating labor utilization:', error);
      toast.error('Error calculating labor utilization');
      return {};
    }
  }, [data]);

  // Get BOM details for selected product
  const bomDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.bom_id || !data) return [];
    return getBOMDetails(data, selectedProduct.bom_id);
  }, [selectedProduct, data]);

  // Get routing details for selected product
  const routingDetails = useMemo(() => {
    if (!selectedProduct || !selectedProduct.router_id || !data) return [];
    return getRoutingDetails(data, selectedProduct.router_id);
  }, [selectedProduct, data]);

  // Handle product tile click
  const handleProductClick = (product) => {
    setSelectedProduct(product);
  };

  // Handle recalculate costs
  const handleRecalculateCosts = () => {
    setRecalculateTrigger(prev => prev + 1);
    toast.success('Costs recalculated');
  };

  // Get data for selected period
  const getDataForPeriod = (periodData, period) => {
    if (period === 'all') {
      // Combine all periods
      const combined = {};
      Object.keys(periodData).forEach(p => {
        periodData[p].forEach(item => {
          const key = item.material_description || item.machine_id || item.labor_type_id;
          if (!combined[key]) {
            combined[key] = { ...item };
          } else {
            // Combine quantities and costs
            combined[key].total_quantity_needed = (combined[key].total_quantity_needed || 0) + (item.total_quantity_needed || 0);
            combined[key].total_cost = (combined[key].total_cost || 0) + (item.total_cost || 0);
            combined[key].total_minutes_required = (combined[key].total_minutes_required || 0) + (item.total_minutes_required || 0);
            combined[key].total_hours_required = (combined[key].total_hours_required || 0) + (item.total_hours_required || 0);
            
            // For products_using or products_involved, combine arrays
            if (item.products_using) {
              combined[key].products_using = [...new Set([...(combined[key].products_using || []), ...item.products_using])];
            }
            if (item.products_involved) {
              combined[key].products_involved = [...new Set([...(combined[key].products_involved || []), ...item.products_involved])];
            }
          }
        });
      });
      
      // Recalculate utilization for machines
      Object.keys(combined).forEach(key => {
        const item = combined[key];
        if (item.available_minutes_per_month) {
          item.utilization_percent = (item.total_minutes_required / item.available_minutes_per_month) * 100;
          item.capacity_exceeded = item.utilization_percent > 100;
        }
        if (item.total_hours_required) {
          item.fte_required = item.total_hours_required / 173.33; // Monthly working hours
        }
      });
      
      return Object.values(combined);
    }
    
    return periodData[period] || [];
  };

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(1)}%`;
  };

  const formatNumber = (value, decimals = 0) => {
    return new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    }).format(value || 0);
  };

  if (loading) {
    return (
      <div className="cost-management">
        <div className="loading-spinner">
          <div className="spinner"></div>
          <p>Loading cost data...</p>
        </div>
      </div>
    );
  }

  // Calculate summary statistics
  const totalRevenue = costSummary.reduce((sum, p) => sum + p.forecasted_revenue, 0);
  const totalCOGS = costSummary.reduce((sum, p) => sum + p.total_cogs, 0);
  const totalMaterialCost = costSummary.reduce((sum, p) => sum + p.material_cost, 0);
  const totalLaborCost = costSummary.reduce((sum, p) => sum + p.labor_cost, 0);
  const totalMachineCost = costSummary.reduce((sum, p) => sum + p.machine_cost, 0);
  const overallMargin = totalRevenue > 0 ? ((totalRevenue - totalCOGS) / totalRevenue) * 100 : 0;

  return (
    <div className="cost-management">
      <div className="cost-header">
        <h2>Cost Management</h2>
        <div className="header-controls">
          <button 
            onClick={handleRecalculateCosts}
            className="btn-secondary"
            title="Recalculate all costs"
          >
            🔄 Recalculate
          </button>
          {activeScenario && (
            <div className="scenario-info">
              <span>Scenario: {activeScenario}</span>
            </div>
          )}
        </div>
      </div>

      <div className="cost-summary-stats">
        <div className="summary-stat">
          <span className="stat-label">Total Revenue</span>
          <span className="stat-value">{formatCurrency(totalRevenue)}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Total COGS</span>
          <span className="stat-value">{formatCurrency(totalCOGS)}</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Materials</span>
          <span className="stat-value">{formatCurrency(totalMaterialCost)}</span>
          <span className="stat-percentage">({totalCOGS > 0 ? formatPercent((totalMaterialCost / totalCOGS) * 100) : '0%'})</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Labor</span>
          <span className="stat-value">{formatCurrency(totalLaborCost)}</span>
          <span className="stat-percentage">({totalCOGS > 0 ? formatPercent((totalLaborCost / totalCOGS) * 100) : '0%'})</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Machines</span>
          <span className="stat-value">{formatCurrency(totalMachineCost)}</span>
          <span className="stat-percentage">({totalCOGS > 0 ? formatPercent((totalMachineCost / totalCOGS) * 100) : '0%'})</span>
        </div>
        <div className="summary-stat">
          <span className="stat-label">Overall Margin</span>
          <span className="stat-value">{formatPercent(overallMargin)}</span>
        </div>
      </div>

      <div className="cost-tabs">
        <button 
          className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Product Overview
        </button>
        <button 
          className={`tab ${activeTab === 'materials' ? 'active' : ''}`}
          onClick={() => setActiveTab('materials')}
        >
          Materials Dashboard
        </button>
        <button 
          className={`tab ${activeTab === 'machines' ? 'active' : ''}`}
          onClick={() => setActiveTab('machines')}
        >
          Machine Utilization
        </button>
        <button 
          className={`tab ${activeTab === 'labor' ? 'active' : ''}`}
          onClick={() => setActiveTab('labor')}
        >
          Labor & FTE
        </button>
      </div>

      {/* Period selector for non-overview tabs */}
      {activeTab !== 'overview' && (
        <div className="period-selector">
          <label>View Period:</label>
          <select
            value={selectedPeriod}
            onChange={(e) => setSelectedPeriod(e.target.value)}
          >
            <option value="all">All Periods Combined</option>
            {availablePeriods.map(period => (
              <option key={period} value={period}>{period}</option>
            ))}
          </select>
        </div>
      )}

      <div className="cost-content">
        {activeTab === 'overview' && (
          <div className="overview-tab">
            <div className="product-tiles">
              {costSummary.map((product) => (
                <div 
                  key={product.product_id} 
                  className={`product-tile ${selectedProduct?.product_id === product.product_id ? 'selected' : ''}`}
                  onClick={() => handleProductClick(product)}
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
                    <div className="metric">
                      <span className="metric-label">Quantity</span>
                      <span className="metric-value">{formatNumber(product.forecast_quantity)}</span>
                    </div>
                  </div>
                  <div className="cost-breakdown">
                    <div className="cost-item">
                      <span>Materials:</span>
                      <span>{formatCurrency(product.material_cost)}</span>
                      <span className="percentage">({product.total_cogs > 0 ? formatPercent((product.material_cost / product.total_cogs) * 100) : '0%'})</span>
                    </div>
                    <div className="cost-item">
                      <span>Labor:</span>
                      <span>{formatCurrency(product.labor_cost)}</span>
                      <span className="percentage">({product.total_cogs > 0 ? formatPercent((product.labor_cost / product.total_cogs) * 100) : '0%'})</span>
                    </div>
                    <div className="cost-item">
                      <span>Machines:</span>
                      <span>{formatCurrency(product.machine_cost)}</span>
                      <span className="percentage">({product.total_cogs > 0 ? formatPercent((product.machine_cost / product.total_cogs) * 100) : '0%'})</span>
                    </div>
                  </div>
                  <div className="unit-costs">
                    <small>Unit costs: Mat: {formatCurrency(product.unit_material_cost)}, Lab: {formatCurrency(product.unit_labor_cost)}, Mach: {formatCurrency(product.unit_machine_cost)}</small>
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
                          {bomDetails.map((item, index) => (
                            <tr key={index}>
                              <td>{item.bom_line}</td>
                              <td>{item.material_description}</td>
                              <td>{formatNumber(item.qty, 2)}</td>
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
                    <h4>Routing Operations</h4>
                    <div className="routing-table">
                      <table>
                        <thead>
                          <tr>
                            <th>Seq</th>
                            <th>Machine</th>
                            <th>Machine Min</th>
                            <th>Labor Min</th>
                            <th>Labor Type</th>
                            <th>Labor Rate</th>
                          </tr>
                        </thead>
                        <tbody>
                          {routingDetails.map((item, index) => (
                            <tr key={index}>
                              <td>{item.sequence}</td>
                              <td>{item.machine_name}</td>
                              <td>{formatNumber(item.machine_minutes)}</td>
                              <td>{formatNumber(item.labor_minutes)}</td>
                              <td>{item.rate_name}</td>
                              <td>{formatCurrency(item.rate_amount)}</td>
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
        )}

        {activeTab === 'materials' && (
          <div className="materials-tab">
            <h3>Materials Usage Forecast - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</h3>
            <div className="materials-grid">
              {getDataForPeriod(materialsUsage, selectedPeriod).map((material, index) => (
                <div key={index} className="material-card">
                  <h4>{material.material_description}</h4>
                  <div className="material-metrics">
                    <div className="metric">
                      <span className="metric-label">Quantity Needed</span>
                      <span className="metric-value">{formatNumber(material.total_quantity_needed, 2)} {material.unit}</span>
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
        )}

        {activeTab === 'machines' && (
          <div className="machines-tab">
            <h3>Machine Utilization - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</h3>
            <div className="machines-grid">
              {getDataForPeriod(machineUtilization, selectedPeriod).map((machine, index) => (
                <div key={index} className={`machine-card ${machine.capacity_exceeded ? 'over-capacity' : ''}`}>
                  <h4>{machine.machine_name}</h4>
                  <div className="machine-metrics">
                    <div className="metric">
                      <span className="metric-label">Required Minutes</span>
                      <span className="metric-value">{formatNumber(machine.total_minutes_required)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Available Minutes</span>
                      <span className="metric-value">{formatNumber(machine.available_minutes_per_month)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Utilization</span>
                      <span className="metric-value">{formatPercent(machine.utilization_percent)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Total Cost</span>
                      <span className="metric-value">{formatCurrency(machine.total_cost)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Machine Rate</span>
                      <span className="metric-value">{formatCurrency(machine.machine_rate)}/hr</span>
                    </div>
                  </div>
                  {machine.capacity_exceeded && (
                    <div className="capacity-warning">
                      ⚠️ Capacity Exceeded by {formatPercent(machine.utilization_percent - 100)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'labor' && (
          <div className="labor-tab">
            <h3>Labor Utilization & FTE - {selectedPeriod === 'all' ? 'All Periods' : selectedPeriod}</h3>
            <div className="labor-grid">
              {getDataForPeriod(laborUtilization, selectedPeriod).map((labor, index) => (
                <div key={index} className="labor-card">
                  <h4>{labor.labor_type_name}</h4>
                  <div className="labor-type-badge">
                    {labor.labor_type}
                  </div>
                  <div className="labor-metrics">
                    <div className="metric">
                      <span className="metric-label">Required Minutes</span>
                      <span className="metric-value">{formatNumber(labor.total_minutes_required)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Required Hours</span>
                      <span className="metric-value">{formatNumber(labor.total_hours_required)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">FTE Required</span>
                      <span className="metric-value">{formatNumber(labor.fte_required, 2)}</span>
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
        )}
      </div>
    </div>
  );
};

export default CostManagement;