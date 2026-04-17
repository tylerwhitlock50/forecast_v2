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

// Infer the period type from a period key format.
// Returns one of 'weekly' | 'monthly' | 'quarterly' | null.
export const inferPeriodType = (periodKey) => {
  if (!periodKey || typeof periodKey !== 'string') return null;
  const trimmed = periodKey.trim();
  if (/^\d{4}-W\d{2}$/.test(trimmed)) return 'weekly';
  if (/^\d{4}-Q[1-4]$/.test(trimmed)) return 'quarterly';
  // Accept YYYY-MM or YYYY-MM-DD as monthly
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(trimmed)) return 'monthly';
  return null;
};

// Given a period key (e.g. '2025-03', '2025-Q1', '2025-W10') and a count n,
// return an array of the next N period keys after it for the given periodType.
// If periodType is omitted, it is inferred from the key (defaulting to monthly
// if the key format is unrecognized — TODO: richer format detection).
export const getNextNPeriods = (lastPeriodKey, n, periodType) => {
  const count = Math.max(0, parseInt(n, 10) || 0);
  if (!lastPeriodKey || count === 0) return [];

  const type = periodType || inferPeriodType(lastPeriodKey) || 'monthly';
  const result = [];

  if (type === 'monthly') {
    // Accept YYYY-MM or YYYY-MM-DD
    const match = String(lastPeriodKey).match(/^(\d{4})-(\d{2})(?:-\d{2})?$/);
    if (!match) return [];
    let year = parseInt(match[1], 10);
    let month = parseInt(match[2], 10); // 1-based
    for (let i = 0; i < count; i += 1) {
      month += 1;
      if (month > 12) {
        month = 1;
        year += 1;
      }
      result.push(`${year}-${String(month).padStart(2, '0')}`);
    }
    return result;
  }

  if (type === 'quarterly') {
    const match = String(lastPeriodKey).match(/^(\d{4})-Q([1-4])$/);
    if (!match) return [];
    let year = parseInt(match[1], 10);
    let quarter = parseInt(match[2], 10);
    for (let i = 0; i < count; i += 1) {
      quarter += 1;
      if (quarter > 4) {
        quarter = 1;
        year += 1;
      }
      result.push(`${year}-Q${quarter}`);
    }
    return result;
  }

  if (type === 'weekly') {
    const match = String(lastPeriodKey).match(/^(\d{4})-W(\d{2})$/);
    if (!match) return [];
    // Use ISO week math: start from the Monday of the given ISO week, add 7 days.
    const baseYear = parseInt(match[1], 10);
    const baseWeek = parseInt(match[2], 10);

    // Get Monday of ISO week `baseWeek` in `baseYear`.
    // Jan 4 is always in ISO week 1; find its Monday, then offset weeks.
    const jan4 = new Date(Date.UTC(baseYear, 0, 4));
    const jan4Day = jan4.getUTCDay() || 7; // 1..7, Mon=1
    const week1Monday = new Date(jan4);
    week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));

    let current = new Date(week1Monday);
    current.setUTCDate(week1Monday.getUTCDate() + (baseWeek - 1) * 7);

    for (let i = 0; i < count; i += 1) {
      current.setUTCDate(current.getUTCDate() + 7);
      // Compute ISO week info for `current`
      const d = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), current.getUTCDate()));
      d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      result.push(`${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`);
    }
    return result;
  }

  return [];
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
