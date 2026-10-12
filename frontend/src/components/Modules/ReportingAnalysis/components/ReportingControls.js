import React from 'react';
import { Button } from '../../../ui/button';

const MONTHS = [
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

const ym = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;

export const calculateMonthsDifference = (start, end) => {
  const [startYear, startMonth] = start.split('-').map(Number);
  const [endYear, endMonth] = end.split('-').map(Number);
  return (endYear - startYear) * 12 + (endMonth - startMonth) + 1;
};

const ReportingControls = ({ period, onPeriodChange }) => {
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 7 }, (_, i) => currentYear - 3 + i);
  const selectClass = 'block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 text-sm';

  const [startYear, startMonth] = period.start.split('-');
  const [endYear, endMonth] = period.end.split('-');

  const setRange = (start, end) => onPeriodChange({ start, end });
  const setYearRange = (year, m1 = 1, m2 = 12) =>
    setRange(`${year}-${String(m1).padStart(2, '0')}`, `${year}-${String(m2).padStart(2, '0')}`);
  const setRolling = (offsetStart, offsetEnd) => {
    const now = new Date();
    setRange(ym(new Date(now.getFullYear(), now.getMonth() + offsetStart, 1)), ym(new Date(now.getFullYear(), now.getMonth() + offsetEnd, 1)));
  };

  const quick = [
    { label: 'Current Year', onClick: () => setYearRange(currentYear) },
    { label: 'Next Year', onClick: () => setYearRange(currentYear + 1) },
    { label: 'Last Year', onClick: () => setYearRange(currentYear - 1) },
    { label: `Q1 ${currentYear}`, onClick: () => setYearRange(currentYear, 1, 3) },
    { label: `Q2 ${currentYear}`, onClick: () => setYearRange(currentYear, 4, 6) },
    { label: `Q3 ${currentYear}`, onClick: () => setYearRange(currentYear, 7, 9) },
    { label: `Q4 ${currentYear}`, onClick: () => setYearRange(currentYear, 10, 12) },
    { label: 'Next 12 Months', onClick: () => setRolling(0, 11) },
    { label: 'Last 12 Months', onClick: () => setRolling(-12, -1) }
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Start Period</label>
          <div className="grid grid-cols-2 gap-2">
            <select value={startMonth} onChange={e => onPeriodChange({ ...period, start: `${startYear}-${e.target.value}` })} className={selectClass} aria-label="Start month">
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={startYear} onChange={e => onPeriodChange({ ...period, start: `${e.target.value}-${startMonth}` })} className={selectClass} aria-label="Start year">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">End Period</label>
          <div className="grid grid-cols-2 gap-2">
            <select value={endMonth} onChange={e => onPeriodChange({ ...period, end: `${endYear}-${e.target.value}` })} className={selectClass} aria-label="End month">
              {MONTHS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <select value={endYear} onChange={e => onPeriodChange({ ...period, end: `${e.target.value}-${endMonth}` })} className={selectClass} aria-label="End year">
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-2">Quick Periods</label>
        <div className="flex flex-wrap gap-2">
          {quick.map(q => (
            <Button key={q.label} variant="outline" size="sm" onClick={q.onClick}>{q.label}</Button>
          ))}
        </div>
      </div>

      <div className="text-sm text-gray-600 bg-gray-50 p-3 rounded-lg">
        <strong>Selected Period:</strong> {period.start} to {period.end}
        <br />
        <span className="text-xs">Duration: {calculateMonthsDifference(period.start, period.end)} months</span>
      </div>
    </div>
  );
};

export default ReportingControls;
