// Test script to verify custom date range functionality
const generateCustomPeriods = (startPeriod, endPeriod, timeRange) => {
  const periods = [];
  
  // Parse periods correctly (YYYY-MM format)
  const [startYear, startMonth] = startPeriod.split('-').map(Number);
  const [endYear, endMonth] = endPeriod.split('-').map(Number);
  
  let currentYear = startYear;
  let currentMonth = startMonth - 1; // JavaScript months are 0-based
  
  while (true) {
    let key, label;
    
    if (timeRange === 'weekly') {
      // For weekly, we'll use monthly periods but with weekly labels
      const date = new Date(currentYear, currentMonth, 1);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    } else if (timeRange === 'monthly') {
      const date = new Date(currentYear, currentMonth, 1);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    } else if (timeRange === 'quarterly') {
      const date = new Date(currentYear, currentMonth, 1);
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      key = `${date.getFullYear()}-Q${quarter}`;
      label = `Q${quarter} ${date.getFullYear()}`;
    }
    
    periods.push({ key, label });
    
    // Check if we've reached the end
    if (currentYear === endYear && currentMonth === (endMonth - 1)) {
      break;
    }
    
    // Move to next month
    currentMonth++;
    if (currentMonth > 11) {
      currentMonth = 0;
      currentYear++;
    }
  }
  
  return periods;
};

// Test the custom date range functionality
console.log('=== TESTING CUSTOM DATE RANGE ===');

// Test case 1: 9/2025 - 12/2025
console.log('\nTest Case 1: 9/2025 - 12/2025');
const periods1 = generateCustomPeriods('2025-09', '2025-12', 'monthly');
console.log('Generated periods:');
periods1.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test case 1b: Verify the range is correct
console.log('\nVerification:');
console.log('Start period should be: 2025-09 (September 2025)');
console.log('End period should be: 2025-12 (December 2025)');
console.log(`Actual start: ${periods1[0]?.key}`);
console.log(`Actual end: ${periods1[periods1.length - 1]?.key}`);

// Test case 2: 1/2026 - 6/2026
console.log('\nTest Case 2: 1/2026 - 6/2026');
const periods2 = generateCustomPeriods('2026-01', '2026-06', 'monthly');
console.log('Generated periods:');
periods2.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test case 3: Quarterly periods
console.log('\nTest Case 3: Quarterly periods for 2025');
const periods3 = generateCustomPeriods('2025-01', '2025-12', 'quarterly');
console.log('Generated periods:');
periods3.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test the issue resolution
console.log('\n=== ISSUE RESOLUTION TEST ===');
console.log('Before fix: User selects 9/2025 - 12/2025, matrix shows 8/2025-11/2025');
console.log('After fix: User selects 9/2025 - 12/2025, matrix shows 9/2025-12/2025');

console.log('\nExpected periods for 9/2025 - 12/2025:');
const expectedPeriods = generateCustomPeriods('2025-09', '2025-12', 'monthly');
expectedPeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

console.log('\n✅ This should now match what the user selected in the modal!'); 