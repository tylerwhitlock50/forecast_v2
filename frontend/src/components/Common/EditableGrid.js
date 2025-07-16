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

  // Cell renderer
  const Cell = ({ columnIndex, rowIndex, style }) => {
    const column = columns[columnIndex];
    const rowData = sortedData[rowIndex];
    const value = rowData[column.key] || '';
    const isEditing = editingCell && editingCell.row === rowIndex && editingCell.col === columnIndex;
    const isSelected = selectedCells.some(([r, c]) => r === rowIndex && c === columnIndex);
    const errorKey = `${rowIndex}-${columnIndex}`;
    const hasError = validationErrors.has(errorKey);

    const handleClick = (e) => {
      console.log('Cell clicked:', { rowIndex, columnIndex, column: column.key, hasOnClick: !!column.onClick, event: e.type });
      
      // Visual feedback
      const target = e.currentTarget;
      target.style.backgroundColor = '#ffeb3b';
      setTimeout(() => {
        target.style.backgroundColor = '';
      }, 200);
      
      setSelectedCells([[rowIndex, columnIndex]]);
      
      // Handle custom onClick if defined
      if (column.onClick) {
        console.log('Calling custom onClick for column:', column.key);
        column.onClick(rowIndex, columnIndex, rowData);
      }
    };

    return (
      <div 
        style={{
          ...style,
          width: column.width || columnWidth,
          minWidth: column.width || columnWidth,
          height: rowHeight,
          padding: 0,
          border: '1px solid #dee2e6',
          borderTop: 'none',
          borderLeft: columnIndex === 0 ? '1px solid #dee2e6' : 'none',
          cursor: column.onClick ? 'pointer' : 'default'
        }}
        className={`grid-cell ${isSelected ? 'selected' : ''} ${hasError ? 'error' : ''} ${column.onClick ? 'clickable' : ''}`}
        onDoubleClick={() => startEditing(rowIndex, columnIndex)}
        onDragStart={() => handleDragStart(rowIndex, columnIndex)}
        onDragEnd={handleDragEnd}
      >
        {isEditing ? (
          <input
            ref={editInputRef}
            type={column.type === 'number' ? 'number' : 'text'}
            value={value}
            onChange={(e) => handleCellChange(rowIndex, columnIndex, e.target.value)}
            onBlur={stopEditing}
            onKeyDown={handleKeyDown}
            className="cell-input"
            style={{ 
              width: '100%', 
              height: '100%', 
              border: 'none', 
              outline: 'none',
              padding: '0 8px',
              fontSize: '14px'
            }}
          />
        ) : (
          <div 
            className="cell-content"
            onClick={column.onClick ? handleClick : undefined}
            style={{ cursor: column.onClick ? 'pointer' : 'default' }}
          >
            <span className="cell-value">
              {column.format ? column.format(value) : value}
            </span>
            {hasError && (
              <ValidationIndicator 
                type="error" 
                message={validationErrors.get(errorKey)} 
              />
            )}
          </div>
        )}
      </div>
    );
  };

  // Header renderer
  const Header = ({ columns, onSort, sortConfig }) => (
    <div className="grid-header" style={{ height: headerHeight }}>
      {columns.map((column, index) => (
        <div
          key={column.key}
          className={`header-cell ${sortConfig.key === column.key ? 'sorted' : ''}`}
          style={{ 
            width: column.width || columnWidth, 
            minWidth: column.width || columnWidth
          }}
          onClick={() => onSort(column.key)}
        >
          {column.title}
          {sortConfig.key === column.key && (
            <span className="sort-indicator">
              {sortConfig.direction === 'asc' ? '↑' : '↓'}
            </span>
          )}
          {column.required && <span className="required-indicator">*</span>}
        </div>
      ))}
    </div>
  );

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
      <Header 
        columns={columns} 
        onSort={handleSort} 
        sortConfig={sortConfig} 
      />
      
      <div className="grid-container" style={{ height: '400px', overflow: 'auto' }}>
        <div className="grid-rows" style={{ width: totalWidth }}>
          {sortedData.map((rowData, rowIndex) => (
            <div 
              key={rowIndex} 
              className="grid-row"
              style={{ 
                height: rowHeight,
                display: 'flex',
                width: totalWidth
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