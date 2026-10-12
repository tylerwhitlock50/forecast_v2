import { roundHalfAwayFromZero, roundMoney, formatMoney } from './money';

describe('roundHalfAwayFromZero', () => {
  it('rounds the 4 dp value half away from zero, ignoring binary float noise', () => {
    expect(roundHalfAwayFromZero(70.475, 2)).toBe(70.48); // 70.475 is stored as 70.47499999...
    expect(roundHalfAwayFromZero(-70.475, 2)).toBe(-70.48);
    expect(roundHalfAwayFromZero(1.005, 2)).toBe(1.01);
    expect(roundHalfAwayFromZero(781.2917, 2)).toBe(781.29);
    expect(roundHalfAwayFromZero(167.41666666666666, 2)).toBe(167.42);
    expect(roundHalfAwayFromZero(1234.5, 0)).toBe(1235);
    expect(roundHalfAwayFromZero(-1234.5, 0)).toBe(-1235);
    expect(roundHalfAwayFromZero(2.25, 1)).toBe(2.3);
  });

  it('rounds to 4 dp first, so 70.47499 (4 dp: 70.4750) shows as 70.48', () => {
    expect(roundHalfAwayFromZero(70.474999, 2)).toBe(70.48);
    expect(roundHalfAwayFromZero(70.47449, 2)).toBe(70.47);
  });

  it('never returns -0 and returns NaN for missing values', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.004, 2), 0)).toBe(true);
    expect(Number.isNaN(roundHalfAwayFromZero(null))).toBe(true);
    expect(Number.isNaN(roundHalfAwayFromZero('abc'))).toBe(true);
    expect(roundHalfAwayFromZero('70.475')).toBe(70.48);
  });

  it('keeps large amounts exact', () => {
    expect(roundMoney(5440708.275, 2)).toBe(5440708.28);
    expect(roundMoney(123456789.125, 2)).toBe(123456789.13);
  });
});

describe('formatMoney', () => {
  it('formats with a dollar sign, separators and the shared rounding', () => {
    expect(formatMoney(70.475)).toBe('$70.48');
    expect(formatMoney(1009.8)).toBe('$1,009.80');
    expect(formatMoney(-1234.5, { decimals: 0 })).toBe('-$1,235');
    expect(formatMoney(-12.345, { negative: 'parens' })).toBe('($12.35)');
    expect(formatMoney(5, { symbol: false })).toBe('5.00');
    expect(formatMoney(-0.001)).toBe('$0.00');
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined, { dash: '-' })).toBe('-');
  });
});
