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
  // Tracks whether focus is inside the grid container. Used to gate the
  // window-level keydown listener so shortcuts only fire when the user is
  // actually interacting with the grid.
  const isFocusedRef = useRef(false);

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

    const { key, ctrlKey, metaKey } = e;

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
      return;
    }

    // Not editing: require a selection for anything except clipboard paste
    if (selectedCells.length === 0) return;

    const [currentRow, currentCol] = selectedCells[0];
    let newRow = currentRow;
    let newCol = currentCol;
    let handled = false;

    switch (key) {
      case 'ArrowUp':
        newRow = Math.max(0, currentRow - 1);
        handled = true;
        break;
      case 'ArrowDown':
        newRow = Math.min(sortedData.length - 1, currentRow + 1);
        handled = true;
        break;
      case 'ArrowLeft':
        newCol = Math.max(0, currentCol - 1);
        handled = true;
        break;
      case 'ArrowRight':
        newCol = Math.min(columns.length - 1, currentCol + 1);
        handled = true;
        break;
      case 'Tab': {
        // Tab: next column, wrapping to first column of next row at the edge
        const nextCol = currentCol + 1;
        if (nextCol < columns.length) {
          newCol = nextCol;
        } else if (currentRow + 1 < sortedData.length) {
          newRow = currentRow + 1;
          newCol = 0;
        }
        handled = true;
        break;
      }
      case 'Enter':
      case 'F2': {
        const col = columns[currentCol];
        if (col && typeof col.onClick === 'function') {
          // Delegate activation to the column's custom onClick (e.g. opens
          // the parent-controlled edit modal for revenue cells).
          col.onClick(currentRow, currentCol, sortedData[currentRow]);
        } else {
          startEditing(currentRow, currentCol);
        }
        handled = true;
        break;
      }
      case 'Escape':
        // Modal-driven cells manage their own Esc; nothing to do here.
        break;
      case 'Delete': {
        const col = columns[currentCol];
        // Delete is unsafe for modal-driven cells (revenue cells in v1) —
        // skip those and leave the parent in charge.
        if (col && typeof col.onClick !== 'function') {
          handleCellChange(currentRow, currentCol, '');
        }
        handled = true;
        break;
      }
      default:
        break;
    }

    if (handled) {
      e.preventDefault();
      if (newRow !== currentRow || newCol !== currentCol) {
        setSelectedCells([[newRow, newCol]]);
      }
      return;
    }

    // Copy/Paste (single-cell only in this phase)
    if (ctrlKey || metaKey) {
      if (key === 'c' || key === 'C') {
        e.preventDefault();
        handleCopy();
      } else if (key === 'v' || key === 'V') {
        e.preventDefault();
        handlePaste();
      }
    }
  }, [editingCell, selectedCells, columns, sortedData, enableKeyboardNavigation, startEditing, stopEditing, handleCellChange]);
  // Note: handleCopy/handlePaste are referenced via closure below; adding
  // them to the dependency list here would create a circular definition.
  // They are stable enough for this single-cell phase.

  // Handle copy/paste (single-cell only in this phase — Phase 1 will
  // handle ranges and multi-cell selections).
  const handleCopy = useCallback(() => {
    if (selectedCells.length === 0) return;

    const copiedData = selectedCells.map(([row, col]) => ({
      row,
      col,
      value: sortedData[row][columns[col].key]
    }));

    setCopiedCells(copiedData);

    // Best-effort write to the system clipboard so the user can paste
    // into other apps. Keep the in-memory copy either way.
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        const text = copiedData
          .map(c => (c.value === undefined || c.value === null ? '' : String(c.value)))
          .join('\n');
        navigator.clipboard.writeText(text).catch(() => {});
      }
    } catch (err) {
      // Ignore — in-memory fallback still works.
    }

    actions.showToast('Copied to clipboard', 'success');
  }, [selectedCells, sortedData, columns, actions]);

  const handlePaste = useCallback(() => {
    if (selectedCells.length === 0) return;

    const [startRow, startCol] = selectedCells[0];

    const applyFromMemory = () => {
      if (copiedCells.length === 0) return false;
      copiedCells.forEach(({ value }, index) => {
        const targetRow = startRow + Math.floor(index / copiedCells.length);
        const targetCol = startCol + (index % copiedCells.length);

        if (targetRow < sortedData.length && targetCol < columns.length) {
          const targetCol2 = columns[targetCol];
          // Never try to clear/write through modal-driven columns.
          if (targetCol2 && typeof targetCol2.onClick !== 'function') {
            handleCellChange(targetRow, targetCol, value);
          }
        }
      });
      actions.showToast('Pasted from clipboard', 'success');
      return true;
    };

    // Prefer the system clipboard if available (single-cell).
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.readText) {
        navigator.clipboard.readText().then(text => {
          if (text === undefined || text === null || text === '') {
            applyFromMemory();
            return;
          }
          const col = columns[startCol];
          if (col && typeof col.onClick === 'function') {
            // Don't write through modal-driven cells.
            return;
          }
          handleCellChange(startRow, startCol, text);
          actions.showToast('Pasted from clipboard', 'success');
        }).catch(() => {
          applyFromMemory();
        });
        return;
      }
    } catch (err) {
      // Fall through to in-memory fallback.
    }

    applyFromMemory();
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

      // Always register the click as a selection so subsequent keyboard
      // shortcuts (arrow keys, Enter, Ctrl+C) know which cell is active —
      // including cells that delegate activation to a custom onClick
      // (e.g. the revenue edit modal).
      if (enableKeyboardNavigation) {
        setSelectedCells([[rowIndex, columnIndex]]);
      }

      if (column.onClick) {
        column.onClick(rowIndex, columnIndex, rowData);
        return;
      }

      if (enableKeyboardNavigation) {
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

  // Add keyboard event listener. The listener is attached to window (the
  // previous containerRef-based listener never fired because the container
  // rarely received focus), and we gate it with an isFocused check so the
  // grid only reacts to keys when the user is actually interacting with it.
  useEffect(() => {
    const listener = (e) => {
      const container = containerRef.current;
      if (!container) return;

      const active = document.activeElement;
      const focusInside = !!(active && container.contains(active));

      if (!focusInside && !isFocusedRef.current) return;

      // Ignore keystrokes when a different input/textarea outside the grid
      // is focused (e.g. the global "?" shortcut shouldn't collide with
      // shortcuts while typing in other fields).
      if (active && !container.contains(active)) {
        const tag = (active.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || active.isContentEditable) {
          return;
        }
      }

      handleKeyDown(e);
    };

    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleKeyDown]);

  // Track focus state so keyboard shortcuts fire after a click-to-select
  // even when focus briefly leaves the container (e.g. a cell's custom
  // onClick opens a modal and moves focus to the modal's input, then the
  // modal closes and focus returns to the body).
  //
  // The window-level keydown listener uses this flag together with
  // document.activeElement checks, so it is safe to leave this "sticky" —
  // keys won't fire while another real input/textarea owns focus.
  const handleContainerMouseDown = useCallback(() => {
    isFocusedRef.current = true;
  }, []);

  const handleContainerFocus = useCallback(() => {
    isFocusedRef.current = true;
  }, []);

  return (
    <div
      ref={containerRef}
      className={`editable-grid ${className}`}
      tabIndex={0}
      onMouseDown={handleContainerMouseDown}
      onFocus={handleContainerFocus}
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
