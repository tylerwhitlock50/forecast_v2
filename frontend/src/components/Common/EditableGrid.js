import React, { useState, useEffect, useRef, useCallback } from 'react';
import { FixedSizeGrid as Grid } from 'react-window';
import { useForecast } from '../../context/ForecastContext';
import ValidationIndicator from './ValidationIndicator';
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
  
  const gridRef = useRef(null);
  const editInputRef = useRef(null);
  const containerRef = useRef(null);

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

  // Cell component for rendering individual cells
  const Cell = ({ columnIndex, rowIndex, style }) => {
    const column = columns[columnIndex];
    const rowData = sortedData[rowIndex];
    const value = rowData[column.key];
    const isEditing = editingCell?.row === rowIndex && editingCell?.col === columnIndex;
    const isSelected = selectedCells.some(([r, c]) => r === rowIndex && c === columnIndex);
    const hasError = validationErrors.has(`${rowIndex}-${columnIndex}`);

    const handleClick = (e) => {
      e.stopPropagation();
      
      if (column.onClick) {
        column.onClick(rowIndex, columnIndex, rowData);
        return;
      }

      if (enableKeyboardNavigation) {
        setSelectedCells([[rowIndex, columnIndex]]);
        startEditing(rowIndex, columnIndex);
      }
    };

    const handleDoubleClick = () => {
      if (enableKeyboardNavigation) {
        startEditing(rowIndex, columnIndex);
      }
    };

    return (
      <div
        className={`grid-cell ${isSelected ? 'selected' : ''} ${hasError ? 'error' : ''}`}
        style={{
          ...style,
          width: column.width || columnWidth,
          minWidth: column.width || columnWidth,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          cursor: 'pointer',
          borderRight: '1px solid #f3f4f6',
          backgroundColor: isSelected ? '#fef3c7' : 'white',
          position: 'relative'
        }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {isEditing ? (
          <input
            ref={editInputRef}
            type={column.type === 'number' ? 'number' : 'text'}
            value={value || ''}
            onChange={(e) => {
              const newValue = column.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value;
              handleCellChange(rowIndex, columnIndex, newValue);
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
        outline: 'none'
      }}
    >
      {/* Single scrollable container for both header and data */}
      <div className="grid-container" style={{ height: '400px', overflow: 'auto' }}>
        <div className="grid-content" style={{ width: totalWidth }}>
          {/* Header that scrolls with the data */}
          <div className="grid-header" style={{ 
            height: headerHeight,
            display: 'flex',
            width: totalWidth,
            position: 'sticky',
            top: 0,
            backgroundColor: 'white',
            zIndex: 10,
            borderBottom: '1px solid #e2e8f0'
          }}>
            {columns.map((column, index) => (
              <div
                key={column.key}
                className={`header-cell ${sortConfig.key === column.key ? 'sorted' : ''}`}
                style={{ 
                  width: column.width || columnWidth, 
                  minWidth: column.width || columnWidth,
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 8px',
                  fontWeight: '600',
                  fontSize: '14px',
                  color: '#374151',
                  borderRight: '1px solid #e2e8f0'
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
            ))}
          </div>
          
          {/* Data rows */}
          <div className="grid-rows">
            {sortedData.map((rowData, rowIndex) => (
              <div 
                key={rowIndex} 
                className="grid-row"
                style={{ 
                  height: rowHeight,
                  display: 'flex',
                  width: totalWidth,
                  borderBottom: '1px solid #f3f4f6'
                }}
              >
                {columns.map((column, colIndex) => (
                  <Cell 
                    key={colIndex}
                    columnIndex={colIndex} 
                    rowIndex={rowIndex} 
                    style={{ height: '100%' }}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Bulk actions toolbar */}
      {enableBulkEdit && selectedCells.length > 1 && (
        <div className="bulk-actions">
          <button onClick={handleCopy}>Copy</button>
          <button onClick={handlePaste}>Paste</button>
          <button onClick={() => {
            selectedCells.forEach(([row, col]) => {
              handleCellChange(row, col, '');
            });
          }}>Clear</button>
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