import React from 'react';

const CategoryManagement = ({ categories, expenses, onRefresh }) => {
  // Group categories by type
  const categoriesByType = categories.reduce((acc, category) => {
    if (!acc[category.category_type]) {
      acc[category.category_type] = [];
    }
    acc[category.category_type].push(category);
    return acc;
  }, {});

  // Get expense count for each category
  const getExpenseCount = (categoryId) => {
    return expenses.filter(exp => exp.category_id === categoryId).length;
  };

  // Get total amount for each category
  const getTotalAmount = (categoryId) => {
    return expenses
      .filter(exp => exp.category_id === categoryId && exp.is_active)
      .reduce((sum, exp) => sum + (exp.total_annual_cost || 0), 0);
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(amount || 0);
  };

  const typeDisplayNames = {
    'factory_overhead': '🏭 Factory Overhead',
    'admin_expense': '🏢 Administrative Expenses',
    'cogs': '⚙️ Cost of Goods Sold'
  };

  return (
    <div className="category-management">
      <div className="category-header">
        <h3>Expense Categories</h3>
        <button className="btn btn-outline" onClick={onRefresh}>
          🔄 Refresh
        </button>
      </div>

      {Object.entries(categoriesByType).map(([type, typeCategories]) => (
        <div key={type} className="category-type-section">
          <h4 className="category-type-header">
            {typeDisplayNames[type] || type}
            <span className="category-count">
              ({typeCategories.length} categories)
            </span>
          </h4>
          
          <div className="category-grid">
            {typeCategories.map(category => (
              <div key={category.category_id} className="category-card">
                <div className="category-card-header">
                  <h5>{category.category_name}</h5>
                  {category.account_code && (
                    <span className="account-code">{category.account_code}</span>
                  )}
                </div>
                
                {category.description && (
                  <p className="category-description">{category.description}</p>
                )}
                
                <div className="category-stats">
                  <div className="stat">
                    <span className="stat-label">Expenses:</span>
                    <span className="stat-value">{getExpenseCount(category.category_id)}</span>
                  </div>
                  <div className="stat">
                    <span className="stat-label">Annual Total:</span>
                    <span className="stat-value">{formatCurrency(getTotalAmount(category.category_id))}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      {categories.length === 0 && (
        <div className="empty-state">
          <div className="empty-icon">📂</div>
          <h3>No categories found</h3>
          <p>Categories will be loaded from the database automatically.</p>
        </div>
      )}
    </div>
  );
};

export default CategoryManagement;