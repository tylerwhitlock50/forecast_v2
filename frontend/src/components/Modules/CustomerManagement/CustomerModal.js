import React, { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Modal, ModalClose, ModalContent, ModalFooter, ModalHeader, ModalTitle } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { customerTypeOptions, nextCustomerId, normalizeChoice, regionOptions } from './customerOptions';

/**
 * Add or edit a customer. Customer type and region are free text with
 * suggestions (the types already in use, then Dealer / Distributor / Direct /
 * OEM / Government / Export), so an imported type like "OEM" always shows and
 * can be kept.
 */
const CustomerModal = ({ isOpen, onClose, onSave, customer, existingCustomers = [] }) => {
  const [formData, setFormData] = useState({ customer_id: '', customer_name: '', customer_type: '', region: '' });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const typeOptions = useMemo(() => customerTypeOptions(existingCustomers), [existingCustomers]);
  const regions = useMemo(() => regionOptions(existingCustomers), [existingCustomers]);

  useEffect(() => {
    if (!isOpen) return;
    if (customer) {
      setFormData({
        customer_id: customer.customer_id || '',
        customer_name: customer.customer_name || '',
        customer_type: customer.customer_type || '',
        region: customer.region || '',
      });
    } else {
      setFormData({ customer_id: nextCustomerId(existingCustomers), customer_name: '', customer_type: '', region: '' });
    }
    setErrors({});
    setSaving(false);
    // Reset when the modal opens or the customer changes, not on every data refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, customer]);

  const set = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    if (errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
  };

  const validate = () => {
    const next = {};
    const id = formData.customer_id.trim();
    if (!id) next.customer_id = 'Customer ID is required';
    else if (!customer && existingCustomers.some(c => String(c.customer_id).toLowerCase() === id.toLowerCase())) {
      next.customer_id = `${id} is already used by another customer`;
    }
    if (!formData.customer_name.trim()) next.customer_name = 'Customer name is required';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      await onSave({
        customer_id: formData.customer_id.trim(),
        customer_name: formData.customer_name.trim(),
        customer_type: normalizeChoice(formData.customer_type, typeOptions) || null,
        region: normalizeChoice(formData.region, regions) || null,
      });
    } catch (error) {
      const detail = error?.response?.data?.detail;
      setErrors(prev => ({ ...prev, form: typeof detail === 'string' ? detail : 'The customer could not be saved.' }));
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;
  const isEdit = Boolean(customer);

  return (
    <Modal onClick={(e) => e.target === e.currentTarget && !saving && onClose()}>
      <form onSubmit={handleSubmit}>
        <ModalHeader>
          <ModalTitle>{isEdit ? `Edit ${customer.customer_name || customer.customer_id}` : 'Add customer'}</ModalTitle>
          <ModalClose type="button" onClick={onClose} aria-label="Close" />
        </ModalHeader>
        <ModalContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="cm-id">Customer ID *</Label>
            <Input
              id="cm-id"
              value={formData.customer_id}
              onChange={(e) => set('customer_id', e.target.value)}
              disabled={isEdit}
              className={`${isEdit ? 'bg-gray-100' : ''} ${errors.customer_id ? 'border-red-500' : ''}`}
            />
            {errors.customer_id
              ? <p className="text-xs text-red-600">{errors.customer_id}</p>
              : <p className="text-xs text-gray-500">{isEdit ? 'The ID links sales and prices, so it cannot be changed here.' : 'Use your ERP account number, or keep the suggested one.'}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cm-name">Customer name *</Label>
            <Input
              id="cm-name"
              value={formData.customer_name}
              onChange={(e) => set('customer_name', e.target.value)}
              placeholder="e.g. Sportsman's Warehouse"
              className={errors.customer_name ? 'border-red-500' : ''}
            />
            {errors.customer_name && <p className="text-xs text-red-600">{errors.customer_name}</p>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="cm-type">Customer type</Label>
              <Input
                id="cm-type"
                list="cm-type-options"
                value={formData.customer_type}
                onChange={(e) => set('customer_type', e.target.value)}
                placeholder="Dealer, Distributor…"
                autoComplete="off"
              />
              <datalist id="cm-type-options">
                {typeOptions.map(t => <option key={t} value={t} />)}
              </datalist>
              <p className="text-xs text-gray-500">Prices and discounts can be set per type.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cm-region">Region</Label>
              <Input
                id="cm-region"
                list="cm-region-options"
                value={formData.region}
                onChange={(e) => set('region', e.target.value)}
                placeholder="West, Midwest…"
                autoComplete="off"
              />
              <datalist id="cm-region-options">
                {regions.map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
          </div>
          {errors.form && <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{errors.form}</div>}
        </ModalContent>
        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button type="submit" disabled={saving} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            {isEdit ? 'Save changes' : 'Add customer'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default CustomerModal;
