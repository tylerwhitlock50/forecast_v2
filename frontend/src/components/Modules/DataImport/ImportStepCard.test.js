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
    await screen.findByText('Will remove 12 lines that are not in this file');
    expect(api.post.mock.calls[1][1]).toMatchObject({ mode: 'replace', dry_run: true });
    const confirm = screen.getByRole('button', { name: 'Import 2 sales rows and remove 12 lines' });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await screen.findByText(/Imported 2 sales rows into Budget 2027 and removed 12 lines that were not in the file/);
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
