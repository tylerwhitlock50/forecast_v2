import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import api from '../../../lib/apiClient';
import { useConfirm } from '../../Common/ConfirmDialog';
import { PageHeader } from '../../ui/page-header';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../ui/tabs';
import LoanTableNew from './LoanTableNew';
import LoanSummaryNew from './LoanSummaryNew';
import LoanModalNew from './LoanModalNew';
import AmortizationScheduleModalNew from './AmortizationScheduleModalNew';
import ScheduleAuditBanner from './ScheduleAuditBanner';
import ScheduleRepairModal from './ScheduleRepairModal';
import ScheduleChangeConfirmModal from './ScheduleChangeConfirmModal';
import { needsSchedulePreview } from './loanScheduleUtils';

const LoanManagement = () => {
    const { actions } = useForecast();
    const confirm = useConfirm();

    const [loans, setLoans] = useState([]);
    const [loanSummary, setLoanSummary] = useState(null);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
    const [amortizationSchedule, setAmortizationSchedule] = useState(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [scheduleAudit, setScheduleAudit] = useState(null);
    const [isRepairOpen, setIsRepairOpen] = useState(false);
    // A loan edit that would rebuild the schedule waits here for confirmation.
    const [pendingUpdate, setPendingUpdate] = useState(null);
    const [savingUpdate, setSavingUpdate] = useState(false);

    useEffect(() => {
        loadLoans();
        loadLoanSummary();
        loadScheduleAudit();
        // Load once on mount; the loaders are defined below and are not memoised.
        // eslint-disable-next-line react-hooks/exhaustive-deps
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

    const loadScheduleAudit = async () => {
        try {
            const response = await api.get('/loans/schedule-audit', { suppressErrorToast: true });
            setScheduleAudit(response.data);
        } catch (error) {
            // The audit is advisory: the screen works without it.
            console.error('Error checking loan schedules:', error);
        }
    };

    const refreshAll = () => {
        loadLoans();
        loadLoanSummary();
        loadScheduleAudit();
        actions.fetchAllData();
    };

    const handleCreateLoan = () => {
        setSelectedLoan(null);
        setIsModalOpen(true);
    };

    const handleEditLoan = (loan) => {
        setSelectedLoan(loan);
        setIsModalOpen(true);
    };

    const saveUpdate = async (loanId, loanData) => {
        // API client shows the server's message ("Loan updated; ...") as a toast.
        await api.put(`/loans/${encodeURIComponent(loanId)}`, loanData);
        setPendingUpdate(null);
        setIsModalOpen(false);
        refreshAll();
    };

    const handleSaveLoan = async (loanData) => {
        actions.setLoading(true);
        try {
            if (selectedLoan) {
                // Ask the API what the edit would do first: a change to the loan
                // terms rebuilds the unpaid installments, so show that before saving.
                const preview = await api.put(`/loans/${encodeURIComponent(selectedLoan.loan_id)}`, loanData, {
                    params: { preview: true }, suppressSuccessToast: true,
                });
                const data = preview.data || {};
                if (!data.changed_fields || data.changed_fields.length === 0) {
                    toast.success('No changes to save', { id: 'loan-no-changes' });
                    setIsModalOpen(false);
                    return;
                }
                if (needsSchedulePreview(data)) {
                    setPendingUpdate({ loanId: selectedLoan.loan_id, loanName: loanData.loan_name, loanData, preview: data });
                    return;
                }
                await saveUpdate(selectedLoan.loan_id, loanData);
            } else {
                await api.post('/loans/', loanData);
                // API client handles success toast
                setIsModalOpen(false);
                refreshAll();
            }
        } catch (error) {
            console.error('Error saving loan:', error);
            actions.setError('Failed to save loan');
        } finally {
            actions.setLoading(false);
        }
    };

    const handleConfirmUpdate = async () => {
        if (!pendingUpdate) return;
        setSavingUpdate(true);
        try {
            await saveUpdate(pendingUpdate.loanId, pendingUpdate.loanData);
        } catch (error) {
            console.error('Error saving loan:', error);
        } finally {
            setSavingUpdate(false);
        }
    };

    const handleDeleteLoan = async (loanId) => {
        const loan = loans.find(l => l.loan_id === loanId);
        const paid = loan?.payments_made || 0;
        if (!(await confirm({
          title: 'Delete loan?',
          body: paid
            ? `This deletes the loan and its whole payment schedule, including ${paid} paid payment${paid === 1 ? '' : 's'}. `
              + 'To retire a loan and keep its history, edit it and untick "Active Loan" instead.'
            : 'This will also delete all payment schedule data.',
          confirmLabel: 'Delete',
          variant: 'destructive',
        }))) {
            return;
        }

        actions.setLoading(true);
        try {
            await api.delete(`/loans/${loanId}`);

            // API client handles success toast
            refreshAll();
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

    const auditByLoan = {};
    (scheduleAudit?.loans || []).forEach(entry => { auditByLoan[entry.loan_id] = entry; });

    return (
        <div className="container mx-auto px-6 py-8">
            <PageHeader
                title="Loan Management"
                description="Manage your loan portfolio, view amortization schedules, and track payment obligations"
                actions={headerActions}
            />

            {scheduleAudit?.loans_with_issues > 0 && (
                <div className="mb-6">
                    <ScheduleAuditBanner audit={scheduleAudit} onReview={() => setIsRepairOpen(true)} />
                </div>
            )}

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
                        auditByLoan={auditByLoan}
                        onEdit={handleEditLoan}
                        onDelete={handleDeleteLoan}
                        onViewSchedule={handleViewSchedule}
                        onReviewSchedule={() => setIsRepairOpen(true)}
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

            {pendingUpdate && (
                <ScheduleChangeConfirmModal
                    loanName={pendingUpdate.loanName}
                    preview={pendingUpdate.preview}
                    saving={savingUpdate}
                    onConfirm={handleConfirmUpdate}
                    onBack={() => setPendingUpdate(null)}
                />
            )}

            {isScheduleModalOpen && amortizationSchedule && (
                <AmortizationScheduleModalNew
                    schedule={amortizationSchedule}
                    onClose={() => setIsScheduleModalOpen(false)}
                />
            )}

            {isRepairOpen && (
                <ScheduleRepairModal
                    audit={scheduleAudit}
                    onClose={() => setIsRepairOpen(false)}
                    onRepaired={refreshAll}
                />
            )}
        </div>
    );
};

export default LoanManagement;
