import * as React from "react"
import { cn } from "../../lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "./card"

const StatsCard = ({ 
  title, 
  value, 
  subtitle, 
  variant = "default",
  className,
  children,
  ...props 
}) => {
  const variantStyles = {
    default: "",
    primary: "border-blue-200 bg-blue-50/50",
    success: "border-green-200 bg-green-50/50",
    warning: "border-yellow-200 bg-yellow-50/50",
    danger: "border-red-200 bg-red-50/50",
  };

  const valueStyles = {
    default: "text-foreground",
    primary: "text-blue-600",
    success: "text-green-600",
    warning: "text-yellow-600",
    danger: "text-red-600",
  };

  return (
    <Card className={cn(variantStyles[variant], className)} {...props}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", valueStyles[variant])}>
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-1">
            {subtitle}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
};

export { StatsCard }