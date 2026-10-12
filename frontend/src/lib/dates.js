// Date-only helpers.
//
// The API sends calendar dates as plain 'YYYY-MM-DD' strings (pay dates,
// loan payment dates, hire dates) and months as 'YYYY-MM'. `new Date('2026-03-31')`
// parses that as UTC midnight, so in any timezone west of UTC it renders as
// March 30 and lands in the wrong month when grouped. These helpers build
// local dates from the components instead, so a date-only value is always
// shown and bucketed as the day it names.

const DATE_RE = /^(\d{4})-(\d{2})(?:-(\d{2}))?/;

/** 'YYYY-MM-DD' or 'YYYY-MM' -> local Date (first of month when no day). Null when unparseable. */
export const parseLocalDate = (value) => {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value !== 'string') return null;
  const m = value.trim().match(DATE_RE);
  if (!m) {
    const fallback = new Date(value);
    return isNaN(fallback.getTime()) ? null : fallback;
  }
  const date = new Date(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1);
  return isNaN(date.getTime()) ? null : date;
};

/** 'YYYY-MM' key for a date-only string, without going through a Date at all. */
export const monthKey = (value) => {
  if (typeof value !== 'string') return null;
  const m = value.trim().match(DATE_RE);
  return m ? `${m[1]}-${m[2]}` : null;
};

/** Local 'YYYY-MM-DD' for a Date (today by default). */
export const toDateOnly = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

/** Format a date-only string for display; empty/invalid -> fallback. */
export const formatDateOnly = (value, options = { month: 'short', day: 'numeric', year: 'numeric' }, fallback = '') => {
  const date = parseLocalDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString('en-US', options);
};
