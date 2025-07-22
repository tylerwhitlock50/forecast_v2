import React, { useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { DataTable } from '../../ui/data-table';
import { Badge } from '../../ui/badge';

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

    const regularColumns = [
        {
            key: 'payment_number',
            title: 'Payment #',
            render: (value) => <span className="font-semibold">{value}</span>
        },
        {
            key: 'payment_date',
            title: 'Date',
            type: 'date'
        },
        {
            key: 'payment_amount',
            title: 'Payment Amount',
            type: 'currency',
            render: (value) => <span className="font-semibold">{formatCurrency(value)}</span>
        },
        {
            key: 'principal_payment',
            title: 'Principal',
            type: 'currency'
        },
        {
            key: 'interest_payment',
            title: 'Interest',
            type: 'currency'
        },
        {
            key: 'remaining_balance',
            title: 'Remaining Balance',
            render: (value) => <span className="font-semibold text-red-600">{formatCurrency(value)}</span>
        },
        {
            key: 'payment_status',
            title: 'Status',
            render: (value) => {
                const variants = {
                    'scheduled': 'default',
                    'paid': 'success',
                    'overdue': 'destructive'
                };
                return <Badge variant={variants[value] || 'default'}>{value}</Badge>;
            }
        }
    ];

    const annualColumns = [
        {
            key: 'year',
            title: 'Year',
            render: (value) => <span className="font-semibold">{value}</span>
        },
        {
            key: 'payments',
            title: 'Payments'
        },
        {
            key: 'total_payment',
            title: 'Total Payment',
            render: (value) => <span className="font-semibold">{formatCurrency(value)}</span>
        },
        {
            key: 'total_principal',
            title: 'Principal',
            type: 'currency'
        },
        {
            key: 'total_interest',
            title: 'Interest',
            type: 'currency'
        },
        {
            key: 'ending_balance',
            title: 'Ending Balance',
            render: (value) => <span className="font-semibold text-red-600">{formatCurrency(value)}</span>
        }
    ];

    const columns = viewMode === 'annual' ? annualColumns : regularColumns;

    if (!schedule) {
        return null;
    }

    const exportToCsv = () => {
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
    };

    return (
        <Modal className="max-w-7xl" onClick={onClose}>
            <div onClick={e => e.stopPropagation()}>
                <ModalHeader>
                    <ModalTitle>Amortization Schedule - {schedule.loan_name}</ModalTitle>
                    <ModalClose onClick={onClose} />
                </ModalHeader>

                <ModalContent className="space-y-6">
                    {/* Loan Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-4">
                        <StatsCard
                            title="Lender"
                            value={schedule.lender}
                            variant="default"
                        />
                        <StatsCard
                            title="Principal"
                            value={formatCurrency(schedule.loan_summary?.principal_amount)}
                            variant="primary"
                        />
                        <StatsCard
                            title="Interest Rate"
                            value={`${schedule.loan_summary?.interest_rate}%`}
                            variant="warning"
                        />
                        <StatsCard
                            title="Term"
                            value={`${schedule.loan_summary?.loan_term_months} months`}
                            variant="default"
                        />
                        <StatsCard
                            title="Total Payments"
                            value={formatCurrency(schedule.total_payments)}
                            variant="success"
                        />
                        <StatsCard
                            title="Total Interest"
                            value={formatCurrency(schedule.total_interest)}
                            variant="danger"
                        />
                        <StatsCard
                            title="Payment Type"
                            value={schedule.loan_summary?.payment_type?.replace('_', ' ')}
                            variant="default"
                        />
                        <StatsCard
                            title="Avg Monthly Payment"
                            value={formatCurrency(schedule.loan_summary?.average_monthly_payment)}
                            variant="default"
                        />
                    </div>

                    {/* View Mode Tabs */}
                    <Tabs value={viewMode} onValueChange={setViewMode}>
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="all">
                                All Payments ({schedule.payment_schedule?.length || 0})
                            </TabsTrigger>
                            <TabsTrigger value="upcoming">
                                Next 12 Payments
                            </TabsTrigger>
                            <TabsTrigger value="annual">
                                Annual Summary
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value={viewMode} className="space-y-4">
                            <Card>
                                <CardContent className="p-0">
                                    <div className="max-h-96 overflow-y-auto">
                                        <DataTable
                                            data={filteredPayments}
                                            columns={columns}
                                            emptyMessage="No payment data available"
                                        />
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    {/* Schedule Statistics */}
                    {viewMode === 'all' && schedule.payment_schedule && schedule.payment_schedule.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Schedule Statistics</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <StatsCard
                                        title="Total Payments"
                                        value={schedule.payment_schedule.length}
                                        variant="default"
                                    />
                                    <StatsCard
                                        title="Interest to Principal Ratio"
                                        value={
                                            schedule.total_interest && schedule.loan_summary?.principal_amount ? 
                                            `${((schedule.total_interest / schedule.loan_summary.principal_amount) * 100).toFixed(1)}%` : 
                                            'N/A'
                                        }
                                        variant="warning"
                                    />
                                    <StatsCard
                                        title="First Payment Date"
                                        value={formatDate(schedule.payment_schedule[0]?.payment_date)}
                                        variant="default"
                                    />
                                    <StatsCard
                                        title="Final Payment Date"
                                        value={formatDate(schedule.payment_schedule[schedule.payment_schedule.length - 1]?.payment_date)}
                                        variant="default"
                                    />
                                </div>
                            </CardContent>
                        </Card>
                    )}
                </ModalContent>

                <ModalFooter>
                    <Button variant="outline" onClick={onClose}>
                        Close
                    </Button>
                    <Button onClick={exportToCsv}>
                        Export CSV
                    </Button>
                </ModalFooter>
            </div>
        </Modal>
    );
};

export default AmortizationScheduleModal;