import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Dashboard from './components/Dashboard';
import ChatPanel from './components/ChatPanel';
import ForecastingWizard from './components/ForecastingWizard';
import './App.css';

const API_BASE = 'http://localhost:8000';

function App() {
  const [chatExpanded, setChatExpanded] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [forecastData, setForecastData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchForecastData();
  }, []);

  const fetchForecastData = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE}/forecast`);
      if (response.data.status === 'success') {
        setForecastData(response.data.data);
      }
    } catch (err) {
      setError('Failed to load forecast data');
      console.error('Error fetching forecast data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleWizardComplete = () => {
    setShowWizard(false);
    fetchForecastData(); // Refresh data after wizard completion
  };

  if (loading) {
    return (
      <div className="app">
        <div className="loading">
          <div className="spinner"></div>
          <p>Loading forecast data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="main-content">
        <header className="app-header">
          <h1>Forecast AI - Financial Modeling & Forecasting</h1>
          <div className="header-actions">
            <button 
              className="btn btn-primary"
              onClick={() => setShowWizard(true)}
            >
              New Forecast
            </button>
            <button 
              className="btn btn-secondary"
              onClick={() => setChatExpanded(!chatExpanded)}
            >
              {chatExpanded ? 'Collapse Chat' : 'Expand Chat'}
            </button>
          </div>
        </header>

        <Dashboard 
          forecastData={forecastData}
          onRefresh={fetchForecastData}
        />
      </div>

      <ChatPanel 
        expanded={chatExpanded}
        onToggle={() => setChatExpanded(!chatExpanded)}
      />

      {showWizard && (
        <ForecastingWizard
          onComplete={handleWizardComplete}
          onCancel={() => setShowWizard(false)}
        />
      )}
    </div>
  );
}

export default App; 