import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import ColumnMapping from './ColumnMapping';

describe('ColumnMapping', () => {
  it('shows which file column feeds which field, month columns and unused columns', () => {
    render(
      <ColumnMapping
        mapping={{
          mapped: [
            { column: 'Class', field: 'customer_type', label: 'customer type' },
            { column: 'Territory', field: 'region', label: 'region' },
          ],
          months: { count: 12, first: '2027-01', last: '2027-12', columns: [] },
          dropped: ['Total'],
          ignored: ['UOM'],
        }}
      />,
    );
    const box = screen.getByTestId('column-mapping');
    expect(box).toHaveTextContent('Class');
    expect(box).toHaveTextContent('customer type');
    expect(box).toHaveTextContent('Territory');
    expect(box).toHaveTextContent('12 month columns');
    expect(box).toHaveTextContent('Row total not imported: Total');
    expect(box).toHaveTextContent('Not used: UOM');
  });

  it('renders nothing without a mapping', () => {
    const { container } = render(<ColumnMapping mapping={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
