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
            <p className="text-sm text-gray-600">Click a cell in the matrix first. Edits save when you press Enter or leave the cell.</p>
            <div>
              <h3 className="font-semibold mb-2">Navigation</h3>
              <ul className="space-y-1 text-sm">
                <li><Kbd>Arrow Keys</Kbd> — Move between cells</li>
                <li><Kbd>Tab</Kbd> / <Kbd>Shift+Tab</Kbd> — Next / previous cell</li>
                <li><Kbd>Enter</Kbd> or <Kbd>F2</Kbd> — Edit the selected cell</li>
                <li>Type a number — Start editing with that value</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">While editing</h3>
              <ul className="space-y-1 text-sm">
                <li><Kbd>Enter</Kbd> — Save and move down</li>
                <li><Kbd>Tab</Kbd> — Save and move right</li>
                <li><Kbd>Esc</Kbd> — Cancel without saving</li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Actions</h3>
              <ul className="space-y-1 text-sm">
                <li><Kbd>Delete</Kbd> — Clear the cell (saves 0)</li>
                <li><Kbd>Ctrl+C</Kbd> / <Kbd>Ctrl+V</Kbd> — Copy / paste one value</li>
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
