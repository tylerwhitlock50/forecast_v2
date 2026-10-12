import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "../../lib/utils"
import { Button } from "./button"

// Lock page scroll while at least one modal is open (modals can stack, e.g.
// a confirm dialog over an editor), restoring the previous value at the end.
let openModals = 0
let previousOverflow = ""
const lockScroll = () => {
  if (typeof document === "undefined") return
  if (openModals === 0) {
    previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
  }
  openModals += 1
}
const unlockScroll = () => {
  if (typeof document === "undefined") return
  openModals = Math.max(0, openModals - 1)
  if (openModals === 0) document.body.style.overflow = previousOverflow
}

/**
 * Centered dialog over the whole viewport, sidebar included. Rendered into
 * document.body so no page container (overflow, stacking context,
 * transform) can clip it or push it under the navigation. z-index 1050 sits
 * above the legacy .modal-overlay (1000), so a confirm dialog opened from a
 * legacy modal shows on top of it.
 *
 * `onClose` (optional): called on Escape and on a click on the backdrop.
 * `className` styles the panel (width: e.g. "max-w-3xl").
 */
const Modal = React.forwardRef(({ className, children, onClose, onClick, ...props }, ref) => {
  React.useEffect(() => {
    lockScroll()
    return unlockScroll
  }, [])

  React.useEffect(() => {
    if (!onClose) return undefined
    const onKey = (e) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])

  const handleClick = (e) => {
    if (onClick) onClick(e)
    if (onClose && e.target === e.currentTarget) onClose()
  }

  const overlay = (
    <div
      ref={ref}
      className="fixed inset-0 z-[1050] flex items-center justify-center p-4 bg-black/50"
      onClick={handleClick}
      {...props}
    >
      <div
        role="dialog"
        aria-modal="true"
        className={cn(
          "relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-background rounded-lg shadow-lg",
          className
        )}
      >
        {children}
      </div>
    </div>
  )

  if (typeof document === "undefined" || !document.body) return overlay
  return createPortal(overlay, document.body)
})
Modal.displayName = "Modal"

const ModalHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between p-6 border-b", className)}
    {...props}
  />
))
ModalHeader.displayName = "ModalHeader"

const ModalTitle = React.forwardRef(({ className, children, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  >
    {children}
  </h2>
))
ModalTitle.displayName = "ModalTitle"

const ModalContent = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("p-6", className)}
    {...props}
  />
))
ModalContent.displayName = "ModalContent"

const ModalFooter = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex justify-end gap-2 p-6 border-t", className)}
    {...props}
  />
))
ModalFooter.displayName = "ModalFooter"

const ModalClose = React.forwardRef(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    type="button"
    variant="ghost"
    size="icon"
    aria-label="Close"
    className={cn("absolute top-4 right-4", className)}
    {...props}
  >
    ×
  </Button>
))
ModalClose.displayName = "ModalClose"

export { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose }
