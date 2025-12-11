import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useForecast } from '../../context/ForecastContext';
import ValidationIndicator from './ValidationIndicator';
import { Button } from '../ui/button';
import './EditableGrid.css';

const EditableGrid = ({ 
  data, 
  columns, 
  onDataChange,
  onCellChange,
  onValidation,
  enableDragFill = true,
  enableBulkEdit = true,
  enableKeyboardNavigation = true,
  maxRows = 1000,
  maxCols = 50,
  className = ''
}) => {
  const { actions } = useForecast();
  const [editingCell, setEditingCell] = useState(null);
  const [selectedCells, setSelectedCells] = useState([]);
  const [dragSelection, setDragSelection] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [copiedCells, setCopiedCells] = useState([]);
  const [validationErrors, setValidationErrors] = useState(new Map());
  const [sortConfig, setSortConfig] = useState({ key: null, direction: 'asc' });
  const [selectedRows, setSelectedRows] = useState(new Set());
  const [bulkEditMode, setBulkEditMode] = useState(false);
  
  const gridRef = useRef(null);
  const editInputRef = useRef(null);
  const containerRef = useRef(null);
  const gridContainerRef = useRef(null);

  // Grid dimensions
  const rowHeight = 40;
  const columnWidth = 120; // Default width
  const headerHeight = 40;

  // Calculate column widths from column definitions
  const getColumnWidth = (columnIndex) => {
    const column = columns[columnIndex];
    return column.width || columnWidth;
  };

  // Calculate total width for the grid
  const totalWidth = columns.reduce((sum, column) => sum + (column.width || columnWidth), 0);

  // Calculate sticky column left offsets
  const getStickyLeftOffset = (columnIndex) => {
    let offset = 0;
    for (let i = 0; i < columnIndex; i++) {
      if (columns[i]?.sticky) {
        offset += getColumnWidth(i);
      }
    }
    if (enableBulkEdit) {
      offset += 40; // Checkbox column width
    }
    return offset;
  };

  // Check if column is sticky
  const isColumnSticky = (columnIndex) => {
    const column = columns[columnIndex];
    return column?.sticky === true;
  };

  // Sort and filter data
  const sortedData = React.useMemo(() => {
    if (!sortConfig.key) return data;
    
    return [...data].sort((a, b) => {
      const aValue = a[sortConfig.key];
      const bValue = b[sortConfig.key];
      
      if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [data, sortConfig]);

  // Handle cell editing
  const startEditing = useCallback((rowIndex, colIndex) => {
    setEditingCell({ row: rowIndex, col: colIndex });
    // Focus input after state update
    setTimeout(() => {
      if (editInputRef.current) {
        editInputRef.current.focus();
        editInputRef.current.select();
      }
    }, 0);
  }, []);

  const stopEditing = useCallback(() => {
    setEditingCell(null);
  }, []);

  const handleCellChange = useCallback((rowIndex, colIndex, value) => {
    const column = columns[colIndex];
    const rowData = sortedData[rowIndex];
    
    // Validate value
    const isValid = validateCell(column, value);
    
    if (isValid) {
      // Update data
      const newData = [...sortedData];
      newData[rowIndex] = { ...rowData, [column.key]: value };
      onDataChange(newData);
      
      // Trigger cell-specific callback
      if (onCellChange) {
        onCellChange(rowIndex, colIndex, value, column.key);
      }
      
      // Remove validation error
      const errorKey = `${rowIndex}-${colIndex}`;
      if (validationErrors.has(errorKey)) {
        const newErrors = new Map(validationErrors);
        newErrors.delete(errorKey);
        setValidationErrors(newErrors);
      }
    } else {
      // Add validation error
      const errorKey = `${rowIndex}-${colIndex}`;
      setValidationErrors(prev => new Map(prev).set(errorKey, 'Invalid value'));
    }
  }, [sortedData, columns, onDataChange, onCellChange, validationErrors]);

  const validateCell = (column, value) => {
    // Basic validation based on column type
    if (column.required && (!value || value.toString().trim() === '')) {
      return false;
    }
    
    if (column.type === 'number') {
      const num = parseFloat(value);
      if (isNaN(num)) return false;
      if (column.min !== undefined && num < column.min) return false;
      if (column.max !== undefined && num > column.max) return false;
    }
    
    if (column.type === 'email') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) return false;
    }
    
    if (column.validation) {
      return column.validation(value);
    }
    
    return true;
  };

  // Handle keyboard navigation
  const handleKeyDown = useCallback((e) => {
    if (!enableKeyboardNavigation) return;

    const { key, ctrlKey, shiftKey } = e;
    
    if (editingCell) {
      if (key === 'Enter' || key === 'Tab') {
        e.preventDefault();
        stopEditing();
        
        // Move to next cell
        if (key === 'Tab') {
          const nextCol = editingCell.col + 1;
          if (nextCol < columns.length) {
            startEditing(editingCell.row, nextCol);
          } else if (editingCell.row + 1 < sortedData.length) {
            startEditing(editingCell.row + 1, 0);
          }
        } else if (editingCell.row + 1 < sortedData.length) {
          startEditing(editingCell.row + 1, editingCell.col);
        }
      } else if (key === 'Escape') {
        e.preventDefault();
        stopEditing();
      }
    } else {
      // Navigation when not editing
      if (selectedCells.length > 0) {
        const [currentRow, currentCol] = selectedCells[0];
        let newRow = currentRow;
        let newCol = currentCol;

        switch (key) {
          case 'ArrowUp':
            newRow = Math.max(0, currentRow - 1);
            break;
          case 'ArrowDown':
            newRow = Math.min(sortedData.length - 1, currentRow + 1);
            break;
          case 'ArrowLeft':
            newCol = Math.max(0, currentCol - 1);
            break;
          case 'ArrowRight':
            newCol = Math.min(columns.length - 1, currentCol + 1);
            break;
          case 'Enter':
          case 'F2':
            startEditing(currentRow, currentCol);
            break;
          case 'Delete':
            handleCellChange(currentRow, currentCol, '');
            break;
        }

        if (newRow !== currentRow || newCol !== currentCol) {
          setSelectedCells([[newRow, newCol]]);
        }
      }

      // Copy/Paste
      if (ctrlKey) {
        if (key === 'c' || key === 'C') {
          handleCopy();
        } else if (key === 'v' || key === 'V') {
          handlePaste();
        }
      }
    }
  }, [editingCell, selectedCells, columns, sortedData, enableKeyboardNavigation, startEditing, stopEditing, handleCellChange]);

  // Handle copy/paste
  const handleCopy = useCallback(() => {
    if (selectedCells.length === 0) return;
    
    const copiedData = selectedCells.map(([row, col]) => ({
      row,
      col,
      value: sortedData[row][columns[col].key]
    }));
    
    setCopiedCells(copiedData);
    actions.showToast('Copied to clipboard', 'success');
  }, [selectedCells, sortedData, columns, actions]);

  const handlePaste = useCallback(() => {
    if (copiedCells.length === 0 || selectedCells.length === 0) return;
    
    const [startRow, startCol] = selectedCells[0];
    
    copiedCells.forEach(({ value }, index) => {
      const targetRow = startRow + Math.floor(index / copiedCells.length);
      const targetCol = startCol + (index % copiedCells.length);
      
      if (targetRow < sortedData.length && targetCol < columns.length) {
        handleCellChange(targetRow, targetCol, value);
      }
    });
    
    actions.showToast('Pasted from clipboard', 'success');
  }, [copiedCells, selectedCells, sortedData, columns, handleCellChange, actions]);

  // Handle drag and fill
  const handleDragStart = useCallback((rowIndex, colIndex) => {
    if (!enableDragFill) return;
    
    setIsDragging(true);
    setDragSelection({ startRow: rowIndex, startCol: colIndex, endRow: rowIndex, endCol: colIndex });
  }, [enableDragFill]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging || !dragSelection) return;
    
    const { startRow, startCol, endRow, endCol } = dragSelection;
    const sourceValue = sortedData[startRow][columns[startCol].key];
    
    // Fill all cells in the selection with the source value
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row++) {
      for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col++) {
        if (row !== startRow || col !== startCol) {
          handleCellChange(row, col, sourceValue);
        }
      }
    }
    
    setIsDragging(false);
    setDragSelection(null);
  }, [isDragging, dragSelection, sortedData, columns, handleCellChange]);

  // Handle sorting
  const handleSort = useCallback((columnKey) => {
    setSortConfig(prev => ({
      key: columnKey,
      direction: prev.key === columnKey && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  }, []);

  // Memoized cell renderer for react-window
  const Cell = useCallback(({ columnIndex, rowIndex, style }) => {
    // Adjust rowIndex: row 0 is header, data starts at row 1
    const actualRowIndex = rowIndex - 1;
    
    if (rowIndex === 0) {
      // Header row - checkbox column is handled separately in header rendering
      const adjustedColIndex = getAdjustedColumnIndex(columnIndex);
      if (adjustedColIndex === -1) {
        // This is the checkbox column header, already rendered
        return null;
      }
      const column = columns[adjustedColIndex];
      if (!column) return null;
      const isSticky = isColumnSticky(adjustedColIndex);
      const stickyLeft = isSticky ? getStickyLeftOffset(adjustedColIndex) : undefined;
      
      return (
        <div
          className={`header-cell ${sortConfig.key === column.key ? 'sorted' : ''} ${isSticky ? 'sticky-column' : ''}`}
          style={{
            ...style,
            width: column.width || columnWidth,
            minWidth: column.width || columnWidth,
            display: 'flex',
            alignItems: 'center',
            padding: '0 8px',
            fontWeight: '600',
            fontSize: '14px',
            color: '#374151',
            borderRight: '1px solid #e2e8f0',
            backgroundColor: 'white',
            position: isSticky ? 'sticky' : 'relative',
            top: 0,
            left: stickyLeft,
            zIndex: isSticky ? 20 : 10,
            boxShadow: isSticky && adjustedColIndex > 0 ? '2px 0 4px rgba(0,0,0,0.1)' : 'none'
          }}
          onClick={() => handleSort(column.key)}
        >
          {column.title}
          {sortConfig.key === column.key && (
            <span className="sort-indicator ml-1">
              {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
          )}
          {column.required && <span className="required-indicator ml-1 text-red-500">*</span>}
        </div>
      );
    }
    
    // Data row
    const adjustedColIndex = getAdjustedColumnIndex(columnIndex);
    if (adjustedColIndex === -1) {
      // Checkbox column - handled in first column logic below
      return null;
    }
    const column = columns[adjustedColIndex];
    if (!column) return null;
    const rowData = sortedData[actualRowIndex];
    if (!rowData) return null;
    
    const value = rowData[column.key];
    const isEditing = editingCell?.row === actualRowIndex && editingCell?.col === columnIndex;
    const isSelected = selectedCells.some(([r, c]) => r === actualRowIndex && c === columnIndex);
    const hasError = validationErrors.has(`${actualRowIndex}-${columnIndex}`);

    const handleClick = (e) => {
      e.stopPropagation();
      
      if (column.onClick) {
        column.onClick(actualRowIndex, columnIndex, rowData);
        return;
      }

      if (enableKeyboardNavigation) {
        setSelectedCells([[actualRowIndex, adjustedColIndex]]);
        startEditing(actualRowIndex, adjustedColIndex);
      }
    };

    const handleDoubleClick = () => {
      if (enableKeyboardNavigation) {
        startEditing(actualRowIndex, adjustedColIndex);
      }
    };

    const isSticky = isColumnSticky(adjustedColIndex);
    const stickyLeft = isSticky ? getStickyLeftOffset(adjustedColIndex) : undefined;
    const isRowSelected = selectedRows.has(actualRowIndex);
    
    return (
      <div
        className={`grid-cell ${isSelected ? 'selected' : ''} ${hasError ? 'error' : ''} ${isSticky ? 'sticky-column' : ''}`}
        style={{
          ...style,
          width: column.width || columnWidth,
          minWidth: column.width || columnWidth,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          cursor: 'pointer',
          borderRight: '1px solid #f3f4f6',
          backgroundColor: isSelected || isRowSelected ? '#fef3c7' : 'white',
          position: isSticky ? 'sticky' : 'relative',
          left: stickyLeft,
          zIndex: isSticky ? 15 : 1,
          borderBottom: '1px solid #f3f4f6',
          boxShadow: isSticky && adjustedColIndex > 0 ? '2px 0 4px rgba(0,0,0,0.1)' : 'none'
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <input
            ref={isEditing && editingCell?.row === actualRowIndex && editingCell?.col === columnIndex ? editInputRef : null}
            type={column.type === 'number' ? 'number' : 'text'}
            value={value || ''}
            onChange={(e) => {
              const newValue = column.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
              handleCellChange(actualRowIndex, adjustedColIndex, newValue);
            }}
            onBlur={stopEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                stopEditing();
              } else if (e.key === 'Escape') {
                stopEditing();
              }
            }}
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '14px'
            }}
          />
        ) : (
          <span style={{ fontSize: '14px', color: '#374151' }}>
            {column.format ? column.format(value) : value || ''}
          </span>
        )}
        
        {hasError && (
          <ValidationIndicator 
            type="error" 
            size="small" 
            className="absolute top-1 right-1"
          />
        )}
      </div>
    );
  }, [columns, sortedData, editingCell, selectedCells, selectedRows, validationErrors, sortConfig, enableKeyboardNavigation, enableBulkEdit, startEditing, stopEditing, handleCellChange, handleSort, getAdjustedColumnIndex, isColumnSticky, getStickyLeftOffset]);
  
  // Calculate grid dimensions
  const gridRowCount = useMemo(() => sortedData.length + 1, [sortedData.length]); // +1 for header
  const gridColumnCount = useMemo(() => columns.length + (enableBulkEdit ? 1 : 0), [columns.length, enableBulkEdit]);
  
  // Adjust column index for checkbox column
  const getAdjustedColumnIndex = (columnIndex) => {
    if (enableBulkEdit && columnIndex === 0) return -1; // Checkbox column
    return enableBulkEdit ? columnIndex - 1 : columnIndex;
  };

  // Add keyboard event listener
  useEffect(() => {
    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [handleKeyDown]);

  return (
    <div 
      ref={containerRef}
      className={`editable-grid ${className}`}
      tabIndex={0}
      style={{ 
        width: '100%', 
        height: '100%',
        outline: 'none',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Virtualized grid container */}
      <div 
        ref={gridContainerRef}
        className="grid-container" 
        style={{ 
          flex: 1,
          minHeight: 0,
          overflow: 'hidden'
        }}
      >
        <AutoSizer>
          {({ height, width }) => (
            <Grid
              ref={gridRef}
              columnCount={gridColumnCount}
              rowCount={gridRowCount}
              columnWidth={(index) => {
                if (enableBulkEdit && index === 0) return 40; // Checkbox column
                const adjustedIndex = enableBulkEdit ? index - 1 : index;
                return getColumnWidth(adjustedIndex);
              }}
              rowHeight={(index) => index === 0 ? headerHeight : rowHeight}
              height={height}
              width={width}
              overscanRowCount={5}
              overscanColumnCount={2}
            >
              {Cell}
            </Grid>
          )}
        </AutoSizer>
      </div>
      
      {/* Bulk actions toolbar */}
      {enableBulkEdit && (selectedCells.length > 1 || selectedRows.size > 0) && (
        <div className="bulk-actions bg-orange-50 border border-orange-200 rounded-lg p-3 mb-4 flex items-center gap-3">
          <span className="text-sm font-medium text-gray-700">
            {selectedRows.size > 0 ? `${selectedRows.size} row${selectedRows.size !== 1 ? 's' : ''} selected` : `${selectedCells.length} cell${selectedCells.length !== 1 ? 's' : ''} selected`}
          </span>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy}>Copy</Button>
            <Button size="sm" variant="outline" onClick={handlePaste}>Paste</Button>
            <Button size="sm" variant="outline" onClick={() => {
              if (selectedRows.size > 0) {
                // Bulk clear selected rows
                const updatedData = [...sortedData];
                selectedRows.forEach(rowIndex => {
                  columns.forEach((column, colIndex) => {
                    if (column.type !== 'text' || !column.required) {
                      updatedData[rowIndex][column.key] = '';
                    }
                  });
                });
                onDataChange(updatedData);
                setSelectedRows(new Set());
              } else {
                selectedCells.forEach(([row, col]) => {
                  handleCellChange(row, col, '');
                });
              }
            }}>Clear</Button>
            {selectedRows.size > 0 && (
              <Button 
                size="sm" 
                variant="outline" 
                onClick={() => {
                  setBulkEditMode(true);
                }}
                className="bg-orange-600 text-white hover:bg-orange-700"
              >
                Bulk Edit
              </Button>
            )}
            <Button 
              size="sm" 
              variant="ghost" 
              onClick={() => {
                setSelectedRows(new Set());
                setSelectedCells([]);
              }}
            >
              Deselect All
            </Button>
          </div>
        </div>
      )}
      
      {/* Status bar */}
      <div className="grid-status">
        <span>
          {selectedCells.length} cell{selectedCells.length !== 1 ? 's' : ''} selected
        </span>
        <span>
          {validationErrors.size} error{validationErrors.size !== 1 ? 's' : ''}
        </span>
      </div>
    </div>
  );
};

export default EditableGrid;