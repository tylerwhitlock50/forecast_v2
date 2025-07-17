import React from 'react';

const DateRangeSelector = ({ startDate, endDate, onStartChange, onEndChange }) => (
  <div className="horizon-selector">
    <label>From:</label>
    <input type="month" value={startDate} onChange={e => onStartChange(e.target.value)} />
    <label>To:</label>
    <input type="month" value={endDate} onChange={e => onEndChange(e.target.value)} />
  </div>
);

export default DateRangeSelector;
