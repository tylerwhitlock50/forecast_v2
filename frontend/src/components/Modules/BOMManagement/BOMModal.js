import React, { useState, useEffect } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';


const BOMModal = ({ isOpen, onClose, onSave, bom }) => {
  const [formData, setFormData] = useState({
    bom_id: '',
    bom_name: '',
    bom_description: '',
    version: '1.0'
  });
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  // Initialize form when modal opens or bom changes
  useEffect(() => {
    if (isOpen) {
      if (bom) {
        // Editing existing BOM
        setFormData({
          bom_id: bom.bom_id || '',
          bom_name: bom.bom_name || '',
          bom_description: bom.bom_description || '',
          version: bom.version || '1.0'
        });
      } else {
        // Creating new BOM
        setFormData({
          bom_id: '',
          bom_name: '',
          bom_description: '',
          version: '1.0'
        });
      }
      setErrors({});
    }
  }, [isOpen, bom]);

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    // Only require bom_id for editing existing BOMs
    if (bom && !formData.bom_id.trim()) {
      newErrors.bom_id = 'BOM ID is required';
    }
    
    if (!formData.bom_name.trim()) {
      newErrors.bom_name = 'BOM name is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form submission. `openItemsAfter` short-circuits the default
  // two-step flow (create BOM → separately open items modal) so a new BOM
  // can be created and have its lines added in one pass. The page shows the
  // result toast; on failure the form stays open.
  const handleSubmit = async (e, { openItemsAfter = false } = {}) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!validateForm()) return;

    setSaving(true);
    try {
      const dataToSave = {
        ...formData,
        bom_id: formData.bom_id.trim() || null,
        bom_name: formData.bom_name.trim(),
        version: formData.version.trim() || '1.0',
      };
      await onSave(dataToSave, { openItemsAfter });
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
        <ModalTitle>{bom ? `Edit BOM ${bom.bom_id}` : 'Add a BOM'}</ModalTitle>
        <ModalClose onClick={onClose} />
      </ModalHeader>

      <form onSubmit={handleSubmit}>
        <ModalContent className="space-y-5">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_8rem]">
            <div className="space-y-1.5">
              <Label htmlFor="bom_id">BOM ID</Label>
              <Input
                id="bom_id"
                value={formData.bom_id}
                onChange={(e) => handleInputChange('bom_id', e.target.value)}
                className={errors.bom_id ? 'border-red-500' : ''}
                placeholder={bom ? 'e.g., BOM-001' : 'Leave empty to auto-generate'}
                disabled={Boolean(bom)}
                autoFocus={!bom}
              />
              {errors.bom_id && <p className="text-sm text-red-600">{errors.bom_id}</p>}
              {!bom && <p className="text-xs text-gray-500">Usually the parent / assembly part number.</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="bom_version">Version</Label>
              <Input
                id="bom_version"
                value={formData.version}
                onChange={(e) => handleInputChange('version', e.target.value)}
                placeholder="1.0"
                disabled={Boolean(bom)}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bom_name">Name *</Label>
            <Input
              id="bom_name"
              value={formData.bom_name}
              onChange={(e) => handleInputChange('bom_name', e.target.value)}
              className={errors.bom_name ? 'border-red-500' : ''}
              placeholder="e.g., Ridgeline 6.5 PRC"
              autoFocus={Boolean(bom)}
            />
            {errors.bom_name && <p className="text-sm text-red-600">{errors.bom_name}</p>}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bom_description">Description</Label>
            <Textarea
              id="bom_description"
              value={formData.bom_description}
              onChange={(e) => handleInputChange('bom_description', e.target.value)}
              placeholder="Optional"
              rows={3}
            />
          </div>

          {!bom && (
            <p className="rounded-md bg-gray-50 p-3 text-sm text-gray-600">
              Next, add the material lines (quantity and unit price per finished unit), then link the BOM to its
              product on the Products screen. Have the BOM in a spreadsheet? Use <span className="font-medium">Import from file</span> instead.
            </p>
          )}
        </ModalContent>

        <ModalFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          {!bom && (
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={(e) => handleSubmit(e, { openItemsAfter: true })}
              title="Create this BOM and go straight to adding its material lines"
            >
              Create &amp; add lines
            </Button>
          )}
          <Button type="submit" disabled={saving} className="bg-orange-600 text-white hover:bg-orange-700">
            {saving ? 'Saving…' : bom ? 'Save changes' : 'Create BOM'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  );
};

export default BOMModal;
