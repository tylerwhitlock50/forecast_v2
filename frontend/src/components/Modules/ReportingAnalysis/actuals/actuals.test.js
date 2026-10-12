import React from 'react';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import ImportActualsDialog, { importButtonLabel } from './ImportActualsDialog';
import ImportHistory, { batchCounts, nothingToUndo, undoSummary } from './ImportHistory';
import PeriodClosePanel from './PeriodClosePanel';
import { otherReferenceLines, previewHeadline } from './ImportPreview';
import { formatWhen, importQuery, reportFromError } from './actualsApi';
import api from '../../../../lib/apiClient';

jest.mock('../../../../lib/apiClient', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    upload: jest.fn()
  }
}));

const totals = {
  grand_total: 13500,
  rows: 3,
  by_line_item: [
    { line_item: 'revenue', label: 'Net Sales', recognised: true, amount: 12500, rows: 1 },
    { line_item: 'payroll', label: 'Payroll', recognised: true, amount: 4000, rows: 1 },
    { line_item: null, label: 'Freight', recognised: false, amount: -3000, rows: 1 }
  ],
  by_period: [{ period: '2026-04', label: 'Apr 2026', valid: true, amount: 13500, rows: 3 }]
};

const rejectedReport = {
  dry_run: true, written: false, outcome: 'rejected', batch_id: null,
  inserted: 1, updated: 1, unchanged: 0, rejected: 1,
  errors: [{ row: 4, error: "line item 'Freight' is not a statement line." }],
  request_errors: [], duplicates: [], closed_periods: [], warnings: [],
  totals, control_total: null, control_difference: null, control_matches: null,
  rows: [
    { row: 2, period: '2026-04', line_item: 'revenue', label: 'Net Sales', reference_id: '', amount: 12500, previous_amount: null, action: 'inserted' },
    { row: 3, period: '2026-04', line_item: 'payroll', label: 'Payroll', reference_id: '', amount: 4000, previous_amount: 3800, action: 'updated', changes: ['amount'] },
    { row: 4, period: '2026-04', line_item: null, label: 'Freight', reference_id: '', amount: -3000, action: 'rejected', error: "line item 'Freight' is not a statement line." }
  ],
  message: 'Check only, nothing written. The import would be refused: 1 row of 3 has a problem.'
};

const partialReport = { ...rejectedReport, outcome: 'partial', message: 'Check only, nothing written. Importing would give 1 new, 1 changed, 0 unchanged; 1 row would be left out.' };

const file = new File(['period,line_item,amount\n'], 'april.csv', { type: 'text/csv' });

const chooseFile = () => {
  fireEvent.change(screen.getByTestId('actuals-file-input'), { target: { files: [file] } });
};

