import React from 'react';
import { DataTable } from '../../ui/data-table';
import { Badge } from '../../ui/badge';
import { Button } from '../../ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const LoanTable = ({ loans, onEdit, onDelete, onViewSchedule }) => {
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
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    const getLoanTypeVariant = (loanType) => {
        const variants = {
            'term_loan': 'default',
            'line_of_credit': 'secondary',
            'sba_loan': 'success',
            'equipment_loan': 'warning',
            'real_estate_loan': 'info'
        };
        return variants[loanType] || 'default';
    };

    const getPaymentTypeVariant = (paymentType) => {
        return paymentType === 'amortizing' ? 'default' : 'warning';
    };

    const columns = [
        {
            key: 'loan_details',
            title: 'Loan Details',
            render: (_, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{row.loan_name}</div>
                    <div className="text-sm text-muted-foreground">ID: {row.loan_id}</div>
                    {row.account_number && (
                        <div className="text-sm text-muted-foreground">
                            Acct: {row.account_number}
                        </div>
                    )}
                </div>
            )
        },
        {
            key: 'lender',
            title: 'Lender',
            render: (_, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{row.lender}</div>
                    {row.loan_officer && (
                        <div className="text-sm text-muted-foreground">{row.loan_officer}</div>
                    )}
                </div>
            )
        },
        {
            key: 'type_payment',
            title: 'Type & Payment',
            render: (_, row) => (
                <div className="space-y-2">
                    <Badge variant={getLoanTypeVariant(row.loan_type)}>
                        {row.loan_type.replace('_', ' ')}
                    </Badge>
                    <div>
                        <Badge variant={getPaymentTypeVariant(row.payment_type)}>
                            {row.payment_type.replace('_', ' ')}
                        </Badge>
                    </div>
                </div>
            )
        },
        {
            key: 'principal_amount',
            title: 'Principal',
            type: 'currency',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{formatCurrency(value)}</div>
                    <div className="text-sm text-muted-foreground">
                        Started: {formatDate(row.start_date)}
                    </div>
                </div>
            )
        },
        {
            key: 'current_balance',
            title: 'Current Balance',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold text-red-600">{formatCurrency(value)}</div>
                    {row.principal_amount > 0 && (
                        <div className="text-sm text-muted-foreground">
                            {((value / row.principal_amount) * 100).toFixed(1)}% remaining
                        </div>
                    )}
                </div>
            )
        },
        {
            key: 'interest_rate',
            title: 'Interest Rate',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold text-yellow-600">{formatPercent(value)}</div>
                    <div className="text-sm text-muted-foreground capitalize">
                        {row.payment_frequency}
                    </div>
                </div>
            )
        },
        {
            key: 'monthly_payment_amount',
            title: 'Monthly Payment',
            render: (value) => (
                <div className="space-y-1">
                    <div className="font-semibold">{formatCurrency(value)}</div>
                    <div className="text-sm text-muted-foreground">
                        Annual: {formatCurrency(value * 12)}
                    </div>
                </div>
            )
        },
        {
            key: 'loan_term_months',
            title: 'Term',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{value} months</div>
                    <div className="text-sm text-muted-foreground">
                        {row.payments_made || 0} of {(row.payments_made || 0) + (row.payments_remaining || 0)} paid
                    </div>
                </div>
            )
        },
        {
            key: 'next_payment_date',
            title: 'Next Payment',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{formatDate(value)}</div>
                    {row.balloon_date && (
                        <div className="text-sm text-red-600">
                            Balloon: {formatDate(row.balloon_date)}
                        </div>
                    )}
                </div>
            )
        },
        {
            key: 'is_active',
            title: 'Status',
            type: 'badge',
            render: (value) => (
                <Badge variant={value ? 'success' : 'secondary'}>
                    {value ? 'Active' : 'Inactive'}
                </Badge>
            )
        }
    ];

    const customActions = (row) => (
        <div className="flex items-center gap-2">
            <Button
                variant="outline"
                size="sm"
                onClick={() => onViewSchedule(row.loan_id)}
            >
                Schedule
            </Button>
            <Button
                variant="outline"
                size="sm"
                onClick={() => onEdit(row)}
            >
                Edit
            </Button>
            <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete(row.loan_id)}
            >
                Delete
            </Button>
        </div>
    );

    return (
        <Card>
            <CardHeader>
                <CardTitle>Loan Portfolio ({loans.length} loans)</CardTitle>
            </CardHeader>
            <CardContent>
                <DataTable
                    data={loans}
                    columns={columns}
                    onCustomAction={{
                        render: customActions
                    }}
                    emptyMessage="No loans found. Click 'Add New Loan' to create your first loan."
                />
            </CardContent>
        </Card>
    );
};

export default LoanTable;