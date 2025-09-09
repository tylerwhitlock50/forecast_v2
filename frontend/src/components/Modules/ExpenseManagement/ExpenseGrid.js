import React, { useEffect, useState } from 'react';
import EditableGrid from '../../Common/EditableGrid';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';

const ExpenseGrid = ({ expenses = [], onRefresh }) => {
  const { state: { activeScenario } } = useForecast();
  const [gridData, setGridData] = useState([]);

  useEffect(() => {
    // Map incoming expenses to grid rows
    const rows = expenses.map(expense => ({
      ...expense
    }));
    setGridData(rows);
  }, [expenses]);

  const columns = [
    { key: 'expense_name', title: 'Expense', required: true, width: 200 },
    { key: 'category_name', title: 'Category', width: 160 },
    { key: 'amount', title: 'Amount', type: 'number', width: 120 },
    { key: 'frequency', title: 'Frequency', width: 120 },
    { key: 'vendor', title: 'Vendor', width: 160 },
    { key: 'start_date', title: 'Start Date', width: 140 }
  ];

  const handleDataChange = (newData) => {
    setGridData(newData);
  };

  const handleCellChange = async (rowIndex, colIndex, value, key) => {
    const row = gridData[rowIndex];
    if (!row) return;

    try {
      await api.put(`/expenses/${row.expense_id}`, { [key]: value, ...(activeScenario ? { forecast_id: activeScenario } : {}) }, { suppressErrorToast: true });
      toast.success('Expense updated');
      if (onRefresh) onRefresh();
    } catch (error) {
      console.error('Failed to update expense', error);
      toast.error('Failed to update expense');
    }
  };

  return (
    <EditableGrid
      data={gridData}
      columns={columns}
      onDataChange={handleDataChange}
      onCellChange={handleCellChange}
    />
  );
};

export default ExpenseGrid;