describe('actuals helpers', () => {
  it('builds the import query', () => {
    expect(importQuery({ dryRun: true, allowPartial: true, combineDuplicates: false, controlTotal: ' 1,000.50 ', note: 'April' }))
      .toBe('?dry_run=true&allow_partial=true&control_total=1%2C000.50&note=April');
    expect(importQuery({ replaceLines: true })).toBe('?replace_lines=true');
    expect(importQuery({})).toBe('');
  });

  it('warns when lines already hold amounts under other references', () => {
    const lineTotals = [{ period: '2026-04', label: 'Apr 2026', line_item: 'revenue', line_label: 'Net Sales', before: 500000,
      file_amount: 500000, after: 1000000, replaced: false, other_references: [{ reference_id: 'JE-101', amount: 300000 }] }];
    expect(otherReferenceLines({ line_totals: lineTotals })).toHaveLength(1);
    const added = previewHeadline({ outcome: 'imported', line_totals: lineTotals });
    expect(added.tone).toBe('warning');
    expect(added.title).toMatch(/some lines already hold other amounts/);
    expect(added.text).toMatch(/Replace these months' lines/);
    const replaced = previewHeadline({ outcome: 'imported', line_totals: [{ ...lineTotals[0], replaced: true, after: 500000 }] });
    expect(replaced.title).toBe('Ready to import');
    expect(previewHeadline({ outcome: 'unchanged', line_totals: lineTotals }).text).toMatch(/kept and added/);
  });

  it('describes an undo that puts replaced amounts back', () => {
    expect(undoSummary({ rows_to_remove: 1, rows_to_restore: 0, rows_to_put_back: 2 }))
      .toBe('This removes 1 amount and puts back 2 amounts this import replaced');
    expect(undoSummary({ rows_to_remove: 1, rows_to_restore: 1, rows_to_put_back: 1 }))
      .toBe('This removes 1 amount, puts 1 amount back to its earlier value and puts back 1 amount this import replaced');
    expect(batchCounts({ inserted: 1, replaced: 2 })).toBe('1 new, 2 replaced');
    expect(undoSummary({ rows_to_remove: 1, rows_to_reassign: 1 }))
      .toBe('This removes 1 amount and keeps 1 amount another import still in place also entered');
  });

  it('counts what a file writes apart from the stored amounts it replaces (UI13-2)', () => {
    expect(importButtonLabel({ inserted: 2, updated: 0, unchanged: 0, replaced: 2 })).toBe('Import 2 amounts, replace 2 stored');
    expect(importButtonLabel({ inserted: 0, updated: 0, unchanged: 2, replaced: 1 })).toBe('Replace 1 stored amount');
    expect(importButtonLabel({ inserted: 1, updated: 1, replaced: 0 })).toBe('Import 2 amounts');
    expect(importButtonLabel({ inserted: 1 })).toBe('Import 1 amount');
    expect(importButtonLabel(null)).toBe('Import');
  });

  it('lets a replace-only import be undone (NEW-4)', () => {
    expect(nothingToUndo({ rows_current: 0, replaced: 1 })).toBe(false);
    expect(nothingToUndo({ rows_current: 0, replaced: 0 })).toBe(true);
    expect(nothingToUndo({ rows_current: 2, replaced: 0 })).toBe(false);
  });

  it('reads the report out of a refused write', () => {
    expect(reportFromError({ response: { data: { data: { outcome: 'rejected' } } } })).toEqual({ outcome: 'rejected' });
    expect(reportFromError({ response: { data: { detail: 'x' } } })).toBeNull();
  });

  it('formats UTC timestamps', () => {
    expect(formatWhen('2026-10-12T14:03:00Z')).toMatch(/Oct 12, 2026/);
    expect(formatWhen('')).toBe('');
  });

  it('says what a check found', () => {
    expect(previewHeadline(rejectedReport).title).toMatch(/Nothing will be imported/);
    expect(previewHeadline({ ...rejectedReport, closed_periods: [{ period: '2026-04', rows: 1 }] }).title).toMatch(/closed months/);
    expect(previewHeadline({ ...rejectedReport, request_errors: ['The file adds up to 1 but the control total is 2'] }).title).toMatch(/control total/);
    expect(previewHeadline(partialReport).title).toBe('Ready to import the valid rows');
    expect(previewHeadline({ outcome: 'unchanged' }).title).toBe('Nothing to import');
    expect(previewHeadline({ outcome: 'imported' }).title).toBe('Ready to import');
  });
});

describe('ImportActualsDialog', () => {
  beforeEach(() => jest.clearAllMocks());

  it('checks the file (dry run), shows problems and totals, and only imports a clean or partial file', async () => {
    api.upload.mockImplementation((url) => {
      if (url.includes('dry_run=true') && url.includes('allow_partial=true')) return Promise.resolve({ status: 'success', data: partialReport });
      if (url.includes('dry_run=true')) return Promise.resolve({ status: 'success', data: rejectedReport });
      return Promise.resolve({
        status: 'success',
        data: { ...partialReport, dry_run: false, written: true, batch_id: 'ACT-1a2b3c4d', message: 'Imported the valid rows' }
      });
    });
    const onImported = jest.fn();
    render(<ImportActualsDialog onClose={jest.fn()} onImported={onImported} />);
    expect(screen.getByTestId('actuals-import-confirm')).toBeDisabled();

    chooseFile();
    expect(await screen.findByTestId('actuals-import-preview')).toBeInTheDocument();
    expect(api.upload.mock.calls[0][0]).toBe('/reporting/actuals/import?dry_run=true');
    expect(screen.getByTestId('actuals-preview-status')).toHaveTextContent('Nothing will be imported until these rows are fixed');
    const errors = within(screen.getByTestId('actuals-preview-errors')).getAllByRole('row');
    expect(errors[1]).toHaveTextContent("4line item 'Freight' is not a statement line.");
    expect(within(screen.getByTestId('actuals-totals-by-line')).getByText('Freight (not recognised)')).toBeInTheDocument();
    expect(screen.getByTestId('actuals-control')).toHaveTextContent('File total 13,500.00');
    expect(within(screen.getByTestId('actuals-preview-changes')).getByText('3,800.00')).toBeInTheDocument();
    expect(screen.getByTestId('actuals-import-confirm')).toBeDisabled();

    // Leave the bad row out: the check runs again and the import is allowed.
    fireEvent.click(screen.getByLabelText(/Import the valid rows/));
    await waitFor(() => expect(screen.getByTestId('actuals-preview-status')).toHaveTextContent('Ready to import the valid rows'));
    const confirm = screen.getByTestId('actuals-import-confirm');
    expect(confirm).not.toBeDisabled();
    expect(confirm).toHaveTextContent('Import 2 amounts');

    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'April TB' } });
    await waitFor(() => expect(screen.getByTestId('actuals-import-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('actuals-import-confirm'));
    expect(await screen.findByTestId('actuals-import-done')).toHaveTextContent('ACT-1a2b3c4d');
    const realCall = api.upload.mock.calls.find(([url]) => !url.includes('dry_run'));
    expect(realCall[0]).toBe('/reporting/actuals/import?allow_partial=true&note=April+TB');
    expect(onImported).toHaveBeenCalledWith(expect.objectContaining({ batch_id: 'ACT-1a2b3c4d' }));
  });

  it('labels a replacing import with what it writes and what it replaces (UI13-2)', async () => {
    const replacing = { ...partialReport, outcome: 'imported', inserted: 2, updated: 0, unchanged: 0, rejected: 0, replaced: 2, errors: [],
      rows: partialReport.rows.slice(0, 1) };
    api.upload.mockResolvedValue({ status: 'success', data: replacing });
    render(<ImportActualsDialog onClose={jest.fn()} />);
    fireEvent.click(screen.getByLabelText(/Replace these months/));
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('actuals-import-confirm')).not.toBeDisabled());
    expect(screen.getByTestId('actuals-import-confirm')).toHaveTextContent('Import 2 amounts, replace 2 stored');
    expect(api.upload.mock.calls.some(([url]) => url.includes('replace_lines=true'))).toBe(true);
  });

  it('shows a control total that does not tie', async () => {
    api.upload.mockResolvedValue({
      status: 'success',
      data: { ...rejectedReport, errors: [], rejected: 0, request_errors: ['The file adds up to 13,500.00 but the control total is 13,000.00 (difference 500.00).'], control_total: 13000, control_difference: 500, control_matches: false }
    });
    render(<ImportActualsDialog onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Control total (optional)'), { target: { value: '13000' } });
    chooseFile();
    await screen.findByTestId('actuals-import-preview');
    await waitFor(() => expect(api.upload.mock.calls.some(([url]) => url.includes('control_total=13000'))).toBe(true));
    expect(screen.getByTestId('actuals-control')).toHaveTextContent('does not tie: control total 13,000.00, difference 500.00');
    expect(screen.getByTestId('actuals-preview-status')).toHaveTextContent('does not tie to the control total');
    expect(screen.getByTestId('actuals-import-confirm')).toBeDisabled();
  });

  it('shows the month totals after the import and replaces other references on request (ACT-4)', async () => {
    const lineTotals = [{ period: '2026-04', label: 'Apr 2026', line_item: 'revenue', line_label: 'Net Sales', before: 500000,
      file_amount: 500000, after: 1000000, replaced: false,
      other_references: [{ reference_id: 'JE-101', amount: 300000, batch_id: 'ACT-0a0a0a0a' }, { reference_id: 'JE-102', amount: 200000, batch_id: 'ACT-0a0a0a0a' }] }];
    const added = { ...partialReport, outcome: 'imported', rejected: 0, errors: [], inserted: 1, updated: 0, line_totals: lineTotals,
      stored_before_total: 500000, stored_after_total: 1000000, control_total: 500000, control_matches: true,
      control_matches_after: false, control_difference_after: 500000,
      totals: { ...totals, grand_total: 500000 } };
    const replaced = { ...added, replaced: 2, line_totals: [{ ...lineTotals[0], after: 500000, replaced: true }],
      stored_after_total: 500000, control_matches_after: true, control_difference_after: 0 };
    api.upload.mockImplementation((url) => Promise.resolve({ status: 'success', data: url.includes('replace_lines=true') ? replaced : added }));
    render(<ImportActualsDialog onClose={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('Control total (optional)'), { target: { value: '500000' } });
    chooseFile();
    await screen.findByTestId('actuals-line-totals');
    expect(screen.getByTestId('actuals-preview-status')).toHaveTextContent('some lines already hold other amounts');
    expect(screen.getByTestId('actuals-after-total')).toHaveTextContent('hold 1,000,000.00 in total');
    expect(screen.getByTestId('actuals-after-total')).toHaveTextContent('500,000.00 off the control total');
    const row = within(screen.getByTestId('actuals-line-totals')).getAllByRole('row')[1];
    expect(row).toHaveTextContent('Apr 2026Net Sales500,000.00500,000.001,000,000.00JE-101 300,000.00; JE-102 200,000.00(kept and added)');

    fireEvent.click(screen.getByLabelText(/Replace these months/));
    await waitFor(() => expect(api.upload.mock.calls.some(([url]) => url.includes('replace_lines=true'))).toBe(true));
    await waitFor(() => expect(screen.getByTestId('actuals-line-totals')).toHaveTextContent('(replaced)'));
    expect(within(screen.getByTestId('actuals-preview-counts')).getByText('Replaced')).toBeInTheDocument();
    expect(screen.getByTestId('actuals-after-total')).toHaveTextContent('hold 500,000.00 in total');
    expect(screen.getByTestId('actuals-preview-status')).toHaveTextContent('Ready to import');
  });

  it('explains a file that cannot be read', async () => {
    api.upload.mockRejectedValue({ userMessage: 'No period column. The file needs one row per month and line.' });
    render(<ImportActualsDialog onClose={jest.fn()} />);
    chooseFile();
    expect(await screen.findByTestId('actuals-check-error')).toHaveTextContent('No period column');
  });

  it('reports a refused import with the report', async () => {
    api.upload.mockImplementation((url) => {
      if (url.includes('dry_run=true')) return Promise.resolve({ status: 'success', data: { ...partialReport, outcome: 'imported', rejected: 0, errors: [] } });
      return Promise.reject({
        response: { status: 409, data: { status: 'rejected', detail: 'Nothing imported. This would change closed months: Apr 2026 (2 rows).', data: { ...rejectedReport, dry_run: false, errors: [], rejected: 0, closed_periods: [{ period: '2026-04', label: 'Apr 2026', rows: 2 }], message: 'Nothing imported. This would change closed months: Apr 2026 (2 rows).' } } }
      });
    });
    render(<ImportActualsDialog onClose={jest.fn()} />);
    chooseFile();
    await waitFor(() => expect(screen.getByTestId('actuals-import-confirm')).not.toBeDisabled());
    fireEvent.click(screen.getByTestId('actuals-import-confirm'));
    expect(await screen.findByTestId('actuals-import-refused')).toHaveTextContent('closed months: Apr 2026');
    expect(screen.getByTestId('actuals-preview-closed')).toHaveTextContent('Apr 2026: 2 rows would change');
  });
});

const replaceOnly = {
  batch_id: 'ACT-33333333', created_at: '2026-10-12T16:00:00Z', source: 'manual', filename: null, rows_in_file: 1,
  inserted: 0, updated: 0, unchanged: 1, rejected: 0, replaced: 1, file_total: 5, control_total: null, status: 'imported',
  note: null, rows_current: 0, periods: ['2028-02'], closed_periods: [], can_undo: true, undo_blocked_reason: null
};

const batches = [
  {
    batch_id: 'ACT-22222222', created_at: '2026-10-12T15:00:00Z', source: 'manual', filename: null, rows_in_file: 1,
    inserted: 0, updated: 1, unchanged: 0, rejected: 0, file_total: 320, control_total: null, status: 'imported', note: null,
    rows_current: 1, periods: ['2026-04'], closed_periods: [], can_undo: true, undo_blocked_reason: null
  },
  {
    batch_id: 'ACT-11111111', created_at: '2026-10-12T14:00:00Z', source: 'file import', filename: 'april.csv', rows_in_file: 2,
    inserted: 2, updated: 0, unchanged: 0, rejected: 0, file_total: 1300, control_total: 1300, status: 'imported', note: 'April TB',
    rows_current: 1, periods: ['2026-03'], closed_periods: ['2026-03'], can_undo: false, undo_blocked_reason: 'Mar 2026 is closed'
  }
];

describe('ImportHistory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue({ status: 'success', data: { batches, total_count: 2 } });
  });

  it('lists imports and undoes one after showing what it removes', async () => {
    api.delete.mockImplementation((url) => Promise.resolve({
      status: 'success',
      data: url.includes('dry_run=true')
        ? { rows_to_remove: 0, rows_to_restore: 1, added_rows: 0, changed_rows: 1, periods: ['2026-04'], can_undo: true,
            changed: [{ period: '2026-04', line_item: 'payroll', label: 'Payroll', reference_id: '', amount: 320,
                        restores_to: 300, action: 'restore' }],
            notes: ['1 row existed before this import and goes back to the earlier amount.'] }
        : { removed: 0, restored: 1, message: 'Undid import' }
    }));
    const onChanged = jest.fn();
    render(<ImportHistory refreshKey={0} onChanged={onChanged} />);
    const manualRow = await screen.findByTestId('actuals-batch-ACT-22222222');
    expect(manualRow).toHaveTextContent('Entered by hand');
    expect(within(manualRow).getByTestId('actuals-batch-counts')).toHaveTextContent('1 changed');
    const fileRow = screen.getByTestId('actuals-batch-ACT-11111111');
    expect(fileRow).toHaveTextContent('april.csv');
    expect(fileRow).toHaveTextContent('control 1,300.00');
    expect(within(fileRow).getByRole('button', { name: /Undo/ })).toBeDisabled();

    fireEvent.click(within(manualRow).getByText('Undo'));
    expect(await screen.findByTestId('actuals-undo-summary')).toHaveTextContent('This puts 1 amount back to its earlier value in Apr 2026.');
    expect(screen.getByText(/goes back to the earlier amount/)).toBeInTheDocument();
    expect(screen.getByTestId('actuals-undo-changed')).toHaveTextContent('Apr 2026 Payroll: now 320.00, goes back to 300.00');
    fireEvent.click(screen.getByTestId('actuals-undo-confirm'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.delete).toHaveBeenCalledWith('/reporting/actuals/batches/ACT-22222222', expect.anything());
  });
});

