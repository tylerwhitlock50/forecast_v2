import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter } from '../ui/modal';
import { Button } from '../ui/button';

/**
 * Promise-based confirm replacement for window.confirm.
 *
 * Usage:
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete scenario?',
 *     body: 'This cannot be undone.',
 *     confirmLabel: 'Delete',
 *     variant: 'destructive',
 *   });
 *   if (!ok) return;
 *
 * Render <ConfirmProvider> once near the app root; it hosts the dialog
 * portal and serves a single confirm function to everything below it.
 */

const ConfirmContext = createContext(null);

export const useConfirm = () => {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return ctx;
};

export const ConfirmProvider = ({ children }) => {
  const [state, setState] = useState(null);
  const resolverRef = useRef(null);

  const confirm = useCallback((opts = {}) => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setState({
        title: opts.title || 'Are you sure?',
        body: opts.body || '',
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel: opts.cancelLabel || 'Cancel',
        variant: opts.variant || 'default',
      });
    });
  }, []);

  const close = useCallback((result) => {
    if (resolverRef.current) {
      resolverRef.current(result);
      resolverRef.current = null;
    }
    setState(null);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {state && (
        <Modal onClick={(e) => e.target === e.currentTarget && close(false)}>
          <ModalHeader>
            <ModalTitle>{state.title}</ModalTitle>
          </ModalHeader>
          <ModalContent>
            {typeof state.body === 'string' ? (
              <p className="text-sm text-muted-foreground whitespace-pre-line">{state.body}</p>
            ) : (
              state.body
            )}
          </ModalContent>
          <ModalFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {state.cancelLabel}
            </Button>
            <Button
              variant={state.variant === 'destructive' ? 'destructive' : 'default'}
              onClick={() => close(true)}
              autoFocus
            >
              {state.confirmLabel}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
};

export default ConfirmProvider;
