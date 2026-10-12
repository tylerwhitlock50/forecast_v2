import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import { ConfirmProvider } from '../../Common/ConfirmDialog';
import PriceListTab from './PriceListTab';
import PriceRuleModal from './PriceRuleModal';
import ApplyPricesModal from './ApplyPricesModal';
import DeductionExample from './DeductionExample';
import api from '../../../lib/apiClient';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
}));

const products = [
  { unit_id: 'RIF', unit_name: 'Hunter Rifle', unit_type: 'Rifle', base_price: 1399 },
  { unit_id: 'ACC', unit_name: 'Sling', unit_type: 'Accessory', base_price: 50 },
];
const customers = [{ customer_id: 'C1', customer_name: 'Big Sky', customer_type: 'Dealer' }];
const base = { id: 'F001', name: 'Budget 2027', is_base: true, sales_rows: 10 };
const branch = { id: 'F002', name: 'Budget 2027 +5% price', is_base: false, sales_rows: 10 };

describe('PriceRuleModal delete', () => {
  const rule = { price_id: 'P1', method: 'fixed', unit_price: 1000, unit_id: 'RIF', customer_type: 'Distributor', is_active: 0 };
  const renderModal = (props) => render(
    <PriceRuleModal
      open
      rule={rule}
      defaults={null}
      onClose={jest.fn()}
      onSave={jest.fn()}
      customers={customers}
      products={products}
      customerTypes={['Dealer', 'Distributor']}
      productTypes={['Rifle']}
      scenario={null}
      {...props}
    />,
  );

  it('deletes an existing price from its edit dialog and says when it is switched off', async () => {
    const onDelete = jest.fn().mockResolvedValue(true);
    const onClose = jest.fn();
    renderModal({ onDelete, onClose });
    expect(screen.getByTestId('price-switched-off')).toHaveTextContent(/switched off/);
    fireEvent.click(screen.getByRole('button', { name: /Delete price/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDelete).toHaveBeenCalledWith(rule);
  });

  it('stays open when the delete is cancelled, and a new price has no delete button', async () => {
    const onDelete = jest.fn().mockResolvedValue(false);
    const onClose = jest.fn();
    const { unmount } = renderModal({ onDelete, onClose });
    fireEvent.click(screen.getByRole('button', { name: /Delete price/ }));
    await waitFor(() => expect(onDelete).toHaveBeenCalled());
    expect(await screen.findByRole('button', { name: /Delete price/ })).toBeEnabled();
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    renderModal({ rule: null, defaults: { unit_id: 'RIF' }, onDelete });
    expect(screen.queryByRole('button', { name: /Delete price/ })).not.toBeInTheDocument();
  });
});

describe('PriceListTab', () => {
  const prices = [
    { price_id: 'P1', unit_id: 'RIF', customer_type: 'Dealer', method: 'fixed', unit_price: 1110, is_active: 1 },
    { price_id: 'P2', unit_id: 'RIF', customer_type: 'Distributor', method: 'fixed', unit_price: 1000, is_active: 0 },
    { price_id: 'P3', customer_type: 'Distributor', method: 'discount_from_base', discount_pct: 0.22, is_active: 1 },
    { price_id: 'P4', unit_id: 'RIF', customer_id: 'C1', method: 'fixed', unit_price: 1080, is_active: 0 },
  ];

  const renderTab = () => render(
    <MemoryRouter>
      <ConfirmProvider>
        <PriceListTab
          customers={customers}
          products={products}
          customerTypes={['Dealer', 'Distributor']}
          productTypes={['Accessory', 'Rifle']}
          scenario={base}
          scenarios={{ F001: base, F002: branch }}
          onChanged={jest.fn()}
        />
      </ConfirmProvider>
    </MemoryRouter>,
  );

  beforeEach(() => {
    api.get.mockResolvedValue({ status: 'success', data: { prices } });
    api.delete.mockResolvedValue({ status: 'success', data: {} });
  });

  it('keeps switched-off prices out of the way but one click from view', async () => {
    renderTab();
    const toggle = await screen.findByRole('switch', { name: 'Show switched-off prices' });
    expect(screen.getByText('Show switched-off prices')).toHaveTextContent('2');
    expect(screen.queryByText('Switched-off prices')).not.toBeInTheDocument();
    // The switched-off customer price is not mixed in with the ones in use.
    expect(screen.getByText(/Use these for contract prices/)).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText('Switched-off prices')).toBeInTheDocument();
    expect(screen.getAllByText(/switched off/).length).toBeGreaterThan(0);
    // The Distributor cell shows the switched-off price struck through; a click opens it.
    expect(screen.getByTestId('cell-switched-off')).toHaveTextContent('off: $1,000.00');
    fireEvent.click(screen.getByTitle(/\$1,000\.00 is set here but switched off/));
    expect(screen.getByText('Edit price')).toBeInTheDocument();
    expect(screen.getByTestId('price-switched-off')).toBeInTheDocument();
  });

  it('deletes a customer-type price from the cell editor after a confirm', async () => {
    renderTab();
    fireEvent.click(await screen.findByTitle('$1,110.00. Click to edit.'));
    const editor = screen.getByText('Edit price').closest('[role="dialog"]');
    fireEvent.click(within(editor).getByRole('button', { name: /Delete price/ }));
    const dialog = (await screen.findByText('Delete this price?')).closest('[role="dialog"]');
    expect(dialog).toHaveTextContent('$1,110.00 for Dealer on Hunter Rifle');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete price' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/pricing/prices/P1', expect.anything()));
    await waitFor(() => expect(screen.queryByText('Edit price')).not.toBeInTheDocument());
  });
});

