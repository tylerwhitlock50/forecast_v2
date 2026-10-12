import { formatCapacityHours, hoursFieldValue, hoursToMinutes, minutesToHours, validateMachines } from './machineHelpers';

describe('capacity in hours', () => {
  it('shows stored minutes as hours and stores typed hours as minutes', () => {
    expect(minutesToHours(19200)).toBe(320);
    expect(formatCapacityHours(19200)).toBe('320');
    expect(formatCapacityHours(9600)).toBe('160');
    expect(formatCapacityHours(100)).toBe('1.7');
    expect(formatCapacityHours(null)).toBeNull();
    expect(hoursToMinutes('320')).toBe(19200);
    expect(hoursToMinutes('7.5')).toBe(450);
    expect(hoursToMinutes('')).toBeNull();
    expect(hoursFieldValue(19200)).toBe('320');
    expect(hoursFieldValue(100)).toBe('1.67');
    expect(hoursFieldValue(undefined)).toBe('');
  });
});

describe('validateMachines', () => {
  it('only reports what affects cost or capacity (no labor type / description noise)', () => {
    const r = validateMachines([
      { machine_id: 'WC-MILL1', machine_name: 'Haas VF-4', machine_rate: 85, available_minutes_per_month: 19200, labor_type: null, machine_description: null },
      { machine_id: 'WC-TEST', machine_name: 'Function Test Range', machine_rate: 0, available_minutes_per_month: null },
    ]);
    expect(r.stats).toEqual({ total: 2, valid: 1, withIssues: 0, withWarnings: 1 });
    expect(r.warnings[0].warnings).toEqual([
      'Hourly rate is $0: machine time on this machine costs nothing',
      'No capacity: set hours per month to see how loaded it is',
    ]);
  });
});
