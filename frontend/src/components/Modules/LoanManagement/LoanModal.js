import React, { useState, useEffect } from 'react';

const LoanModal = ({ loan, onSave, onClose }) => {
    const [formData, setFormData] = useState({
        loan_name: '',
        lender: '',
        loan_type: 'term_loan',
        principal_amount: '',
        interest_rate: '',
        loan_term_months: '',
        start_date: '',
        payment_type: 'amortizing',
        payment_frequency: 'monthly',
        balloon_payment: '',
        balloon_date: '',
        description: '',
        collateral_description: '',
        guarantor: '',
        loan_officer: '',
        account_number: '',
        is_active: true
    });

    const [errors, setErrors] = useState({});

    useEffect(() => {
        if (loan) {
            setFormData({
                loan_name: loan.loan_name || '',
                lender: loan.lender || '',
                loan_type: loan.loan_type || 'term_loan',
                principal_amount: loan.principal_amount || '',
                interest_rate: loan.interest_rate || '',
                loan_term_months: loan.loan_term_months || '',
                start_date: loan.start_date || '',
                payment_type: loan.payment_type || 'amortizing',
                payment_frequency: loan.payment_frequency || 'monthly',
                balloon_payment: loan.balloon_payment || '',
                balloon_date: loan.balloon_date || '',
                description: loan.description || '',
                collateral_description: loan.collateral_description || '',
                guarantor: loan.guarantor || '',
                loan_officer: loan.loan_officer || '',
                account_number: loan.account_number || '',
                is_active: loan.is_active !== undefined ? loan.is_active : true
            });
        } else {
            // Default to current date for new loans
            const today = new Date().toISOString().split('T')[0];
            setFormData(prev => ({
                ...prev,
                start_date: today
            }));
        }
    }, [loan]);

    const handleChange = (e) => {
        const { name, value, type, checked } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value
        }));

        // Clear error when user starts typing
        if (errors[name]) {
            setErrors(prev => ({
                ...prev,
                [name]: ''
            }));
        }
    };

    const validateForm = () => {
        const newErrors = {};

        // Required fields
        if (!formData.loan_name.trim()) newErrors.loan_name = 'Loan name is required';
        if (!formData.lender.trim()) newErrors.lender = 'Lender is required';
        if (!formData.principal_amount) newErrors.principal_amount = 'Principal amount is required';
        if (!formData.interest_rate) newErrors.interest_rate = 'Interest rate is required';
        if (!formData.loan_term_months) newErrors.loan_term_months = 'Loan term is required';
        if (!formData.start_date) newErrors.start_date = 'Start date is required';

        // Numeric validations
        if (formData.principal_amount && isNaN(formData.principal_amount)) {
            newErrors.principal_amount = 'Principal amount must be a number';
        } else if (formData.principal_amount && parseFloat(formData.principal_amount) <= 0) {
            newErrors.principal_amount = 'Principal amount must be greater than 0';
        }

        if (formData.interest_rate && isNaN(formData.interest_rate)) {
            newErrors.interest_rate = 'Interest rate must be a number';
        } else if (formData.interest_rate && (parseFloat(formData.interest_rate) < 0 || parseFloat(formData.interest_rate) > 100)) {
            newErrors.interest_rate = 'Interest rate must be between 0 and 100';
        }

        if (formData.loan_term_months && isNaN(formData.loan_term_months)) {
            newErrors.loan_term_months = 'Loan term must be a number';
        } else if (formData.loan_term_months && parseInt(formData.loan_term_months) <= 0) {
            newErrors.loan_term_months = 'Loan term must be greater than 0';
        }

        // Balloon payment validations
        if (formData.payment_type === 'interest_only') {
            if (!formData.balloon_date) {
                newErrors.balloon_date = 'Balloon date is required for interest-only loans';
            }
        }

        if (formData.balloon_payment && isNaN(formData.balloon_payment)) {
            newErrors.balloon_payment = 'Balloon payment must be a number';
        } else if (formData.balloon_payment && parseFloat(formData.balloon_payment) <= 0) {
            newErrors.balloon_payment = 'Balloon payment must be greater than 0';
        }

        // Date validations
        if (formData.start_date && formData.balloon_date) {
            if (new Date(formData.balloon_date) <= new Date(formData.start_date)) {
                newErrors.balloon_date = 'Balloon date must be after start date';
            }
        }

        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        // Convert string values to appropriate types
        const submitData = {
            ...formData,
            principal_amount: parseFloat(formData.principal_amount),
            interest_rate: parseFloat(formData.interest_rate),
            loan_term_months: parseInt(formData.loan_term_months),
            balloon_payment: formData.balloon_payment ? parseFloat(formData.balloon_payment) : null,
            balloon_date: formData.balloon_date || null
        };

        onSave(submitData);
    };

    const loanTypeOptions = [
        { value: 'term_loan', label: 'Term Loan' },
        { value: 'line_of_credit', label: 'Line of Credit' },
        { value: 'sba_loan', label: 'SBA Loan' },
        { value: 'equipment_loan', label: 'Equipment Loan' },
        { value: 'real_estate_loan', label: 'Real Estate Loan' }
    ];

    const paymentFrequencyOptions = [
        { value: 'monthly', label: 'Monthly' },
        { value: 'quarterly', label: 'Quarterly' },
        { value: 'annually', label: 'Annually' }
    ];

    return (
        <div className="loan-modal-overlay" onClick={onClose}>
            <div className="loan-modal" onClick={e => e.stopPropagation()}>
                <div className="loan-modal-header">
                    <h2>{loan ? 'Edit Loan' : 'Add New Loan'}</h2>
                    <button className="close-btn" onClick={onClose}>&times;</button>
                </div>
                
                <form onSubmit={handleSubmit}>
                    <div className="loan-modal-body">
                        <div className="form-section">
                            <h3>Basic Information</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Loan Name *</label>
                                    <input
                                        type="text"
                                        name="loan_name"
                                        value={formData.loan_name}
                                        onChange={handleChange}
                                        placeholder="e.g., Equipment Purchase Loan"
                                        className={errors.loan_name ? 'error' : ''}
                                    />
                                    {errors.loan_name && <div className="error-text">{errors.loan_name}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Lender *</label>
                                    <input
                                        type="text"
                                        name="lender"
                                        value={formData.lender}
                                        onChange={handleChange}
                                        placeholder="e.g., First National Bank"
                                        className={errors.lender ? 'error' : ''}
                                    />
                                    {errors.lender && <div className="error-text">{errors.lender}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Loan Type</label>
                                    <select
                                        name="loan_type"
                                        value={formData.loan_type}
                                        onChange={handleChange}
                                    >
                                        {loanTypeOptions.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Account Number</label>
                                    <input
                                        type="text"
                                        name="account_number"
                                        value={formData.account_number}
                                        onChange={handleChange}
                                        placeholder="Loan account number"
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="form-section">
                            <h3>Loan Terms</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Principal Amount * ($)</label>
                                    <input
                                        type="number"
                                        name="principal_amount"
                                        value={formData.principal_amount}
                                        onChange={handleChange}
                                        min="0"
                                        step="0.01"
                                        placeholder="100000.00"
                                        className={errors.principal_amount ? 'error' : ''}
                                    />
                                    {errors.principal_amount && <div className="error-text">{errors.principal_amount}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Interest Rate * (%)</label>
                                    <input
                                        type="number"
                                        name="interest_rate"
                                        value={formData.interest_rate}
                                        onChange={handleChange}
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        placeholder="5.25"
                                        className={errors.interest_rate ? 'error' : ''}
                                    />
                                    {errors.interest_rate && <div className="error-text">{errors.interest_rate}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Loan Term * (months)</label>
                                    <input
                                        type="number"
                                        name="loan_term_months"
                                        value={formData.loan_term_months}
                                        onChange={handleChange}
                                        min="1"
                                        placeholder="60"
                                        className={errors.loan_term_months ? 'error' : ''}
                                    />
                                    {errors.loan_term_months && <div className="error-text">{errors.loan_term_months}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Start Date *</label>
                                    <input
                                        type="date"
                                        name="start_date"
                                        value={formData.start_date}
                                        onChange={handleChange}
                                        className={errors.start_date ? 'error' : ''}
                                    />
                                    {errors.start_date && <div className="error-text">{errors.start_date}</div>}
                                </div>

                                <div className="form-group">
                                    <label>Payment Type</label>
                                    <select
                                        name="payment_type"
                                        value={formData.payment_type}
                                        onChange={handleChange}
                                    >
                                        <option value="amortizing">Amortizing</option>
                                        <option value="interest_only">Interest Only</option>
                                    </select>
                                </div>

                                <div className="form-group">
                                    <label>Payment Frequency</label>
                                    <select
                                        name="payment_frequency"
                                        value={formData.payment_frequency}
                                        onChange={handleChange}
                                    >
                                        {paymentFrequencyOptions.map(option => (
                                            <option key={option.value} value={option.value}>
                                                {option.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        </div>

                        {formData.payment_type === 'interest_only' && (
                            <div className="form-section">
                                <h3>Balloon Payment</h3>
                                <div className="form-grid">
                                    <div className="form-group">
                                        <label>Balloon Payment Amount ($)</label>
                                        <input
                                            type="number"
                                            name="balloon_payment"
                                            value={formData.balloon_payment}
                                            onChange={handleChange}
                                            min="0"
                                            step="0.01"
                                            placeholder="Principal amount if not specified"
                                            className={errors.balloon_payment ? 'error' : ''}
                                        />
                                        {errors.balloon_payment && <div className="error-text">{errors.balloon_payment}</div>}
                                    </div>

                                    <div className="form-group">
                                        <label>Balloon Due Date *</label>
                                        <input
                                            type="date"
                                            name="balloon_date"
                                            value={formData.balloon_date}
                                            onChange={handleChange}
                                            className={errors.balloon_date ? 'error' : ''}
                                        />
                                        {errors.balloon_date && <div className="error-text">{errors.balloon_date}</div>}
                                    </div>
                                </div>
                            </div>
                        )}

                        <div className="form-section">
                            <h3>Additional Details</h3>
                            <div className="form-grid">
                                <div className="form-group">
                                    <label>Loan Officer</label>
                                    <input
                                        type="text"
                                        name="loan_officer"
                                        value={formData.loan_officer}
                                        onChange={handleChange}
                                        placeholder="Contact person at lender"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Guarantor</label>
                                    <input
                                        type="text"
                                        name="guarantor"
                                        value={formData.guarantor}
                                        onChange={handleChange}
                                        placeholder="Personal or business guarantor"
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Collateral Description</label>
                                    <textarea
                                        name="collateral_description"
                                        value={formData.collateral_description}
                                        onChange={handleChange}
                                        placeholder="Description of collateral securing the loan"
                                        rows="3"
                                    />
                                </div>

                                <div className="form-group full-width">
                                    <label>Description</label>
                                    <textarea
                                        name="description"
                                        value={formData.description}
                                        onChange={handleChange}
                                        placeholder="Additional notes about the loan"
                                        rows="3"
                                    />
                                </div>

                                <div className="form-group">
                                    <label>
                                        <input
                                            type="checkbox"
                                            name="is_active"
                                            checked={formData.is_active}
                                            onChange={handleChange}
                                        />
                                        Active Loan
                                    </label>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="loan-modal-footer">
                        <button type="button" className="btn btn-secondary" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit" className="btn btn-primary">
                            {loan ? 'Update Loan' : 'Create Loan'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default LoanModal;