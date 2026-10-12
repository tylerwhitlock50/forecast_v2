// One rounding rule for every money figure on screen.
//
// Per-unit costs come from the API at up to 4 dp (70.475), but a binary
// float cannot hold 70.475 exactly (it is 70.47499999...), so
// Number#toFixed shows 70.47 while Intl shows 70.48. To make every screen
// agree, a value is first rounded to 4 dp (which removes the float noise)
// and then rounded half AWAY FROM ZERO to the decimals shown:
// 70.475 -> 70.48, -70.475 -> -70.48, 1.005 -> 1.01.

const PRE_ROUND_DP = 4;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return NaN;
  return typeof value === 'number' ? value : parseFloat(value);
};

/**
 * Round half away from zero to `decimals`, after first rounding to 4 dp.
 * Returns NaN for null / undefined / non-numeric input, and never -0.
 */
export const roundHalfAwayFromZero = (value, decimals = 2) => {
  const num = toNumber(value);
  if (!Number.isFinite(num)) return NaN;
  const sign = num < 0 ? -1 : 1;
  const abs = Math.abs(num);
  let result;
  if (decimals >= PRE_ROUND_DP) {
    const f = 10 ** decimals;
    result = Math.round(abs * f) / f;
  } else {
    // Integer arithmetic: abs at 4 dp as an integer, then half-up to `decimals`.
    const scaled = Math.round(abs * 10 ** PRE_ROUND_DP);
    const step = 10 ** (PRE_ROUND_DP - decimals);
    result = Math.floor((scaled + step / 2) / step) / 10 ** decimals;
  }
  return result === 0 ? 0 : sign * result;
};

/** Money rounded the shared way (alias for readability at call sites). */
export const roundMoney = (value, decimals = 2) => roundHalfAwayFromZero(value, decimals);

const formatters = {};
const numberFormat = (decimals) => {
  if (!formatters[decimals]) {
    formatters[decimals] = new Intl.NumberFormat('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }
  return formatters[decimals];
};

/**
 * Format a money value with the shared rounding.
 *   formatMoney(70.475)                        -> "$70.48"
 *   formatMoney(-1234.5, { decimals: 0 })      -> "-$1,235"
 *   formatMoney(-12.345, { negative: 'parens' }) -> "($12.35)"
 *   formatMoney(5, { symbol: false })          -> "5.00"
 *   formatMoney(null)                          -> "—"
 */
export const formatMoney = (value, options = {}) => {
  const { decimals = 2, symbol = true, negative = 'minus', dash = '—' } = options;
  const rounded = roundHalfAwayFromZero(value, decimals);
  if (Number.isNaN(rounded)) return dash;
  const body = `${symbol ? '$' : ''}${numberFormat(decimals).format(Math.abs(rounded))}`;
  if (rounded < 0) return negative === 'parens' ? `(${body})` : `-${body}`;
  return body;
};
