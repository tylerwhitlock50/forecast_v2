import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

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
        <Modal className="max-w-4xl" onClick={onClose}>
            <div onClick={e => e.stopPropagation()}>
                <ModalHeader>
                    <ModalTitle>{loan ? 'Edit Loan' : 'Add New Loan'}</ModalTitle>
                    <ModalClose onClick={onClose} />
                </ModalHeader>

                <form onSubmit={handleSubmit}>
                    <ModalContent className="space-y-6">
                        {/* Basic Information */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Basic Information</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="loan_name">Loan Name *</Label>
                                        <Input
                                            id="loan_name"
                                            name="loan_name"
                                            value={formData.loan_name}
                                            onChange={handleChange}
                                            placeholder="e.g., Equipment Purchase Loan"
                                            className={errors.loan_name ? 'border-red-500' : ''}
                                        />
                                        {errors.loan_name && (
                                            <p className="text-sm text-red-500">{errors.loan_name}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="lender">Lender *</Label>
                                        <Input
                                            id="lender"
                                            name="lender"
                                            value={formData.lender}
                                            onChange={handleChange}
                                            placeholder="e.g., First National Bank"
                                            className={errors.lender ? 'border-red-500' : ''}
                                        />
                                        {errors.lender && (
                                            <p className="text-sm text-red-500">{errors.lender}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="loan_type">Loan Type</Label>
                                        <Select
                                            id="loan_type"
                                            name="loan_type"
                                            value={formData.loan_type}
                                            onChange={handleChange}
                                        >
                                            {loanTypeOptions.map(option => (
                                                <SelectOption key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectOption>
                                            ))}
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="account_number">Account Number</Label>
                                        <Input
                                            id="account_number"
                                            name="account_number"
                                            value={formData.account_number}
                                            onChange={handleChange}
                                            placeholder="Loan account number"
                                        />
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Loan Terms */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Loan Terms</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="space-y-2">
                                        <Label htmlFor="principal_amount">Principal Amount * ($)</Label>
                                        <Input
                                            id="principal_amount"
                                            name="principal_amount"
                                            type="number"
                                            value={formData.principal_amount}
                                            onChange={handleChange}
                                            min="0"
                                            step="0.01"
                                            placeholder="100000.00"
                                            className={errors.principal_amount ? 'border-red-500' : ''}
                                        />
                                        {errors.principal_amount && (
                                            <p className="text-sm text-red-500">{errors.principal_amount}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="interest_rate">Interest Rate * (%)</Label>
                                        <Input
                                            id="interest_rate"
                                            name="interest_rate"
                                            type="number"
                                            value={formData.interest_rate}
                                            onChange={handleChange}
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            placeholder="5.25"
                                            className={errors.interest_rate ? 'border-red-500' : ''}
                                        />
                                        {errors.interest_rate && (
                                            <p className="text-sm text-red-500">{errors.interest_rate}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="loan_term_months">Loan Term * (months)</Label>
                                        <Input
                                            id="loan_term_months"
                                            name="loan_term_months"
                                            type="number"
                                            value={formData.loan_term_months}
                                            onChange={handleChange}
                                            min="1"
                                            placeholder="60"
                                            className={errors.loan_term_months ? 'border-red-500' : ''}
                                        />
                                        {errors.loan_term_months && (
                                            <p className="text-sm text-red-500">{errors.loan_term_months}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="start_date">Start Date *</Label>
                                        <Input
                                            id="start_date"
                                            name="start_date"
                                            type="date"
                                            value={formData.start_date}
                                            onChange={handleChange}
                                            className={errors.start_date ? 'border-red-500' : ''}
                                        />
                                        {errors.start_date && (
                                            <p className="text-sm text-red-500">{errors.start_date}</p>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="payment_type">Payment Type</Label>
                                        <Select
                                            id="payment_type"
                                            name="payment_type"
                                            value={formData.payment_type}
                                            onChange={handleChange}
                                        >
                                            <SelectOption value="amortizing">Amortizing</SelectOption>
                                            <SelectOption value="interest_only">Interest Only</SelectOption>
                                        </Select>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="payment_frequency">Payment Frequency</Label>
                                        <Select
                                            id="payment_frequency"
                                            name="payment_frequency"
                                            value={formData.payment_frequency}
                                            onChange={handleChange}
                                        >
                                            {paymentFrequencyOptions.map(option => (
                                                <SelectOption key={option.value} value={option.value}>
                                                    {option.label}
                                                </SelectOption>
                                            ))}
                                        </Select>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>

                        {/* Balloon Payment (for interest-only loans) */}
                        {formData.payment_type === 'interest_only' && (
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-lg">Balloon Payment</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="balloon_payment">Balloon Payment Amount ($)</Label>
                                            <Input
                                                id="balloon_payment"
                                                name="balloon_payment"
                                                type="number"
                                                value={formData.balloon_payment}
                                                onChange={handleChange}
                                                min="0"
                                                step="0.01"
                                                placeholder="Principal amount if not specified"
                                                className={errors.balloon_payment ? 'border-red-500' : ''}
                                            />
                                            {errors.balloon_payment && (
                                                <p className="text-sm text-red-500">{errors.balloon_payment}</p>
                                            )}
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="balloon_date">Balloon Due Date *</Label>
                                            <Input
                                                id="balloon_date"
                                                name="balloon_date"
                                                type="date"
                                                value={formData.balloon_date}
                                                onChange={handleChange}
                                                className={errors.balloon_date ? 'border-red-500' : ''}
                                            />
                                            {errors.balloon_date && (
                                                <p className="text-sm text-red-500">{errors.balloon_date}</p>
                                            )}
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Additional Details */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Additional Details</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="loan_officer">Loan Officer</Label>
                                            <Input
                                                id="loan_officer"
                                                name="loan_officer"
                                                value={formData.loan_officer}
                                                onChange={handleChange}
                                                placeholder="Contact person at lender"
                                            />
                                        </div>

                                        <div className="space-y-2">
                                            <Label htmlFor="guarantor">Guarantor</Label>
                                            <Input
                                                id="guarantor"
                                                name="guarantor"
                                                value={formData.guarantor}
                                                onChange={handleChange}
                                                placeholder="Personal or business guarantor"
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="collateral_description">Collateral Description</Label>
                                        <Textarea
                                            id="collateral_description"
                                            name="collateral_description"
                                            value={formData.collateral_description}
                                            onChange={handleChange}
                                            placeholder="Description of collateral securing the loan"
                                            rows={3}
                                        />
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="description">Description</Label>
                                        <Textarea
                                            id="description"
                                            name="description"
                                            value={formData.description}
                                            onChange={handleChange}
                                            placeholder="Additional notes about the loan"
                                            rows={3}
                                        />
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <input
                                            id="is_active"
                                            name="is_active"
                                            type="checkbox"
                                            checked={formData.is_active}
                                            onChange={handleChange}
                                            className="rounded"
                                        />
                                        <Label htmlFor="is_active">Active Loan</Label>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    </ModalContent>

                    <ModalFooter>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                        <Button type="submit">
                            {loan ? 'Update Loan' : 'Create Loan'}
                        </Button>
                    </ModalFooter>
                </form>
            </div>
        </Modal>
    );
};

export default LoanModal;