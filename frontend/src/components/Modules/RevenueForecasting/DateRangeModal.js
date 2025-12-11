import React, { useState, useEffect } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Label } from '../../ui/label';

const DateRangeModal = ({ isOpen, onClose, onApply, currentRange }) => {
  const [startDate, setStartDate] = useState(null);
  const [endDate, setEndDate] = useState(null);

  useEffect(() => {
    if (currentRange) {
      const start = new Date(currentRange.start.year, currentRange.start.month - 1, 1);
      const end = new Date(currentRange.end.year, currentRange.end.month, 0);
      setStartDate(start);
      setEndDate(end);
    } else {
      setStartDate(null);
      setEndDate(null);
    }
  }, [currentRange, isOpen]);

  const handleApply = () => {
    if (startDate && endDate) {
      onApply({
        start: {
          month: startDate.getMonth() + 1,
          year: startDate.getFullYear()
        },
        end: {
          month: endDate.getMonth() + 1,
          year: endDate.getFullYear()
        }
      });
      onClose();
    }
  };

  const handlePreset = (preset) => {
    const now = new Date();
    let start, end;

    switch (preset) {
      case 'last_3_months':
        start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last_6_months':
        start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'last_12_months':
        start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
        end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        break;
      case 'current_year':
        start = new Date(now.getFullYear(), 0, 1);
        end = new Date(now.getFullYear(), 11, 31);
        break;
      case 'next_year':
        start = new Date(now.getFullYear() + 1, 0, 1);
        end = new Date(now.getFullYear() + 1, 11, 31);
        break;
      default:
        return;
    }

    setStartDate(start);
    setEndDate(end);
  };

  if (!isOpen) return null;

  return (
    <Modal onClick={onClose}>
      <div onClick={e => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Custom Date Range</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>
        <ModalContent className="space-y-6">
          {/* Quick Presets */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Quick Presets:</Label>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="outline" onClick={() => handlePreset('last_3_months')}>
                Last 3 Months
              </Button>
              <Button size="sm" variant="outline" onClick={() => handlePreset('last_6_months')}>
                Last 6 Months
              </Button>
              <Button size="sm" variant="outline" onClick={() => handlePreset('last_12_months')}>
                Last 12 Months
              </Button>
              <Button size="sm" variant="outline" onClick={() => handlePreset('current_year')}>
                Current Year
              </Button>
              <Button size="sm" variant="outline" onClick={() => handlePreset('next_year')}>
                Next Year
              </Button>
            </div>
          </div>

          {/* Custom Date Pickers */}
          <div className="space-y-4 border-t pt-4">
            <div className="space-y-2">
              <Label className="text-sm font-medium">Start Date:</Label>
              <DatePicker
                selected={startDate}
                onChange={(date) => setStartDate(date)}
                selectsStart
                startDate={startDate}
                endDate={endDate}
                placeholderText="Select start date"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-sm font-medium">End Date:</Label>
              <DatePicker
                selected={endDate}
                onChange={(date) => setEndDate(date)}
                selectsEnd
                startDate={startDate}
                endDate={endDate}
                minDate={startDate}
                placeholderText="Select end date"
                className="w-full px-3 py-2 border border-gray-300 rounded text-sm"
              />
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button 
            onClick={handleApply}
            disabled={!startDate || !endDate}
            className="bg-orange-600 hover:bg-orange-700"
          >
            Apply Range
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};

export default DateRangeModal;

