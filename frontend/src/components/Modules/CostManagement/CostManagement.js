import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './CostManagement.css';

const CostManagement = () => {
  const { activeScenario } = useForecast();
  const [activeTab, setActiveTab] = useState('overview');
  const [loading, setLoading] = useState(false);
  const [costSummary, setCostSummary] = useState([]);
  const [materialsUsage, setMaterialsUsage] = useState([]);
  const [machinesUtilization, setMachinesUtilization] = useState([]);
  const [laborUtilization, setLaborUtilization] = useState([]);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [bomData, setBomData] = useState([]);
  const [routingData, setRoutingData] = useState([]);
  const [showVersionModal, setShowVersionModal] = useState(false);
  const [versionType, setVersionType] = useState(''); // 'bom' or 'routing'

  const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8000';

  // Fetch cost summary
  const fetchCostSummary = async () => {
    try {
      setLoading(true);
      if (!activeScenario) {
        toast('Please select a forecast scenario first', { icon: 'ℹ️' });
        setLoading(false);
        return;
      }
      
      const url = `${API_BASE}/products/cost-summary?forecast_id=${activeScenario}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'success') {
        setCostSummary(data.data.products || []);
      }
    } catch (error) {
      console.error('Error fetching cost summary:', error);
      toast.error('Failed to load cost summary');
    } finally {
      setLoading(false);
    }
  };

  // Fetch materials usage
  const fetchMaterialsUsage = async () => {
    try {
      if (!activeScenario) return;
      const url = `${API_BASE}/materials/usage?forecast_id=${activeScenario}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'success') {
        setMaterialsUsage(data.data.materials || []);
      }
    } catch (error) {
      console.error('Error fetching materials usage:', error);
      toast.error('Failed to load materials usage');
    }
  };

  // Fetch machines utilization
  const fetchMachinesUtilization = async () => {
    try {
      if (!activeScenario) return;
      const url = `${API_BASE}/machines/utilization?forecast_id=${activeScenario}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'success') {
        setMachinesUtilization(data.data.machines || []);
      }
    } catch (error) {
      console.error('Error fetching machines utilization:', error);
      toast.error('Failed to load machines utilization');
    }
  };

  // Fetch labor utilization
  const fetchLaborUtilization = async () => {
    try {
      if (!activeScenario) return;
      const url = `${API_BASE}/labor/utilization?forecast_id=${activeScenario}`;
      const response = await fetch(url);
      const data = await response.json();
      if (data.status === 'success') {
        setLaborUtilization(data.data.labor || []);
      }
    } catch (error) {
      console.error('Error fetching labor utilization:', error);
      toast.error('Failed to load labor utilization');
    }
  };

  // Fetch BOM details
  const fetchBomDetails = async (bomId, version = '1.0') => {
    try {
      const response = await fetch(`${API_BASE}/bom/${bomId}?version=${version}`);
      const data = await response.json();
      if (data.status === 'success') {
        setBomData(data.data.bom || []);
      }
    } catch (error) {
      console.error('Error fetching BOM details:', error);
      toast.error('Failed to load BOM details');
    }
  };

  // Fetch routing details
  const fetchRoutingDetails = async (routerId, version = '1.0') => {
    try {
      const response = await fetch(`${API_BASE}/routing/${routerId}?version=${version}`);
      const data = await response.json();
      if (data.status === 'success') {
        setRoutingData(data.data.routing || []);
      }
    } catch (error) {
      console.error('Error fetching routing details:', error);
      toast.error('Failed to load routing details');
    }
  };

  // Handle product tile click
  const handleProductClick = (product) => {
    setSelectedProduct(product);
    if (product.bom_id) {
      fetchBomDetails(product.bom_id, product.bom_version);
    }
    if (product.router_id) {
      fetchRoutingDetails(product.router_id, product.router_version);
    }
  };

  // Handle version cloning
  const handleVersionClone = async (type, id, fromVersion, toVersion) => {
    try {
      const endpoint = type === 'bom' ? '/bom/clone' : '/routing/clone';
      const body = type === 'bom' 
        ? { bom_id: id, from_version: fromVersion, to_version: toVersion }
        : { router_id: id, from_version: fromVersion, to_version: toVersion };

      const response = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await response.json();
      if (data.status === 'success') {
        toast.success(data.message);
        setShowVersionModal(false);
        // Refresh the current data
        if (type === 'bom' && selectedProduct?.bom_id) {
          fetchBomDetails(selectedProduct.bom_id, toVersion);
        } else if (type === 'routing' && selectedProduct?.router_id) {
          fetchRoutingDetails(selectedProduct.router_id, toVersion);
        }
      }
    } catch (error) {
      console.error('Error cloning version:', error);
      toast.error('Failed to clone version');
    }
  };

  // Load data on component mount and when active scenario changes
  useEffect(() => {
    fetchCostSummary();
    fetchMaterialsUsage();
    fetchMachinesUtilization();
    fetchLaborUtilization();
  }, [activeScenario]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(value || 0);
  };

  const formatPercent = (value) => {
    return `${(value || 0).toFixed(1)}%`;
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

  return (
    <div className="cost-management">
      <div className="cost-header">
        <h2>Cost Management</h2>
        <div className="cost-summary-stats">
          <div className="summary-stat">
            <span className="stat-label">Total Products</span>
            <span className="stat-value">{costSummary.length}</span>
          </div>
          <div className="summary-stat">
            <span className="stat-label">Total COGS</span>
            <span className="stat-value">{formatCurrency(costSummary.reduce((sum, p) => sum + p.total_cogs, 0))}</span>
          </div>
          <div className="summary-stat">
            <span className="stat-label">Total Revenue</span>
            <span className="stat-value">{formatCurrency(costSummary.reduce((sum, p) => sum + p.forecasted_revenue, 0))}</span>
          </div>
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
          Machines Dashboard
        </button>
        <button 
          className={`tab ${activeTab === 'labor' ? 'active' : ''}`}
          onClick={() => setActiveTab('labor')}
        >
          Labor Dashboard
        </button>
      </div>

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
        )}

        {activeTab === 'materials' && (
          <div className="materials-tab">
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
        )}

        {activeTab === 'machines' && (
          <div className="machines-tab">
            <h3>Machine Utilization</h3>
            <div className="machines-grid">
              {machinesUtilization.map((machine, index) => (
                <div key={index} className={`machine-card ${machine.capacity_exceeded ? 'over-capacity' : ''}`}>
                  <h4>{machine.machine_name}</h4>
                  <div className="machine-metrics">
                    <div className="metric">
                      <span className="metric-label">Required Minutes</span>
                      <span className="metric-value">{Math.round(machine.total_minutes_required)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Available Minutes</span>
                      <span className="metric-value">{machine.available_minutes_per_month}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Utilization</span>
                      <span className="metric-value">{formatPercent(machine.utilization_percent)}</span>
                    </div>
                    <div className="metric">
                      <span className="metric-label">Total Cost</span>
                      <span className="metric-value">{formatCurrency(machine.total_cost)}</span>
                    </div>
                  </div>
                  {machine.capacity_exceeded && (
                    <div className="capacity-warning">
                      ⚠️ Capacity Exceeded
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'labor' && (
          <div className="labor-tab">
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
        )}
      </div>
    </div>
  );
};

export default CostManagement;