describe('ApplyPricesModal in a branch', () => {
  const dryRun = (extra) => ({
    status: 'success',
    data: {
      matched: 10, changed: 10, unchanged: 0, unpriced: 0, revenue_before: 10500, revenue_after: 10000,
      by_source: { type_product_type: 6, product_type: 4 }, sample_changes: [], dry_run: true, ...extra,
    },
  });

  const renderApply = (scenario) => render(
    <ApplyPricesModal open onClose={jest.fn()} scenario={scenario} baseScenario={base} customerTypes={['Dealer']} products={products} customers={customers} onApplied={jest.fn()} />,
  );

  it('warns that replacing every price undoes the branch price change and needs a tick', async () => {
    api.post.mockResolvedValueOnce(dryRun({})).mockResolvedValueOnce(dryRun({ changed: 0, unchanged: 10, revenue_after: 10500 }));
    renderApply(branch);
    await screen.findByRole('button', { name: 'Update 10 rows' });
    const warning = screen.getByTestId('apply-prices-warning');
    expect(warning).toHaveTextContent('This replaces every price in Budget 2027 +5% price with the price list');
    expect(warning).toHaveTextContent(
      'Budget 2027 +5% price is not the base scenario, and its name mentions a price change. Applying the price list undoes that change: every row goes back to the price-list price.',
    );
    expect(warning).toHaveTextContent(/gross sales fall by \$500 \(-4\.8%\)/);
    expect(warning).toHaveTextContent(/apply prices in the base scenario Budget 2027/);
    expect(screen.getByText('Product-type price')).toBeInTheDocument();
    expect(screen.getByText('Customer-type price for the product type')).toBeInTheDocument();
    const update = screen.getByRole('button', { name: 'Update 10 rows' });
    expect(update).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Replace the prices in Budget 2027 \+5% price anyway/));
    expect(update).toBeEnabled();

    // "only fill rows with no price" keeps the branch's prices.
    fireEvent.click(within(warning).getByRole('button', { name: 'only fill rows with no price' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1]).toMatchObject({ forecast_id: 'F002', only_missing: true, dry_run: true });
    expect(screen.getByLabelText(/Only fill rows with no price/)).toBeChecked();
    await waitFor(() => expect(screen.queryByTestId('apply-prices-warning')).not.toBeInTheDocument());
  });

  it('explains a plain branch, and a base scenario whose description mentions a price change', async () => {
    api.post.mockResolvedValue(dryRun({}));
    const { unmount } = renderApply({ id: 'F003', name: 'High volume', is_base: false });
    await screen.findByRole('button', { name: 'Update 10 rows' });
    expect(screen.getByTestId('apply-prices-warning')).toHaveTextContent(
      'High volume is not the base scenario. If it was branched with a price change (for example “+5% price”), applying the price list undoes that change',
    );
    unmount();
    renderApply({ ...base, description: 'Dealer pricing +3% from July' });
    await screen.findByRole('button', { name: 'Update 10 rows' });
    expect(screen.getByTestId('apply-prices-warning')).toHaveTextContent(
      'Its description mentions a price change (“Dealer pricing +3% from July”). Applying the price list undoes that change',
    );
    expect(screen.getByTestId('apply-prices-warning')).toHaveTextContent("To keep this scenario's prices, only fill rows with no price.");
    expect(screen.getByTestId('apply-prices-warning')).not.toHaveTextContent('apply prices in the base scenario');
  });

  it('says when every row already has a price', async () => {
    api.post.mockResolvedValueOnce(dryRun({})).mockResolvedValueOnce(dryRun({ matched: 0, changed: 0, revenue_before: 0, revenue_after: 0 }));
    renderApply(branch);
    await screen.findByRole('button', { name: 'Update 10 rows' });
    fireEvent.click(screen.getByLabelText(/Only fill rows with no price/));
    expect(await screen.findByTestId('nothing-to-fill')).toHaveTextContent('Every sales row in Budget 2027 +5% price already has a price');
    expect(screen.getByRole('button', { name: 'Nothing to change' })).toBeDisabled();
  });

  it('does not warn in the base scenario', async () => {
    api.post.mockResolvedValueOnce(dryRun({}));
    renderApply(base);
    expect(await screen.findByRole('button', { name: 'Update 10 rows' })).toBeEnabled();
    expect(screen.queryByTestId('apply-prices-warning')).not.toBeInTheDocument();
  });
});

