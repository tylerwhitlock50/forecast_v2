import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import PriceRuleModal from './PriceRuleModal';
import DeductionRuleModal from './DeductionRuleModal';
import DeductionExample from './DeductionExample';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn() },
}));

const products = [
  { unit_id: 'RIF', unit_name: 'Hunter Rifle', unit_type: 'Rifle', base_price: 1500 },
  { unit_id: 'ACC', unit_name: 'Sling', unit_type: 'Accessory', base_price: 50 },
];
const customers = [{ customer_id: 'C-DST', customer_name: 'Big Distributor', customer_type: 'Distributor' }];

describe('PriceRuleModal product-type scope', () => {
  it('saves a customer-type discount for one product type', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    render(
      <PriceRuleModal
        open
        rule={null}
        defaults={{ method: 'discount_from_base' }}
        onClose={jest.fn()}
        onSave={onSave}
        customers={customers}
        products={products}
        customerTypes={['Dealer', 'Distributor']}
        productTypes={['Accessory', 'Rifle']}
        scenario={null}
      />,
    );
    fireEvent.click(screen.getByLabelText('A product type'));
    fireEvent.change(screen.getByLabelText('Product type'), { target: { value: 'Accessory' } });
    expect(screen.getByText(/1 product of this type/)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('A customer type'));
    fireEvent.change(screen.getByLabelText('Customer type'), { target: { value: 'Distributor' } });
    fireEvent.change(screen.getByLabelText('Discount off list price'), { target: { value: '40' } });
    expect(screen.getByText(/Sling: \$50\.00 → \$30\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add price' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(onSave.mock.calls[0][0]).toMatchObject({
      method: 'discount_from_base', discount_pct: 0.4, unit_id: null, unit_type: 'Accessory', customer_type: 'Distributor',
    });
  });

  it('shows an existing product-type rule as such and does not offer "All products" for a fixed price', () => {
    render(
      <PriceRuleModal
        open
        rule={{ price_id: 'P1', method: 'fixed', unit_price: 35, unit_type: 'Accessory', customer_type: 'Dealer' }}
        defaults={null}
        onClose={jest.fn()}
        onSave={jest.fn()}
        customers={customers}
        products={products}
        customerTypes={['Dealer']}
        productTypes={['Accessory']}
        scenario={null}
      />,
    );
    expect(screen.getByLabelText('A product type')).toBeChecked();
    expect(screen.getByLabelText('Product type')).toHaveValue('Accessory');
    expect(screen.getByLabelText('All products')).toBeDisabled();
  });
});

describe('DeductionRuleModal programs', () => {
  it('asks for a program name for other allowances', () => {
    render(
      <DeductionRuleModal
        open
        rule={null}
        defaults={{ deduction_type: 'other_allowance' }}
        onClose={jest.fn()}
        onSave={jest.fn()}
        customers={customers}
        products={products}
        customerTypes={['Distributor']}
        productTypes={['Rifle']}
        scenario={null}
      />,
    );
    expect(screen.getByLabelText('Program name')).toHaveAttribute('placeholder', 'e.g. Co-op advertising');
    expect(screen.getByText(/Rules with the same name are one program/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'terms_allowance' } });
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
  });
});

describe('DeductionExample programs', () => {
  it('lists every other-allowance program the invoice gets', async () => {
    api.post.mockResolvedValue({
      data: {
        gross_sales: 10000,
        lines: [
          { deduction_type: 'terms_allowance', amount: 0, rule: null, rules: [] },
          {
            deduction_type: 'other_allowance',
            amount: 80,
            rule: { rule_id: 'C', name: 'Co-op', method: 'percent_of_gross', rate: 0.005 },
            rules: [
              { rule_id: 'C', name: 'Co-op', method: 'percent_of_gross', rate: 0.005, amount: 50 },
              { rule_id: 'F', name: 'Freight', method: 'per_unit', amount_per_unit: 3, amount: 30 },
            ],
            overridden_rules: [],
          },
        ],
        total_sales_deductions: 80,
        net_sales: 9920,
        commission: 0,
      },
    });
    render(
      <DeductionExample customers={customers} products={products} customerTypes={['Distributor']} productTypes={['Rifle']} scenario={null} rules={[]} refreshKey={0} />,
    );
    const list = await screen.findByTestId('programs-other_allowance', {}, { timeout: 2000 });
    expect(list).toHaveTextContent('Co-op · 0.5%');
    expect(list).toHaveTextContent('Freight · $3.00 / unit');
    expect(list).toHaveTextContent('$50.00');
    expect(list).toHaveTextContent('$30.00');
  });
});
