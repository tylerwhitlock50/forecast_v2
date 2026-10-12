import React, { useState } from 'react';
import { formatDateOnly, parseLocalDate } from '../../../lib/dates';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { DataTable } from '../../ui/data-table';
import { Badge } from '../../ui/badge';
import { paymentStatusLabel } from './loanScheduleUtils';

const STATUS_VARIANTS = { Paid: 'success', Skipped: 'secondary', Recorded: 'info', Overdue: 'destructive', Scheduled: 'outline' };

/**
 * Payment-by-payment schedule. Paid and recorded rows (history) are shaded
 * and show what was actually paid: changing the loan's terms never changes
 * them.
 */
export const PaymentScheduleTable = ({ payments, formatCurrency, formatDate }) => {
    if (!payments || payments.length === 0) {
        return <div className="p-8 text-center text-muted-foreground">No payment data available</div>;
    }
    return (
        <table className="w-full text-sm" data-testid="payment-schedule-table">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-xs text-slate-600">
                <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 text-right font-medium">Payment</th>
                    <th className="px-3 py-2 text-right font-medium">Principal</th>
                    <th className="px-3 py-2 text-right font-medium">Interest</th>
                    <th className="px-3 py-2 text-right font-medium">Balance after</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                </tr>
            </thead>
            <tbody>
                {payments.map((payment, i) => {
                    const label = paymentStatusLabel(payment);
                    const history = Boolean(payment.recorded);
                    const hasActualAmount = payment.actual_payment_amount !== null && payment.actual_payment_amount !== undefined;
                    const hasActual = Boolean(payment.actual_payment_date) || hasActualAmount;
                    return (
                        <tr
                            key={`${payment.payment_id}-${i}`}
                            className={`border-t ${history ? 'bg-green-50/70' : ''}`}
                            data-testid={history ? 'history-row' : 'schedule-row'}
                        >
                            <td className="px-3 py-1.5 font-semibold tabular-nums">{payment.payment_number}</td>
                            <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(payment.payment_date)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatCurrency(payment.payment_amount)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(payment.principal_payment)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{formatCurrency(payment.interest_payment)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{formatCurrency(payment.remaining_balance)}</td>
                            <td className="px-3 py-1.5">
                                <Badge variant={STATUS_VARIANTS[label] || 'outline'}>{label}</Badge>
                                {hasActual && (
                                    <div className="mt-0.5 text-xs text-slate-600">
                                        {payment.actual_payment_date ? `Paid ${formatDate(payment.actual_payment_date)}` : 'Paid'}
                                        {hasActualAmount ? ` - ${formatCurrency(payment.actual_payment_amount)}` : ''}
                                    </div>
                                )}
                                {payment.notes && <div className="mt-0.5 max-w-[16rem] truncate text-xs text-slate-500" title={payment.notes}>{payment.notes}</div>}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    );
};

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

    const formatDate = (dateString) => formatDateOnly(dateString, { year: 'numeric', month: 'short', day: 'numeric' }, '');

    const getFilteredPayments = () => {
        if (!schedule.payment_schedule) return [];

        const today = new Date();

        switch (viewMode) {
            case 'upcoming':
                return schedule.payment_schedule.filter(payment =>
                    !payment.recorded && (parseLocalDate(payment.payment_date) || new Date(0)) >= today
                ).slice(0, 12); // Next 12 payments

            case 'annual':
                // Group by year and show annual totals
                const yearlyData = {};
                schedule.payment_schedule.forEach(payment => {
                    const year = (parseLocalDate(payment.payment_date) || new Date(payment.payment_date)).getFullYear();
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

    if (!schedule) {
        return null;
    }

    const payments = schedule.payment_schedule || [];
    const recordedCount = payments.filter(p => p.recorded).length;
    const paidCount = payments.filter(p => String(p.payment_status || '').toLowerCase() === 'paid').length;

    const csvCell = (value) => {
        if (value === null || value === undefined) return '';
        const text = String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    const exportToCsv = () => {
        const header = 'Payment Number,Date,Payment Amount,Principal,Interest,Remaining Balance,Status,Actual Payment Date,Actual Payment Amount,Notes';
        const lines = payments.map(payment => [
            payment.payment_number, payment.payment_date, payment.payment_amount, payment.principal_payment,
            payment.interest_payment, payment.remaining_balance, payment.payment_status,
            payment.actual_payment_date, payment.actual_payment_amount, payment.notes,
        ].map(csvCell).join(','));
        const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `${schedule.loan_name}_amortization_schedule.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    return (
        <Modal className="max-w-7xl" onClick={onClose}>
            <div onClick={e => e.stopPropagation()}>
                <ModalHeader>
                    <div className="pr-8">
                        <ModalTitle>Amortization Schedule - {schedule.loan_name}</ModalTitle>
                        <p className="mt-1 text-sm text-muted-foreground">{schedule.lender}</p>
                    </div>
                    <ModalClose onClick={onClose} />
                </ModalHeader>

                <ModalContent className="space-y-6">
                    {/* Loan Summary */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <StatsCard
                            title="Paid"
                            value={`${paidCount} of ${payments.length}`}
                            subtitle={recordedCount > paidCount ? `${recordedCount} recorded` : undefined}
                            variant={paidCount ? 'success' : 'default'}
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

                    {recordedCount > 0 && (
                        <p className="rounded-md border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-900" data-testid="history-note">
                            Shaded rows are paid or recorded payments. They are history: changing the loan's terms
                            never changes them, only the installments after the last one are recalculated.
                        </p>
                    )}

                    {/* View Mode Tabs */}
                    <Tabs value={viewMode} onValueChange={setViewMode}>
                        <TabsList className="grid w-full grid-cols-3">
                            <TabsTrigger value="all">
                                All Payments ({payments.length})
                            </TabsTrigger>
                            <TabsTrigger value="upcoming">
                                Next 12 Unpaid
                            </TabsTrigger>
                            <TabsTrigger value="annual">
                                Annual Summary
                            </TabsTrigger>
                        </TabsList>

                        <TabsContent value={viewMode} className="space-y-4">
                            <Card>
                                <CardContent className="p-0">
                                    <div className="max-h-96 overflow-auto rounded-md border">
                                        {viewMode === 'annual' ? (
                                            <DataTable
                                                data={filteredPayments}
                                                columns={annualColumns}
                                                emptyMessage="No payment data available"
                                            />
                                        ) : (
                                            <PaymentScheduleTable
                                                payments={filteredPayments}
                                                formatCurrency={formatCurrency}
                                                formatDate={formatDate}
                                            />
                                        )}
                                    </div>
                                </CardContent>
                            </Card>
                        </TabsContent>
                    </Tabs>

                    {/* Schedule Statistics */}
                    {viewMode === 'all' && payments.length > 0 && (
                        <Card>
                            <CardHeader>
                                <CardTitle>Schedule Statistics</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                    <StatsCard
                                        title="Total Payments"
                                        value={payments.length}
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
                                        value={formatDate(payments[0]?.payment_date)}
                                        variant="default"
                                    />
                                    <StatsCard
                                        title="Final Payment Date"
                                        value={formatDate(payments[payments.length - 1]?.payment_date)}
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
