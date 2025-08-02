import React, { useState } from 'react';
import { Card } from '../../../ui/card';
import { Button } from '../../../ui/button';

const ForecastSelector = ({ scenarios, selectedForecasts, onSelectionChange }) => {
  const [selectMode, setSelectMode] = useState('individual'); // 'individual' or 'combined'

  const scenarioList = Object.values(scenarios || {});

  const handleForecastToggle = (forecastId) => {
    const newSelection = selectedForecasts.includes(forecastId)
      ? selectedForecasts.filter(id => id !== forecastId)
      : [...selectedForecasts, forecastId];
    
    onSelectionChange(newSelection);
  };

  const handleSelectAll = () => {
    const allIds = scenarioList.map(s => s.id);
    onSelectionChange(allIds);
  };

  const handleClearAll = () => {
    onSelectionChange([]);
  };

  const getCommonCombinations = () => {
    const combinations = [];
    
    // Find scenarios by common patterns
    const pickleballScenarios = scenarioList.filter(s => 
      s.name.toLowerCase().includes('pickleball') || s.id.toLowerCase().includes('pickle')
    );
    
    const sideBySideScenarios = scenarioList.filter(s => 
      s.name.toLowerCase().includes('side') || s.name.toLowerCase().includes('sxs')
    );
    
    const optimisticScenarios = scenarioList.filter(s => 
      s.name.toLowerCase().includes('optimistic') || s.name.toLowerCase().includes('best')
    );
    
    const conservativeScenarios = scenarioList.filter(s => 
      s.name.toLowerCase().includes('conservative') || s.name.toLowerCase().includes('worst')
    );

    if (pickleballScenarios.length > 0) {
      combinations.push({
        name: 'Pickleball Product Line',
        scenarios: pickleballScenarios,
        description: 'All pickleball-related forecasts'
      });
    }

    if (sideBySideScenarios.length > 0) {
      combinations.push({
        name: 'Side-by-Side Product Line',
        scenarios: sideBySideScenarios,
        description: 'All side-by-side vehicle forecasts'
      });
    }

    if (pickleballScenarios.length > 0 && sideBySideScenarios.length > 0) {
      combinations.push({
        name: 'Combined Product Lines',
        scenarios: [...pickleballScenarios.slice(0, 1), ...sideBySideScenarios.slice(0, 1)],
        description: 'Mix of pickleball and side-by-side forecasts'
      });
    }

    if (optimisticScenarios.length > 0 && conservativeScenarios.length > 0) {
      combinations.push({
        name: 'Scenario Comparison',
        scenarios: [...optimisticScenarios.slice(0, 1), ...conservativeScenarios.slice(0, 1)],
        description: 'Compare optimistic vs conservative scenarios'
      });
    }

    return combinations;
  };

  const commonCombinations = getCommonCombinations();

  return (
    <div className="space-y-4">
      {/* Selection Mode Toggle */}
      <div className="flex space-x-2">
        <Button
          variant={selectMode === 'individual' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectMode('individual')}
        >
          Individual Selection
        </Button>
        <Button
          variant={selectMode === 'combined' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectMode('combined')}
        >
          Quick Combinations
        </Button>
      </div>

      {/* Individual Selection Mode */}
      {selectMode === 'individual' && (
        <div className="space-y-4">
          {/* Bulk Actions */}
          <div className="flex justify-between items-center">
            <span className="text-sm text-gray-600">
              {selectedForecasts.length} of {scenarioList.length} forecasts selected
            </span>
            <div className="flex space-x-2">
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleSelectAll}
                disabled={selectedForecasts.length === scenarioList.length}
              >
                Select All
              </Button>
              <Button 
                variant="outline" 
                size="sm" 
                onClick={handleClearAll}
                disabled={selectedForecasts.length === 0}
              >
                Clear All
              </Button>
            </div>
          </div>

          {/* Forecast List */}
          <div className="grid grid-cols-1 gap-3 max-h-64 overflow-y-auto">
            {scenarioList.map(scenario => (
              <div
                key={scenario.id}
                className={`border rounded-lg p-3 cursor-pointer transition-all ${
                  selectedForecasts.includes(scenario.id)
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-gray-200 hover:border-gray-300'
                }`}
                onClick={() => handleForecastToggle(scenario.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <input
                      type="checkbox"
                      checked={selectedForecasts.includes(scenario.id)}
                      onChange={() => handleForecastToggle(scenario.id)}
                      className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    />
                    <div>
                      <h4 className="font-medium text-gray-900">{scenario.name}</h4>
                      {scenario.description && (
                        <p className="text-sm text-gray-600 mt-1">{scenario.description}</p>
                      )}
                    </div>
                  </div>
                  <div className="text-xs text-gray-500">
                    {scenario.id}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {scenarioList.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">📊</div>
              <p>No forecast scenarios available</p>
              <p className="text-sm mt-1">Create forecast scenarios to begin</p>
            </div>
          )}
        </div>
      )}

      {/* Quick Combinations Mode */}
      {selectMode === 'combined' && (
        <div className="space-y-3">
          {commonCombinations.map((combination, index) => (
            <Card key={index} className="p-4 hover:shadow-md transition-shadow cursor-pointer">
              <div 
                className="flex items-center justify-between"
                onClick={() => onSelectionChange(combination.scenarios.map(s => s.id))}
              >
                <div className="flex-1">
                  <h4 className="font-medium text-gray-900">{combination.name}</h4>
                  <p className="text-sm text-gray-600 mt-1">{combination.description}</p>
                  <div className="flex flex-wrap gap-1 mt-2">
                    {combination.scenarios.map(scenario => (
                      <span
                        key={scenario.id}
                        className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-800"
                      >
                        {scenario.name}
                      </span>
                    ))}
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Select
                </Button>
              </div>
            </Card>
          ))}

          {commonCombinations.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🔀</div>
              <p>No common combinations found</p>
              <p className="text-sm mt-1">Create more forecast scenarios to see suggested combinations</p>
            </div>
          )}

          {/* Custom Combination Builder */}
          <Card className="p-4 border-dashed border-gray-300">
            <div className="text-center">
              <h4 className="font-medium text-gray-700 mb-2">Build Custom Combination</h4>
              <p className="text-sm text-gray-600 mb-3">
                Switch to individual selection to create your own forecast mix
              </p>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setSelectMode('individual')}
              >
                Individual Selection
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Selected Forecasts Preview */}
      {selectedForecasts.length > 0 && (
        <Card className="p-3 bg-blue-50 border-blue-200">
          <div className="text-sm">
            <span className="font-medium text-blue-900">Current Selection:</span>
            <div className="mt-2 flex flex-wrap gap-1">
              {selectedForecasts.map(id => {
                const scenario = scenarios[id];
                return scenario ? (
                  <span
                    key={id}
                    className="inline-flex items-center px-2 py-1 rounded bg-blue-200 text-blue-800 text-xs"
                  >
                    {scenario.name}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleForecastToggle(id);
                      }}
                      className="ml-1 hover:text-blue-600"
                    >
                      ×
                    </button>
                  </span>
                ) : null;
              })}
            </div>
          </div>
        </Card>
      )}

      {/* Examples Section */}
      <Card className="p-4 bg-gray-50 border-gray-200">
        <h4 className="font-medium text-gray-700 mb-2">📋 Example Use Cases</h4>
        <div className="text-sm text-gray-600 space-y-1">
          <p>• <strong>Single Product Line:</strong> Select F001 (Pickleball Paddles) for focused analysis</p>
          <p>• <strong>Product Comparison:</strong> Combine F001 + F002 to compare different product lines</p>
          <p>• <strong>Scenario Analysis:</strong> Mix optimistic and conservative forecasts to assess risk</p>
          <p>• <strong>Comprehensive View:</strong> Select all forecasts for complete business outlook</p>
        </div>
      </Card>
    </div>
  );
};

export default ForecastSelector;