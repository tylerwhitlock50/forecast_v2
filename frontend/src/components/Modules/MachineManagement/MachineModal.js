import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { useForecast } from '../../../context/ForecastContext';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { Textarea } from '../../ui/textarea';

const MachineModal = ({ isOpen, onClose, onSave, machine }) => {
  const { data } = useForecast();
  const [formData, setFormData] = useState({
    machine_id: '',
    machine_name: '',
    machine_description: '',
    machine_rate: '',
    labor_type: '',
    available_minutes_per_month: ''
  });
  const [errors, setErrors] = useState({});

  // Initialize form when modal opens or machine changes
  useEffect(() => {
    if (isOpen) {
      if (machine) {
        // Editing existing machine
        setFormData({
          machine_id: machine.machine_id || '',
          machine_name: machine.machine_name || '',
          machine_description: machine.machine_description || '',
          machine_rate: machine.machine_rate || '',
          labor_type: machine.labor_type || '',
          available_minutes_per_month: machine.available_minutes_per_month || ''
        });
      } else {
        // Creating new machine
        setFormData({
          machine_id: '',
          machine_name: '',
          machine_description: '',
          machine_rate: '',
          labor_type: '',
          available_minutes_per_month: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, machine]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require machine_id for editing existing machines
    if (machine && !formData.machine_id.trim()) {
      newErrors.machine_id = 'Machine ID is required';
    }
    
    if (!formData.machine_name.trim()) {
      newErrors.machine_name = 'Machine name is required';
    }
    
    if (formData.machine_rate && (isNaN(formData.machine_rate) || formData.machine_rate < 0)) {
      newErrors.machine_rate = 'Machine rate must be a valid positive number';
    }
    
    if (formData.available_minutes_per_month && (isNaN(formData.available_minutes_per_month) || formData.available_minutes_per_month < 0)) {
      newErrors.available_minutes_per_month = 'Available minutes must be a valid positive number';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission
  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }

    try {
      // Convert numeric fields to appropriate types
      const dataToSave = {
        ...formData,
        machine_id: formData.machine_id.trim() || null, // Allow null for auto-generation
        machine_rate: formData.machine_rate ? parseFloat(formData.machine_rate) : null,
        available_minutes_per_month: formData.available_minutes_per_month ? parseInt(formData.available_minutes_per_month) : null
      };
      
      await onSave(dataToSave);
    } catch (error) {
      console.error('Error saving machine:', error);
      toast.error('Failed to save machine');
    }
  };

  // Handle input changes
  const handleInputChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    
    // Clear error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  if (!isOpen) return null;

  return (
    <Modal>
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        {/* Modal Header */}
        <ModalHeader>
          <ModalTitle>
            {machine ? 'Edit Machine' : 'Add New Machine'}
          </ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>

        {/* Modal Body */}
        <ModalContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Machine ID */}
            <div>
              <Label htmlFor="machine_id">
                Machine ID {machine ? '*' : ''}
              </Label>
              <Input
                id="machine_id"
                type="text"
                value={formData.machine_id}
                onChange={(e) => handleInputChange('machine_id', e.target.value)}
                className={errors.machine_id ? 'border-red-500' : ''}
                placeholder={machine ? "e.g., WC0001" : "Auto-generated if left empty"}
                disabled={machine} // Disable editing of ID for existing machines
              />
              {errors.machine_id && (
                <p className="mt-1 text-sm text-red-600">{errors.machine_id}</p>
              )}
              {!machine && (
                <p className="mt-1 text-sm text-gray-500">Leave empty to auto-generate</p>
              )}
            </div>

            {/* Machine Name */}
            <div>
              <Label htmlFor="machine_name">
                Machine Name *
              </Label>
              <Input
                id="machine_name"
                type="text"
                value={formData.machine_name}
                onChange={(e) => handleInputChange('machine_name', e.target.value)}
                className={errors.machine_name ? 'border-red-500' : ''}
                placeholder="Enter machine name"
              />
              {errors.machine_name && (
                <p className="mt-1 text-sm text-red-600">{errors.machine_name}</p>
              )}
            </div>

            {/* Machine Description */}
            <div>
              <Label htmlFor="machine_description">
                Machine Description
              </Label>
              <Textarea
                id="machine_description"
                value={formData.machine_description}
                onChange={(e) => handleInputChange('machine_description', e.target.value)}
                placeholder="Enter machine description"
                rows={3}
              />
            </div>

            {/* Labor Type and Machine Rate */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="labor_type">
                  Labor Type
                </Label>
                <Select
                  id="labor_type"
                  value={formData.labor_type}
                  onChange={(e) => handleInputChange('labor_type', e.target.value)}
                >
                  <SelectOption value="">Select Labor Type</SelectOption>
                  {Array.isArray(data.labor_rates) && data.labor_rates.map(rate => (
                    <SelectOption key={rate.rate_id} value={rate.rate_name}>
                      {rate.rate_name} (${rate.rate_amount}/hr)
                    </SelectOption>
                  ))}
                </Select>
              </div>

              <div>
                <Label htmlFor="machine_rate">
                  Machine Rate ($/hour)
                </Label>
                <Input
                  id="machine_rate"
                  type="number"
                  step="0.01"
                  value={formData.machine_rate}
                  onChange={(e) => handleInputChange('machine_rate', e.target.value)}
                  className={errors.machine_rate ? 'border-red-500' : ''}
                  placeholder="0.00"
                />
                {errors.machine_rate && (
                  <p className="mt-1 text-sm text-red-600">{errors.machine_rate}</p>
                )}
              </div>
            </div>

            {/* Available Minutes per Month */}
            <div>
              <Label htmlFor="available_minutes_per_month">
                Available Minutes per Month
              </Label>
              <Input
                id="available_minutes_per_month"
                type="number"
                value={formData.available_minutes_per_month}
                onChange={(e) => handleInputChange('available_minutes_per_month', e.target.value)}
                className={errors.available_minutes_per_month ? 'border-red-500' : ''}
                placeholder="e.g., 12000"
              />
              {errors.available_minutes_per_month && (
                <p className="mt-1 text-sm text-red-600">{errors.available_minutes_per_month}</p>
              )}
              <p className="mt-1 text-sm text-gray-500">
                Total available minutes per month for this machine (e.g., 12000 = 200 hours/month)
              </p>
            </div>
          </form>
        </ModalContent>

        {/* Modal Footer */}
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} className="bg-orange-600 hover:bg-orange-700">
            {machine ? 'Update Machine' : 'Create Machine'}
          </Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};

export default MachineModal;