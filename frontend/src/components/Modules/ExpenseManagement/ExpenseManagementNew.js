import React, { useState, useEffect, useCallback } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { useConfirm } from '../../Common/ConfirmDialog';
import api, { showErrorToast } from '../../../lib/apiClient';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';
import { StatsCard } from '../../ui/stats-card';
import { DataTable } from '../../ui/data-table';
import { Button } from '../../ui/button';
import { Badge } from '../../ui/badge';
import ExpenseGrid from './ExpenseGrid';
import { ExpenseModal, CategoryModal } from './ExpenseModals';

const formatCurrency = (amount) => {
    if (!amount) return '$0';
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(amount);
};

const ExpenseManagement = () => {
    const { state: { activeScenario }, scenarios, actions, loading } = useForecast();
    const confirm = useConfirm();
    const activeScenarioName = activeScenario && scenarios?.[activeScenario] ? scenarios[activeScenario].name : '';

    const [expenses, setExpenses] = useState([]);
    const [expenseCategories, setExpenseCategories] = useState([]);
    const [expenseSummary, setExpenseSummary] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [expenseModal, setExpenseModal] = useState({ open: false, expense: null });
    const [showCategoryModal, setShowCategoryModal] = useState(false);
    const [scopeFilter, setScopeFilter] = useState('');

    const scenarioQuery = activeScenario ? `?forecast_id=${encodeURIComponent(activeScenario)}` : '';

    const loadExpenses = useCallback(async () => {
        actions.setLoading(true);
        try {
            const response = await api.get(`/expenses/${scenarioQuery}`, { suppressErrorToast: true });
            setExpenses(response.data.expenses || []);
        } catch (error) {
            console.error('Error loading expenses:', error);
            actions.setError('Failed to load expenses');
        } finally {
            actions.setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [scenarioQuery]);

    const loadExpenseCategories = useCallback(async () => {
        try {
            const response = await api.get('/expenses/categories', { suppressErrorToast: true });
            setExpenseCategories(response.data.categories || []);
        } catch (error) {
            console.error('Error loading expense categories:', error);
        }
    }, []);

    const loadExpenseSummary = useCallback(async () => {
        try {
            const response = await api.get(`/expenses/summary${scenarioQuery}`, { suppressErrorToast: true });
            setExpenseSummary(response.data);
        } catch (error) {
            console.error('Error loading expense summary:', error);
        }
    }, [scenarioQuery]);

    const reload = useCallback(async () => {
        await Promise.all([loadExpenses(), loadExpenseSummary()]);
    }, [loadExpenses, loadExpenseSummary]);

    useEffect(() => {
        loadExpenseCategories();
    }, [loadExpenseCategories]);

    // Reload whenever the active scenario changes: the list is
    // company-wide rows plus rows pinned to that scenario.
    useEffect(() => {
        reload();
    }, [reload]);

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

    const visibleExpenses = expenses.filter(e => {
        if (scopeFilter === 'company') return !e.forecast_id;
        if (scopeFilter === 'scenario') return Boolean(e.forecast_id);
        return true;
    });

    const expenseColumns = [
        {
            key: 'expense_name',
            title: 'Expense Name',
            render: (value, row) => (
                <div className="space-y-1">
                    <div className="font-semibold">{value}</div>
                    <div className="text-sm text-muted-foreground">
                        {row.vendor || row.expense_id}
                    </div>
                </div>
            )
        },
        {
            key: 'forecast_id',
            title: 'Scope',
            render: (value) => (
                value
                    ? <Badge variant="warning" title={`Only in scenario ${value}`}>{value === activeScenario ? 'This scenario' : value}</Badge>
                    : <Badge variant="secondary" title="Included in every scenario">Company-wide</Badge>
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
                    <div className="font-semibold tabular-nums">{formatCurrency(value)}</div>
                    <Badge variant={getFrequencyVariant(row.frequency)}>
                        {row.frequency}
                    </Badge>
                </div>
            )
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

    const handleSaveExpense = async (values) => {
        // The context action shows the one toast (or the server's reason);
        // on failure the form stays open.
        try {
            if (expenseModal.expense) {
                await actions.updateExpense(expenseModal.expense.expense_id, values);
            } else {
                await actions.createExpense(values);
            }
            setExpenseModal({ open: false, expense: null });
            await reload();
        } catch (error) {
            console.error('Error saving expense:', error);
        }
    };

    const handleDeleteExpense = async (expense) => {
        const expenseId = typeof expense === 'string' ? expense : expense?.expense_id;
        const row = expenses.find(e => e.expense_id === expenseId);
        const ok = await confirm({
            title: `Delete "${row?.expense_name || expenseId}"?`,
            body: row && !row.forecast_id
                ? 'This expense is company-wide, so it disappears from every scenario.'
                : 'This removes the expense and its period allocations from this scenario.',
            confirmLabel: 'Delete',
            variant: 'destructive',
        });
        if (!ok) return;
        try {
            await actions.deleteExpense(expenseId);
            await reload();
        } catch (error) {
            console.error('Error deleting expense:', error);
        }
    };

    const handleSaveCategory = async (values) => {
        try {
            await api.post('/expenses/categories', values, { suppressErrorToast: true, suppressSuccessToast: true });
            toast.success(`Category "${values.category_name}" created`);
            setShowCategoryModal(false);
            await loadExpenseCategories();
        } catch (error) {
            showErrorToast(error, 'Could not create category');
        }
    };

    const headerActions = [
        {
            label: 'Add New Expense',
            onClick: () => setExpenseModal({ open: true, expense: null }),
            variant: 'default'
        },
        {
            label: 'Add Category',
            onClick: () => setShowCategoryModal(true),
            variant: 'outline'
        }
    ];

    return (
        <div className="container mx-auto px-6 py-8">
            <PageHeader
                title="Expense Management"
                description="Operating expenses by category. Company-wide expenses apply to every scenario; scenario-only expenses apply to one."
                actions={headerActions}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-4">
                    <TabsTrigger value="overview" data-state={activeTab === 'overview' ? 'active' : 'inactive'} onClick={() => setActiveTab('overview')}>Overview</TabsTrigger>
                    <TabsTrigger value="expenses" data-state={activeTab === 'expenses' ? 'active' : 'inactive'} onClick={() => setActiveTab('expenses')}>Expenses</TabsTrigger>
                    <TabsTrigger value="grid" data-state={activeTab === 'grid' ? 'active' : 'inactive'} onClick={() => setActiveTab('grid')}>Grid Editor</TabsTrigger>
                    <TabsTrigger value="categories" data-state={activeTab === 'categories' ? 'active' : 'inactive'} onClick={() => setActiveTab('categories')}>Categories</TabsTrigger>
                </TabsList>

                {activeTab === 'overview' && (
                <TabsContent value="overview" className="space-y-6">
                    {expenseSummary && (
                        <div className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <StatsCard
                                    title="Monthly run rate"
                                    value={formatCurrency(expenseSummary.total_monthly)}
                                    variant="primary"
                                />
                                <StatsCard
                                    title="Annual total"
                                    value={formatCurrency(expenseSummary.total_annual)}
                                    variant="success"
                                />
                                <StatsCard
                                    title="Factory overhead (annual)"
                                    value={formatCurrency(expenseSummary.factory_overhead_total)}
                                    variant="info"
                                />
                                <StatsCard
                                    title="Admin expense (annual)"
                                    value={formatCurrency(expenseSummary.admin_expense_total)}
                                    variant="warning"
                                />
                            </div>
                            <Card>
                                <CardContent className="py-4 text-sm text-gray-700">
                                    {expenseSummary.expense_count} active expenses in view:{' '}
                                    <span className="font-medium">{expenseSummary.company_wide_count} company-wide</span>
                                    {activeScenario && (
                                        <> and <span className="font-medium">{expenseSummary.scenario_count} only in {activeScenarioName || activeScenario}</span></>
                                    )}.
                                    These are the expenses the income statement uses for this scenario.
                                </CardContent>
                            </Card>
                        </div>
                    )}
                    {!expenseSummary && !loading && (
                        <Card className="p-8 text-center text-muted-foreground">No expense summary available.</Card>
                    )}
                </TabsContent>
                )}

                {activeTab === 'expenses' && (
                <TabsContent value="expenses" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <CardTitle>Expenses ({visibleExpenses.length})</CardTitle>
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">Scope:</span>
                                    <select
                                        value={scopeFilter}
                                        onChange={(e) => setScopeFilter(e.target.value)}
                                        className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                                    >
                                        <option value="">Company-wide + this scenario</option>
                                        <option value="company">Company-wide only</option>
                                        <option value="scenario">This scenario only</option>
                                    </select>
                                </div>
                            </div>
                        </CardHeader>
                        <CardContent>
                            <DataTable
                                data={visibleExpenses}
                                columns={expenseColumns}
                                onEdit={(row) => setExpenseModal({ open: true, expense: row })}
                                onDelete={handleDeleteExpense}
                                emptyMessage="No expenses found. Click 'Add New Expense' to get started."
                            />
                        </CardContent>
                    </Card>
                </TabsContent>
                )}

                {activeTab === 'grid' && (
                <TabsContent value="grid" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle>Inline Expense Editor</CardTitle>
                            <p className="text-sm text-muted-foreground">Click a cell to edit. Changes save when you press Enter or leave the cell.</p>
                        </CardHeader>
                        <CardContent>
                            <ExpenseGrid expenses={expenses} onRefresh={reload} />
                        </CardContent>
                    </Card>
                </TabsContent>
                )}

                {activeTab === 'categories' && (
                <TabsContent value="categories" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <div className="flex items-center justify-between">
                                <CardTitle>Expense Categories ({expenseCategories.length})</CardTitle>
                                <Button size="sm" variant="outline" onClick={() => setShowCategoryModal(true)}>Add Category</Button>
                            </div>
                        </CardHeader>
                        <CardContent>
                            {expenseCategories.length === 0 ? (
                                <div className="text-center text-muted-foreground py-8">No categories yet.</div>
                            ) : (
                                <table className="min-w-full text-sm">
                                    <thead className="text-left text-xs uppercase tracking-wide text-gray-500">
                                        <tr>
                                            <th className="py-2 pr-4">Name</th>
                                            <th className="py-2 pr-4">Type</th>
                                            <th className="py-2 pr-4">Account code</th>
                                            <th className="py-2">Description</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-100">
                                        {expenseCategories.map(cat => (
                                            <tr key={cat.category_id}>
                                                <td className="py-2 pr-4 font-medium">{cat.category_name}</td>
                                                <td className="py-2 pr-4"><Badge variant={getCategoryVariant(cat.category_type)}>{cat.category_type?.replace('_', ' ')}</Badge></td>
                                                <td className="py-2 pr-4 text-muted-foreground">{cat.account_code || '—'}</td>
                                                <td className="py-2 text-muted-foreground">{cat.description || ''}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
                )}
            </Tabs>

            {expenseModal.open && (
                <ExpenseModal
                    expense={expenseModal.expense}
                    categories={expenseCategories}
                    activeScenario={activeScenario}
                    activeScenarioName={activeScenarioName}
                    onSave={handleSaveExpense}
                    onClose={() => setExpenseModal({ open: false, expense: null })}
                />
            )}

            {showCategoryModal && (
                <CategoryModal
                    categories={expenseCategories}
                    onSave={handleSaveCategory}
                    onClose={() => setShowCategoryModal(false)}
                />
            )}
        </div>
    );
};

export default ExpenseManagement;
