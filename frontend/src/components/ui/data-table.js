import * as React from "react"
import { cn } from "../../lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"
import { Button } from "./button"
import { Badge } from "./badge"

// Parse YYYY-MM-DD as a local date (new Date('2026-01-01') is UTC and shows a day early in the US).
const parseDateValue = (value) => {
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
};

/**
 * Table with an optional actions column. The actions column stays pinned to
 * the right edge (sticky) so Edit / Delete are always reachable even when
 * the table scrolls sideways on a narrow screen.
 *
 * rowActions: extra per-row buttons shown before Edit / Delete, as
 *   [{ label, onClick(row), title?, variant?, hidden?(row) }].
 * rowKey: field (or function) that identifies a row (default: row.id).
 */
const DataTable = ({ 
  data = [], 
  columns = [], 
  onEdit, 
  onDelete, 
  onCustomAction,
  rowActions = [],
  rowKey,
  className,
  emptyMessage = "No data available",
  ...props 
}) => {
  const hasActions = Boolean(onEdit || onDelete || onCustomAction || rowActions.length);
  const keyFor = (row, index) => {
    if (typeof rowKey === 'function') return rowKey(row, index);
    if (rowKey && row[rowKey] !== undefined && row[rowKey] !== null) return row[rowKey];
    return row.id || index;
  };
  const formatCellValue = (value, column) => {
    if (value === null || value === undefined) return '';
    
    switch (column.type) {
      case 'currency':
        return new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: 'USD',
          minimumFractionDigits: 0,
          maximumFractionDigits: 0
        }).format(value);
      
      case 'percentage':
        return `${parseFloat(value).toFixed(2)}%`;
      
      case 'date':
        return parseDateValue(value).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        });
      
      case 'badge':
        const variant = column.variants?.[value] || 'default';
        return <Badge variant={variant}>{value}</Badge>;
      
      case 'boolean':
        return (
          <Badge variant={value ? 'success' : 'secondary'}>
            {value ? 'Yes' : 'No'}
          </Badge>
        );
      
      default:
        return String(value);
    }
  };

  const renderActions = (row) => {
    // If custom action has a render function, use that
    if (onCustomAction && onCustomAction.render) {
      return onCustomAction.render(row);
    }
    
    return (
      <div className="flex items-center justify-end gap-1.5 whitespace-nowrap">
        {rowActions.filter(a => !(a.hidden && a.hidden(row))).map((action) => (
          <Button
            key={action.label}
            type="button"
            variant={action.variant || 'outline'}
            size="sm"
            className="h-8 px-2.5"
            title={action.title}
            onClick={() => action.onClick(row)}
          >
            {action.label}
          </Button>
        ))}
        {onCustomAction && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5"
            onClick={() => onCustomAction(row)}
          >
            {onCustomAction.label || 'Action'}
          </Button>
        )}
        {onEdit && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5"
            onClick={() => onEdit(row)}
          >
            Edit
          </Button>
        )}
        {onDelete && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 px-2.5 border-red-200 text-red-700 hover:bg-red-50 hover:text-red-800"
            onClick={() => onDelete(row)}
          >
            Delete
          </Button>
        )}
      </div>
    );
  };

  if (!data || data.length === 0) {
    return (
      <div className={cn("rounded-md border", className)}>
        <div className="p-8 text-center text-muted-foreground">
          {emptyMessage}
        </div>
      </div>
    );
  }

  return (
    <div className={cn("rounded-md border", className)} {...props}>
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((column) => (
              <TableHead key={column.key} className={column.headerClassName}>
                {column.title}
              </TableHead>
            ))}
            {hasActions && (
              <TableHead className="sticky right-0 z-10 w-px bg-white text-right shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)]">
                Actions
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, index) => (
            <TableRow key={keyFor(row, index)} className="group">
              {columns.map((column) => (
                <TableCell key={column.key} className={column.cellClassName}>
                  {column.render 
                    ? column.render(row[column.key], row)
                    : formatCellValue(row[column.key], column)
                  }
                </TableCell>
              ))}
              {hasActions && (
                <TableCell className="sticky right-0 z-10 w-px bg-white py-2 shadow-[-6px_0_6px_-6px_rgba(0,0,0,0.15)] group-hover:bg-slate-50">
                  {renderActions(row)}
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
};

export { DataTable }