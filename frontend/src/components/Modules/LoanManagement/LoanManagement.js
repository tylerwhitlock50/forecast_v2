import React, { useState, useEffect } from 'react';
import { useForecast } from '../../../context/ForecastContext';
import { toast } from 'react-hot-toast';
import LoanTable from './LoanTable';
import LoanModal from './LoanModal';
import LoanSummary from './LoanSummary';
import AmortizationScheduleModal from './AmortizationScheduleModal';


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
            console.log('Loading loans...');
            const response = await fetch('/api/loans/');
            console.log('Loans response:', response);
            const data = await response.json();
            console.log('Loans data:', data);
            
            if (data.status === 'success') {
                setLoans(data.data.loans || []);
                console.log('Loans set:', data.data.loans || []);
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
            console.log('Loading loan summary...');
            const response = await fetch('/api/loans/summary');
            console.log('Summary response:', response);
            const data = await response.json();
            console.log('Summary data:', data);
            
            if (data.status === 'success') {
                setLoanSummary(data.data);
                console.log('Loan summary set:', data.data);
            } else {
                console.error('Failed to load loan summary:', data);
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

    return (
        <div className="loan-management">
            <div className="loan-header">
                <h1>Loan Management</h1>
                <div className="loan-actions">
                    <button 
                        className="btn btn-primary"
                        onClick={handleCreateLoan}
                    >
                        Add New Loan
                    </button>
                </div>
            </div>

            <div className="loan-tabs">
                <button 
                    className={`tab-button ${activeTab === 'overview' ? 'active' : ''}`}
                    onClick={() => {
                        console.log('Switching to overview tab');
                        setActiveTab('overview');
                    }}
                >
                    Portfolio Overview
                </button>
                <button 
                    className={`tab-button ${activeTab === 'loans' ? 'active' : ''}`}
                    onClick={() => {
                        console.log('Switching to loans tab');
                        setActiveTab('loans');
                    }}
                >
                    Loan Details
                </button>
            </div>

            <div className="loan-content">
                <div style={{ marginBottom: '10px', padding: '10px', background: '#f0f0f0', borderRadius: '4px' }}>
                    <strong>Debug Info:</strong> Active Tab: {activeTab} | Loans Count: {loans.length} | Summary: {loanSummary ? 'Loaded' : 'Not loaded'}
                </div>
                
                {activeTab === 'overview' && loanSummary && (
                    <LoanSummary 
                        summary={loanSummary}
                        onRefresh={loadLoanSummary}
                    />
                )}
                
                {activeTab === 'overview' && !loanSummary && (
                    <div className="no-data">
                        <p>Loading loan summary...</p>
                        <button onClick={loadLoanSummary}>Retry Load Summary</button>
                    </div>
                )}
                
                {activeTab === 'loans' && (
                    <LoanTable
                        loans={loans}
                        onEdit={handleEditLoan}
                        onDelete={handleDeleteLoan}
                        onViewSchedule={handleViewSchedule}
                    />
                )}
            </div>

            {isModalOpen && (
                <LoanModal
                    loan={selectedLoan}
                    onSave={handleSaveLoan}
                    onClose={() => setIsModalOpen(false)}
                />
            )}

            {isScheduleModalOpen && amortizationSchedule && (
                <AmortizationScheduleModal
                    schedule={amortizationSchedule}
                    onClose={() => setIsScheduleModalOpen(false)}
                />
            )}
        </div>
    );
};

export default LoanManagement;