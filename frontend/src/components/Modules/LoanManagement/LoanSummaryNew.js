import React from 'react';
import { StatsCard } from '../../ui/stats-card';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';

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
        return (
            <div className="flex items-center justify-center p-8">
                <div className="text-muted-foreground">Loading loan summary...</div>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Key Metrics Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
                <StatsCard
                    title="Total Loans"
                    value={summary.total_loans || 0}
                    subtitle={`${summary.active_loans || 0} active`}
                    variant="primary"
                />
                
                <StatsCard
                    title="Total Principal"
                    value={formatCurrency(summary.total_principal)}
                    subtitle="Original loan amounts"
                    variant="success"
                />
                
                <StatsCard
                    title="Current Balance"
                    value={formatCurrency(summary.total_current_balance)}
                    subtitle={
                        summary.total_principal > 0 ? 
                        `${((summary.total_current_balance / summary.total_principal) * 100).toFixed(1)}% remaining` : 
                        ''
                    }
                    variant="warning"
                />
                
                <StatsCard
                    title="Monthly Payments"
                    value={formatCurrency(summary.total_monthly_payments)}
                    subtitle={`${formatCurrency(summary.total_annual_payments)} annually`}
                    variant="danger"
                />
                
                <StatsCard
                    title="Avg Interest Rate"
                    value={formatPercent(summary.interest_rate_summary?.average)}
                    subtitle={`Range: ${formatPercent(summary.interest_rate_summary?.minimum)} - ${formatPercent(summary.interest_rate_summary?.maximum)}`}
                    variant="default"
                />
            </div>

            {/* Detailed Views */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Upcoming Payments */}
                <div className="lg:col-span-2">
                    <Card>
                        <CardHeader className="flex flex-row items-center justify-between">
                            <CardTitle>Upcoming Payments (Next 30 Days)</CardTitle>
                            <Button variant="outline" size="sm" onClick={onRefresh}>
                                Refresh
                            </Button>
                        </CardHeader>
                        <CardContent>
                            {summary.upcoming_payments && summary.upcoming_payments.length > 0 ? (
                                <div className="space-y-4">
                                    {summary.upcoming_payments.map((payment, index) => (
                                        <div key={index} className="flex items-center justify-between p-3 border rounded-lg">
                                            <div className="space-y-1">
                                                <div className="font-semibold">{payment.loan_name}</div>
                                                <div className="text-sm text-muted-foreground">
                                                    {payment.lender} • {formatDate(payment.payment_date)}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="font-semibold">
                                                    {formatCurrency(payment.payment_amount)}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    No payments due in the next 30 days
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Loans by Type */}
                <div>
                    <Card>
                        <CardHeader>
                            <CardTitle>Loans by Type</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {summary.loans_by_type && summary.loans_by_type.length > 0 ? (
                                <div className="space-y-4">
                                    {summary.loans_by_type.map((type, index) => (
                                        <div key={index} className="space-y-2">
                                            <div className="flex items-center justify-between">
                                                <div className="space-y-1">
                                                    <div className="font-semibold capitalize">
                                                        {type.loan_type.replace('_', ' ')}
                                                    </div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {type.count} loan{type.count !== 1 ? 's' : ''}
                                                    </div>
                                                </div>
                                                <div className="text-right space-y-1">
                                                    <div className="font-semibold">
                                                        {formatCurrency(type.total_balance)}
                                                    </div>
                                                    <div className="text-sm text-muted-foreground">
                                                        {formatPercent(type.avg_interest_rate)} avg
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-muted-foreground">
                                    No loan type data available
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>
            </div>

            {/* Portfolio Metrics */}
            {summary.total_current_balance > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Portfolio Metrics</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                                    Debt-to-Asset Ratio
                                </div>
                                <div className="text-2xl font-bold">
                                    {summary.total_principal > 0 ? 
                                        `${((summary.total_current_balance / summary.total_principal) * 100).toFixed(1)}%` : 
                                        '0%'}
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                                    Annual Debt Service
                                </div>
                                <div className="text-2xl font-bold">
                                    {formatCurrency(summary.total_annual_payments)}
                                </div>
                            </div>
                            
                            <div className="space-y-2">
                                <div className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                                    Principal Paid Down
                                </div>
                                <div className="text-2xl font-bold text-green-600">
                                    {formatCurrency(summary.total_principal - summary.total_current_balance)}
                                </div>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};

export default LoanSummary;