// Pure period / date helpers for the revenue forecast matrix. Kept
// separate so RevenueForecastingNew.js stays focused on UI and state.

// Format a week label with the date span
export const formatWeekLabel = (weekStart, weekEnd, weekNumber) => {
  const span = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
  return `W${String(weekNumber).padStart(2, '0')} (${span})`;
};

// Normalize to Monday as start of week
export const getStartOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Monday = 1
  return new Date(d.setDate(diff));
};

// ISO week number and corresponding year
export const getISOWeekInfo = (date) => {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7)); // nearest Thursday
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return { year: d.getUTCFullYear(), week: weekNo };
};

// Utility function to generate time periods
export const generateTimePeriods = (timeRange, count = 12) => {
  const periods = [];
  const now = new Date();

  for (let i = 0; i < count; i++) {
    let date;
    let key;
    let label;

    if (timeRange === 'weekly') {
      const startOfWeek = getStartOfWeek(now);
      date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + (i * 7));

      const weekStart = getStartOfWeek(date);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekStart.getDate() + 6);

      const { year, week } = getISOWeekInfo(weekStart);
      key = `${year}-W${String(week).padStart(2, '0')}`;
      label = formatWeekLabel(weekStart, weekEnd, week);
    } else if (timeRange === 'monthly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    } else if (timeRange === 'quarterly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      key = `${date.getFullYear()}-Q${quarter}`;
      label = `Q${quarter} ${date.getFullYear()}`;
    }

    periods.push({ key, label });
  }

  return periods;
};

// Extract formatted YYYY-MM strings from the stored custom range
export const getFormattedDateRange = (customDateRange) => {
  if (!customDateRange) return null;

  const startMonth = String(customDateRange.start.month).padStart(2, '0');
  const endMonth = String(customDateRange.end.month).padStart(2, '0');

  return {
    start: `${customDateRange.start.year}-${startMonth}`,
    end: `${customDateRange.end.year}-${endMonth}`,
  };
};

// Build the time period array based on range and optional custom dates
export const buildTimePeriods = (timeRange, customDateRange) => {
  const formattedRange = getFormattedDateRange(customDateRange);

  if (formattedRange) {
    const [startYear, startMonth] = formattedRange.start.split('-').map(Number);
    const [endYear, endMonth] = formattedRange.end.split('-').map(Number);

    const startDate = new Date(startYear, startMonth - 1, 1);
    const endDate = new Date(endYear, endMonth, 0); // last day of end month

    if (startDate > endDate) {
      console.warn('Custom date range start is after end; no periods generated.');
      return [];
    }

    const periods = [];

    if (timeRange === 'weekly') {
      let current = getStartOfWeek(startDate);
      const endBoundary = endDate;

      while (current <= endBoundary) {
        const weekStart = getStartOfWeek(current);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekStart.getDate() + 6);

        const { year, week } = getISOWeekInfo(weekStart);
        const key = `${year}-W${String(week).padStart(2, '0')}`;
        const label = formatWeekLabel(weekStart, weekEnd, week);

        periods.push({ key, label });
        current.setDate(current.getDate() + 7);
      }

      return periods;
    }

    if (timeRange === 'quarterly') {
      const startQuarterMonth = Math.floor(startDate.getMonth() / 3) * 3;
      let current = new Date(startDate.getFullYear(), startQuarterMonth, 1);

      while (current <= endDate) {
        const quarter = Math.floor(current.getMonth() / 3) + 1;
        const key = `${current.getFullYear()}-Q${quarter}`;
        const label = `Q${quarter} ${current.getFullYear()}`;

        periods.push({ key, label });
        current.setMonth(current.getMonth() + 3, 1);
      }

      return periods;
    }

    // Monthly
    let current = new Date(startDate);
    while (current <= endDate) {
      const key = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}`;
      const label = `${current.toLocaleDateString('en-US', { month: 'short' })} ${current.getFullYear()}`;

      periods.push({ key, label });
      current.setMonth(current.getMonth() + 1, 1);
    }

    return periods;
  }

  // Use default logic (current date + next N months)
  const monthCount = timeRange === 'monthly' ? 12 : timeRange === 'quarterly' ? 4 : 52;
  return generateTimePeriods(timeRange, monthCount);
};
