import React, { useState } from 'react';
import { useForecast } from '../../context/ForecastContext';
import './ScenarioSelector.css';

const ScenarioSelector = () => {
  const { scenarios, activeScenario, actions } = useForecast();
  const [isOpen, setIsOpen] = useState(false);



  const handleScenarioChange = (scenarioId) => {
    actions.switchScenario(scenarioId);
    setIsOpen(false);
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

  return (
    <div className="scenario-selector">
      <button
        className="scenario-button"
        onClick={() => setIsOpen(!isOpen)}
        style={{ borderColor: getScenarioColor(activeScenario) }}
      >
        <span className="scenario-icon">
          {getScenarioIcon(activeScenario)}
        </span>
        <span className="scenario-name">
          {scenarios[activeScenario] ? 
            `${activeScenario} | ${scenarios[activeScenario].name || 'Unnamed Scenario'}` : 
            'Select Scenario'
          }
        </span>
        <span className={`scenario-arrow ${isOpen ? 'open' : ''}`}>
          ▼
        </span>
      </button>

      {isOpen && (
        <div className="scenario-dropdown">
          {Object.entries(scenarios).map(([id, scenario]) => (
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
    </div>
  );
};

export default ScenarioSelector;