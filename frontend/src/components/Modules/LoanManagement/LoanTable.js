import React from 'react';

const LoanTable = ({ loans, onEdit, onDelete, onViewSchedule }) => {
    const formatCurrency = (amount) => {
        if (!amount) return '$0.00';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    };

    const formatPercent = (rate) => {
        if (!rate) return '0%';
        return `${rate.toFixed(2)}%`;
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const getLoanTypeColor = (loanType) => {
        const colors = {
            'term_loan': '#3498db',
            'line_of_credit': '#9b59b6',
            'sba_loan': '#27ae60',
            'equipment_loan': '#f39c12',
            'real_estate_loan': '#e74c3c'
        };
        return colors[loanType] || '#95a5a6';
    };

    if (!loans || loans.length === 0) {
        return (
            <div className="loan-table-container">
                <div className="no-data">
                    No loans found. Click "Add New Loan" to create your first loan.
                </div>
            </div>
        );
    }

    return (
        <div className="loan-table-container">
            <div className="loan-table-header">
                <h3 className="loan-table-title">Loan Portfolio ({loans.length} loans)</h3>
            </div>
            
            <div style={{ overflowX: 'auto' }}>
                <table className="loan-table">
                    <thead>
                        <tr>
                            <th>Loan Details</th>
                            <th>Lender</th>
                            <th>Type & Payment</th>
                            <th>Principal</th>
                            <th>Current Balance</th>
                            <th>Interest Rate</th>
                            <th>Monthly Payment</th>
                            <th>Term</th>
                            <th>Next Payment</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loans.map((loan) => (
                            <tr key={loan.loan_id}>
                                <td>
                                    <div>
                                        <div style={{ fontWeight: '600', marginBottom: '4px' }}>
                                            {loan.loan_name}
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                            ID: {loan.loan_id}
                                        </div>
                                        {loan.account_number && (
                                            <div style={{ fontSize: '12px', color: '#666' }}>
                                                Acct: {loan.account_number}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div>
                                        <div style={{ fontWeight: '600' }}>{loan.lender}</div>
                                        {loan.loan_officer && (
                                            <div style={{ fontSize: '12px', color: '#666' }}>
                                                {loan.loan_officer}
                                            </div>
                                        )}
                                    </div>
                                </td>
                                <td>
                                    <div>
                                        <div 
                                            className="loan-type-badge"
                                            style={{ 
                                                backgroundColor: getLoanTypeColor(loan.loan_type) + '20',
                                                color: getLoanTypeColor(loan.loan_type),
                                                marginBottom: '6px'
                                            }}
                                        >
                                            {loan.loan_type.replace('_', ' ')}
                                        </div>
                                        <div 
                                            className={`loan-payment-type ${loan.payment_type.replace('_', '-')}`}
                                        >
                                            {loan.payment_type.replace('_', ' ')}
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600' }}>
                                        {formatCurrency(loan.principal_amount)}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        Started: {formatDate(loan.start_date)}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600', color: '#e74c3c' }}>
                                        {formatCurrency(loan.current_balance)}
                                    </div>
                                    {loan.principal_amount > 0 && (
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                            {((loan.current_balance / loan.principal_amount) * 100).toFixed(1)}% remaining
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600', color: '#f39c12' }}>
                                        {formatPercent(loan.interest_rate)}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        {loan.payment_frequency}
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600' }}>
                                        {formatCurrency(loan.monthly_payment_amount)}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        Annual: {formatCurrency(loan.monthly_payment_amount * 12)}
                                    </div>
                                </td>
                                <td>
                                    <div>
                                        <div style={{ fontWeight: '600' }}>
                                            {loan.loan_term_months} months
                                        </div>
                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                            {loan.payments_made || 0} of {loan.payments_made + loan.payments_remaining || 0} paid
                                        </div>
                                    </div>
                                </td>
                                <td>
                                    <div style={{ fontWeight: '600' }}>
                                        {formatDate(loan.next_payment_date)}
                                    </div>
                                    {loan.balloon_date && (
                                        <div style={{ fontSize: '12px', color: '#e74c3c' }}>
                                            Balloon: {formatDate(loan.balloon_date)}
                                        </div>
                                    )}
                                </td>
                                <td>
                                    <span className={`loan-status ${loan.is_active ? 'active' : 'inactive'}`}>
                                        {loan.is_active ? 'Active' : 'Inactive'}
                                    </span>
                                </td>
                                <td>
                                    <div className="loan-actions">
                                        <button
                                            className="loan-action-btn schedule"
                                            onClick={() => onViewSchedule(loan.loan_id)}
                                            title="View Amortization Schedule"
                                        >
                                            Schedule
                                        </button>
                                        <button
                                            className="loan-action-btn edit"
                                            onClick={() => onEdit(loan)}
                                            title="Edit Loan"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            className="loan-action-btn delete"
                                            onClick={() => onDelete(loan.loan_id)}
                                            title="Delete Loan"
                                        >
                                            Delete
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default LoanTable;