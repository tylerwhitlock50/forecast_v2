import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './ForecastingWizard.css';

const API_BASE = 'http://localhost:8000';

const ForecastingWizard = ({ onComplete, onCancel }) => {
  const [currentStep, setCurrentStep] = useState(1);
  const [formData, setFormData] = useState({
    // Step 1: Revenue
    revenue: {
      customer: '',
      product: '',
      forecastType: 'flat', // 'flat' or 'monthly'
      flatAmount: '',
      monthlyData: [],
      growthRate: 0,
      periods: 12
    },
    // Step 2: Bill of Materials
    bom: {
      product: '',
      materialCost: '',
      routerId: ''
    },
    // Step 3: Labor
    labor: {
      employeeName: '',
      weeklyHours: '',
      hourlyRate: '',
      laborType: '',
      startDate: '',
      endDate: ''
    },
    // Step 4: Recurring Expenses
    recurring: {
      expenseName: '',
      amount: '',
      frequency: 'monthly', // 'monthly', 'quarterly', 'yearly'
      startDate: '',
      endDate: ''
    },
    // Step 5: Loans
    loans: {
      loanName: '',
      principal: '',
      interestRate: '',
      term: '',
      startDate: ''
    },
    // Step 6: Non-Recurring Expenses
    nonRecurring: {
      expenseName: '',
      amount: '',
      date: ''
    }
  });

  const [availableData, setAvailableData] = useState({
    customers: [],
    products: [],
    routers: []
  });

  useEffect(() => {
    fetchAvailableData();
  }, []);

  const fetchAvailableData = async () => {
    try {
      const [customersRes, productsRes, routersRes] = await Promise.all([
        axios.get(`${API_BASE}/data/customers`),
        axios.get(`${API_BASE}/data/units`),
        axios.get(`${API_BASE}/data/routers`)
      ]);

      setAvailableData({
        customers: customersRes.data.data || [],
        products: productsRes.data.data || [],
        routers: routersRes.data.data || []
      });
    } catch (error) {
      console.error('Error fetching available data:', error);
    }
  };

  const updateFormData = (step, field, value) => {
    setFormData(prev => ({
      ...prev,
      [step]: {
        ...prev[step],
        [field]: value
      }
    }));
  };

  const nextStep = () => {
    if (currentStep < 6) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSubmit = async () => {
    try {
      // Submit all form data to the backend
      const response = await axios.post(`${API_BASE}/forecast/create`, formData);
      if (response.data.status === 'success') {
        onComplete();
      }
    } catch (error) {
      console.error('Error creating forecast:', error);
      alert('Error creating forecast. Please try again.');
    }
  };

  const renderStep1 = () => (
    <div className="wizard-step">
      <h3>Step 1: Revenue Forecast</h3>
      <div className="form-group">
        <label>Customer</label>
        <select 
          value={formData.revenue.customer}
          onChange={(e) => updateFormData('revenue', 'customer', e.target.value)}
          className="input"
        >
          <option value="">Select Customer</option>
          {availableData.customers.map(customer => (
            <option key={customer.customer_id} value={customer.customer_id}>
              {customer.customer_name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Product</label>
        <select 
          value={formData.revenue.product}
          onChange={(e) => updateFormData('revenue', 'product', e.target.value)}
          className="input"
        >
          <option value="">Select Product</option>
          {availableData.products.map(product => (
            <option key={product.unit_id} value={product.unit_id}>
              {product.unit_name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Forecast Type</label>
        <div className="radio-group">
          <label>
            <input
              type="radio"
              value="flat"
              checked={formData.revenue.forecastType === 'flat'}
              onChange={(e) => updateFormData('revenue', 'forecastType', e.target.value)}
            />
            Flat Amount
          </label>
          <label>
            <input
              type="radio"
              value="monthly"
              checked={formData.revenue.forecastType === 'monthly'}
              onChange={(e) => updateFormData('revenue', 'forecastType', e.target.value)}
            />
            Monthly Breakdown
          </label>
        </div>
      </div>

      {formData.revenue.forecastType === 'flat' ? (
        <div className="form-group">
          <label>Monthly Revenue Amount</label>
          <input
            type="number"
            value={formData.revenue.flatAmount}
            onChange={(e) => updateFormData('revenue', 'flatAmount', e.target.value)}
            className="input"
            placeholder="Enter monthly amount"
          />
        </div>
      ) : (
        <div className="form-group">
          <label>Monthly Growth Rate (%)</label>
          <input
            type="number"
            value={formData.revenue.growthRate}
            onChange={(e) => updateFormData('revenue', 'growthRate', e.target.value)}
            className="input"
            placeholder="Enter growth rate"
          />
        </div>
      )}

      <div className="form-group">
        <label>Number of Periods</label>
        <input
          type="number"
          value={formData.revenue.periods}
          onChange={(e) => updateFormData('revenue', 'periods', e.target.value)}
          className="input"
          min="1"
          max="60"
        />
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="wizard-step">
      <h3>Step 2: Bill of Materials</h3>
      <div className="form-group">
        <label>Product</label>
        <select 
          value={formData.bom.product}
          onChange={(e) => updateFormData('bom', 'product', e.target.value)}
          className="input"
        >
          <option value="">Select Product</option>
          {availableData.products.map(product => (
            <option key={product.unit_id} value={product.unit_id}>
              {product.unit_name}
            </option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label>Material Cost</label>
        <input
          type="number"
          value={formData.bom.materialCost}
          onChange={(e) => updateFormData('bom', 'materialCost', e.target.value)}
          className="input"
          placeholder="Enter material cost"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Router ID</label>
        <input
          type="text"
          value={formData.bom.routerId}
          onChange={(e) => updateFormData('bom', 'routerId', e.target.value)}
          className="input"
          placeholder="Enter router ID"
        />
      </div>
    </div>
  );

  const renderStep3 = () => (
    <div className="wizard-step">
      <h3>Step 3: Labor</h3>
      <div className="form-group">
        <label>Employee Name</label>
        <input
          type="text"
          value={formData.labor.employeeName}
          onChange={(e) => updateFormData('labor', 'employeeName', e.target.value)}
          className="input"
          placeholder="Enter employee name"
        />
      </div>

      <div className="form-group">
        <label>Weekly Hours</label>
        <input
          type="number"
          value={formData.labor.weeklyHours}
          onChange={(e) => updateFormData('labor', 'weeklyHours', e.target.value)}
          className="input"
          placeholder="Enter weekly hours"
        />
      </div>

      <div className="form-group">
        <label>Hourly Rate</label>
        <input
          type="number"
          value={formData.labor.hourlyRate}
          onChange={(e) => updateFormData('labor', 'hourlyRate', e.target.value)}
          className="input"
          placeholder="Enter hourly rate"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Labor Type</label>
        <select 
          value={formData.labor.laborType}
          onChange={(e) => updateFormData('labor', 'laborType', e.target.value)}
          className="input"
        >
          <option value="">Select Labor Type</option>
          <option value="direct">Direct</option>
          <option value="indirect">Indirect</option>
          <option value="overhead">Overhead</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Start Date</label>
          <input
            type="date"
            value={formData.labor.startDate}
            onChange={(e) => updateFormData('labor', 'startDate', e.target.value)}
            className="input"
          />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input
            type="date"
            value={formData.labor.endDate}
            onChange={(e) => updateFormData('labor', 'endDate', e.target.value)}
            className="input"
          />
        </div>
      </div>
    </div>
  );

  const renderStep4 = () => (
    <div className="wizard-step">
      <h3>Step 4: Recurring Expenses</h3>
      <div className="form-group">
        <label>Expense Name</label>
        <input
          type="text"
          value={formData.recurring.expenseName}
          onChange={(e) => updateFormData('recurring', 'expenseName', e.target.value)}
          className="input"
          placeholder="Enter expense name"
        />
      </div>

      <div className="form-group">
        <label>Amount</label>
        <input
          type="number"
          value={formData.recurring.amount}
          onChange={(e) => updateFormData('recurring', 'amount', e.target.value)}
          className="input"
          placeholder="Enter amount"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Frequency</label>
        <select 
          value={formData.recurring.frequency}
          onChange={(e) => updateFormData('recurring', 'frequency', e.target.value)}
          className="input"
        >
          <option value="monthly">Monthly</option>
          <option value="quarterly">Quarterly</option>
          <option value="yearly">Yearly</option>
        </select>
      </div>

      <div className="form-row">
        <div className="form-group">
          <label>Start Date</label>
          <input
            type="date"
            value={formData.recurring.startDate}
            onChange={(e) => updateFormData('recurring', 'startDate', e.target.value)}
            className="input"
          />
        </div>
        <div className="form-group">
          <label>End Date</label>
          <input
            type="date"
            value={formData.recurring.endDate}
            onChange={(e) => updateFormData('recurring', 'endDate', e.target.value)}
            className="input"
          />
        </div>
      </div>
    </div>
  );

  const renderStep5 = () => (
    <div className="wizard-step">
      <h3>Step 5: Loans</h3>
      <div className="form-group">
        <label>Loan Name</label>
        <input
          type="text"
          value={formData.loans.loanName}
          onChange={(e) => updateFormData('loans', 'loanName', e.target.value)}
          className="input"
          placeholder="Enter loan name"
        />
      </div>

      <div className="form-group">
        <label>Principal Amount</label>
        <input
          type="number"
          value={formData.loans.principal}
          onChange={(e) => updateFormData('loans', 'principal', e.target.value)}
          className="input"
          placeholder="Enter principal amount"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Interest Rate (%)</label>
        <input
          type="number"
          value={formData.loans.interestRate}
          onChange={(e) => updateFormData('loans', 'interestRate', e.target.value)}
          className="input"
          placeholder="Enter interest rate"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Term (months)</label>
        <input
          type="number"
          value={formData.loans.term}
          onChange={(e) => updateFormData('loans', 'term', e.target.value)}
          className="input"
          placeholder="Enter term in months"
        />
      </div>

      <div className="form-group">
        <label>Start Date</label>
        <input
          type="date"
          value={formData.loans.startDate}
          onChange={(e) => updateFormData('loans', 'startDate', e.target.value)}
          className="input"
        />
      </div>
    </div>
  );

  const renderStep6 = () => (
    <div className="wizard-step">
      <h3>Step 6: Non-Recurring Expenses</h3>
      <div className="form-group">
        <label>Expense Name</label>
        <input
          type="text"
          value={formData.nonRecurring.expenseName}
          onChange={(e) => updateFormData('nonRecurring', 'expenseName', e.target.value)}
          className="input"
          placeholder="Enter expense name"
        />
      </div>

      <div className="form-group">
        <label>Amount</label>
        <input
          type="number"
          value={formData.nonRecurring.amount}
          onChange={(e) => updateFormData('nonRecurring', 'amount', e.target.value)}
          className="input"
          placeholder="Enter amount"
          step="0.01"
        />
      </div>

      <div className="form-group">
        <label>Date</label>
        <input
          type="date"
          value={formData.nonRecurring.date}
          onChange={(e) => updateFormData('nonRecurring', 'date', e.target.value)}
          className="input"
        />
      </div>
    </div>
  );

  const renderStep = () => {
    switch (currentStep) {
      case 1: return renderStep1();
      case 2: return renderStep2();
      case 3: return renderStep3();
      case 4: return renderStep4();
      case 5: return renderStep5();
      case 6: return renderStep6();
      default: return null;
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal wizard-modal">
        <div className="wizard-header">
          <h2>Forecasting Wizard</h2>
          <button className="btn btn-secondary btn-sm" onClick={onCancel}>
            ✕
          </button>
        </div>

        <div className="wizard-progress">
          {[1, 2, 3, 4, 5, 6].map(step => (
            <div 
              key={step} 
              className={`progress-step ${step === currentStep ? 'active' : ''} ${step < currentStep ? 'completed' : ''}`}
            >
              <div className="step-number">{step}</div>
              <div className="step-label">
                {step === 1 && 'Revenue'}
                {step === 2 && 'BOM'}
                {step === 3 && 'Labor'}
                {step === 4 && 'Recurring'}
                {step === 5 && 'Loans'}
                {step === 6 && 'Non-Recurring'}
              </div>
            </div>
          ))}
        </div>

        <div className="wizard-content">
          {renderStep()}
        </div>

        <div className="wizard-actions">
          {currentStep > 1 && (
            <button className="btn btn-secondary" onClick={prevStep}>
              Previous
            </button>
          )}
          
          {currentStep < 6 ? (
            <button className="btn btn-primary" onClick={nextStep}>
              Next
            </button>
          ) : (
            <button className="btn btn-success" onClick={handleSubmit}>
              Create Forecast
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default ForecastingWizard; 