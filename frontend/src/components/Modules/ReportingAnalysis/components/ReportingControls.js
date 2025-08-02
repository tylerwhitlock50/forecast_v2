import React from 'react';
import { Button } from '../../../ui/button';

const ReportingControls = ({ period, onPeriodChange }) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);
  const months = [
    { value: '01', label: 'January' },
    { value: '02', label: 'February' },
    { value: '03', label: 'March' },
    { value: '04', label: 'April' },
    { value: '05', label: 'May' },
    { value: '06', label: 'June' },
    { value: '07', label: 'July' },
    { value: '08', label: 'August' },
    { value: '09', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];

  const handleStartChange = (value) => {
    onPeriodChange({ ...period, start: value });
  };

  const handleEndChange = (value) => {
    onPeriodChange({ ...period, end: value });
  };

  const setQuickPeriod = (startMonth, endMonth, year = currentYear) => {
    const start = `${year}-${String(startMonth).padStart(2, '0')}`;
    const end = `${year}-${String(endMonth).padStart(2, '0')}`;
    onPeriodChange({ start, end });
  };

  // Parse current period values
  const [startYear, startMonth] = period.start.split('-');
  const [endYear, endMonth] = period.end.split('-');

  return (
    <div className="space-y-4">
      {/* Custom Period Selection */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Start Period
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={startMonth}
              onChange={(e) => handleStartChange(`${startYear}-${e.target.value}`)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {months.map(month => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
            <select
              value={startYear}
              onChange={(e) => handleStartChange(`${e.target.value}-${startMonth}`)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {years.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            End Period
          </label>
          <div className="grid grid-cols-2 gap-2">
            <select
              value={endMonth}
              onChange={(e) => handleEndChange(`${endYear}-${e.target.value}`)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {months.map(month => (
                <option key={month.value} value={month.value}>
                  {month.label}
                </option>
              ))}
            </select>
            <select
              value={endYear}
              onChange={(e) => handleEndChange(`${e.target.value}-${endMonth}`)}
              className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              {years.map(year => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Quick Period Buttons */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Quick Periods
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(1, 12, currentYear)}
          >
            Current Year
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(1, 12, currentYear - 1)}
          >
            Last Year
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(1, 3, currentYear)}
          >
            Q1 {currentYear}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(4, 6, currentYear)}
          >
            Q2 {currentYear}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(7, 9, currentYear)}
          >
            Q3 {currentYear}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(10, 12, currentYear)}
          >
            Q4 {currentYear}
          </Button>
        </div>
      </div>

      {/* Rolling Periods */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Rolling Periods
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
              const end = new Date(now.getFullYear(), now.getMonth(), 0);
              onPeriodChange({
                start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
                end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
              });
            }}
          >
            Last 12 Months
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth() - 5, 1);
              const end = new Date(now.getFullYear(), now.getMonth(), 0);
              onPeriodChange({
                start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
                end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
              });
            }}
          >
            Last 6 Months
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth() - 2, 1);
              const end = new Date(now.getFullYear(), now.getMonth(), 0);
              onPeriodChange({
                start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
                end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
              });
            }}
          >
            Last 3 Months
          </Button>
        </div>
      </div>

      {/* Future Periods */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Future Periods
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), 1);
              const end = new Date(now.getFullYear(), now.getMonth() + 11, 0);
              onPeriodChange({
                start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
                end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
              });
            }}
          >
            Next 12 Months
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const now = new Date();
              const start = new Date(now.getFullYear(), now.getMonth(), 1);
              const end = new Date(now.getFullYear(), now.getMonth() + 5, 0);
              onPeriodChange({
                start: `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`,
                end: `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}`
              });
            }}
          >
            Next 6 Months
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setQuickPeriod(1, 12, currentYear + 1)}
          >
            Next Year
          </Button>
        </div>
      </div>

      {/* Period Summary */}
      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
        <strong>Selected Period:</strong> {period.start} to {period.end}
        <br />
        <span className="text-xs">
          Duration: {calculateMonthsDifference(period.start, period.end)} months
        </span>
      </div>
    </div>
  );
};

// Helper function to calculate months difference
const calculateMonthsDifference = (start, end) => {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
};

export default ReportingControls;