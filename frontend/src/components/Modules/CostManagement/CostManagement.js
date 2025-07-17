import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import './CostManagement.css';
import OverviewTab from './Tabs/OverviewTab';
import MaterialsTab from './Tabs/MaterialsTab';
import MachinesTab from './Tabs/MachinesTab';
import LaborTab from './Tabs/LaborTab';
import MetricsHorizonSelector from './MetricsHorizonSelector';
import LaborHorizonSelector from './LaborHorizonSelector';

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
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const API_BASE = process.env.NODE_ENV === 'production' ? '/api' : 'http://localhost:8000';

  // Fetch cost summary
  const fetchCostSummary = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (activeScenario) params.append('forecast_id', activeScenario);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const url = `${API_BASE}/products/cost-summary?${params.toString()}`;
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
      const params = new URLSearchParams();
      if (activeScenario) params.append('forecast_id', activeScenario);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const url = `${API_BASE}/materials/usage?${params.toString()}`;
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
      const params = new URLSearchParams();
      if (activeScenario) params.append('forecast_id', activeScenario);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const url = `${API_BASE}/machines/utilization?${params.toString()}`;
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
      const params = new URLSearchParams();
      if (activeScenario) params.append('forecast_id', activeScenario);
      if (startDate) params.append('start_date', startDate);
      if (endDate) params.append('end_date', endDate);
      const url = `${API_BASE}/labor/utilization?${params.toString()}`;
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
  };

  useEffect(() => {
    if (selectedProduct) {
      if (selectedProduct.bom_id) {
        fetchBomDetails(selectedProduct.bom_id, selectedProduct.bom_version);
      } else {
        setBomData([]);
      }
      if (selectedProduct.router_id) {
        fetchRoutingDetails(selectedProduct.router_id, selectedProduct.router_version);
      } else {
        setRoutingData([]);
      }
    } else {
      setBomData([]);
      setRoutingData([]);
    }
  }, [selectedProduct]);


  // Load data on component mount and when active scenario changes
  useEffect(() => {
    fetchCostSummary();
    fetchMaterialsUsage();
    fetchMachinesUtilization();
    fetchLaborUtilization();
  }, [activeScenario, startDate, endDate]);

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
          <OverviewTab
            costSummary={costSummary}
            selectedProduct={selectedProduct}
            onProductClick={handleProductClick}
            bomData={bomData}
            routingData={routingData}
            formatCurrency={formatCurrency}
            formatPercent={formatPercent}
            setSelectedProduct={setSelectedProduct}
          />
        )}

        {activeTab === 'materials' && (
          <MaterialsTab
            materialsUsage={materialsUsage}
            formatCurrency={formatCurrency}
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
        )}

        {activeTab === 'machines' && (
          <MachinesTab
            machinesUtilization={machinesUtilization}
            formatCurrency={formatCurrency}
            formatPercent={formatPercent}
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
        )}

        {activeTab === 'labor' && (
          <LaborTab
            laborUtilization={laborUtilization}
            formatCurrency={formatCurrency}
            startDate={startDate}
            endDate={endDate}
            onStartChange={setStartDate}
            onEndChange={setEndDate}
          />
        )}
      </div>
    </div>
  );
};

export default CostManagement;