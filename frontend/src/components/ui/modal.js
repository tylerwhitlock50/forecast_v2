import * as React from "react"
import { cn } from "../../lib/utils"
import { Button } from "./button"

const Modal = React.forwardRef(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
    {...props}
  >
    <div className={cn(
      "relative w-full max-w-lg max-h-[90vh] overflow-y-auto bg-background rounded-lg shadow-lg",
      className
    )}>
      {children}
    </div>
  </div>
))
Modal.displayName = "Modal"

const ModalHeader = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between p-6 border-b", className)}
    {...props}
  />
))
ModalHeader.displayName = "ModalHeader"

const ModalTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
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
    variant="ghost"
    size="icon"
    className={cn("absolute top-4 right-4", className)}
    {...props}
  >
    ×
  </Button>
))
ModalClose.displayName = "ModalClose"

export { Modal, ModalHeader, ModalTitle, ModalContent, ModalFooter, ModalClose }