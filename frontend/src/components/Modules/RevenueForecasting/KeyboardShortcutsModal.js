import React from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose } from '../../ui/modal';
import { Button } from '../../ui/button';

const Kbd = ({ children }) => (
  <kbd className="px-2 py-1 bg-gray-100 rounded">{children}</kbd>
);

const KeyboardShortcutsModal = ({ open, onClose }) => {
  if (!open) return null;
  return (
    <Modal onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <ModalHeader>
          <ModalTitle>Keyboard Shortcuts</ModalTitle>
          <ModalClose onClick={onClose} />
        </ModalHeader>
        <ModalContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Navigation</h3>
              <ul className="space-y-1 text-sm">
                <li><Kbd>Arrow Keys</Kbd> — Navigate cells</li>
                <li><Kbd>Enter</Kbd> or <Kbd>F2</Kbd> — Edit cell</li>
                <li><Kbd>Tab</Kbd> — Next cell</li>
                <li><Kbd>Esc</Kbd> — Cancel editing</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Actions</h3>
              <ul className="space-y-1 text-sm">
                <li><Kbd>Ctrl+C</Kbd> — Copy cells</li>
                <li><Kbd>Ctrl+V</Kbd> — Paste cells</li>
                <li><Kbd>Delete</Kbd> — Clear cell</li>
                <li><Kbd>?</Kbd> — Show this help</li>
              </ul>
            </div>
          </div>
        </ModalContent>
        <ModalFooter>
          <Button onClick={onClose}>Close</Button>
        </ModalFooter>
      </div>
    </Modal>
  );
};

export default KeyboardShortcutsModal;
