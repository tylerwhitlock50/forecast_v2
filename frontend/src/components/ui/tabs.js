import * as React from "react"
import { cn } from "../../lib/utils"

// Controlled tabs. <Tabs value onValueChange> shares the active value with
// its triggers and panels, so only the active panel renders and clicking a
// trigger switches tabs. Triggers / panels that set data-state or onClick
// themselves keep working.
const TabsContext = React.createContext(null)

const Tabs = React.forwardRef(({ className, value, onValueChange, ...props }, ref) => (
  <TabsContext.Provider value={{ value, onValueChange }}>
    <div
      ref={ref}
      className={cn("w-full", className)}
      {...props}
    />
  </TabsContext.Provider>
))
Tabs.displayName = "Tabs"

const TabsList = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    role="tablist"
    className={cn(
      "inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = "TabsList"

const TabsTrigger = React.forwardRef(({ className, value, onClick, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  const active = ctx?.value !== undefined && ctx?.value !== null ? ctx.value === value : undefined
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      aria-selected={active}
      data-state={active === undefined ? undefined : active ? "active" : "inactive"}
      onClick={(e) => {
        if (onClick) onClick(e)
        if (ctx?.onValueChange && value !== undefined) ctx.onValueChange(value)
      }}
      className={cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm",
        className
      )}
      {...props}
    />
  )
})
TabsTrigger.displayName = "TabsTrigger"

const TabsContent = React.forwardRef(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(TabsContext)
  if (ctx?.value !== undefined && ctx?.value !== null && value !== undefined && ctx.value !== value) {
    return null
  }
  return (
    <div
      ref={ref}
      role="tabpanel"
      className={cn(
        "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    />
  )
})
TabsContent.displayName = "TabsContent"

export { Tabs, TabsList, TabsTrigger, TabsContent }
