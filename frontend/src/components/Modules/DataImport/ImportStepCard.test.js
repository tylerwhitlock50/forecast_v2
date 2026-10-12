import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { MemoryRouter } from 'react-router-dom';
import ImportStepCard from './ImportStepCard';
import { stepByKind } from './importSteps';
import api from '../../../lib/apiClient';
import { prepareSalesRows, readImportFile } from './fileParsing';

jest.mock('../../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn() },
  apiClient: { get: jest.fn() },
}));

const fileRows = [
  { customer_id: 'CUST-001', unit_id: 'RFL-308', period: '2027-01', quantity: 5 },
  { customer_id: 'CUST-999', unit_id: 'RFL-308', period: '2027-01', quantity: 2 },
];
jest.mock('./fileParsing', () => ({
  ...jest.requireActual('./fileParsing'),
  readImportFile: jest.fn(),
  prepareSalesRows: jest.fn(),
}));

const scenario = { id: 'F-2027', name: 'Budget 2027', start_period: '2027-01', end_period: '2027-12' };

const response = (data) => ({
  status: 'success',
  data: {
    imported: 2, inserted: 0, updated: 2, created_customers: [], created_products: [], errors: [], warnings: [],
    price_sources: { explicit: 2 }, start_period: '2027-01', end_period: '2027-01', dry_run: true, mode: 'upsert', deleted: 0,
    replace_blocked: false, ...data,
  },
});

const renderSales = () => render(
  <MemoryRouter>
    <ImportStepCard step={stepByKind('sales')} number={9} count={10} scenario={scenario} noScenarios={false} onImported={jest.fn()} />
  </MemoryRouter>,
);

const upload = async () => {
  const input = screen.getByLabelText('Upload Sales forecast file');
  fireEvent.change(input, { target: { files: [new File(['x'], 'sales.csv', { type: 'text/csv' })] } });
  await screen.findByRole('radiogroup', { name: 'Import mode' });
  await screen.findByText(/This is a check only/); // the dry run has answered
};

