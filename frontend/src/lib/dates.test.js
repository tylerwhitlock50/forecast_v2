import { parseLocalDate, monthKey, toDateOnly, formatDateOnly } from './dates';

describe('date-only helpers', () => {
  it('parses YYYY-MM-DD as a local calendar date, not UTC midnight', () => {
    const d = parseLocalDate('2026-03-31');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 31]);
    // Month ends in February and leap years stay on their day.
    expect(parseLocalDate('2027-02-28').getDate()).toBe(28);
    expect(parseLocalDate('2028-02-29').getDate()).toBe(29);
    expect(parseLocalDate('2028-02-29').getMonth()).toBe(1);
  });

  it('parses YYYY-MM as the first of that month', () => {
    const d = parseLocalDate('2026-12');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 11, 1]);
  });

  it('returns null for empty or invalid input', () => {
    expect(parseLocalDate('')).toBeNull();
    expect(parseLocalDate(null)).toBeNull();
    expect(parseLocalDate('not a date')).toBeNull();
  });

  it('buckets a date-only string into its own month without a Date round trip', () => {
    expect(monthKey('2026-03-31')).toBe('2026-03');
    expect(monthKey('2026-12-31')).toBe('2026-12');
    expect(monthKey('2026-01')).toBe('2026-01');
    expect(monthKey(undefined)).toBeNull();
  });

  it('round-trips through toDateOnly and formats for display', () => {
    expect(toDateOnly(new Date(2026, 1, 28))).toBe('2026-02-28');
    expect(toDateOnly(parseLocalDate('2026-03-31'))).toBe('2026-03-31');
    expect(formatDateOnly('2026-03-31')).toBe('Mar 31, 2026');
    expect(formatDateOnly('2026-03', { month: 'long', year: 'numeric' })).toBe('March 2026');
    expect(formatDateOnly('', undefined, '—')).toBe('—');
  });
});
