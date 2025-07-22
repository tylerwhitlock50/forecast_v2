import * as React from "react"
import { cn } from "../../lib/utils"
import { Button } from "./button"

const PageHeader = ({ 
  title, 
  description, 
  actions, 
  className,
  children,
  ...props 
}) => {
  return (
    <div className={cn("flex flex-col gap-4 pb-6", className)} {...props}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            {actions.map((action, index) => (
              <Button
                key={index}
                variant={action.variant || "default"}
                size={action.size || "default"}
                onClick={action.onClick}
                className={action.className}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
      {children}
    </div>
  );
};

export { PageHeader }