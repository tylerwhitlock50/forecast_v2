// Pure helpers that turn the backend's month-by-month costing reports
// (/products/materials/usage, /products/machines/utilization,
// /products/labor/utilization) into what one Cost Management card shows for
// "All months" or for a single month. Tested in costViews.test.js.
//
// Capacity and headcount are MONTHLY constraints: for "All months" a card
// shows the average month and the busiest (peak) month, never the window
// total over one month of capacity.

export const ALL = 'all';
export const DEFAULT_HOURS_PER_FTE = 173.33;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const round = (v, d = 2) => Math.round(num(v) * 10 ** d) / 10 ** d;

/** Months of a report: its `periods`, else the keys of the first item's monthly data. */
export const reportPeriods = (report) => {
  if (Array.isArray(report?.periods) && report.periods.length) return report.periods;
  return [];
};

const monthsOf = (item, periods) =>
  num(item?.months_in_window) || (Array.isArray(item?.monthly) && item.monthly.length) || periods.length || 1;

const byPeriod = (monthly = [], period) => (monthly || []).find(m => m.period === period) || null;

const peakOf = (monthly, key) =>
  (monthly || []).reduce((best, m) => (best === null || num(m[key]) > num(best[key]) ? m : best), null);

/**
 * One machine card. `period` is ALL or 'YYYY-MM'.
 * Returns minutes, capacity and utilisation for the average month (ALL) or
 * that month, plus the peak month and a monthly utilisation trend.
 */
export const machineView = (machine, period = ALL, periods = []) => {
  const monthly = Array.isArray(machine?.monthly) ? machine.monthly : null;
  const months = monthsOf(machine, periods);
  const capacity = machine?.available_minutes_per_month === null || machine?.available_minutes_per_month === undefined
    ? null
    : num(machine.available_minutes_per_month);
  const hasCapacity = capacity !== null && capacity > 0;
  const pct = (minutes) => (hasCapacity ? round((minutes / capacity) * 100, 1) : null);

  const totalMinutes = num(machine?.total_minutes_required);
  const avgMinutes = machine?.average_monthly_minutes !== undefined
    ? num(machine.average_monthly_minutes)
    : totalMinutes / months;

  let peakPeriod = machine?.peak_period || null;
  let peakMinutes = null;
  if (monthly) {
    const peak = peakOf(monthly, 'minutes_required');
    if (peak && num(peak.minutes_required) > 0) {
      peakPeriod = peak.period;
      peakMinutes = num(peak.minutes_required);
    }
  }
  const peakUtilization = machine?.peak_utilization_percent !== undefined && machine?.peak_utilization_percent !== null
    ? round(machine.peak_utilization_percent, 1)
    : (peakMinutes !== null ? pct(peakMinutes) : null);

  const overPeriods = Array.isArray(machine?.over_capacity_periods)
    ? machine.over_capacity_periods
    : (monthly || []).filter(m => hasCapacity && num(m.minutes_required) > capacity).map(m => m.period);

  const trend = (monthly || []).map(m => ({
    label: m.period,
    value: hasCapacity ? num(m.minutes_required) / capacity * 100 : num(m.minutes_required),
  }));

  if (period !== ALL) {
    const m = byPeriod(monthly, period);
    const minutes = m ? num(m.minutes_required) : 0;
    const utilization = m && m.utilization_percent !== null && m.utilization_percent !== undefined
      ? round(m.utilization_percent, 1)
      : pct(minutes);
    return {
      mode: 'month',
      minutes,
      capacity,
      utilization,
      overCapacity: hasCapacity && minutes > capacity,
      cost: m ? num(m.cost) : 0,
      peakPeriod,
      peakUtilization,
      overPeriods,
      trend,
    };
  }

  return {
    mode: 'average',
    minutes: round(avgMinutes, 1),
    totalMinutes,
    capacity,
    utilization: machine?.utilization_percent !== undefined && machine?.utilization_percent !== null
      ? round(machine.utilization_percent, 1)
      : pct(avgMinutes),
    overCapacity: overPeriods.length > 0,
    cost: num(machine?.total_cost),
    peakPeriod,
    peakUtilization,
    overPeriods,
    trend,
  };
};

/** One labor-type card: hours and FTE for the average month (ALL) or one month, plus peak. */
export const laborView = (labor, period = ALL, periods = [], hoursPerFte = DEFAULT_HOURS_PER_FTE) => {
  const monthly = Array.isArray(labor?.monthly) ? labor.monthly : null;
  const months = monthsOf(labor, periods);
  const fteHours = num(hoursPerFte) || DEFAULT_HOURS_PER_FTE;
  const totalHours = num(labor?.total_hours ?? labor?.total_hours_required);

  const peak = monthly ? peakOf(monthly, 'hours') : null;
  const peakHours = labor?.peak_monthly_hours !== undefined ? num(labor.peak_monthly_hours) : (peak ? num(peak.hours) : 0);
  const peakPeriod = labor?.peak_period || (peak && num(peak.hours) > 0 ? peak.period : null);
  const peakFte = labor?.peak_fte !== undefined && labor?.peak_fte !== null ? num(labor.peak_fte) : peakHours / fteHours;

  const trend = (monthly || []).map(m => ({
    label: m.period,
    value: m.fte !== undefined && m.fte !== null ? num(m.fte) : num(m.hours) / fteHours,
  }));

  if (period !== ALL) {
    const m = byPeriod(monthly, period);
    const hours = m ? num(m.hours) : 0;
    return {
      mode: 'month',
      hours,
      fte: m && m.fte !== undefined && m.fte !== null ? num(m.fte) : hours / fteHours,
      cost: m ? num(m.cost) : 0,
      peakFte,
      peakPeriod,
      trend,
    };
  }

  const avgHours = labor?.average_monthly_hours !== undefined ? num(labor.average_monthly_hours) : totalHours / months;
  return {
    mode: 'average',
    hours: avgHours,
    totalHours,
    fte: labor?.avg_fte !== undefined && labor?.avg_fte !== null ? num(labor.avg_fte) : avgHours / fteHours,
    cost: num(labor?.total_cost),
    peakFte,
    peakPeriod,
    trend,
  };
};

/** One material card: quantity and spend for the window (ALL) or one month, plus a monthly quantity trend. */
export const materialView = (material, period = ALL) => {
  const by = material?.by_period || {};
  const trend = Object.keys(by).sort().map(p => ({ label: p, value: num(by[p]?.quantity) }));
  if (period !== ALL) {
    const m = by[period] || { quantity: 0, cost: 0 };
    return { mode: 'month', quantity: num(m.quantity), cost: num(m.cost), trend };
  }
  return { mode: 'total', quantity: num(material?.total_quantity_needed), cost: num(material?.total_cost), trend };
};

/** Items that have something to show for the chosen period (all items for ALL). */
export const activeIn = (items, period, valueOf) =>
  (items || []).filter(item => period === ALL || num(valueOf(item)) > 0);

/** "$7.96M" / "$412K" / "$950" — for KPI tiles that must stay on one line. */
export const formatCompactCurrency = (value) => {
  const v = num(value);
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e4) return `${sign}$${Math.round(abs / 1e3).toLocaleString('en-US')}K`;
  return `${sign}$${Math.round(abs).toLocaleString('en-US')}`;
};

/** 'YYYY-MM' -> 'Jan 2027'. */
export const periodLabel = (period) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(period || ''));
  if (!m) return String(period || '');
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${names[Number(m[2]) - 1]} ${m[1]}`;
};
