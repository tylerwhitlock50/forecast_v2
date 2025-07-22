import React, { useState } from 'react';

const AmortizationScheduleModal = ({ schedule, onClose }) => {
    const [viewMode, setViewMode] = useState('all'); // 'all', 'upcoming', 'annual'

    const formatCurrency = (amount) => {
        if (!amount) return '$0.00';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    };

    const formatDate = (dateString) => {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const getFilteredPayments = () => {
        if (!schedule.payment_schedule) return [];
        
        const today = new Date();
        
        switch (viewMode) {
            case 'upcoming':
                return schedule.payment_schedule.filter(payment => 
                    new Date(payment.payment_date) >= today
                ).slice(0, 12); // Next 12 payments
                
            case 'annual':
                // Group by year and show annual totals
                const yearlyData = {};
                schedule.payment_schedule.forEach(payment => {
                    const year = new Date(payment.payment_date).getFullYear();
                    if (!yearlyData[year]) {
                        yearlyData[year] = {
                            year,
                            payments: 0,
                            total_payment: 0,
                            total_principal: 0,
                            total_interest: 0,
                            ending_balance: 0
                        };
                    }
                    yearlyData[year].payments++;
                    yearlyData[year].total_payment += payment.payment_amount;
                    yearlyData[year].total_principal += payment.principal_payment;
                    yearlyData[year].total_interest += payment.interest_payment;
                    yearlyData[year].ending_balance = payment.remaining_balance;
                });
                return Object.values(yearlyData);
                
            default:
                return schedule.payment_schedule;
        }
    };

    const filteredPayments = getFilteredPayments();

    if (!schedule) {
        return null;
    }

    return (
        <div className="loan-modal-overlay" onClick={onClose}>
            <div className="loan-modal schedule-modal" onClick={e => e.stopPropagation()}>
                <div className="loan-modal-header">
                    <h2>Amortization Schedule - {schedule.loan_name}</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                
                <div className="loan-modal-body">
                    {/* Loan Summary */}
                    <div className="schedule-summary">
                        <div className="schedule-summary-item">
                            <h4>Lender</h4>
                            <div className="value">{schedule.lender}</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Principal</h4>
                            <div className="value">{formatCurrency(schedule.loan_summary?.principal_amount)}</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Interest Rate</h4>
                            <div className="value">{schedule.loan_summary?.interest_rate}%</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Term</h4>
                            <div className="value">{schedule.loan_summary?.loan_term_months} months</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Total Payments</h4>
                            <div className="value">{formatCurrency(schedule.total_payments)}</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Total Interest</h4>
                            <div className="value">{formatCurrency(schedule.total_interest)}</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Payment Type</h4>
                            <div className="value">{schedule.loan_summary?.payment_type?.replace('_', ' ')}</div>
                        </div>
                        <div className="schedule-summary-item">
                            <h4>Avg Monthly Payment</h4>
                            <div className="value">{formatCurrency(schedule.loan_summary?.average_monthly_payment)}</div>
                        </div>
                    </div>

                    {/* View Mode Selector */}
                    <div style={{ 
                        display: 'flex', 
                        gap: '10px', 
                        marginBottom: '20px',
                        paddingBottom: '15px',
                        borderBottom: '1px solid #ddd'
                    }}>
                        <button 
                            className={`btn ${viewMode === 'all' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setViewMode('all')}
                        >
                            All Payments ({schedule.payment_schedule?.length})
                        </button>
                        <button 
                            className={`btn ${viewMode === 'upcoming' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setViewMode('upcoming')}
                        >
                            Next 12 Payments
                        </button>
                        <button 
                            className={`btn ${viewMode === 'annual' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setViewMode('annual')}
                        >
                            Annual Summary
                        </button>
                    </div>

                    {/* Payment Schedule Table */}
                    <div className="schedule-table-container">
                        <table className="schedule-table">
                            <thead>
                                <tr>
                                    {viewMode === 'annual' ? (
                                        <>
                                            <th>Year</th>
                                            <th>Payments</th>
                                            <th>Total Payment</th>
                                            <th>Principal</th>
                                            <th>Interest</th>
                                            <th>Ending Balance</th>
                                        </>
                                    ) : (
                                        <>
                                            <th>Payment #</th>
                                            <th>Date</th>
                                            <th>Payment Amount</th>
                                            <th>Principal</th>
                                            <th>Interest</th>
                                            <th>Remaining Balance</th>
                                            <th>Status</th>
                                        </>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPayments.length > 0 ? (
                                    filteredPayments.map((item, index) => (
                                        <tr key={viewMode === 'annual' ? item.year : item.payment_id || index}>
                                            {viewMode === 'annual' ? (
                                                <>
                                                    <td style={{ fontWeight: '600' }}>{item.year}</td>
                                                    <td>{item.payments}</td>
                                                    <td style={{ fontWeight: '600' }}>{formatCurrency(item.total_payment)}</td>
                                                    <td>{formatCurrency(item.total_principal)}</td>
                                                    <td>{formatCurrency(item.total_interest)}</td>
                                                    <td style={{ fontWeight: '600', color: '#e74c3c' }}>
                                                        {formatCurrency(item.ending_balance)}
                                                    </td>
                                                </>
                                            ) : (
                                                <>
                                                    <td style={{ fontWeight: '600' }}>{item.payment_number}</td>
                                                    <td>{formatDate(item.payment_date)}</td>
                                                    <td style={{ fontWeight: '600' }}>{formatCurrency(item.payment_amount)}</td>
                                                    <td>{formatCurrency(item.principal_payment)}</td>
                                                    <td>{formatCurrency(item.interest_payment)}</td>
                                                    <td style={{ fontWeight: '600', color: '#e74c3c' }}>
                                                        {formatCurrency(item.remaining_balance)}
                                                    </td>
                                                    <td>
                                                        <span className={`payment-status ${item.payment_status}`}>
                                                            {item.payment_status}
                                                        </span>
                                                    </td>
                                                </>
                                            )}
                                        </tr>
                                    ))
                                ) : (
                                    <tr>
                                        <td colSpan={viewMode === 'annual' ? 6 : 7} style={{ textAlign: 'center', padding: '20px' }}>
                                            No payment data available
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Payment Schedule Stats */}
                    {viewMode === 'all' && schedule.payment_schedule && schedule.payment_schedule.length > 0 && (
                        <div style={{ 
                            marginTop: '20px', 
                            padding: '20px', 
                            backgroundColor: '#f8f9fa', 
                            borderRadius: '8px',
                            border: '1px solid #e0e0e0'
                        }}>
                            <h4 style={{ margin: '0 0 15px 0', color: '#2c3e50' }}>
                                Schedule Statistics
                            </h4>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '20px' }}>
                                <div>
                                    <h5 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px' }}>
                                        TOTAL PAYMENTS
                                    </h5>
                                    <p style={{ margin: '0', fontSize: '1.2rem', fontWeight: '600', color: '#2c3e50' }}>
                                        {schedule.payment_schedule.length}
                                    </p>
                                </div>
                                <div>
                                    <h5 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px' }}>
                                        INTEREST TO PRINCIPAL RATIO
                                    </h5>
                                    <p style={{ margin: '0', fontSize: '1.2rem', fontWeight: '600', color: '#2c3e50' }}>
                                        {schedule.total_interest && schedule.loan_summary?.principal_amount ? 
                                            `${((schedule.total_interest / schedule.loan_summary.principal_amount) * 100).toFixed(1)}%` : 
                                            'N/A'}
                                    </p>
                                </div>
                                <div>
                                    <h5 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px' }}>
                                        FIRST PAYMENT DATE
                                    </h5>
                                    <p style={{ margin: '0', fontSize: '1.2rem', fontWeight: '600', color: '#2c3e50' }}>
                                        {formatDate(schedule.payment_schedule[0]?.payment_date)}
                                    </p>
                                </div>
                                <div>
                                    <h5 style={{ margin: '0 0 5px 0', color: '#666', fontSize: '12px' }}>
                                        FINAL PAYMENT DATE
                                    </h5>
                                    <p style={{ margin: '0', fontSize: '1.2rem', fontWeight: '600', color: '#2c3e50' }}>
                                        {formatDate(schedule.payment_schedule[schedule.payment_schedule.length - 1]?.payment_date)}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                <div className="loan-modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>
                        Close
                    </button>
                    <button 
                        className="btn btn-primary"
                        onClick={() => {
                            // Export functionality could be added here
                            const csvContent = "data:text/csv;charset=utf-8," + 
                                "Payment Number,Date,Payment Amount,Principal,Interest,Remaining Balance,Status\n" +
                                (schedule.payment_schedule || []).map(payment => 
                                    `${payment.payment_number},${payment.payment_date},${payment.payment_amount},${payment.principal_payment},${payment.interest_payment},${payment.remaining_balance},${payment.payment_status}`
                                ).join("\n");
                            
                            const encodedUri = encodeURI(csvContent);
                            const link = document.createElement("a");
                            link.setAttribute("href", encodedUri);
                            link.setAttribute("download", `${schedule.loan_name}_amortization_schedule.csv`);
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                        }}
                    >
                        Export CSV
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AmortizationScheduleModal;