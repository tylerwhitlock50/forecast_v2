import React from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';
import { Input } from '../../ui/input';
import { Label } from '../../ui/label';
import { Textarea } from '../../ui/textarea';

const NewScenarioModal = ({ open, onClose, onCreate }) => {
  if (!open) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    onCreate({
      name: formData.get('name'),
      description: formData.get('description'),
    });
    onClose();
  };

  return (
    <Modal onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Create New Scenario</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>
        <form onSubmit={handleSubmit}>
          <ModalContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name:</Label>
              <Input id="name" name="name" required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description:</Label>
              <Textarea id="description" name="description" rows={3} />
            </div>
          </ModalContent>
          <ModalFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Create</Button>
          </ModalFooter>
        </form>
      </div>
    </Modal>
  );
};

export default NewScenarioModal;
