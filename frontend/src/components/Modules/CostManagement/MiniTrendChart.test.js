import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import MiniTrendChart, { THRESHOLD_DASHES } from './MiniTrendChart';

describe('MiniTrendChart', () => {
  it('draws bars with pixel heights (never 0 high) scaled to the largest value', () => {
    render(<MiniTrendChart data={[{ label: '2027-01', value: 1 }, { label: '2027-02', value: 2 }, { label: '2027-03', value: 0 }]} />);
    const bars = screen.getAllByTestId('trend-bar');
    expect(bars.map(b => b.style.height)).toEqual(['24px', '48px', '2px']);
    expect(bars[0]).toHaveAttribute('title', '2027-01: 1.0');
  });

  it('marks bars over the threshold', () => {
    render(<MiniTrendChart data={[{ label: '2027-01', value: 50 }, { label: '2027-02', value: 120 }]} threshold={100} color="orange" />);
    const bars = screen.getAllByTestId('trend-bar');
    expect(bars[0].className).toContain('bg-orange-500');
    expect(bars[1].className).toContain('bg-red-500');
  });

  it('draws the capacity line on top of the bars in a colour that shows on red', () => {
    render(<MiniTrendChart data={[{ label: '2027-01', value: 50 }, { label: '2027-02', value: 200 }]} threshold={100} />);
    const line = screen.getByTestId('trend-threshold');
    expect(line.style.top).toBe('23px'); // 100 of 200 on a 48px chart, centred on its 2px height
    expect(THRESHOLD_DASHES).toMatch(/#111827.*#ffffff/); // near-black dashes, white gaps (jsdom drops gradients)
    // painted after (above) the bars
    expect(line.previousElementSibling).toHaveAttribute('data-testid', 'trend-bar');
    expect(line.className).toContain('z-10');
  });

  it('draws no capacity line without a threshold', () => {
    render(<MiniTrendChart data={[{ label: '2027-01', value: 50 }]} />);
    expect(screen.queryByTestId('trend-threshold')).not.toBeInTheDocument();
  });

  it('says so when there is no data', () => {
    render(<MiniTrendChart data={[]} />);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });
});
