import React, { useMemo } from 'react';
import ForecastGrid from '../../Common/ForecastGrid';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';

const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'biannually', 'annually', 'one_time'];
const money2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Inline editor for expenses. Each cell saves on commit with a PUT for that
 * one field, addressed by expense_id (never by row position).
 */
const ExpenseGrid = ({ expenses = [], onRefresh }) => {
  const { state: { activeScenario } } = useForecast();

  const rows = useMemo(
    () => expenses.map(e => ({
      ...e,
      id: e.expense_id,
      scope: e.forecast_id ? (e.forecast_id === activeScenario ? 'This scenario' : e.forecast_id) : 'Company-wide',
    })),
    [expenses, activeScenario]
  );

  const columns = useMemo(() => [
    { key: 'expense_name', title: 'Expense', width: 220, sticky: true, editable: true, validate: (v) => (!String(v || '').trim() ? 'Name is required' : null) },
    { key: 'scope', title: 'Scope', width: 120 },
    { key: 'category_name', title: 'Category', width: 160 },
    { key: 'amount', title: 'Amount', width: 120, align: 'right', type: 'number', editable: true, format: (v) => (v ? money2.format(v) : ''), validate: (v) => (v <= 0 ? 'Must be greater than 0' : null) },
    { key: 'frequency', title: 'Frequency', width: 120, editable: true, validate: (v) => (FREQUENCIES.includes(String(v)) ? null : `One of: ${FREQUENCIES.join(', ')}`) },
    { key: 'vendor', title: 'Vendor', width: 160, editable: true },
    { key: 'start_date', title: 'Start date', width: 120, editable: true, validate: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? null : 'Use YYYY-MM-DD') },
    { key: 'end_date', title: 'End date', width: 120, editable: true, validate: (v) => (!v || /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? null : 'Use YYYY-MM-DD') },
  ], []);

  const handleCommit = async (rowId, key, value) => {
    try {
      await api.put(`/expenses/${rowId}`, { [key]: value === '' ? null : value }, { suppressErrorToast: true, suppressSuccessToast: true });
      toast.success('Expense updated');
      if (onRefresh) await onRefresh();
    } catch (error) {
      console.error('Failed to update expense', error);
      toast.error(error?.userMessage || 'Failed to update expense');
      throw error;
    }
  };

  return (
    <ForecastGrid
      columns={columns}
      rows={rows}
      onCommit={handleCommit}
      maxHeight="60vh"
      emptyMessage="No expenses in this scenario"
    />
  );
};

export default ExpenseGrid;