describe('ImportStepCard: sales import modes', () => {
  // CRA's jest config resets mocks before every test.
  beforeEach(() => {
    readImportFile.mockResolvedValue({ rows: fileRows, headers: ['customer_id', 'unit_id', 'period', 'quantity'], sheetName: null });
    prepareSalesRows.mockImplementation((rows) => ({ rows, layout: 'long' }));
  });

  it('checks the file as add / update by default and offers the replace modes with help', async () => {
    api.post.mockResolvedValueOnce(response({}));
    renderSales();
    await upload();
    await screen.findByRole('button', { name: 'Import 2 sales rows' });
    expect(api.post.mock.calls[0][1]).toMatchObject({ forecast_id: 'F-2027', mode: 'upsert', dry_run: true });
    expect(screen.getByLabelText(/Add \/ update rows/)).toBeChecked();
    expect(screen.getByText("Replace this scenario's months in the file")).toBeInTheDocument();
    expect(screen.getByText('Replace the whole scenario forecast')).toBeInTheDocument();
    expect(screen.getByText(/Months that are not in the file are left exactly as they are/)).toBeInTheDocument();
  });

  it('re-checks in replace mode and shows the lines it will remove', async () => {
    api.post
      .mockResolvedValueOnce(response({}))
      .mockResolvedValueOnce(response({ mode: 'replace', deleted: 12 }))
      .mockResolvedValueOnce(response({ mode: 'replace', deleted: 12, dry_run: false }));
    renderSales();
    await upload();
    fireEvent.click(screen.getByLabelText(/Replace this scenario's months in the file/));
    await screen.findByText('Will remove 12 monthly rows that are not in this file');
    expect(api.post.mock.calls[1][1]).toMatchObject({ mode: 'replace', dry_run: true });
    const confirm = screen.getByRole('button', { name: 'Import 2 sales rows and remove 12 monthly rows' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await screen.findByText(/Imported 2 sales rows into Budget 2027 and removed 12 monthly rows that were not in the file/);
    expect(api.post.mock.calls[2][1]).toMatchObject({ mode: 'replace', dry_run: false });
  });

  it('blocks the confirm button when a replace would be blocked by row errors', async () => {
    api.post
      .mockResolvedValueOnce(response({ imported: 1, errors: [{ row: 2, error: 'Customer CUST-999 does not exist' }] }))
      .mockResolvedValueOnce(response({ mode: 'replace_all', imported: 1, replace_blocked: true, errors: [{ row: 2, error: 'Customer CUST-999 does not exist' }] }));
    renderSales();
    await upload();
    expect(await screen.findByRole('button', { name: 'Import 1 sales row' })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Replace the whole scenario forecast/));
    await screen.findByText('Nothing will be changed');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import 1 sales row' })).toBeDisabled());
    expect(screen.getByText(/Replacing is blocked while any row has a problem/)).toBeInTheDocument();
  });
});

describe('ImportStepCard: unchanged rows', () => {
  beforeEach(() => {
    readImportFile.mockResolvedValue({ rows: fileRows, headers: ['customer_id', 'unit_id', 'period', 'quantity'], sheetName: null });
    prepareSalesRows.mockImplementation((rows) => ({ rows, layout: 'long' }));
  });

  it('offers nothing to import when every sales row is already saved', async () => {
    api.post.mockResolvedValueOnce(response({ imported: 2, inserted: 0, updated: 0, unchanged: 2 }));
    renderSales();
    await upload();
    const button = await screen.findByRole('button', { name: 'Nothing to change' });
    expect(button).toBeDisabled();
    expect(screen.getByText(/Everything in this file is already saved exactly like this/)).toBeInTheDocument();
  });

  it('counts only new and updated rows on the button, and offers a pure removal', async () => {
    api.post
      .mockResolvedValueOnce(response({ imported: 2, inserted: 0, updated: 1, unchanged: 1 }))
      .mockResolvedValueOnce(response({ imported: 2, inserted: 0, updated: 0, unchanged: 2, mode: 'replace', deleted: 3, removed_line_count: 1 }));
    renderSales();
    await upload();
    expect(await screen.findByRole('button', { name: 'Import 1 sales row' })).toBeEnabled();
    fireEvent.click(screen.getByLabelText(/Replace this scenario's months in the file/));
    expect(await screen.findByRole('button', { name: 'Remove 3 monthly rows' })).toBeEnabled();
    expect(screen.getByText('Will remove 3 monthly rows (1 customer × product line) that are not in this file')).toBeInTheDocument();
  });

  it('says what a removal-only replace did', async () => {
    const replaceResponse = (extra) => response({ imported: 2, inserted: 0, updated: 0, unchanged: 2, mode: 'replace', deleted: 3, removed_line_count: 1, ...extra });
    api.post
      .mockResolvedValueOnce(response({ imported: 2, inserted: 0, updated: 0, unchanged: 2 }))
      .mockResolvedValueOnce(replaceResponse({}))
      .mockResolvedValueOnce(replaceResponse({ dry_run: false }));
    renderSales();
    await upload();
    fireEvent.click(screen.getByLabelText(/Replace this scenario's months in the file/));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove 3 monthly rows' }));
    expect(await screen.findByText(
      'Removed 3 monthly rows (1 customer × product line) from Budget 2027 that were not in the file; 2 rows unchanged.',
    )).toBeInTheDocument();
  });

  it('offers nothing to change when every record is unchanged', async () => {
    readImportFile.mockResolvedValue({ rows: [{ customer_name: 'Big Sky' }], headers: ['customer_name'], sheetName: null });
    api.post.mockResolvedValueOnce({ status: 'success', data: { created: 0, updated: 0, skipped: 0, errors: [], warnings: [], dry_run: true, summary: { unchanged: 1 } } });
    render(
      <MemoryRouter>
        <ImportStepCard step={stepByKind('customers')} number={1} count={12} scenario={scenario} noScenarios={false} onImported={jest.fn()} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Upload Customers file'), { target: { files: [new File(['x'], 'customers.csv', { type: 'text/csv' })] } });
    expect(await screen.findByRole('button', { name: 'Nothing to change' })).toBeDisabled();
  });

  it('says how many BOMs a replace rebuilt and the lines it deleted', async () => {
    readImportFile.mockResolvedValue({ rows: [{ bom_id: 'B1', material_description: 'Barrel', qty: 1 }], headers: ['bom_id', 'material_description', 'qty'], sheetName: null });
    const bomResponse = (extra) => ({
      status: 'success',
      data: { created: 64, updated: 0, replaced: 8, skipped: 0, mode: 'replace', boms_replaced: 8, errors: [], warnings: [], boms: [], summary: { lines_deleted: 61 }, ...extra },
    });
    api.post.mockResolvedValueOnce(bomResponse({ dry_run: true })).mockResolvedValueOnce(bomResponse({ dry_run: false }));
    render(
      <MemoryRouter>
        <ImportStepCard step={stepByKind('boms')} number={6} count={8} scenario={scenario} noScenarios={false} onImported={jest.fn()} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Upload Bills of materials file'), { target: { files: [new File(['x'], 'boms.csv', { type: 'text/csv' })] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Import 64 BOM lines' }));
    expect(await screen.findByText('Import finished: 64 added, 8 BOMs replaced (61 lines deleted first).')).toBeInTheDocument();
  });
});

describe('ImportStepCard: price import replace', () => {
  const priceRows = [{ Product: 'RF-100', Dealer: '1110', Distributor: 'call us' }];
  const priceResponse = (data) => ({
    status: 'success',
    data: {
      created: 1, updated: 0, replaced: 0, skipped: 0, dry_run: true, mode: 'upsert', replace_blocked: false, warnings: [],
      errors: [{ row: 1, column: 'Distributor', error: "unit_price 'call us' is not a number" }], ...data,
    },
  });

  beforeEach(() => {
    readImportFile.mockResolvedValue({ rows: priceRows, headers: ['Product', 'Dealer', 'Distributor'], sheetName: null });
  });

  it('blocks the confirm when a "Replace all" is refused because a row has an error', async () => {
    api.post
      .mockResolvedValueOnce(priceResponse({}))
      .mockResolvedValueOnce(priceResponse({ mode: 'replace', replaced: 15, replace_blocked: true }));
    render(
      <MemoryRouter>
        <ImportStepCard step={stepByKind('prices')} number={7} count={15} scenario={scenario} noScenarios={false} onImported={jest.fn()} />
      </MemoryRouter>,
    );
    fireEvent.change(screen.getByLabelText('Upload Prices file'), { target: { files: [new File(['x'], 'prices.csv', { type: 'text/csv' })] } });
    await screen.findByText(/This is a check only/);
    expect(screen.getByRole('button', { name: 'Import 1 price rule' })).toBeEnabled();
    expect(screen.getByTestId('error-column')).toHaveTextContent('Distributor column');

    fireEvent.click(screen.getByLabelText('Replace all'));
    await screen.findByText('Nothing will be changed');
    expect(api.post.mock.calls[1][1]).toMatchObject({ mode: 'replace', dry_run: true });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Import 1 price rule' })).toBeDisabled());
    expect(screen.getByText(/Replacing is blocked while any row has a problem/)).toHaveTextContent('Add new and update matching');
  });
});
