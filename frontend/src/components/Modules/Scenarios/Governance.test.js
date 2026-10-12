import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ApproveScenarioModal from './ApproveScenarioModal';
import UnlockScenarioModal from './UnlockScenarioModal';
import ApprovalHistoryModal from './ApprovalHistoryModal';
import { approvalLine, driftSummary, formatWhen, isLocked, parseUtc, signedMoney, statusOf } from './governance';

const draft = { id: 'F001', name: '2027 Budget', start_period: '2027-01', end_period: '2027-12', locked: false, status: 'draft' };
const locked = {
  ...draft, locked: true, status: 'approved', approved_by: 'Dana CFO', approved_at: '2026-10-12T15:21:51Z',
  drift: { changed: true, items: [
    { line: 'gross_profit', label: 'Gross profit', approved: 100000, current: 97000, delta: -3000 },
    { line: 'net_income', label: 'Net income', approved: 50000, current: 47630, delta: -2370 },
  ] },
};

const refused = (detail, status = 409) => Object.assign(new Error(`Request failed with status code ${status}`), {
  response: { status, data: { detail } },
  userMessage: detail,
});

beforeEach(() => {
  try { window.localStorage.clear(); } catch (err) { /* no storage */ }
});

describe('governance helpers', () => {
  it('reads status, approval and drift in plain words', () => {
    expect(isLocked(locked)).toBe(true);
    expect(statusOf(locked).label).toBe('Approved & locked');
    expect(statusOf(draft).label).toBe('Draft');
    expect(approvalLine(locked)).toMatch(/^Approved by Dana CFO on Oct 1[23], 2026$/);
    expect(driftSummary(locked)).toBe('Gross profit −$3,000, Net income −$2,370 since approval');
    expect(driftSummary(draft)).toBe('');
    expect(signedMoney(1234.4)).toBe('+$1,234');
  });

  it('parses API times as UTC, with or without the Z', () => {
    expect(parseUtc('2026-10-12T15:21:51Z').toISOString()).toBe('2026-10-12T15:21:51.000Z');
    expect(parseUtc('2026-10-12 15:21:51').toISOString()).toBe('2026-10-12T15:21:51.000Z');
    expect(parseUtc('')).toBeNull();
    expect(formatWhen('not a date')).toBe('not a date');
  });
});

describe('ApproveScenarioModal', () => {
  it('explains the snapshot, workbook and lock, and needs an approver', async () => {
    const onSubmit = jest.fn().mockResolvedValue({});
    const onClose = jest.fn();
    render(<ApproveScenarioModal open scenario={draft} onClose={onClose} onSubmit={onSubmit} />);
    expect(screen.getByText(/a snapshot of the whole database and the Excel workbook/)).toBeInTheDocument();
    expect(screen.getByText(/Locks this scenario/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Approve & lock' }));
    expect(await screen.findByText('Enter who is approving this scenario')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Approved by *'), { target: { value: ' Dana CFO ' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Board approved' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve & lock' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ approved_by: 'Dana CFO', note: 'Board approved' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('keeps the dialog open and shows the server explanation when refused', async () => {
    const detail = "Scenario '2027 Budget' has no monthly sales yet, so there is nothing to approve.";
    const onClose = jest.fn();
    render(<ApproveScenarioModal open scenario={draft} onClose={onClose} onSubmit={jest.fn().mockRejectedValue(refused(detail, 422))} />);
    fireEvent.change(screen.getByLabelText('Approved by *'), { target: { value: 'Dana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Approve & lock' }));
    expect(await screen.findByText(detail)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('UnlockScenarioModal', () => {
  it('requires a reason and offers branching instead', async () => {
    const onSubmit = jest.fn().mockResolvedValue({});
    const onBranchInstead = jest.fn();
    const onClose = jest.fn();
    render(<UnlockScenarioModal open scenario={locked} onClose={onClose} onSubmit={onSubmit} onBranchInstead={onBranchInstead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Unlock scenario' }));
    expect(await screen.findByText('A reason is required to unlock an approved scenario')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Q2 reforecast' } });
    fireEvent.change(screen.getByLabelText('Your name'), { target: { value: 'Dana' } });
    fireEvent.click(screen.getByRole('button', { name: 'Unlock scenario' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ reason: 'Q2 reforecast', actor: 'Dana' }));
  });

  it('branch instead closes the dialog and opens the branch form', () => {
    const onBranchInstead = jest.fn();
    const onClose = jest.fn();
    render(<UnlockScenarioModal open scenario={locked} onClose={onClose} onSubmit={jest.fn()} onBranchInstead={onBranchInstead} />);
    fireEvent.click(screen.getByRole('button', { name: 'Branch “2027 Budget”' }));
    expect(onClose).toHaveBeenCalled();
    expect(onBranchInstead).toHaveBeenCalled();
  });
});

describe('ApprovalHistoryModal', () => {
  it('lists approvals with totals and a workbook link, and unlocks with the reason', async () => {
    const loadApprovals = jest.fn().mockResolvedValue([
      { approval_id: 'APR-2', forecast_id: 'F001', action: 'unlock', actor: 'Dana', note: 'Q2 reforecast', created_at: '2026-10-13T09:00:00Z' },
      { approval_id: 'APR-1', forecast_id: 'F001', action: 'approve', actor: 'Dana CFO', note: 'Board approved',
        created_at: '2026-10-12T15:21:51Z', start_period: '2027-01', end_period: '2027-12',
        totals: { gross_sales: 30000, net_sales: 29100, total_cogs: 12000, gross_profit: 17100 },
        workbook_filename: 'approved_F001.xlsx', workbook_available: true,
        snapshot_filename: 'approved_F001_20261012_152151.db', snapshot_available: true },
    ]);
    render(<ApprovalHistoryModal open scenario={locked} onClose={jest.fn()} loadApprovals={loadApprovals} />);
    expect(await screen.findByText('Unlocked by Dana')).toBeInTheDocument();
    expect(loadApprovals).toHaveBeenCalledWith('F001');
    expect(screen.getByText('Reason: Q2 reforecast')).toBeInTheDocument();
    expect(screen.getByText('Approved by Dana CFO')).toBeInTheDocument();
    expect(screen.getByText('$17,100')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Download approved workbook' }))
      .toHaveAttribute('href', '/api/forecast/scenario/F001/approvals/APR-1/workbook');
    expect(screen.getByText(/approved_F001_20261012_152151\.db/)).toBeInTheDocument();
  });
});
