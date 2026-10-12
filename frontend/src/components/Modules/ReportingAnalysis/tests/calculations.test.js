import { describe, it, expect } from '@jest/globals';
import {
  formatCurrency,
  formatPercentage,
  formatPeriod,
  formatAccounting,
  formatPct,
  calculateGrowthRate
} from '../utils/formatters';

// Statement math now lives on the server (/reporting/statements); only the
// presentation helpers are tested here.
describe('Formatter Utilities', () => {
  describe('formatCurrency', () => {
    it('should format positive amounts correctly', () => {
      expect(formatCurrency(1234.56)).toBe('$1,234.56');
      expect(formatCurrency(1000000)).toBe('$1,000,000.00');
    });

    it('should format negative amounts correctly', () => {
      expect(formatCurrency(-1234.56)).toBe('-$1,234.56');
    });

    it('should handle zero and null values', () => {
      expect(formatCurrency(0)).toBe('$0.00');
      expect(formatCurrency(null)).toBe('$0.00');
      expect(formatCurrency(undefined)).toBe('$0.00');
    });

    it('should handle string inputs', () => {
      expect(formatCurrency('1234.56')).toBe('$1,234.56');
      expect(formatCurrency('invalid')).toBe('$0.00');
    });

    it('should honour fraction digit options', () => {
      expect(formatCurrency(1234.56, { minimumFractionDigits: 0, maximumFractionDigits: 0 })).toBe('$1,235');
    });
  });

  describe('formatPercentage', () => {
    it('should calculate and format percentages correctly', () => {
      expect(formatPercentage(250, 1000)).toBe('25.0%');
      expect(formatPercentage(75, 300)).toBe('25.0%');
    });

    it('should handle zero and null values', () => {
      expect(formatPercentage(0, 100)).toBe('0.0%');
      expect(formatPercentage(100, 0)).toBe('0.0%');
      expect(formatPercentage(null, 100)).toBe('0.0%');
    });

    it('should handle string inputs', () => {
      expect(formatPercentage('25', '100')).toBe('25.0%');
    });
  });

  describe('formatPeriod', () => {
    it('should render YYYY-MM as a short month and year', () => {
      expect(formatPeriod('2026-01')).toBe('Jan 2026');
      expect(formatPeriod('2026-12')).toBe('Dec 2026');
    });

    it('should pass through other values', () => {
      expect(formatPeriod('')).toBe('-');
      expect(formatPeriod('Total')).toBe('Total');
    });
  });

  describe('formatAccounting', () => {
    it('should format whole numbers with separators', () => {
      expect(formatAccounting(1234567.89)).toBe('1,234,568');
      expect(formatAccounting(0)).toBe('0');
    });

    it('should wrap negatives in parentheses', () => {
      expect(formatAccounting(-1234.56)).toBe('(1,235)');
      expect(formatAccounting(-0.004)).toBe('0');
    });

    it('should show a dash for missing values', () => {
      expect(formatAccounting(null)).toBe('—');
      expect(formatAccounting(undefined)).toBe('—');
      expect(formatAccounting('abc')).toBe('—');
    });

    it('should support decimals', () => {
      expect(formatAccounting(-12.345, { decimals: 2 })).toBe('(12.35)');
    });
  });

  describe('formatPct', () => {
    it('should format percent-scale values', () => {
      expect(formatPct(52.345)).toBe('52.3%');
      expect(formatPct(-2.5)).toBe('-2.5%');
      expect(formatPct(null)).toBe('—');
    });
  });

  describe('calculateGrowthRate', () => {
    it('should calculate growth rates correctly', () => {
      expect(calculateGrowthRate(120, 100)).toBe(20);
      expect(calculateGrowthRate(80, 100)).toBe(-20);
      expect(calculateGrowthRate(100, 100)).toBe(0);
    });

    it('should handle edge cases', () => {
      expect(calculateGrowthRate(100, 0)).toBeNull();
      expect(calculateGrowthRate(0, 100)).toBe(-100);
      expect(calculateGrowthRate(null, 100)).toBe(-100);
    });
  });
});
