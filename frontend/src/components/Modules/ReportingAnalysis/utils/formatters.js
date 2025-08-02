// Utility functions for formatting financial data

export const formatCurrency = (amount, options = {}) => {
  const {
    currency = 'USD',
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    showZero = true
  } = options;

  if (amount === null || amount === undefined) {
    return showZero ? '$0.00' : '-';
  }

  if (typeof amount !== 'number') {
    const parsed = parseFloat(amount);
    if (isNaN(parsed)) {
      return showZero ? '$0.00' : '-';
    }
    amount = parsed;
  }

  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits,
    maximumFractionDigits
  }).format(amount);
};

export const formatPercentage = (value, total, options = {}) => {
  const {
    minimumFractionDigits = 1,
    maximumFractionDigits = 1,
    showZero = true
  } = options;

  if (!value || !total || total === 0) {
    return showZero ? '0.0%' : '-';
  }

  if (typeof value !== 'number') {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      return showZero ? '0.0%' : '-';
    }
    value = parsed;
  }

  if (typeof total !== 'number') {
    const parsed = parseFloat(total);
    if (isNaN(parsed)) {
      return showZero ? '0.0%' : '-';
    }
    total = parsed;
  }

  const percentage = (value / total) * 100;

  return new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits
  }).format(percentage / 100);
};

export const formatNumber = (value, options = {}) => {
  const {
    minimumFractionDigits = 0,
    maximumFractionDigits = 2,
    showZero = true
  } = options;

  if (value === null || value === undefined) {
    return showZero ? '0' : '-';
  }

  if (typeof value !== 'number') {
    const parsed = parseFloat(value);
    if (isNaN(parsed)) {
      return showZero ? '0' : '-';
    }
    value = parsed;
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(value);
};

export const formatCompactCurrency = (amount, options = {}) => {
  const {
    currency = 'USD',
    notation = 'compact',
    showZero = true
  } = options;

  if (amount === null || amount === undefined) {
    return showZero ? '$0' : '-';
  }

  if (typeof amount !== 'number') {
    const parsed = parseFloat(amount);
    if (isNaN(parsed)) {
      return showZero ? '$0' : '-';
    }
    amount = parsed;
  }

  // For very large numbers, use compact notation
  if (Math.abs(amount) >= 1000000) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      notation,
      compactDisplay: 'short',
      maximumFractionDigits: 1
    }).format(amount);
  }

  // For smaller numbers, use regular currency formatting
  return formatCurrency(amount, options);
};

export const formatDate = (date, options = {}) => {
  const {
    format = 'short' // 'short', 'medium', 'long', 'full'
  } = options;

  if (!date) return '-';

  let dateObj;
  if (typeof date === 'string') {
    dateObj = new Date(date);
  } else if (date instanceof Date) {
    dateObj = date;
  } else {
    return '-';
  }

  if (isNaN(dateObj.getTime())) {
    return '-';
  }

  const formatOptions = {
    short: { month: 'short', year: 'numeric' },
    medium: { month: 'short', day: 'numeric', year: 'numeric' },
    long: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
    full: { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }
  };

  return new Intl.DateTimeFormat('en-US', formatOptions[format] || formatOptions.medium).format(dateObj);
};

export const formatPeriod = (period) => {
  if (!period) return '-';
  
  // Handle YYYY-MM format
  if (typeof period === 'string' && period.match(/^\d{4}-\d{2}$/)) {
    const [year, month] = period.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return new Intl.DateTimeFormat('en-US', { 
      month: 'short', 
      year: 'numeric' 
    }).format(date);
  }
  
  return period;
};

export const calculateGrowthRate = (current, previous) => {
  if (!previous || previous === 0) return null;
  if (!current) return -100;
  
  return ((current - previous) / Math.abs(previous)) * 100;
};

export const formatGrowthRate = (current, previous, options = {}) => {
  const {
    showSign = true,
    minimumFractionDigits = 1,
    maximumFractionDigits = 1
  } = options;

  const growth = calculateGrowthRate(current, previous);
  
  if (growth === null) return '-';
  
  const formatted = new Intl.NumberFormat('en-US', {
    style: 'percent',
    minimumFractionDigits,
    maximumFractionDigits,
    signDisplay: showSign ? 'always' : 'auto'
  }).format(growth / 100);
  
  return formatted;
};

export const formatVariance = (actual, budget, options = {}) => {
  const {
    format = 'currency', // 'currency', 'percentage', 'both'
    showFavorable = true
  } = options;

  if (!actual || !budget) return '-';

  const variance = actual - budget;
  const percentageVariance = (variance / Math.abs(budget)) * 100;
  
  const isFavorable = variance > 0; // Assuming higher values are favorable (revenue context)
  const favorableText = showFavorable ? (isFavorable ? ' (F)' : ' (U)') : '';
  
  switch (format) {
    case 'currency':
      return `${formatCurrency(variance)}${favorableText}`;
    case 'percentage':
      return `${formatPercentage(variance, budget)}${favorableText}`;
    case 'both':
      return `${formatCurrency(variance)} (${formatPercentage(variance, budget)})${favorableText}`;
    default:
      return `${formatCurrency(variance)}${favorableText}`;
  }
};

// Helper function to get color class based on financial performance
export const getPerformanceColor = (value, context = 'general') => {
  if (value === null || value === undefined || isNaN(value)) {
    return 'text-gray-500';
  }

  switch (context) {
    case 'revenue':
    case 'profit':
    case 'income':
      return value >= 0 ? 'text-green-600' : 'text-red-600';
    case 'expense':
    case 'cost':
      return value <= 0 ? 'text-green-600' : 'text-red-600';
    case 'variance':
      return value >= 0 ? 'text-green-600' : 'text-red-600';
    case 'growth':
      return value >= 0 ? 'text-green-600' : 'text-red-600';
    default:
      return value >= 0 ? 'text-green-600' : 'text-red-600';
  }
};

// Helper function to format ratios
export const formatRatio = (numerator, denominator, options = {}) => {
  const {
    minimumFractionDigits = 2,
    maximumFractionDigits = 2,
    suffix = ':1'
  } = options;

  if (!numerator || !denominator || denominator === 0) {
    return '0.00' + suffix;
  }

  const ratio = numerator / denominator;
  
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits,
    maximumFractionDigits
  }).format(ratio) + suffix;
};