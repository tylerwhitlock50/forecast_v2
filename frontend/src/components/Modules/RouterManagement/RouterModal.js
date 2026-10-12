import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';


const RouterModal = ({ isOpen, onClose, onSave, router }) => {
  const [formData, setFormData] = useState({
    router_id: '',
    router_name: '',
    router_description: '',
    version: '1.0'
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Initialize form when modal opens or router changes
  useEffect(() => {
    if (isOpen) {
      if (router) {
        // Editing existing router
        setFormData({
          router_id: router.router_id || '',
          router_name: router.router_name || '',
          router_description: router.router_description || '',
          version: router.version || '1.0'
        });
      } else {
        // Creating new router
        setFormData({
          router_id: '',
          router_name: '',
          router_description: '',
          version: '1.0'
        });
      }
      setErrors({});
    }
  }, [isOpen, router]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require router_id for editing existing routers
    if (router && !formData.router_id.trim()) {
      newErrors.router_id = 'Router ID is required';
    }
    
    if (!formData.router_name.trim()) {
      newErrors.router_name = 'Router name is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission. The page shows the result toast; on failure the
  // form stays open.
  const handleSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    try {
      await onSave({
        ...formData,
        router_id: formData.router_id.trim() || null, // Allow null for auto-generation
        router_name: formData.router_name.trim(),
        version: formData.version.trim() || '1.0',
      });
    } finally {
      setSaving(false);
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
    <Modal onClose={onClose} className="max-w-xl">
      <ModalHeader>
        <ModalTitle>{router ? `Edit routing ${router.router_id}` : 'Add a routing'}</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="router_id">Routing ID</Label>
              <Input
                id="router_id"
                value={formData.router_id}
                onChange={(e) => handleInputChange('router_id', e.target.value)}
                className={errors.router_id ? 'border-red-500' : ''}
                placeholder={router ? 'e.g., R0001' : 'Leave empty to auto-generate'}
                disabled={Boolean(router)}
                autoFocus={!router}
              />
              {errors.router_id && <p className="text-sm text-red-600">{errors.router_id}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="router_version">Version</Label>
              <Input
                id="router_version"
                value={formData.version}
                onChange={(e) => handleInputChange('version', e.target.value)}
                placeholder="1.0"
                disabled={Boolean(router)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="router_name">Name *</Label>
            <Input
              id="router_name"
              value={formData.router_name}
              onChange={(e) => handleInputChange('router_name', e.target.value)}
              className={errors.router_name ? 'border-red-500' : ''}
              placeholder="e.g., Bolt-action rifle routing"
              autoFocus={Boolean(router)}
            />
            {errors.router_name && <p className="text-sm text-red-600">{errors.router_name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="router_description">Description</Label>
            <Input
              id="router_description"
              value={formData.router_description}
              onChange={(e) => handleInputChange('router_description', e.target.value)}
              placeholder="Optional"
            />
          </div>

          {!router && (
            <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              After creating the routing, use <span className="font-medium">Manage</span> to add its operations
              (machine, machine minutes, labor minutes and labor type per unit), then link it to products.
            </p>
          )}
        </ModalContent>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving ? 'Saving…' : router ? 'Save changes' : 'Create routing'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default RouterModal;
