import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import LoanTableNew from './LoanTableNew';
import LoanSummaryNew from './LoanSummaryNew';
import LoanModalNew from './LoanModalNew';
import AmortizationScheduleModalNew from './AmortizationScheduleModalNew';

const LoanManagement = () => {
    const { actions, loading } = useForecast();

    const [loans, setLoans] = useState([]);
    const [loanSummary, setLoanSummary] = useState(null);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [amortizationSchedule, setAmortizationSchedule] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');

    useEffect(() => {
        loadLoans();
        loadLoanSummary();
    }, []);

    const loadLoans = async () => {
        actions.setLoading(true);
        try {
            const response = await fetch('/api/loans/');
            const data = await response.json();
            
            if (data.status === 'success') {
                setLoans(data.data.loans || []);
            } else {
                actions.setError('Failed to load loans');
            }
        } catch (error) {
            console.error('Error loading loans:', error);
            actions.setError('Failed to load loans');
        } finally {
            actions.setLoading(false);
        }
    };

    const loadLoanSummary = async () => {
        try {
            const response = await fetch('/api/loans/summary');
            const data = await response.json();
            
            if (data.status === 'success') {
                setLoanSummary(data.data);
            }
        } catch (error) {
            console.error('Error loading loan summary:', error);
        }
    };

    const handleCreateLoan = () => {
        setSelectedLoan(null);
        setIsModalOpen(true);
    };

    const handleEditLoan = (loan) => {
        setSelectedLoan(loan);
        setIsModalOpen(true);
    };

    const handleSaveLoan = async (loanData) => {
        actions.setLoading(true);
        try {
            const url = selectedLoan ? `/api/loans/${selectedLoan.loan_id}` : '/api/loans/';
            const method = selectedLoan ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(loanData),
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                toast.success(selectedLoan ? 'Loan updated successfully' : 'Loan created successfully');
                setIsModalOpen(false);
                loadLoans();
                loadLoanSummary();
                actions.fetchAllData();
            } else {
                actions.setError(result.message || 'Failed to save loan');
            }
        } catch (error) {
            console.error('Error saving loan:', error);
            actions.setError('Failed to save loan');
        } finally {
            actions.setLoading(false);
        }
    };

    const handleDeleteLoan = async (loanId) => {
        if (!window.confirm('Are you sure you want to delete this loan? This will also delete all payment schedule data.')) {
            return;
        }

        actions.setLoading(true);
        try {
            const response = await fetch(`/api/loans/${loanId}`, {
                method: 'DELETE',
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                toast.success('Loan deleted successfully');
                loadLoans();
                loadLoanSummary();
                actions.fetchAllData();
            } else {
                actions.setError('Failed to delete loan');
            }
        } catch (error) {
            console.error('Error deleting loan:', error);
            actions.setError('Failed to delete loan');
        } finally {
            actions.setLoading(false);
        }
    };

    const handleViewSchedule = async (loanId) => {
        actions.setLoading(true);
        try {
            const response = await fetch(`/api/loans/${loanId}/schedule`);
            const data = await response.json();
            
            if (data.status === 'success') {
                setAmortizationSchedule(data.data);
                setIsScheduleModalOpen(true);
            } else {
                actions.setError('Failed to load amortization schedule');
            }
        } catch (error) {
            console.error('Error loading amortization schedule:', error);
            actions.setError('Failed to load amortization schedule');
        } finally {
            actions.setLoading(false);
        }
    };

    const headerActions = [
        {
            label: 'Add New Loan',
            onClick: handleCreateLoan,
            variant: 'default'
        }
    ];

    return (
        <div className="container mx-auto px-6 py-8">
            <PageHeader
                title="Loan Management"
                description="Manage your loan portfolio, view amortization schedules, and track payment obligations"
                actions={headerActions}
            />

            <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="overview">Portfolio Overview</TabsTrigger>
                    <TabsTrigger value="loans">Loan Details</TabsTrigger>
                </TabsList>

                <TabsContent value="overview" className="space-y-6">
                    {loanSummary && (
                        <LoanSummaryNew 
                            summary={loanSummary}
                            onRefresh={loadLoanSummary}
                        />
                    )}
                </TabsContent>

                <TabsContent value="loans" className="space-y-6">
                    <LoanTableNew
                        loans={loans}
                        onEdit={handleEditLoan}
                        onDelete={handleDeleteLoan}
                        onViewSchedule={handleViewSchedule}
                    />
                </TabsContent>
            </Tabs>

            {isModalOpen && (
                <LoanModalNew
                    loan={selectedLoan}
                    onSave={handleSaveLoan}
                    onClose={() => setIsModalOpen(false)}
                />
            )}

            {isScheduleModalOpen && amortizationSchedule && (
                <AmortizationScheduleModalNew
                    schedule={amortizationSchedule}
                    onClose={() => setIsScheduleModalOpen(false)}
                />
            )}
        </div>
    );
};

export default LoanManagement;