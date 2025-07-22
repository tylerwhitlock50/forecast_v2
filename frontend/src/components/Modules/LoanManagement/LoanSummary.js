import React from 'react';

const LoanSummary = ({ summary, onRefresh }) => {
    const formatCurrency = (amount) => {
        if (!amount) return '$0';
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
            month: 'short',
            day: 'numeric'
        });
    };

    if (!summary) {
        return <div className="loading-spinner">Loading loan summary...</div>;
    }

    return (
        <div className="loan-summary">
            <div className="summary-cards">
                <div className="summary-card primary">
                    <h3>Total Loans</h3>
                    <p className="value">{summary.total_loans || 0}</p>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                        {summary.active_loans || 0} active
                    </div>
                </div>

                <div className="summary-card success">
                    <h3>Total Principal</h3>
                    <p className="value">{formatCurrency(summary.total_principal)}</p>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                        Original loan amounts
                    </div>
                </div>

                <div className="summary-card warning">
                    <h3>Current Balance</h3>
                    <p className="value">{formatCurrency(summary.total_current_balance)}</p>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                        {summary.total_principal > 0 ? 
                            `${((summary.total_current_balance / summary.total_principal) * 100).toFixed(1)}% remaining` : 
                            ''}
                    </div>
                </div>

                <div className="summary-card danger">
                    <h3>Monthly Payments</h3>
                    <p className="value">{formatCurrency(summary.total_monthly_payments)}</p>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                        {formatCurrency(summary.total_annual_payments)} annually
                    </div>
                </div>

                <div className="summary-card">
                    <h3>Avg Interest Rate</h3>
                    <p className="value">{formatPercent(summary.interest_rate_summary?.average)}</p>
                    <div style={{ fontSize: '12px', color: '#666', marginTop: '8px' }}>
                        Range: {formatPercent(summary.interest_rate_summary?.minimum)} - {formatPercent(summary.interest_rate_summary?.maximum)}
                    </div>
                </div>
            </div>

            <div className="summary-sections">
                <div className="upcoming-payments">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                        <h3>Upcoming Payments (Next 30 Days)</h3>
                        <button className="btn btn-sm btn-secondary" onClick={onRefresh}>
                            Refresh
                        </button>
                    </div>
                    
                    {summary.upcoming_payments && summary.upcoming_payments.length > 0 ? (
                        summary.upcoming_payments.map((payment, index) => (
                            <div key={index} className="payment-item">
                                <div className="payment-info">
                                    <h4>{payment.loan_name}</h4>
                                    <p>
                                        {payment.lender} • {formatDate(payment.payment_date)}
                                    </p>
                                </div>
                                <div className="payment-amount">
                                    {formatCurrency(payment.payment_amount)}
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="no-data" style={{ padding: '20px', textAlign: 'center' }}>
                            No payments due in the next 30 days
                        </div>
                    )}
                </div>

                <div className="loans-by-type">
                    <h3>Loans by Type</h3>
                    
                    {summary.loans_by_type && summary.loans_by_type.length > 0 ? (
                        summary.loans_by_type.map((type, index) => (
                            <div key={index} className="type-item">
                                <div className="type-info">
                                    <h4>{type.loan_type.replace('_', ' ')}</h4>
                                    <p>{type.count} loan{type.count !== 1 ? 's' : ''}</p>
                                </div>
                                <div className="type-balance">
                                    <span className="amount">{formatCurrency(type.total_balance)}</span>
                                    <div className="rate">{formatPercent(type.avg_interest_rate)} avg</div>
                                </div>
                            </div>
                        ))
                    ) : (
                        <div className="no-data" style={{ padding: '20px', textAlign: 'center' }}>
                            No loan type data available
                        </div>
                    )}
                </div>
            </div>

            {summary.total_current_balance > 0 && (
                <div style={{ 
                    marginTop: '30px', 
                    padding: '20px', 
                    backgroundColor: '#f8f9fa', 
                    borderRadius: '8px',
                    border: '1px solid #e0e0e0'
                }}>
                    <h3 style={{ margin: '0 0 15px 0', color: '#2c3e50', fontSize: '1.2rem' }}>
                        Portfolio Metrics
                    </h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                        <div>
                            <h4 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                                Debt-to-Asset Ratio
                            </h4>
                            <p style={{ margin: '0', fontSize: '1.4rem', fontWeight: '600', color: '#2c3e50' }}>
                                {summary.total_principal > 0 ? 
                                    `${((summary.total_current_balance / summary.total_principal) * 100).toFixed(1)}%` : 
                                    '0%'}
                            </p>
                        </div>
                        <div>
                            <h4 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                                Annual Debt Service
                            </h4>
                            <p style={{ margin: '0', fontSize: '1.4rem', fontWeight: '600', color: '#2c3e50' }}>
                                {formatCurrency(summary.total_annual_payments)}
                            </p>
                        </div>
                        <div>
                            <h4 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px', fontWeight: '600', textTransform: 'uppercase' }}>
                                Principal Paid Down
                            </h4>
                            <p style={{ margin: '0', fontSize: '1.4rem', fontWeight: '600', color: '#27ae60' }}>
                                {formatCurrency(summary.total_principal - summary.total_current_balance)}
                            </p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default LoanSummary;