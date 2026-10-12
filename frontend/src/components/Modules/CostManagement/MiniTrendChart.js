import React from 'react';

const COLOR_CLASSES = {
  blue: 'bg-blue-500',
  green: 'bg-green-500',
  orange: 'bg-orange-500',
};

// Capacity line: 6px near-black dashes with 4px white gaps.
export const THRESHOLD_DASHES = 'repeating-linear-gradient(90deg, #111827 0 6px, #ffffff 6px 10px)';

const HEIGHT = 48; // px; bar heights are computed in px so they never collapse to 0
const MONTH_INITIALS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

const initialOf = (label) => {
  const m = /^\d{4}-(\d{2})/.exec(String(label || ''));
  return m ? MONTH_INITIALS[Number(m[1]) - 1] : '';
};

/**
 * Small monthly bar chart. `threshold` (optional) draws a dashed reference
 * line (e.g. 100% capacity) and colors the bars above it red. `highlight`
 * marks one period (the month selected on the page).
 */
const MiniTrendChart = ({ data, color = 'blue', threshold = null, highlight = null, formatValue }) => {
  if (!data || data.length === 0) {
    return (
      <div className="flex h-8 items-center justify-center text-xs text-muted-foreground">
        No data
      </div>
    );
  }

  const values = data.map((d) => Number(d.value) || 0);
  const scaleMax = Math.max(...values, threshold || 0);
  const barColor = COLOR_CLASSES[color] || COLOR_CLASSES.blue;
  const fmt = formatValue || ((v) => v.toFixed(1));
  const thresholdTop = threshold && scaleMax > 0 ? HEIGHT - (threshold / scaleMax) * HEIGHT : null;

  return (
    <div>
      <div className="relative flex items-end gap-0.5" style={{ height: HEIGHT }} role="img" aria-label="Monthly trend">
        {data.map((item, index) => {
          const value = values[index];
          const height = scaleMax > 0 ? Math.max(2, Math.round((value / scaleMax) * HEIGHT)) : 2;
          const over = threshold !== null && value > threshold;
          const dim = highlight && highlight !== item.label;
          return (
            <div
              key={item.label || index}
              data-testid="trend-bar"
              className={`flex-1 rounded-t ${over ? 'bg-red-500' : barColor} ${dim ? 'opacity-40' : ''}`}
              style={{ height }}
              title={`${item.label}: ${fmt(value)}`}
            />
          );
        })}
        {thresholdTop !== null && (
          // Drawn after the bars, on top, as alternating dark / white dashes so
          // the capacity line stays visible across red, orange and empty space.
          <div
            data-testid="trend-threshold"
            className="pointer-events-none absolute inset-x-0 z-10"
            style={{ top: Math.max(0, thresholdTop - 1), height: 2, backgroundImage: THRESHOLD_DASHES }}
            aria-hidden="true"
          />
        )}
      </div>
      <div className="mt-0.5 flex gap-0.5 text-center text-[10px] leading-3 text-gray-400" aria-hidden="true">
        {data.map((item, index) => (
          <span key={item.label || index} className="flex-1">{initialOf(item.label)}</span>
        ))}
      </div>
    </div>
  );
};

export default MiniTrendChart;
