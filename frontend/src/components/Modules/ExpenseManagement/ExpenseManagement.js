import React, { useState, useEffect, useMemo } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import ExpenseList from './ExpenseList';
import ExpenseReports from './ExpenseReports';
import ExpenseForecast from './ExpenseForecast';
import CategoryManagement from './CategoryManagement';
import { ExpenseModal, CategoryModal } from './ExpenseModals';
import './ExpenseManagement.css';

const ExpenseManagement = () => {
  const { data, actions } = useForecast();
  const [activeTab, setActiveTab] = useState('expenses');
  const [selectedExpense, setSelectedExpense] = useState(null);
  const [showExpenseModal, setShowExpenseModal] = useState(false);
  const [showCategoryModal, setShowCategoryModal] = useState(false);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [allocations, setAllocations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    category_id: '',
    frequency: '',
    is_active: true,
    department: '',
    vendor: ''
  });

  // Fetch expenses and categories on component mount
  useEffect(() => {
    fetchExpenses();
    fetchCategories();
  }, []);

  // Re-fetch expenses when filters change
  useEffect(() => {
    fetchExpenses();
  }, [filters]);

  const fetchExpenses = async () => {
    setLoading(true);
    try {
      const queryParams = new URLSearchParams();
      Object.entries(filters).forEach(([key, value]) => {
        if (value !== '' && value !== null && value !== undefined) {
          queryParams.append(key, value);
        }
      });

      const response = await fetch(`http://localhost:8000/expenses?${queryParams}`);
      const result = await response.json();
      
      if (result.status === 'success') {
        setExpenses(result.data);
      } else {
        toast.error('Failed to fetch expenses');
      }
    } catch (error) {
      console.error('Error fetching expenses:', error);
      toast.error('Error fetching expenses');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const response = await fetch('http://localhost:8000/expenses/categories');
      const result = await response.json();
      
      if (result.status === 'success') {
        setCategories(result.data);
      } else {
        toast.error('Failed to fetch categories');
      }
    } catch (error) {
      console.error('Error fetching categories:', error);
      toast.error('Error fetching categories');
    }
  };

  const fetchAllocations = async (expenseId = null, period = null) => {
    try {
      const queryParams = new URLSearchParams();
      if (expenseId) queryParams.append('expense_id', expenseId);
      if (period) queryParams.append('period', period);

      const response = await fetch(`http://localhost:8000/expenses/allocations?${queryParams}`);
      const result = await response.json();
      
      if (result.status === 'success') {
        setAllocations(result.data);
      } else {
        toast.error('Failed to fetch allocations');
      }
    } catch (error) {
      console.error('Error fetching allocations:', error);
      toast.error('Error fetching allocations');
    }
  };

  const handleCreateExpense = async (expenseData) => {
    try {
      const response = await fetch('http://localhost:8000/expenses/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(expenseData),
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        toast.success('Expense created successfully');
        fetchExpenses();
        setShowExpenseModal(false);
      } else {
        toast.error('Failed to create expense');
      }
    } catch (error) {
      console.error('Error creating expense:', error);
      toast.error('Error creating expense');
    }
  };

  const handleUpdateExpense = async (expenseId, expenseData) => {
    try {
      const response = await fetch(`http://localhost:8000/expenses/${expenseId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(expenseData),
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        toast.success('Expense updated successfully');
        fetchExpenses();
        setShowExpenseModal(false);
        setSelectedExpense(null);
      } else {
        toast.error('Failed to update expense');
      }
    } catch (error) {
      console.error('Error updating expense:', error);
      toast.error('Error updating expense');
    }
  };

  const handleDeleteExpense = async (expenseId) => {
    if (!window.confirm('Are you sure you want to delete this expense?')) {
      return;
    }

    try {
      const response = await fetch(`http://localhost:8000/expenses/${expenseId}`, {
        method: 'DELETE',
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        toast.success('Expense deleted successfully');
        fetchExpenses();
      } else {
        toast.error('Failed to delete expense');
      }
    } catch (error) {
      console.error('Error deleting expense:', error);
      toast.error('Error deleting expense');
    }
  };

  const handleCreateCategory = async (categoryData) => {
    try {
      const response = await fetch('http://localhost:8000/expenses/categories', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(categoryData),
      });

      const result = await response.json();
      
      if (result.status === 'success') {
        toast.success('Category created successfully');
        fetchCategories();
        setShowCategoryModal(false);
      } else {
        toast.error('Failed to create category');
      }
    } catch (error) {
      console.error('Error creating category:', error);
      toast.error('Error creating category');
    }
  };

  // Calculate summary statistics
  const summaryStats = useMemo(() => {
    const totalExpenses = expenses.length;
    const activeExpenses = expenses.filter(exp => exp.is_active).length;
    const totalAnnualCost = expenses
      .filter(exp => exp.is_active)
      .reduce((sum, exp) => sum + (exp.total_annual_cost || 0), 0);
    
    const categoryBreakdown = categories.reduce((acc, cat) => {
      const categoryExpenses = expenses.filter(exp => 
        exp.category_id === cat.category_id && exp.is_active
      );
      acc[cat.category_type] = (acc[cat.category_type] || 0) + 
        categoryExpenses.reduce((sum, exp) => sum + (exp.total_annual_cost || 0), 0);
      return acc;
    }, {});

    const upcomingPayments = expenses
      .filter(exp => exp.next_payment_date && exp.is_active)
      .sort((a, b) => new Date(a.next_payment_date) - new Date(b.next_payment_date))
      .slice(0, 5);

    return {
      totalExpenses,
      activeExpenses,
      totalAnnualCost,
      categoryBreakdown,
      upcomingPayments
    };
  }, [expenses, categories]);

  // Get unique values for filters
  const filterOptions = useMemo(() => {
    const departments = [...new Set(expenses.map(exp => exp.department).filter(Boolean))];
    const vendors = [...new Set(expenses.map(exp => exp.vendor).filter(Boolean))];
    const frequencies = [...new Set(expenses.map(exp => exp.frequency))];
    
    return { departments, vendors, frequencies };
  }, [expenses]);

  const tabs = [
    { id: 'expenses', label: 'Expense List', icon: '💳' },
    { id: 'categories', label: 'Categories', icon: '📂' },
    { id: 'forecast', label: 'Forecast', icon: '📈' },
    { id: 'reports', label: 'Reports', icon: '📊' }
  ];

  return (
    <div className="expense-management">
      <div className="expense-header">
        <div className="expense-title">
          <h2>💳 Expense Management</h2>
          <p>Manage recurring and one-time expenses with automated allocation and cash flow forecasting</p>
        </div>
        
        <div className="expense-actions">
          <button 
            className="btn btn-primary"
            onClick={() => {
              setSelectedExpense(null);
              setShowExpenseModal(true);
            }}
          >
            + Add Expense
          </button>
          <button 
            className="btn btn-secondary"
            onClick={() => setShowCategoryModal(true)}
          >
            + Add Category
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="expense-summary-cards">
        <div className="summary-card">
          <div className="summary-value">{summaryStats.totalExpenses}</div>
          <div className="summary-label">Total Expenses</div>
          <div className="summary-sublabel">
            {summaryStats.activeExpenses} active
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-value">
            ${summaryStats.totalAnnualCost.toLocaleString()}
          </div>
          <div className="summary-label">Annual Cost</div>
          <div className="summary-sublabel">
            ${(summaryStats.totalAnnualCost / 12).toLocaleString()}/month avg
          </div>
        </div>
        
        <div className="summary-card">
          <div className="summary-value">
            ${summaryStats.categoryBreakdown.factory_overhead?.toLocaleString() || '0'}
          </div>
          <div className="summary-label">Factory Overhead</div>
          <div className="summary-sublabel">Manufacturing costs</div>
        </div>
        
        <div className="summary-card">
          <div className="summary-value">
            ${summaryStats.categoryBreakdown.admin_expense?.toLocaleString() || '0'}
          </div>
          <div className="summary-label">Admin Expenses</div>
          <div className="summary-sublabel">Operating costs</div>
        </div>
      </div>

      {/* Filters */}
      <div className="expense-filters">
        <div className="filter-group">
          <label>Category:</label>
          <select 
            value={filters.category_id} 
            onChange={(e) => setFilters({...filters, category_id: e.target.value})}
          >
            <option value="">All Categories</option>
            {categories.map(cat => (
              <option key={cat.category_id} value={cat.category_id}>
                {cat.category_name} ({cat.category_type})
              </option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <label>Frequency:</label>
          <select 
            value={filters.frequency} 
            onChange={(e) => setFilters({...filters, frequency: e.target.value})}
          >
            <option value="">All Frequencies</option>
            {filterOptions.frequencies.map(freq => (
              <option key={freq} value={freq}>{freq}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <label>Department:</label>
          <select 
            value={filters.department} 
            onChange={(e) => setFilters({...filters, department: e.target.value})}
          >
            <option value="">All Departments</option>
            {filterOptions.departments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>
        </div>
        
        <div className="filter-group">
          <label>Status:</label>
          <select 
            value={filters.is_active} 
            onChange={(e) => setFilters({...filters, is_active: e.target.value === 'true'})}
          >
            <option value={true}>Active Only</option>
            <option value={false}>Inactive Only</option>
            <option value="">All</option>
          </select>
        </div>
        
        <button 
          className="btn btn-outline"
          onClick={() => setFilters({
            category_id: '',
            frequency: '',
            is_active: true,
            department: '',
            vendor: ''
          })}
        >
          Clear Filters
        </button>
      </div>

      {/* Tab Navigation */}
      <div className="expense-tabs">
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span className="tab-icon">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="expense-content">
        {loading && (
          <div className="loading-spinner">
            <div className="spinner"></div>
            <p>Loading expenses...</p>
          </div>
        )}

        {!loading && (
          <>
            {activeTab === 'expenses' && (
              <ExpenseList
                expenses={expenses}
                categories={categories}
                onEdit={(expense) => {
                  setSelectedExpense(expense);
                  setShowExpenseModal(true);
                }}
                onDelete={handleDeleteExpense}
                onViewAllocations={(expenseId) => {
                  fetchAllocations(expenseId);
                  setActiveTab('forecast');
                }}
              />
            )}

            {activeTab === 'categories' && (
              <CategoryManagement
                categories={categories}
                expenses={expenses}
                onRefresh={fetchCategories}
              />
            )}

            {activeTab === 'forecast' && (
              <ExpenseForecast
                expenses={expenses}
                categories={categories}
                allocations={allocations}
                onFetchAllocations={fetchAllocations}
              />
            )}

            {activeTab === 'reports' && (
              <ExpenseReports
                expenses={expenses}
                categories={categories}
                summaryStats={summaryStats}
              />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {showExpenseModal && (
        <ExpenseModal
          expense={selectedExpense}
          categories={categories}
          onSave={selectedExpense ? 
            (data) => handleUpdateExpense(selectedExpense.expense_id, data) : 
            handleCreateExpense
          }
          onClose={() => {
            setShowExpenseModal(false);
            setSelectedExpense(null);
          }}
        />
      )}

      {showCategoryModal && (
        <CategoryModal
          categories={categories}
          onSave={handleCreateCategory}
          onClose={() => setShowCategoryModal(false)}
        />
      )}
    </div>
  );
};

export default ExpenseManagement;