describe('ImportHistory: replace-only imports and rows another import keeps', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    api.get.mockResolvedValue({ status: 'success', data: { batches: [replaceOnly], total_count: 1 } });
  });

  it('shows the month a replace-only import changed, enables Undo and lists rows that stay', async () => {
    api.delete.mockResolvedValue({
      status: 'success',
      data: { rows_to_remove: 0, rows_to_restore: 0, rows_to_put_back: 1, rows_to_reassign: 1, periods: ['2028-02'], can_undo: true,
        changed: [], notes: [],
        put_back_rows: [{ period: '2028-02', line_item: 'revenue', label: 'Net Sales', reference_id: 'R1', amount: 10, batch_id: 'ACT-11111111' }],
        reassigned_rows: [{ period: '2028-02', line_item: 'payroll', label: 'Payroll', reference_id: '', amount: 60, batch_id: 'ACT-44444444', from_batch_id: 'ACT-33333333' }] }
    });
    render(<ImportHistory refreshKey={0} />);
    const row = await screen.findByTestId('actuals-batch-ACT-33333333');
    expect(row).toHaveTextContent('Feb 2028');
    const undoButton = within(row).getByRole('button', { name: /Undo/ });
    expect(undoButton).not.toBeDisabled();
    fireEvent.click(undoButton);
    expect(await screen.findByTestId('actuals-undo-summary'))
      .toHaveTextContent('This puts back 1 amount this import replaced and keeps 1 amount another import still in place also entered in Feb 2028.');
    expect(screen.getByTestId('actuals-undo-put-back')).toHaveTextContent('Feb 2028 Net Sales (R1): 10.00');
    expect(screen.getByTestId('actuals-undo-kept')).toHaveTextContent('Feb 2028 Payroll: 60.00 (now ACT-44444444)');
    expect(screen.getByTestId('actuals-undo-confirm')).not.toBeDisabled();
  });
});

