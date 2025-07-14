import React, { useState } from 'react';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import DataTable from './DataTable';
import './Dashboard.css';

const Dashboard = ({ forecastData, onRefresh }) => {
  const [activeTab, setActiveTab] = useState('overview');

  if (!forecastData) {
    return (
      <div className="dashboard">
        <div className="card">
          <p>No forecast data available. Start by creating a new forecast.</p>
        </div>
      </div>
    );
  }

  const { sales_forecast, bom_data, router_data, payroll_data } = forecastData;

  // Process data for charts
  const revenueData = sales_forecast?.reduce((acc, sale) => {
    const period = sale.period;
    const existing = acc.find(item => item.period === period);
    if (existing) {
      existing.revenue += sale.total_revenue;
    } else {
      acc.push({ period, revenue: sale.total_revenue });
    }
    return acc;
  }, []) || [];

  const customerData = sales_forecast?.reduce((acc, sale) => {
    const customer = sale.customer_name;
    const existing = acc.find(item => item.customer === customer);
    if (existing) {
      existing.revenue += sale.total_revenue;
    } else {
      acc.push({ customer, revenue: sale.total_revenue });
    }
    return acc;
  }, []) || [];

  const productData = sales_forecast?.reduce((acc, sale) => {
    const product = sale.unit_name;
    const existing = acc.find(item => item.product === product);
    if (existing) {
      existing.revenue += sale.total_revenue;
    } else {
      acc.push({ product, revenue: sale.total_revenue });
    }
    return acc;
  }, []) || [];

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="tab-navigation">
          <button 
            className={`tab ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => setActiveTab('overview')}
          >
            Overview
          </button>
          <button 
            className={`tab ${activeTab === 'revenue' ? 'active' : ''}`}
            onClick={() => setActiveTab('revenue')}
          >
            Revenue
          </button>
          <button 
            className={`tab ${activeTab === 'costs' ? 'active' : ''}`}
            onClick={() => setActiveTab('costs')}
          >
            Costs
          </button>
          <button 
            className={`tab ${activeTab === 'labor' ? 'active' : ''}`}
            onClick={() => setActiveTab('labor')}
          >
            Labor
          </button>
        </div>
        <button className="btn btn-secondary" onClick={onRefresh}>
          Refresh Data
        </button>
      </div>

      <div className="dashboard-content">
        {activeTab === 'overview' && (
          <div className="overview-grid">
            <div className="card">
              <h3>Revenue by Period</h3>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="period" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']} />
                    <Legend />
                    <Line type="monotone" dataKey="revenue" stroke="#2563eb" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>Revenue by Customer</h3>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={customerData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="customer" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']} />
                    <Legend />
                    <Bar dataKey="revenue" fill="#10b981" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>Revenue by Product</h3>
              <div className="chart-container">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={productData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="product" />
                    <YAxis />
                    <Tooltip formatter={(value) => [`$${value.toLocaleString()}`, 'Revenue']} />
                    <Legend />
                    <Bar dataKey="revenue" fill="#f59e0b" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h3>Summary Statistics</h3>
              <div className="stats-grid">
                <div className="stat-item">
                  <span className="stat-label">Total Revenue</span>
                  <span className="stat-value">
                    ${revenueData.reduce((sum, item) => sum + item.revenue, 0).toLocaleString()}
                  </span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Customers</span>
                  <span className="stat-value">{customerData.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Products</span>
                  <span className="stat-value">{productData.length}</span>
                </div>
                <div className="stat-item">
                  <span className="stat-label">Periods</span>
                  <span className="stat-value">{revenueData.length}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'revenue' && (
          <div className="card">
            <h3>Sales Forecast Data</h3>
            <DataTable 
              data={sales_forecast}
              columns={[
                { key: 'customer_name', label: 'Customer' },
                { key: 'unit_name', label: 'Product' },
                { key: 'period', label: 'Period' },
                { key: 'quantity', label: 'Quantity' },
                { key: 'unit_price', label: 'Unit Price', format: (value) => `$${value}` },
                { key: 'total_revenue', label: 'Total Revenue', format: (value) => `$${value.toLocaleString()}` }
              ]}
            />
          </div>
        )}

        {activeTab === 'costs' && (
          <div className="card">
            <h3>Bill of Materials</h3>
            <DataTable 
              data={bom_data}
              columns={[
                { key: 'unit_name', label: 'Product' },
                { key: 'router_id', label: 'Router ID' },
                { key: 'material_cost', label: 'Material Cost', format: (value) => `$${value}` }
              ]}
            />
          </div>
        )}

        {activeTab === 'labor' && (
          <div className="card">
            <h3>Labor Data</h3>
            <DataTable 
              data={payroll_data}
              columns={[
                { key: 'employee_name', label: 'Employee' },
                { key: 'weekly_hours', label: 'Weekly Hours' },
                { key: 'hourly_rate', label: 'Hourly Rate', format: (value) => `$${value}` },
                { key: 'labor_type', label: 'Labor Type' },
                { key: 'start_date', label: 'Start Date' },
                { key: 'end_date', label: 'End Date' }
              ]}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default Dashboard; 