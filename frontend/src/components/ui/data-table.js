import * as React from "react"
import { cn } from "../../lib/utils"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table"
import { Button } from "./button"
import { Badge } from "./badge"

const DataTable = ({ 
  data = [], 
  columns = [], 
  onEdit, 
  onDelete, 
  onCustomAction,
  className,
  emptyMessage = "No data available",
  ...props 
}) => {
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
        return new Date(value).toLocaleDateString('en-US', {
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
      <div className="flex items-center gap-2">
        {onCustomAction && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onCustomAction(row)}
          >
            {onCustomAction.label || 'Action'}
          </Button>
        )}
        {onEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(row)}
          >
            Edit
          </Button>
        )}
        {onDelete && (
          <Button
            variant="destructive"
            size="sm"
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
            {(onEdit || onDelete || onCustomAction) && (
              <TableHead className="w-32">Actions</TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((row, index) => (
            <TableRow key={row.id || index}>
              {columns.map((column) => (
                <TableCell key={column.key} className={column.cellClassName}>
                  {column.render 
                    ? column.render(row[column.key], row)
                    : formatCellValue(row[column.key], column)
                  }
                </TableCell>
              ))}
              {(onEdit || onDelete || onCustomAction) && (
                <TableCell>
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