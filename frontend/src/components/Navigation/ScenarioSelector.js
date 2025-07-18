import React, { useState, useMemo } from 'react';
import { useForecast } from '../../context/ForecastContext';
import './ScenarioSelector.css';

const ScenarioSelector = () => {
  const { scenarios, activeScenario, actions } = useForecast();
  const [isOpen, setIsOpen] = useState(false);


  const [showNewScenarioModal, setShowNewScenarioModal] = useState(false);

  const handleScenarioChange = (scenarioId) => {
    actions.switchScenario(scenarioId);
    setIsOpen(false);
  };

  const handleCreateNewScenario = async (scenarioData) => {
    try {
      await actions.createScenario(scenarioData);
      setShowNewScenarioModal(false);
    } catch (error) {
      console.error('Error creating scenario:', error);
    }
  };

  const getScenarioColor = (scenarioId) => {
    const colors = {
      base: '#3B82F6',
      best: '#10B981',
      worst: '#EF4444'
    };
    return colors[scenarioId] || '#6B7280';
  };

  const getScenarioIcon = (scenarioId) => {
    const icons = {
      base: '📊',
      best: '📈',
      worst: '📉'
    };
    return icons[scenarioId] || '📊';
  };

  // Memoize the scenarios to prevent unnecessary re-renders
  const memoizedScenarios = useMemo(() => scenarios || {}, [scenarios]);
  const scenarioEntries = useMemo(() => Object.entries(memoizedScenarios), [memoizedScenarios]);

  return (
    <div className="scenario-selector">
      <div className="scenario-button-container">
        <button
          className="scenario-button"
          onClick={() => setIsOpen(!isOpen)}
          style={{ borderColor: getScenarioColor(activeScenario) }}
        >
          <span className="scenario-icon">
            {getScenarioIcon(activeScenario)}
          </span>
          <span className="scenario-name">
            {memoizedScenarios[activeScenario] ? 
              `${activeScenario} | ${memoizedScenarios[activeScenario].name || 'Unnamed Scenario'}` : 
              'Select Scenario'
            }
          </span>
          <span className={`scenario-arrow ${isOpen ? 'open' : ''}`}>
            ▼
          </span>
        </button>
        <button 
          className="new-scenario-btn"
          onClick={(e) => {
            e.stopPropagation();
            setShowNewScenarioModal(true);
          }}
          title="Create New Scenario"
        >
          +
        </button>
      </div>

      {isOpen && (
        <div className="scenario-dropdown">
          {scenarioEntries.map(([id, scenario]) => (
            <button
              key={id}
              className={`scenario-option ${id === activeScenario ? 'active' : ''}`}
              onClick={() => handleScenarioChange(id)}
              style={{ 
                borderLeft: `4px solid ${getScenarioColor(id)}`,
                backgroundColor: id === activeScenario ? getScenarioColor(id) + '10' : 'transparent'
              }}
            >
              <span className="scenario-option-icon">
                {getScenarioIcon(id)}
              </span>
              <div className="scenario-option-content">
                <span className="scenario-option-name">{`${id} | ${scenario.name || 'Unnamed Scenario'}`}</span>
                <span className="scenario-option-status">
                  {id === activeScenario ? 'Active' : 'Switch to'}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      {/* New Scenario Modal */}
      {showNewScenarioModal && (
        <div className="modal-overlay" onClick={() => setShowNewScenarioModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>Create New Forecast Scenario</h3>
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const scenarioData = {
                name: formData.get('name'),
                description: formData.get('description')
              };
              handleCreateNewScenario(scenarioData);
            }}>
              <div className="form-group">
                <label>Scenario Name:</label>
                <input type="text" name="name" required placeholder="Enter scenario name" />
              </div>
              <div className="form-group">
                <label>Description:</label>
                <textarea name="description" rows="3" placeholder="Enter scenario description"></textarea>
              </div>
              <div className="form-actions">
                <button type="submit">Create Scenario</button>
                <button type="button" onClick={() => setShowNewScenarioModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ScenarioSelector;