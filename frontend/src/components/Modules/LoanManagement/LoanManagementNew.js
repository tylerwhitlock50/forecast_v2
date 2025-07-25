import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
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
            const response = await api.get('/loans/', { suppressErrorToast: true });
            setLoans(response.data.loans || []);
        } catch (error) {
            console.error('Error loading loans:', error);
            actions.setError('Failed to load loans');
        } finally {
            actions.setLoading(false);
        }
    };

    const loadLoanSummary = async () => {
        try {
            const response = await api.get('/loans/summary', { suppressErrorToast: true });
            setLoanSummary(response.data);
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
            const response = selectedLoan 
                ? await api.put(`/loans/${selectedLoan.loan_id}`, loanData)
                : await api.post('/loans/', loanData);
            
            // API client handles success toast
            setIsModalOpen(false);
            loadLoans();
            loadLoanSummary();
            actions.fetchAllData();
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
            const response = await api.delete(`/loans/${loanId}`);
            
            // API client handles success toast
            loadLoans();
            loadLoanSummary();
            actions.fetchAllData();
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
            const response = await api.get(`/loans/${loanId}/schedule`, { suppressErrorToast: true });
            
            setAmortizationSchedule(response.data);
            setIsScheduleModalOpen(true);
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