describe('DeductionExample invoice amount', () => {
  const resolved = {
    RIF: { price: 1110, source: 'type_product', source_label: 'server label', rule: { price_id: 'P1', notes: 'Dealer sheet 2027' } },
    ACC: { price: 35, source: 'type_product_type', source_label: 'server label', rule: { price_id: 'P9' } },
  };

  beforeEach(() => {
    api.get.mockImplementation((url) => {
      const params = new URLSearchParams(url.split('?')[1]);
      return Promise.resolve({ status: 'success', data: resolved[params.get('unit_id')] });
    });
    api.post.mockResolvedValue({ status: 'success', data: { gross_sales: 1110, lines: [], total_sales_deductions: 0, net_sales: 1110 } });
  });

  it('starts from the price-list price times units and says where it came from', async () => {
    render(<DeductionExample customers={customers} products={products} customerTypes={['Dealer']} productTypes={['Rifle']} scenario={base} rules={[]} refreshKey={0} />);
    const amount = screen.getByLabelText('Invoice amount');
    await waitFor(() => expect(amount).toHaveValue(1110));
    expect(api.get.mock.calls[0][0]).toBe('/pricing/resolve?unit_id=RIF&customer_type=Dealer&forecast_id=F001');
    const note = screen.getByTestId('invoice-price-source');
    expect(note).toHaveTextContent('$1,110.00 from the price list: Customer-type price for the product · Dealer sheet 2027');

    fireEvent.change(screen.getByLabelText('Units'), { target: { value: '2' } });
    await waitFor(() => expect(amount).toHaveValue(2220));
    expect(note).toHaveTextContent('$1,110.00 × 2 units from the price list');

    // A typed amount is kept when the product changes; "Use it" goes back to the price list.
    fireEvent.change(amount, { target: { value: '999' } });
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: 'ACC' } });
    await waitFor(() => expect(note).toHaveTextContent('You typed this amount. The price list gives $35.00 × 2 units = $70.00 (Customer-type price for the product type).'));
    expect(amount).toHaveValue(999);
    fireEvent.click(within(note).getByRole('button', { name: 'Use it' }));
    await waitFor(() => expect(amount).toHaveValue(70));
  });

  it('asks for a product, and keeps the amount when nothing prices the combination', async () => {
    api.get.mockResolvedValue({ status: 'success', data: { price: null, source: 'none' } });
    render(<DeductionExample customers={customers} products={products} customerTypes={['Dealer']} productTypes={['Rifle']} scenario={null} rules={[]} refreshKey={0} />);
    const note = screen.getByTestId('invoice-price-source');
    await waitFor(() => expect(note).toHaveTextContent(/No price for this combination/));
    expect(screen.getByLabelText('Invoice amount')).toHaveValue(1399);
    fireEvent.change(screen.getByLabelText('Product'), { target: { value: '' } });
    expect(note).toHaveTextContent('Choose a product to start from its price-list price.');
  });
});