describe('PeriodClosePanel', () => {
  const periods = [
    { period: '2026-03', status: 'closed', closed: true, closed_at: '2026-10-01T10:00:00Z', closed_by: 'Dana', note: 'Tied to TB', lines_entered: 21, lines_total: 21 },
    { period: '2026-04', status: 'open', closed: false, lines_entered: 3, lines_total: 21 }
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    api.get.mockResolvedValue({ status: 'success', data: { periods, closed_periods: ['2026-03'] } });
    api.post.mockResolvedValue({ status: 'success', data: { status: 'closed' } });
  });

  it('closes a month with a name and note', async () => {
    const onChanged = jest.fn();
    render(<PeriodClosePanel start="2026-03" end="2026-04" refreshKey={0} onChanged={onChanged} />);
    const march = await screen.findByTestId('actuals-month-2026-03');
    expect(march).toHaveTextContent('Closed');
    expect(march).toHaveTextContent('by Dana');
    const april = screen.getByTestId('actuals-month-2026-04');
    expect(april).toHaveTextContent('3 of 21 lines');

    fireEvent.click(within(april).getByText('Close month'));
    fireEvent.change(screen.getByLabelText('Closed by'), { target: { value: 'Dana' } });
    fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'April done' } });
    fireEvent.click(screen.getByTestId('actuals-close-confirm'));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(api.post).toHaveBeenCalledWith('/reporting/actuals/periods/2026-04/close', { closed_by: 'Dana', note: 'April done' }, expect.anything());
  });

  it('needs a reason to reopen', async () => {
    render(<PeriodClosePanel start="2026-03" end="2026-04" refreshKey={0} />);
    const march = await screen.findByTestId('actuals-month-2026-03');
    fireEvent.click(within(march).getByText('Reopen'));
    fireEvent.click(screen.getByTestId('actuals-close-confirm'));
    expect(await screen.findByText('Give a reason for reopening the month.')).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Late invoice' } });
    fireEvent.click(screen.getByTestId('actuals-close-confirm'));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/reporting/actuals/periods/2026-03/reopen', { reason: 'Late invoice', reopened_by: null }, expect.anything()));
  });

  it('remembers who closed the last month', async () => {
    window.localStorage.setItem('forecast.actuals.closedBy', 'Dana');
    render(<PeriodClosePanel start="2026-03" end="2026-04" refreshKey={0} />);
    const april = await screen.findByTestId('actuals-month-2026-04');
    fireEvent.click(within(april).getByText('Close month'));
    expect(screen.getByLabelText('Closed by')).toHaveValue('Dana');
  });
});
