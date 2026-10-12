import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import ScenarioFormModal from './ScenarioFormModal';
import BranchScenarioModal from './BranchScenarioModal';

// What the api client rejects with for a 409: the axios error with the backend detail attached.
const conflict = (detail) => Object.assign(new Error('Request failed with status code 409'), {
  response: { status: 409, data: { detail } },
  userMessage: detail,
});

const taken = "A scenario named '2027 Budget' already exists (F001). Choose another name, or open F001 instead.";

describe('ScenarioFormModal', () => {
  it('shows a duplicate name (409) under the name field and keeps the form open', async () => {
    const onSubmit = jest.fn().mockRejectedValue(conflict(taken));
    const onClose = jest.fn();
    render(<ScenarioFormModal open onClose={onClose} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '2027 Budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const message = await screen.findByText(taken);
    expect(message).toHaveAttribute('id', 'scenario-name-error');
    expect(screen.getByLabelText('Name *')).toHaveAttribute('aria-invalid', 'true');
    expect(onClose).not.toHaveBeenCalled();
    // Typing a new name clears it.
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: '2027 Budget v2' } });
    expect(screen.queryByText(taken)).not.toBeInTheDocument();
  });

  it('shows the same on rename', async () => {
    const detail = "A scenario named 'Upside' already exists (F002). Choose another name, or open F002 instead.";
    const onSubmit = jest.fn().mockRejectedValue(conflict(detail));
    render(<ScenarioFormModal open scenario={{ id: 'F001', name: '2027 Budget', is_base: 1 }} onClose={jest.fn()} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'Upside' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(detail)).toHaveAttribute('id', 'scenario-name-error');
  });

  it('shows other errors below the form with the server explanation', async () => {
    const error = Object.assign(new Error('Request failed with status code 500'), {
      response: { status: 500, data: { detail: 'Error creating forecast scenario: disk full' } },
    });
    render(<ScenarioFormModal open onClose={jest.fn()} onSubmit={jest.fn().mockRejectedValue(error)} />);
    fireEvent.change(screen.getByLabelText('Name *'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    const message = await screen.findByText('Error creating forecast scenario: disk full');
    expect(message).not.toHaveAttribute('id', 'scenario-name-error');
  });
});

describe('BranchScenarioModal', () => {
  it('shows a duplicate name (409) under the new name field, not the axios message', async () => {
    const onSubmit = jest.fn().mockRejectedValue(conflict(taken));
    const onClose = jest.fn();
    render(
      <BranchScenarioModal
        open
        onClose={onClose}
        scenarios={{ F001: { id: 'F001', name: '2027 Budget' } }}
        activeScenarioId="F001"
        onSubmit={onSubmit}
      />,
    );
    fireEvent.change(screen.getByLabelText('New scenario name *'), { target: { value: '2027 Budget' } });
    fireEvent.click(screen.getByRole('button', { name: 'Branch Scenario' }));
    const message = await screen.findByText(taken);
    expect(message).toHaveAttribute('id', 'branch-name-error');
    expect(screen.queryByText(/status code 409/)).not.toBeInTheDocument();
    await waitFor(() => expect(onClose).not.toHaveBeenCalled());
  });
});
