import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import DatabaseLoadModal from './DatabaseLoadModal';
import api from '../../lib/apiClient';

jest.mock('../../lib/apiClient', () => ({
  __esModule: true,
  default: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));

const mockConfirm = jest.fn();
jest.mock('../Common/ConfirmDialog', () => ({ useConfirm: () => mockConfirm }));
jest.mock('react-hot-toast', () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

const snap = (filename, kind, type, savedAt, contents) => ({
  filename, name: filename.replace(/\.db$/, ''), type, kind, size: 430080,
  saved_at: savedAt, created: savedAt, modified: savedAt, contents,
});

const rehearsal = {
  scenarios: ['2027 Budget', '2027 Budget +5%'], scenario_count: 2, customers: 12, products: 8,
  sales_rows: 1429, total_rows: 2400, empty: false,
};
const empty = { scenarios: [], scenario_count: 0, customers: 0, products: 0, sales_rows: 0, total_rows: 0, empty: true };

const before = [
  snap('Rehearsal 2027.db', 'manual_save', 'manual_save', '2026-10-12T08:10:00', rehearsal),
  snap('autosave_20261012_080000_000.db', 'autosave', 'autosave', '2026-10-12T08:00:00', rehearsal),
  snap('current_backup_20261012_081815_599.db', 'before_load_backup', 'system_backup', '2026-10-12T08:18:15', empty),
];
const startCleanCopy = snap('start_clean_backup_20261012_082000_100.db', 'start_clean_backup', 'system_backup', '2026-10-12T08:20:00', rehearsal);

const listResponse = (databases) => ({ status: 'success', data: { databases } });

describe('DatabaseLoadModal', () => {
  beforeEach(() => {
    mockConfirm.mockResolvedValue(true);
  });

  it('groups snapshots by kind and shows what each one holds', async () => {
    api.get.mockResolvedValue(listResponse(before));
    render(<DatabaseLoadModal isOpen onClose={jest.fn()} onLoad={jest.fn()} />);
    await screen.findByText('Your saves');
    const groups = Array.from(document.querySelectorAll('.database-group')).map((g) => g.getAttribute('data-group'));
    expect(groups).toEqual(['saves', 'autosaves', 'before_load']);
    expect(screen.getByText('Autosaves')).toBeInTheDocument();
    expect(screen.getByText('Safety copies made before loading')).toBeInTheDocument();
    expect(screen.getAllByText('2027 Budget, 2027 Budget +5% · 12 customers · 1,429 sales rows')).toHaveLength(2);
    const emptyLine = screen.getByText('Empty database');
    expect(emptyLine).toHaveClass('is-empty');
    // Nothing is selected yet, so Load is off.
    expect(screen.getByRole('button', { name: 'Load Database' })).toBeDisabled();
    fireEvent.click(screen.getByText('Rehearsal 2027'));
    expect(screen.getByRole('button', { name: 'Load Database' })).toBeEnabled();
  });

  it('after Start clean keeps the dialog open with the safety copy selected and a hint', async () => {
    api.get
      .mockResolvedValueOnce(listResponse(before))
      .mockResolvedValueOnce(listResponse([...before, startCleanCopy]));
    api.post.mockResolvedValue({ status: 'success', data: { backup: { filename: startCleanCopy.filename } } });
    const onClose = jest.fn();
    const onAfterReset = jest.fn();
    const onLoad = jest.fn().mockResolvedValue(undefined);
    render(<DatabaseLoadModal isOpen onClose={onClose} onLoad={onLoad} onAfterReset={onAfterReset} />);
    await screen.findByText('Your saves');

    fireEvent.click(screen.getByRole('button', { name: 'Start clean…' }));
    await screen.findByText('Load this to get your previous data back');
    expect(api.post).toHaveBeenCalledWith('/database/start-clean', { confirm: true, snapshot_first: true }, expect.anything());
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() => expect(onAfterReset).toHaveBeenCalled());

    const group = document.querySelector('[data-group="start_clean"]');
    expect(within(group).getByText("Safety copies made before 'Start clean'")).toBeInTheDocument();
    const highlighted = document.querySelector('[data-restore-point="true"]');
    expect(highlighted).toHaveClass('restore-point');
    expect(highlighted).toHaveClass('selected');
    expect(within(highlighted).getByText(/start_clean_backup_20261012_082000_100\.db/)).toBeInTheDocument();
    expect(within(highlighted).getByRole('radio')).toBeChecked();

    const load = screen.getByRole('button', { name: 'Load Database' });
    expect(load).toBeEnabled();
    fireEvent.click(load);
    await waitFor(() => expect(onLoad).toHaveBeenCalledWith(startCleanCopy.filename));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('says so when the list cannot be read', async () => {
    api.get.mockRejectedValue(Object.assign(new Error('x'), { userMessage: 'Network error - the backend is not reachable' }));
    render(<DatabaseLoadModal isOpen onClose={jest.fn()} onLoad={jest.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Network error - the backend is not reachable');
  });
});
