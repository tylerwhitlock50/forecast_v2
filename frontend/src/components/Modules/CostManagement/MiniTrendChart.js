import React from 'react';

const COLOR_CLASSES = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  orange: 'bg-orange-500',
};

const MiniTrendChart = ({ data, color = 'blue' }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-8 text-muted-foreground text-xs">
        No data
      </div>
    );
  }

  const maxValue = Math.max(...data.map((d) => d.value));
  const minHeight = 2; // minimum bar height in pixels
  const barColor = COLOR_CLASSES[color] || COLOR_CLASSES.blue;

  return (
    <div className="flex items-end space-x-1 h-12">
      {data.map((item, index) => {
        const heightPct = maxValue > 0
          ? Math.max(minHeight, (item.value / maxValue) * 100)
          : minHeight;
        return (
          <div key={index} className="flex-1 flex flex-col items-center">
            <div
              className={`w-full ${barColor} rounded-t`}
              style={{ height: `${heightPct}%` }}
              title={`${item.label}: ${item.value.toFixed(1)}`}
            />
          </div>
        );
      })}
    </div>
  );
};

export default MiniTrendChart;
