import React, { useState, useEffect } from 'react';
import { Button } from '../../ui/button';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Label } from '../../ui/label';

const ColumnVisibilityMenu = ({ 
  timePeriods, 
  timeRange, 
  onTimeRangeChange,
  onColumnVisibilityChange,
  onGroupByYear,
  groupByYear,
  visibleColumns,
  showOnlyNonZero
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [localVisibleColumns, setLocalVisibleColumns] = useState(new Set(visibleColumns || timePeriods.map(p => p.key)));
  const [localGroupByYear, setLocalGroupByYear] = useState(groupByYear || false);
  const [localShowOnlyNonZero, setLocalShowOnlyNonZero] = useState(showOnlyNonZero || false);

  useEffect(() => {
    setLocalVisibleColumns(new Set(visibleColumns || timePeriods.map(p => p.key)));
  }, [visibleColumns, timePeriods]);

  const handleToggleColumn = (periodKey) => {
    const newSet = new Set(localVisibleColumns);
    if (newSet.has(periodKey)) {
      newSet.delete(periodKey);
    } else {
      newSet.add(periodKey);
    }
    setLocalVisibleColumns(newSet);
  };

  const handleSelectAll = () => {
    setLocalVisibleColumns(new Set(timePeriods.map(p => p.key)));
  };

  const handleDeselectAll = () => {
    setLocalVisibleColumns(new Set());
  };

  const handleApply = () => {
    onColumnVisibilityChange(Array.from(localVisibleColumns));
    onGroupByYear(localGroupByYear);
    setIsOpen(false);
  };

  // Group periods by year
  const periodsByYear = timePeriods.reduce((acc, period) => {
    const year = period.key.split('-')[0];
    if (!acc[year]) acc[year] = [];
    acc[year].push(period);
    return acc;
  }, {});

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        onClick={() => setIsOpen(true)}
        className="flex items-center gap-2"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        View Options
      </Button>

      {isOpen && (
        <Modal onClick={() => setIsOpen(false)}>
          <div onClick={e => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>Column View Options</ModalTitle>
              <ModalClose onClick={() => setIsOpen(false)} />
            </ModalHeader>
            <ModalContent className="space-y-6">
              {/* Time Range Toggle */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Period Type:</Label>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant={timeRange === 'monthly' ? 'default' : 'outline'}
                    onClick={() => onTimeRangeChange('monthly')}
                    className={timeRange === 'monthly' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                  >
                    Monthly
                  </Button>
                  <Button
                    size="sm"
                    variant={timeRange === 'quarterly' ? 'default' : 'outline'}
                    onClick={() => onTimeRangeChange('quarterly')}
                    className={timeRange === 'quarterly' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                  >
                    Quarterly
                  </Button>
                  <Button
                    size="sm"
                    variant={timeRange === 'weekly' ? 'default' : 'outline'}
                    onClick={() => onTimeRangeChange('weekly')}
                    className={timeRange === 'weekly' ? 'bg-orange-600 hover:bg-orange-700' : ''}
                  >
                    Weekly
                  </Button>
                </div>
              </div>

              {/* Group by Year */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="groupByYear"
                    checked={localGroupByYear}
                    onChange={(e) => setLocalGroupByYear(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="groupByYear" className="text-sm font-medium cursor-pointer">
                    Group columns by year
                  </Label>
                </div>
                <p className="text-xs text-gray-500 ml-6">
                  Organize period columns with year headers
                </p>
              </div>

              {/* Show Only Non-Zero */}
              <div className="space-y-2 border-t pt-4">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id="showOnlyNonZero"
                    checked={localShowOnlyNonZero}
                    onChange={(e) => setLocalShowOnlyNonZero(e.target.checked)}
                    className="w-4 h-4"
                  />
                  <Label htmlFor="showOnlyNonZero" className="text-sm font-medium cursor-pointer">
                    Show only periods with data
                  </Label>
                </div>
                <p className="text-xs text-gray-500 ml-6">
                  Hide columns that have no forecast data
                </p>
              </div>

              {/* Column Visibility */}
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-medium">Column Visibility:</Label>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={handleSelectAll}>
                      Select All
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleDeselectAll}>
                      Deselect All
                    </Button>
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto space-y-2">
                  {Object.entries(periodsByYear).map(([year, periods]) => (
                    <div key={year} className="space-y-1">
                      <Label className="text-xs font-semibold text-gray-600">{year}</Label>
                      <div className="grid grid-cols-3 gap-2 ml-4">
                        {periods.map(period => (
                          <div key={period.key} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              id={`col-${period.key}`}
                              checked={localVisibleColumns.has(period.key)}
                              onChange={() => handleToggleColumn(period.key)}
                              className="w-4 h-4"
                            />
                            <Label 
                              htmlFor={`col-${period.key}`} 
                              className="text-xs cursor-pointer"
                            >
                              {period.label}
                            </Label>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </ModalContent>
            <ModalFooter>
              <Button variant="outline" onClick={() => setIsOpen(false)}>
                Cancel
              </Button>
              <Button 
                onClick={handleApply}
                className="bg-orange-600 hover:bg-orange-700"
              >
                Apply
              </Button>
            </ModalFooter>
          </div>
        </Modal>
      )}
    </>
  );
};

export default ColumnVisibilityMenu;

