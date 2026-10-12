/**
 * Period normalisation for sales rows.
 *
 * The model is monthly: a period is 'YYYY-MM'. Spreadsheets write months in
 * many ways, so these are all read as the same month:
 *   2027-01, 2027-1, 2027/01, 2027.01, 202701, 2027-01-31, 2027-01-31T00:00:00,
 *   1/2027, 01/2027, 1/15/2027, 01/01/2027, 1/1/27,
 *   Jan-27, Jan 27, Jan 2027, January 2027, Jan-2027, Jan '27, Sept 2027,
 *   and Excel serial day numbers (46388 = 2027-01-01).
 * Quarter ('2027-Q1') and ISO week ('2027-W05') keys pass through unchanged.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const FULL_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
  'september', 'october', 'november', 'december'];

const pad2 = (n) => String(n).padStart(2, '0');

const fullYear = (y) => (String(y).length <= 2 ? 2000 + Number(y) : Number(y));

const month = (year, m) => (
  Number.isInteger(year) && year >= 1900 && year <= 2200 && Number.isInteger(m) && m >= 1 && m <= 12
    ? `${year}-${pad2(m)}`
    : null
);

// Excel stores dates as days since 1899-12-30 (with the 1900 leap-year bug baked in).
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const excelSerialToMonth = (serial) => {
  const d = new Date(EXCEL_EPOCH_MS + Math.floor(serial) * 86400000);
  return month(d.getUTCFullYear(), d.getUTCMonth() + 1);
};

/**
 * Any common month spelling -> 'YYYY-MM'; quarter / week keys unchanged;
 * null when the value is not a recognisable month.
 */
export function parsePeriod(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return month(value.getFullYear(), value.getMonth() + 1);
  }
  if (typeof value === 'number') {
    if (Number.isInteger(value) && value >= 20000 && value <= 80000) return excelSerialToMonth(value);
    if (Number.isInteger(value) && value >= 190001 && value <= 220012) return month(Math.floor(value / 100), value % 100);
    return null;
  }
  const text = String(value).trim();
  if (!text) return null;

  let m = text.match(/^(\d{4})-(Q[1-4]|W\d{2})$/i);
  if (m) return `${m[1]}-${m[2].toUpperCase()}`;
  m = text.match(/^(\d{4})-(W\d{2})-\d{1,2}$/i);
  if (m) return `${m[1]}-${m[2].toUpperCase()}`;

  // ISO date / datetime: 2027-01-31, 2027-01-31T00:00:00(.000)(Z|+hh:mm)
  m = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/);
  if (m) return month(Number(m[1]), Number(m[2]));

  // 2027-01, 2027-1, 2027/01, 2027.01
  m = text.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return month(Number(m[1]), Number(m[2]));

  // 2027/01/15
  m = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return month(Number(m[1]), Number(m[2]));

  // 202701
  m = text.match(/^(\d{4})(\d{2})$/);
  if (m) return month(Number(m[1]), Number(m[2]));

  // Excel serial typed as text: 46388
  m = text.match(/^(\d{5})(?:\.0+)?$/);
  if (m) {
    const serial = Number(m[1]);
    return serial >= 20000 && serial <= 80000 ? excelSerialToMonth(serial) : null;
  }

  // 1/2027, 01/2027, 1-2027
  m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return month(Number(m[2]), Number(m[1]));

  // US dates: 1/15/2027, 01/01/2027, 1/1/27
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return month(fullYear(m[3]), Number(m[1]));

  // Month names: Jan-27, Jan 2027, January 2027, Jan-2027, Jan '27, Sept 2027
  m = text.match(/^([A-Za-z]{3,9})\.?[\s\-/,']*'?(\d{2}|\d{4})$/);
  if (m) {
    const name = m[1].toLowerCase();
    const idx = MONTHS.indexOf(name.slice(0, 3));
    if (idx >= 0 && (FULL_MONTHS[idx].startsWith(name) || name === 'sept')) {
      return month(fullYear(m[2]), idx + 1);
    }
  }
  return null;
}

/**
 * Normalize a period string to the model's format. Returns the parsed
 * period, or the trimmed original when it is not recognisable (validation
 * reports those).
 */
export function normalizePeriod(period) {
  if (period === null || period === undefined || period === '') return period;
  const parsed = parsePeriod(period);
  return parsed || String(period).trim();
}

/** True when the value can be read as a month (or a quarter / week key). */
export function isValidPeriod(period) {
  return parsePeriod(period) !== null;
}
