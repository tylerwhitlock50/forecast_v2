import React from 'react';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const selectClass = 'h-9 rounded-md border border-gray-300 bg-white px-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500';

/**
 * Month + year selects for a 'YYYY-MM' value. Plain selects work in every
 * browser (Firefox and Safari have no <input type="month">).
 */
const MonthPicker = ({ id, value, onChange, years, label }) => {
  const [y, m] = /^\d{4}-\d{2}$/.test(value || '') ? value.split('-') : ['', ''];
  const yearList = (years && years.length ? years : []).map(String);
  if (y && !yearList.includes(y)) yearList.push(y);
  yearList.sort();
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      <select
        id={id}
        aria-label={`${label} month`}
        className={selectClass}
        value={m}
        onChange={(e) => onChange(`${y || yearList[0]}-${e.target.value}`)}
      >
        {MONTHS.map((name, i) => {
          const mm = String(i + 1).padStart(2, '0');
          return <option key={mm} value={mm}>{name}</option>;
        })}
      </select>
      <select
        aria-label={`${label} year`}
        className={selectClass}
        value={y}
        onChange={(e) => onChange(`${e.target.value}-${m || '01'}`)}
      >
        {yearList.map(year => <option key={year} value={year}>{year}</option>)}
      </select>
    </div>
  );
};

export default MonthPicker;
