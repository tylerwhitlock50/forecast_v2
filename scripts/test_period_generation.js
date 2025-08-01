// Test script to verify period generation logic
const generateTimePeriods = (timeRange, count = 12) => {
  const periods = [];
  const now = new Date();
  
  for (let i = 0; i < count; i++) {
    let date, key, label;
    
    if (timeRange === 'weekly') {
      // Start from the beginning of the current week
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay()); // Sunday
      date = new Date(startOfWeek);
      date.setDate(startOfWeek.getDate() + (i * 7));
      
      const weekStart = new Date(date);
      const weekEnd = new Date(date);
      weekEnd.setDate(date.getDate() + 6);
      
      // Calculate week number more accurately
      const weekNumber = Math.ceil((date.getDate() + date.getDay()) / 7);
      key = `${date.getFullYear()}-W${String(weekNumber).padStart(2, '0')}`;
      label = `${weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}-${weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
    } else if (timeRange === 'monthly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
    } else if (timeRange === 'quarterly') {
      date = new Date(now.getFullYear(), now.getMonth() + i, 1);
      const quarter = Math.floor(date.getMonth() / 3) + 1;
      key = `${date.getFullYear()}-Q${quarter}`;
      label = `Q${quarter} ${date.getFullYear()}`;
    }
    
    periods.push({ key, label });
  }
  
  return periods;
};

// Test the period generation
console.log('Current date:', new Date().toISOString().split('T')[0]);
console.log('\n=== MONTHLY PERIODS ===');
const monthlyPeriods = generateTimePeriods('monthly', 12);
monthlyPeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

console.log('\n=== QUARTERLY PERIODS ===');
const quarterlyPeriods = generateTimePeriods('quarterly', 4);
quarterlyPeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

console.log('\n=== WEEKLY PERIODS ===');
const weeklyPeriods = generateTimePeriods('weekly', 12);
weeklyPeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test specific date ranges
console.log('\n=== TESTING SPECIFIC RANGES ===');
const testDate = new Date('2025-09-01'); // September 2025
console.log('Test date:', testDate.toISOString().split('T')[0]);

// Generate periods starting from September 2025
const testPeriods = [];
for (let i = 0; i < 4; i++) {
  const date = new Date(testDate.getFullYear(), testDate.getMonth() + i, 1);
  const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
  testPeriods.push({ key, label });
}

console.log('Periods starting from September 2025:');
testPeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test the specific issue: 9/2025 - 12/2025
console.log('\n=== TESTING SPECIFIC ISSUE: 9/2025 - 12/2025 ===');
const startPeriod = '2025-09';
const endPeriod = '2025-12';

console.log(`Start period: ${startPeriod}`);
console.log(`End period: ${endPeriod}`);

// Parse the periods
const startDate = new Date(startPeriod + '-01');
const endDate = new Date(endPeriod + '-01');

console.log(`Start date: ${startDate.toISOString().split('T')[0]}`);
console.log(`End date: ${endDate.toISOString().split('T')[0]}`);

// Generate periods for this range
const rangePeriods = [];
let currentYear = startDate.getFullYear();
let currentMonth = startDate.getMonth();

while (true) {
  const periodKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;
  const date = new Date(currentYear, currentMonth, 1);
  const label = `${date.toLocaleDateString('en-US', { month: 'short' })} ${date.getFullYear()}`;
  
  rangePeriods.push({ key: periodKey, label });
  
  // Check if we've reached the end
  if (currentYear === endDate.getFullYear() && currentMonth === endDate.getMonth()) {
    break;
  }
  
  // Move to next month
  currentMonth++;
  if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
}

console.log('Periods for range 9/2025 - 12/2025:');
rangePeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Compare with matrix periods (first 4 months from current date)
console.log('\n=== COMPARISON WITH MATRIX PERIODS ===');
console.log('Matrix periods (first 4 from current date):');
monthlyPeriods.slice(0, 4).forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

console.log('\nExpected periods for 9/2025 - 12/2025:');
rangePeriods.forEach((period, index) => {
  console.log(`${index + 1}. ${period.key} - ${period.label}`);
});

// Test the issue: when user selects 9/2025 - 12/2025, matrix shows 8/2025-11/2025
console.log('\n=== ISSUE ANALYSIS ===');
console.log('User selects: 9/2025 - 12/2025');
console.log('Matrix shows: 8/2025 - 11/2025 (one month offset)');
console.log('This suggests the matrix is using periods starting from current month (August 2025)');
console.log('But the modal should allow selection of specific ranges'); 