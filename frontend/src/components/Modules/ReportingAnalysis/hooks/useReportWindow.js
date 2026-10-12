import { useState, useMemo, useCallback } from 'react';
import { defaultWindowForScenarios } from '../../../../lib/scenarioWindow';

/**
 * Reporting window that follows the selected scenario(s).
 *
 * Until the user picks a window by hand, `period` is the scenarios' default
 * window (their sales window widened to whole calendar years, see
 * lib/scenarioWindow) and it moves when the scenario changes. Once the user
 * picks a window it sticks until `resetPeriod()`.
 */
export const useReportWindow = (scenarios) => {
  const list = Array.isArray(scenarios) ? scenarios : [scenarios];
  const computed = defaultWindowForScenarios(list);
  const { start: defaultStart, end: defaultEnd } = computed;
  const defaultWindow = useMemo(() => ({ start: defaultStart, end: defaultEnd }), [defaultStart, defaultEnd]);

  const [manual, setManual] = useState(null);
  const period = manual || defaultWindow;

  const setPeriod = useCallback((next) => setManual(next ? { start: next.start, end: next.end } : null), []);
  const resetPeriod = useCallback(() => setManual(null), []);

  return { period, setPeriod, resetPeriod, isManual: manual !== null, defaultWindow };
};

export default useReportWindow;
