import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { DataTable } from '../../ui/data-table';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import ExpenseGrid from './ExpenseGrid';

const ExpenseManagement = () => {
    const { state: { activeScenario }, actions, loading } = useForecast();
    
    const [expenses, setExpenses] = useState([]);
    const [expenseCategories, setExpenseCategories] = useState([]);
    const [expenseSummary, setExpenseSummary] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        loadExpenses();
        loadExpenseCategories();
        loadExpenseSummary();
    }, []);

    const loadExpenses = async () => {
        actions.setLoading(true);
        try {
            const response = await api.get(`/expenses/${activeScenario ? `?forecast_id=${activeScenario}` : ''}`, { suppressErrorToast: true });
            setExpenses(response.data.expenses || []);
        } catch (error) {
            console.error('Error loading expenses:', error);
            actions.setError('Failed to load expenses');
        } finally {
            actions.setLoading(false);
        }
    };

    const loadExpenseCategories = async () => {
        try {
            const response = await api.get('/expenses/categories', { suppressErrorToast: true });
            setExpenseCategories(response.data.categories || []);
        } catch (error) {
            console.error('Error loading expense categories:', error);
        }
    };

    const loadExpenseSummary = async () => {
        try {
            const response = await api.get(`/expenses/summary${activeScenario ? `?forecast_id=${activeScenario}` : ''}`, { suppressErrorToast: true });
            setExpenseSummary(response.data);
        } catch (error) {
            console.error('Error loading expense summary:', error);
        }
    };

    const formatCurrency = (amount) => {
        if (!amount) return '$0';
        return new Intl.NumberFormat('en-US', {
            style: 'currency',
            currency: 'USD',
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(amount);
    };

    const getFrequencyVariant = (frequency) => {
        const variants = {
            'monthly': 'default',
            'quarterly': 'secondary',
            'annually': 'success',
            'one_time': 'warning'
        };
        return variants[frequency] || 'default';
    };

    const getCategoryVariant = (categoryType) => {
        const variants = {
            'factory_overhead': 'info',
            'admin_expense': 'warning',
            'cogs': 'success'
        };
        return variants[categoryType] || 'default';
    };

    const expenseColumns = [
        {
            key: 'expense_name',
            title: 'Expense Name',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{value}</div>
                    <div className="text-sm text-muted-foreground">
                        ID: {row.expense_id}
                    </div>
                </div>
            )
        },
        {
            key: 'category_name',
            title: 'Category',
            render: (value, row) => (
                <div className="space-y-2">
                    <Badge variant={getCategoryVariant(row.category_type)}>
                        {value}
                    </Badge>
                    <div className="text-sm text-muted-foreground capitalize">
                        {row.category_type?.replace('_', ' ')}
                    </div>
                </div>
            )
        },
        {
            key: 'amount',
            title: 'Amount',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{formatCurrency(value)}</div>
                    <Badge variant={getFrequencyVariant(row.frequency)}>
                        {row.frequency}
                    </Badge>
                </div>
            )
        },
        {
            key: 'vendor',
            title: 'Vendor',
            render: (value) => value || 'N/A'
        },
        {
            key: 'start_date',
            title: 'Start Date',
            type: 'date'
        },
        {
            key: 'is_active',
            title: 'Status',
            render: (value) => (
                <Badge variant={value ? 'success' : 'secondary'}>
                    {value ? 'Active' : 'Inactive'}
                </Badge>
            )
        }
    ];

    const handleEditExpense = (expense) => {
        // Handle edit expense
        toast.success('Edit expense functionality to be implemented');
    };

    const handleDeleteExpense = (expenseId) => {
        // Handle delete expense
        toast.success('Delete expense functionality to be implemented');
    };

    const headerActions = [
        {
            label: 'Add New Expense',
            onClick: () => toast.success('Add expense modal to be implemented'),
            variant: 'default'
        },
        {
            label: 'Manage Categories',
            onClick: () => toast.success('Category management to be implemented'),
            variant: 'outline'
        }
    ];

    return (
        <div className="container mx-auto px-6 py-8">
            <PageHeader
                title="Expense Management"
                description="Manage your business expenses, categories, and track spending patterns"
                actions={headerActions}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview">Overview</TabsTrigger>
                    <TabsTrigger value="expenses">Expenses</TabsTrigger>
                    <TabsTrigger value="grid">Grid Editor</TabsTrigger>
                    <TabsTrigger value="categories">Categories</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    {expenseSummary && (
                        <div className="space-y-6">
                            {/* Summary Cards */}
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatsCard
                                    title="Total Monthly"
                                    value={formatCurrency(expenseSummary.total_monthly)}
                                    variant="primary"
                                />
                                <StatsCard
                                    title="Total Annual"
                                    value={formatCurrency(expenseSummary.total_annual)}
                                    variant="success"
                                />
                                <StatsCard
                                    title="Factory Overhead"
                                    value={formatCurrency(expenseSummary.factory_overhead_total)}
                                    variant="info"
                                />
                                <StatsCard
                                    title="Admin Expenses"
                                    value={formatCurrency(expenseSummary.admin_expense_total)}
                                    variant="warning"
                                />
                            </div>

                            {/* Charts and detailed views would go here */}
                            <Card>
                                <CardHeader>
                                    <CardTitle>Upcoming Payments</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="text-center text-muted-foreground py-8">
                                        Upcoming payments chart will be displayed here
                                    </div>
                                </CardContent>
                            </Card>
                        </div>
                    )}
                </TabsContent>

                <TabsContent value="expenses" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>All Expenses ({expenses.length})</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                data={expenses}
                                columns={expenseColumns}
                                onEdit={handleEditExpense}
                                onDelete={handleDeleteExpense}
                                emptyMessage="No expenses found. Click 'Add New Expense' to get started."
                            />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="grid" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Inline Expense Editor</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <ExpenseGrid expenses={expenses} onRefresh={loadExpenses} />
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="categories" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Expense Categories</CardTitle>
                        </CardHeader>
                        <CardContent>
                            <div className="text-center text-muted-foreground py-8">
                                Category management interface will be displayed here
                            </div>
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>
        </div>
    );
};

export default ExpenseManagement;