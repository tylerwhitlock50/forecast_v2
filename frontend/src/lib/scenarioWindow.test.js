import {
  toPeriod,
  defaultWindowForScenario,
  defaultWindowForScenarios,
  monthsInWindow,
  sameWindow,
} from './scenarioWindow';

const NOW = new Date(2026, 9, 12); // Oct 12 2026

describe('defaultWindowForScenario', () => {
  it('widens a sales window inside one calendar year to the whole year', () => {
    expect(defaultWindowForScenario({ start_period: '2027-01', end_period: '2027-12' }, NOW)).toEqual({ start: '2027-01', end: '2027-12' });
    expect(defaultWindowForScenario({ start_period: '2027-03', end_period: '2027-10' }, NOW)).toEqual({ start: '2027-01', end: '2027-12' });
  });

  it('keeps a sales window that spans more than one calendar year', () => {
    expect(defaultWindowForScenario({ start_period: '2026-07', end_period: '2027-06' }, NOW)).toEqual({ start: '2026-07', end: '2027-06' });
  });

  it('falls back to the current calendar year when the scenario has no sales', () => {
    expect(defaultWindowForScenario({ start_period: null, end_period: null }, NOW)).toEqual({ start: '2026-01', end: '2026-12' });
    expect(defaultWindowForScenario(undefined, NOW)).toEqual({ start: '2026-01', end: '2026-12' });
    expect(defaultWindowForScenario({ start_period: '2027-Q1', end_period: 'junk' }, NOW)).toEqual({ start: '2026-01', end: '2026-12' });
  });

  it('copes with a single bound, dates and reversed bounds', () => {
    expect(defaultWindowForScenario({ start_period: '2028-05' }, NOW)).toEqual({ start: '2028-01', end: '2028-12' });
    expect(defaultWindowForScenario({ start_period: '2027-01-15', end_period: '2027-02-28' }, NOW)).toEqual({ start: '2027-01', end: '2027-12' });
    expect(defaultWindowForScenario({ start_period: '2028-02', end_period: '2027-11' }, NOW)).toEqual({ start: '2027-11', end: '2028-02' });
  });
});

describe('defaultWindowForScenarios', () => {
  it('uses the union of the scenarios sales windows', () => {
    const list = [
      { start_period: '2027-01', end_period: '2027-12' },
      { start_period: '2027-04', end_period: '2028-03' },
      { start_period: null, end_period: null },
    ];
    expect(defaultWindowForScenarios(list, NOW)).toEqual({ start: '2027-01', end: '2028-03' });
    expect(defaultWindowForScenarios([list[0]], NOW)).toEqual({ start: '2027-01', end: '2027-12' });
    expect(defaultWindowForScenarios([], NOW)).toEqual({ start: '2026-01', end: '2026-12' });
  });
});

describe('window helpers', () => {
  it('normalises periods and counts months', () => {
    expect(toPeriod(' 2027-01 ')).toBe('2027-01');
    expect(toPeriod('2027-13')).toBeNull();
    expect(monthsInWindow({ start: '2027-01', end: '2027-12' })).toBe(12);
    expect(monthsInWindow({ start: '2026-11', end: '2027-02' })).toBe(4);
    expect(monthsInWindow({ start: 'x', end: '2027-02' })).toBe(0);
    expect(sameWindow({ start: '2027-01', end: '2027-12' }, { start: '2027-01', end: '2027-12' })).toBe(true);
    expect(sameWindow({ start: '2027-01', end: '2027-12' }, null)).toBe(false);
  });
});
