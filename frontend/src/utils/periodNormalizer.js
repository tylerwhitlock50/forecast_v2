/**
 * Utility functions for normalizing period formats
 */

/**
 * Normalize period strings to standard format.
 * 
 * Accepts:
 * - YYYY-MM-DD -> YYYY-MM
 * - YYYY-MM -> YYYY-MM (no change)
 * - YYYY-WXX-DD -> YYYY-WXX
 * - YYYY-WXX -> YYYY-WXX (no change)
 * - YYYY-QX -> YYYY-QX (no change)
 * 
 * Returns normalized period or original if invalid
 */
export function normalizePeriod(period) {
  if (!period) return period;
  
  const periodStr = String(period).trim();
  
  // Monthly format: YYYY-MM-DD or YYYY-MM
  const monthlyMatch = periodStr.match(/^(\d{4}-\d{2})(-\d{2})?$/);
  if (monthlyMatch) {
    return monthlyMatch[1]; // Return YYYY-MM part
  }
  
  // Quarterly format: YYYY-QX
  const quarterlyMatch = periodStr.match(/^(\d{4}-Q[1-4])$/);
  if (quarterlyMatch) {
    return quarterlyMatch[1];
  }
  
  // Weekly format: YYYY-WXX-DD or YYYY-WXX
  const weeklyMatch = periodStr.match(/^(\d{4}-W\d{2})(-\d{2})?$/);
  if (weeklyMatch) {
    return weeklyMatch[1]; // Return YYYY-WXX part
  }
  
  // If no match, return original (might be invalid, but let validation handle it)
  return periodStr;
}

/**
 * Check if a period string is in a valid format (can be normalized).
 */
export function isValidPeriod(period) {
  if (!period) return false;
  const normalized = normalizePeriod(period);
  return normalized !== period || /^\d{4}-(Q[1-4]|\d{2}|W\d{2})$/.test(period);
}

