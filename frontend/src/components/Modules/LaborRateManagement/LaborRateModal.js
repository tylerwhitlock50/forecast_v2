import React, { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Select, SelectOption } from '../../ui/select';
import { Textarea } from '../../ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '../../ui/card';

const RATE_TYPES = [
  'Direct Labor',
  'Indirect Labor',
  'Machine Operator',
  'Setup',
  'Quality Control',
  'Maintenance',
  'Supervision',
  'Engineering',
  'Administrative',
  'Skilled Labor',
  'Semi-skilled Labor',
  'Unskilled Labor',
  'Overtime',
  'Holiday',
  'Contract'
];

const LaborRateModal = ({ isOpen, onClose, onSave, laborRate }) => {
  const [formData, setFormData] = useState({
    rate_id: '',
    rate_name: '',
    rate_type: '',
    rate_amount: '',
    rate_description: ''
  });
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!isOpen) return;
    if (laborRate) {
      setFormData({
        rate_id: laborRate.rate_id || '',
        rate_name: laborRate.rate_name || '',
        rate_type: laborRate.rate_type || '',
        rate_amount: laborRate.rate_amount || '',
        rate_description: laborRate.rate_description || ''
      });
    } else {
      setFormData({
        rate_id: '',
        rate_name: '',
        rate_type: '',
        rate_amount: '',
        rate_description: ''
      });
    }
    setErrors({});
  }, [isOpen, laborRate]);

  const validateForm = () => {
    const newErrors = {};
    if (!formData.rate_id.trim()) newErrors.rate_id = 'Rate ID is required';
    if (!formData.rate_name.trim()) newErrors.rate_name = 'Rate name is required';
    if (!formData.rate_type.trim()) newErrors.rate_type = 'Rate type is required';
    if (!formData.rate_amount || isNaN(formData.rate_amount) || parseFloat(formData.rate_amount) < 0) {
      newErrors.rate_amount = 'Valid hourly rate is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) {
      toast.error('Please fix the errors in the form');
      return;
    }
    try {
      await onSave({
        ...formData,
        rate_amount: parseFloat(formData.rate_amount)
      });
    } catch (error) {
      console.error('Error saving labor rate:', error);
      toast.error('Failed to save labor rate');
    }
  };

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: null }));
    }
  };

  const generateRateId = () => {
    const baseName = (formData.rate_name || '').toUpperCase().replace(/\s+/g, '-');
    const rateType = (formData.rate_type || '').toUpperCase().replace(/\s+/g, '-');
    const composed = [rateType, baseName].filter(Boolean).join('-');
    return composed || 'RATE-001';
  };

  if (!isOpen) return null;

  return (
    <Modal className="max-w-3xl" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>{laborRate ? 'Edit Labor Rate' : 'Add New Labor Rate'}</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>

        <form onSubmit={handleSubmit}>
          <ModalContent className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Labor Rate Information</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="rate_id">Rate ID *</Label>
                    <div className="flex gap-2">
                      <Input
                        id="rate_id"
                        value={formData.rate_id}
                        onChange={(e) => handleChange('rate_id', e.target.value)}
                        placeholder="e.g., DIRECT-LABOR"
                        disabled={Boolean(laborRate)}
                        className={errors.rate_id ? 'border-red-500' : ''}
                      />
                      {!laborRate && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          onClick={() => handleChange('rate_id', generateRateId())}
                          title="Generate Rate ID"
                        >
                          🔄
                        </Button>
                      )}
                    </div>
                    {errors.rate_id && <p className="text-sm text-red-500">{errors.rate_id}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate_name">Rate Name *</Label>
                    <Input
                      id="rate_name"
                      value={formData.rate_name}
                      onChange={(e) => handleChange('rate_name', e.target.value)}
                      placeholder="Enter rate name"
                      className={errors.rate_name ? 'border-red-500' : ''}
                    />
                    {errors.rate_name && <p className="text-sm text-red-500">{errors.rate_name}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate_type">Rate Type *</Label>
                    <Select
                      id="rate_type"
                      value={formData.rate_type}
                      onChange={(e) => handleChange('rate_type', e.target.value)}
                      className={errors.rate_type ? 'border-red-500' : ''}
                    >
                      <SelectOption value="">Select Rate Type</SelectOption>
                      {RATE_TYPES.map(t => (
                        <SelectOption key={t} value={t}>{t}</SelectOption>
                      ))}
                    </Select>
                    {errors.rate_type && <p className="text-sm text-red-500">{errors.rate_type}</p>}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="rate_amount">Hourly Rate (USD) *</Label>
                    <Input
                      id="rate_amount"
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.rate_amount}
                      onChange={(e) => handleChange('rate_amount', e.target.value)}
                      placeholder="0.00"
                      className={errors.rate_amount ? 'border-red-500' : ''}
                    />
                    {errors.rate_amount && <p className="text-sm text-red-500">{errors.rate_amount}</p>}
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="rate_description">Description</Label>
                    <Textarea
                      id="rate_description"
                      value={formData.rate_description}
                      onChange={(e) => handleChange('rate_description', e.target.value)}
                      placeholder="Enter rate description (optional)"
                      rows={3}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </ModalContent>

          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              {laborRate ? 'Update Labor Rate' : 'Create Labor Rate'}
            </Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
};

export default LaborRateModal;
