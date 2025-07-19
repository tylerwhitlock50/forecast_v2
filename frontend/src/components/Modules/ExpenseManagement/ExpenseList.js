import React, { useState } from 'react';

const ExpenseList = ({ expenses, categories, onEdit, onDelete, onViewAllocations }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'expense_name', direction: 'asc' });
  const [searchTerm, setSearchTerm] = useState('');

  // Format currency
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return '-';
    return new Date(dateString).toLocaleDateString();
  };

  // Get frequency display
  const getFrequencyDisplay = (frequency) => {
    const frequencyMap = {
      'weekly': '📅 Weekly',
      'monthly': '🗓️ Monthly',
      'quarterly': '📊 Quarterly',
      'biannually': '📈 Biannually',
      'annually': '📅 Annually',
      'one_time': '⚡ One-time'
    };
    return frequencyMap[frequency] || frequency;
  };

  // Get category type badge
  const getCategoryTypeBadge = (categoryType) => {
    const typeConfig = {
      'factory_overhead': { icon: '🏭', label: 'Factory', class: 'badge-factory' },
      'admin_expense': { icon: '🏢', label: 'Admin', class: 'badge-admin' },
      'cogs': { icon: '⚙️', label: 'COGS', class: 'badge-cogs' }
    };
    const config = typeConfig[categoryType] || { icon: '📋', label: 'Other', class: 'badge-other' };
    return (
      <span className={`expense-badge ${config.class}`}>
        {config.icon} {config.label}
      </span>
    );
  };

  // Get allocation method badge
  const getAllocationBadge = (allocation, amortizationMonths) => {
    if (allocation === 'amortized') {
      return (
        <span className="expense-badge badge-amortized">
          📊 Amortized ({amortizationMonths}m)
        </span>
      );
    }
    return (
      <span className="expense-badge badge-immediate">
        ⚡ Immediate
      </span>
    );
  };

  // Sort expenses
  const sortedExpenses = React.useMemo(() => {
    let sortableExpenses = [...expenses];
    
    // Apply search filter
    if (searchTerm) {
      sortableExpenses = sortableExpenses.filter(expense =>
        expense.expense_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expense.vendor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expense.description?.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }
    
    // Apply sorting
    if (sortConfig.key) {
      sortableExpenses.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];
        
        // Handle nested properties
        if (sortConfig.key === 'category_name') {
          aValue = a.category_name;
          bValue = b.category_name;
        }
        
        // Handle numeric values
        if (typeof aValue === 'number' && typeof bValue === 'number') {
          return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
        }
        
        // Handle string values
        if (aValue < bValue) {
          return sortConfig.direction === 'asc' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'asc' ? 1 : -1;
        }
        return 0;
      });
    }
    
    return sortableExpenses;
  }, [expenses, sortConfig, searchTerm]);

  // Handle sort
  const handleSort = (key) => {
    let direction = 'asc';
    if (sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  // Get sort icon
  const getSortIcon = (columnName) => {
    if (sortConfig.key === columnName) {
      return sortConfig.direction === 'asc' ? '↑' : '↓';
    }
    return '↕';
  };

  return (
    <div className="expense-list">
      <div className="expense-list-header">
        <div className="search-box">
          <input
            type="text"
            placeholder="Search expenses, vendors, or descriptions..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <span className="search-icon">🔍</span>
        </div>
        <div className="list-stats">
          Showing {sortedExpenses.length} of {expenses.length} expenses
        </div>
      </div>

      <div className="expense-table-container">
        <table className="expense-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('expense_name')} className="sortable">
                Expense Name {getSortIcon('expense_name')}
              </th>
              <th onClick={() => handleSort('category_name')} className="sortable">
                Category {getSortIcon('category_name')}
              </th>
              <th onClick={() => handleSort('amount')} className="sortable">
                Amount {getSortIcon('amount')}
              </th>
              <th onClick={() => handleSort('frequency')} className="sortable">
                Frequency {getSortIcon('frequency')}
              </th>
              <th onClick={() => handleSort('total_annual_cost')} className="sortable">
                Annual Cost {getSortIcon('total_annual_cost')}
              </th>
              <th>Allocation</th>
              <th>Next Payment</th>
              <th onClick={() => handleSort('vendor')} className="sortable">
                Vendor {getSortIcon('vendor')}
              </th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedExpenses.map((expense) => (
              <tr key={expense.expense_id} className={!expense.is_active ? 'inactive' : ''}>
                <td className="expense-name-cell">
                  <div className="expense-name">{expense.expense_name}</div>
                  {expense.description && (
                    <div className="expense-description">{expense.description}</div>
                  )}
                  {expense.department && (
                    <div className="expense-department">
                      📍 {expense.department}
                    </div>
                  )}
                </td>
                
                <td>
                  <div className="category-info">
                    <div className="category-name">{expense.category_name}</div>
                    {getCategoryTypeBadge(expense.category_type)}
                  </div>
                </td>
                
                <td className="amount-cell">
                  <div className="amount-primary">
                    {formatCurrency(expense.amount)}
                  </div>
                  {expense.frequency !== 'one_time' && (
                    <div className="amount-frequency">
                      per {expense.frequency.replace('_', ' ')}
                    </div>
                  )}
                </td>
                
                <td>
                  {getFrequencyDisplay(expense.frequency)}
                </td>
                
                <td className="annual-cost-cell">
                  <div className="annual-cost">
                    {formatCurrency(expense.total_annual_cost)}
                  </div>
                  {expense.total_annual_cost > 0 && (
                    <div className="monthly-avg">
                      {formatCurrency(expense.total_annual_cost / 12)}/mo
                    </div>
                  )}
                </td>
                
                <td>
                  {getAllocationBadge(expense.expense_allocation, expense.amortization_months)}
                </td>
                
                <td className="payment-cell">
                  {expense.next_payment_date ? (
                    <div>
                      <div className="payment-date">
                        {formatDate(expense.next_payment_date)}
                      </div>
                      <div className="payment-amount">
                        {formatCurrency(expense.next_payment_amount)}
                      </div>
                    </div>
                  ) : (
                    <span className="no-payment">No upcoming payment</span>
                  )}
                </td>
                
                <td className="vendor-cell">
                  {expense.vendor || '-'}
                  {expense.payment_method && (
                    <div className="payment-method">
                      💳 {expense.payment_method}
                    </div>
                  )}
                </td>
                
                <td>
                  <div className="status-indicators">
                    <span className={`status-badge ${expense.is_active ? 'active' : 'inactive'}`}>
                      {expense.is_active ? '✅ Active' : '❌ Inactive'}
                    </span>
                    {expense.approval_required && (
                      <span className={`approval-badge ${expense.approved_by ? 'approved' : 'pending'}`}>
                        {expense.approved_by ? '✅ Approved' : '⏳ Pending'}
                      </span>
                    )}
                  </div>
                </td>
                
                <td className="actions-cell">
                  <div className="action-buttons">
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => onEdit(expense)}
                      title="Edit expense"
                    >
                      ✏️
                    </button>
                    <button
                      className="btn btn-sm btn-outline"
                      onClick={() => onViewAllocations(expense.expense_id)}
                      title="View allocations"
                    >
                      📊
                    </button>
                    <button
                      className="btn btn-sm btn-danger"
                      onClick={() => onDelete(expense.expense_id)}
                      title="Delete expense"
                    >
                      🗑️
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        
        {sortedExpenses.length === 0 && (
          <div className="empty-state">
            <div className="empty-icon">📋</div>
            <h3>No expenses found</h3>
            <p>
              {searchTerm 
                ? `No expenses match "${searchTerm}". Try adjusting your search.`
                : 'Get started by adding your first expense.'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ExpenseList;