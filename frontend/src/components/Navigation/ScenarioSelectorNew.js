import React, { useState, useMemo } from 'react';
import { useForecast } from '../../context/ForecastContext';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Textarea } from '../ui/textarea';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../ui/modal';
import { cn } from '../../lib/utils';

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

  const getScenarioVariant = (scenarioId) => {
    const variants = {
      base: 'default',
      best: 'success',
      worst: 'destructive'
    };
    return variants[scenarioId] || 'secondary';
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
    <div className="relative">
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          className="justify-start text-left flex-1"
          onClick={() => setIsOpen(!isOpen)}
        >
          <span className="mr-2">
            {getScenarioIcon(activeScenario)}
          </span>
          <span className="truncate">
            {memoizedScenarios[activeScenario] ? 
              `${activeScenario} | ${memoizedScenarios[activeScenario].name || 'Unnamed Scenario'}` : 
              'Select Scenario'
            }
          </span>
          <svg 
            className={cn(
              "ml-auto h-4 w-4 transition-transform",
              isOpen && "transform rotate-180"
            )}
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </Button>
        <Button 
          variant="outline"
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            setShowNewScenarioModal(true);
          }}
          title="Create New Scenario"
          className="px-3"
        >
          +
        </Button>
      </div>

      {isOpen && (
        <>
          {/* Backdrop */}
          <div 
            className="fixed inset-0 z-40" 
            onClick={() => setIsOpen(false)}
          />
          
          {/* Dropdown */}
          <div className="absolute top-full left-0 right-0 mt-2 bg-popover border border-border rounded-md shadow-lg z-50 max-h-60 overflow-auto">
            {scenarioEntries.map(([id, scenario]) => (
              <Button
                key={id}
                variant="ghost"
                className={cn(
                  "w-full justify-start p-3 h-auto rounded-none border-l-4 border-transparent",
                  id === activeScenario && "bg-accent"
                )}
                style={{ 
                  borderLeftColor: id === activeScenario ? 'hsl(var(--primary))' : 'transparent'
                }}
                onClick={() => handleScenarioChange(id)}
              >
                <span className="mr-3 text-lg">
                  {getScenarioIcon(id)}
                </span>
                <div className="flex flex-col items-start text-left">
                  <span className="font-medium text-sm">{`${id} | ${scenario.name || 'Unnamed Scenario'}`}</span>
                  <Badge 
                    variant={getScenarioVariant(id)}
                    className="mt-1 text-xs"
                  >
                    {id === activeScenario ? 'Active' : 'Switch to'}
                  </Badge>
                </div>
              </Button>
            ))}
          </div>
        </>
      )}

      {/* New Scenario Modal */}
      {showNewScenarioModal && (
        <Modal onClick={() => setShowNewScenarioModal(false)}>
          <div onClick={e => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Create New Forecast Scenario</ModalTitle>
              <ModalClose onClick={() => setShowNewScenarioModal(false)} />
            </ModalHeader>
            
            <form onSubmit={(e) => {
              e.preventDefault();
              const formData = new FormData(e.target);
              const scenarioData = {
                name: formData.get('name'),
                description: formData.get('description')
              };
              handleCreateNewScenario(scenarioData);
            }}>
              <ModalContent className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Scenario Name:</Label>
                  <Input 
                    id="name"
                    name="name" 
                    required 
                    placeholder="Enter scenario name" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="description">Description:</Label>
                  <Textarea 
                    id="description"
                    name="description" 
                    rows={3} 
                    placeholder="Enter scenario description"
                  />
                </div>
              </ModalContent>
              
              <ModalFooter>
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={() => setShowNewScenarioModal(false)}
                >
                  Cancel
                </Button>
                <Button type="submit">Create Scenario</Button>
              </ModalFooter>
            </form>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default ScenarioSelector;