import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ReportingControls, { yearOptions, orderedWindow, calculateMonthsDifference } from '../components/ReportingControls';

describe('ReportingControls helpers', () => {
  it('offers years around today and around the selected window', () => {
    const now = new Date(2026, 9, 12);
    const years = yearOptions({ start: '2027-01', end: '2027-12' }, now);
    expect(years[0]).toBe(2023);
    expect(years).toContain(2027);
    expect(years).toContain(2031);
    expect(yearOptions({ start: '2034-01', end: '2035-06' }, now)).toEqual(expect.arrayContaining([2034, 2035, 2037]));
  });

  it('never lets the window run backwards', () => {
    expect(orderedWindow('2027-05', '2027-12', 'start')).toEqual({ start: '2027-05', end: '2027-12' });
    expect(orderedWindow('2028-02', '2027-12', 'start')).toEqual({ start: '2028-02', end: '2028-02' });
    expect(orderedWindow('2027-05', '2027-03', 'end')).toEqual({ start: '2027-03', end: '2027-03' });
    expect(calculateMonthsDifference('2027-01', '2027-12')).toBe(12);
  });
});

describe('ReportingControls', () => {
  it('can reach a 2027 window and offers the scenario window as a quick pick', () => {
    const onChange = jest.fn();
    render(
      <ReportingControls
        period={{ start: '2026-01', end: '2026-12' }}
        onPeriodChange={onChange}
        defaultWindow={{ start: '2027-01', end: '2027-12' }}
      />
    );
    fireEvent.change(screen.getByLabelText('Start year'), { target: { value: '2027' } });
    // Start moved past the end: the end follows.
    expect(onChange).toHaveBeenLastCalledWith({ start: '2027-01', end: '2027-01' });
    fireEvent.click(screen.getByRole('button', { name: /Scenario window \(Jan 2027 – Dec 2027\)/ }));
    expect(onChange).toHaveBeenLastCalledWith({ start: '2027-01', end: '2027-12' });
    expect(screen.getByTestId('selected-window')).toHaveTextContent('Jan 2026 – Dec 2026 · 12 months · custom window');
  });

  it('compact mode offers a reset only when the window differs from the scenario window', () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <ReportingControls compact period={{ start: '2027-01', end: '2027-12' }} onPeriodChange={onChange} defaultWindow={{ start: '2027-01', end: '2027-12' }} />
    );
    expect(screen.queryByText('Reset to scenario window')).not.toBeInTheDocument();
    rerender(<ReportingControls compact period={{ start: '2027-04', end: '2027-06' }} onPeriodChange={onChange} defaultWindow={{ start: '2027-01', end: '2027-12' }} />);
    fireEvent.click(screen.getByText('Reset to scenario window'));
    expect(onChange).toHaveBeenLastCalledWith({ start: '2027-01', end: '2027-12' });
  });
});
