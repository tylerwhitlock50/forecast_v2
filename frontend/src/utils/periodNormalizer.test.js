import { isValidPeriod, normalizePeriod, parsePeriod } from './periodNormalizer';

describe('parsePeriod', () => {
  test.each([
    ['2027-01', '2027-01'],
    ['2027-1', '2027-01'],
    ['2027/01', '2027-01'],
    ['2027.01', '2027-01'],
    ['202701', '2027-01'],
    ['2027-01-31', '2027-01'],
    ['2027-01-31T00:00:00', '2027-01'],
    ['2027-01-31T00:00:00.000Z', '2027-01'],
    ['2027/01/15', '2027-01'],
    ['1/2027', '2027-01'],
    ['01/2027', '2027-01'],
    ['1/1/2027', '2027-01'],
    ['01/01/2027', '2027-01'],
    ['12/1/2027', '2027-12'],
    ['1/1/27', '2027-01'],
    ['Jan-27', '2027-01'],
    ['Jan 27', '2027-01'],
    ['Jan 2027', '2027-01'],
    ['January 2027', '2027-01'],
    ['jan-2027', '2027-01'],
    ["Jan '27", '2027-01'],
    ['Sept 2027', '2027-09'],
    ['46388', '2027-01'],
    [' 2027-03 ', '2027-03'],
  ])('%s -> %s', (input, expected) => {
    expect(parsePeriod(input)).toBe(expected);
  });

  test('Excel serial numbers and yyyymm numbers', () => {
    expect(parsePeriod(46388)).toBe('2027-01');
    expect(parsePeriod(46722)).toBe('2027-12');
    expect(parsePeriod(202703)).toBe('2027-03');
  });

  test('quarter and week keys pass through', () => {
    expect(parsePeriod('2027-Q1')).toBe('2027-Q1');
    expect(parsePeriod('2027-w05')).toBe('2027-W05');
    expect(parsePeriod('2027-W05-01')).toBe('2027-W05');
  });

  test.each(['', 'Marketing 2027', '2027-13', '13/2027', 'TBD', '2027-00', null, undefined, 12.5])('%s is not a month', (input) => {
    expect(parsePeriod(input)).toBeNull();
  });
});

describe('normalizePeriod', () => {
  test('keeps unrecognised text (trimmed) so validation can report it', () => {
    expect(normalizePeriod(' TBD ')).toBe('TBD');
    expect(normalizePeriod('2027-01-01')).toBe('2027-01');
    expect(normalizePeriod('')).toBe('');
    expect(normalizePeriod(null)).toBeNull();
  });

  test('isValidPeriod', () => {
    expect(isValidPeriod('Jan-27')).toBe(true);
    expect(isValidPeriod('2027-Q2')).toBe(true);
    expect(isValidPeriod('soon')).toBe(false);
  });
});
