import * as React from "react"
import { cn } from "../../lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "./card"

const VARIANT_STYLES = {
  default: "",
  primary: "border-blue-200 bg-blue-50/50",
  success: "border-green-200 bg-green-50/50",
  warning: "border-yellow-200 bg-yellow-50/50",
  danger: "border-red-200 bg-red-50/50",
  info: "border-sky-200 bg-sky-50/50",
  secondary: "border-slate-200 bg-slate-50/60",
};

const VALUE_STYLES = {
  default: "text-foreground",
  primary: "text-blue-600",
  success: "text-green-600",
  warning: "text-yellow-700",
  danger: "text-red-600",
  info: "text-sky-700",
  secondary: "text-slate-700",
};

/**
 * KPI tile. The value never spills into the next tile: the card can shrink
 * (min-w-0), the value is one tabular line that truncates with the full text
 * on hover, and the font steps down on narrower screens.
 */
const StatsCard = ({
  title,
  value,
  subtitle,
  variant = "default",
  className,
  children,
  onClick,
  onHover,
  trend,
  help,
  ...props
}) => {
  const valueTitle = typeof value === "string" || typeof value === "number" ? String(value) : undefined;
  return (
    <Card
      className={cn(
        "min-w-0 transition-shadow duration-200",
        VARIANT_STYLES[variant] ?? VARIANT_STYLES.default,
        onClick && "cursor-pointer hover:shadow-md",
        className
      )}
      onClick={onClick}
      onMouseEnter={onHover}
      {...props}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex min-w-0 items-start justify-between gap-2 text-sm font-medium text-muted-foreground">
          <span className={cn("min-w-0 leading-snug", help && "cursor-help border-b border-dotted border-gray-400")} title={help}>
            {title}
          </span>
          {trend ? (
            <span className={cn(
              "flex-none text-xs font-semibold",
              trend > 0 ? "text-green-600" : trend < 0 ? "text-red-600" : "text-gray-500"
            )}>
              {trend > 0 ? "↑" : trend < 0 ? "↓" : "→"} {Math.abs(trend)}%
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="min-w-0">
        <div
          className={cn("truncate text-xl font-bold tabular-nums xl:text-2xl", VALUE_STYLES[variant] ?? VALUE_STYLES.default)}
          title={valueTitle}
        >
          {value}
        </div>
        {subtitle && (
          <p className="mt-1 text-xs text-muted-foreground">
            {subtitle}
          </p>
        )}
        {children}
      </CardContent>
    </Card>
  );
};

export { StatsCard }
