import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../lib/utils';

/**
 * ForecastGrid — a spreadsheet-style editable table.
 *
 * One real <table>, so the header and body share column widths by
 * construction; a sticky header row and sticky leading columns; numbers
 * right-aligned with tabular figures; edit on commit (Enter / blur), never on
 * keystroke; and every callback identifies the row by its id, never by index,
 * so sorting or filtering can never target the wrong row.
 *
 * Props
 *  - columns: [{
 *      key, title, width (px), align ('left'|'right'), sticky (bool),
 *      editable (bool | (row) => bool), type ('text'|'number'),
 *      format: (value, row) => string, parse: (text) => value,
 *      validate: (value, row) => string|null, className, headerTitle, group
 *    }]
 *  - rows: [{ id, ...cells }]
 *  - onCommit: async (rowId, columnKey, value, row) => void   (only called when the value changed)
 *  - footer: { [columnKey]: node }   optional totals row
 *  - maxHeight: CSS size for the scroll area (default: viewport minus 320px)
 *  - emptyMessage
 */
const DEFAULT_WIDTH = 110;

const isEditable = (column, row) =>
  typeof column.editable === 'function' ? column.editable(row) : Boolean(column.editable);

const defaultFormat = (value) => (value === null || value === undefined ? '' : String(value));

const defaultParse = (column) => (text) => {
  if (column.type === 'number') {
    const cleaned = String(text).replace(/[$,\s]/g, '');
    if (cleaned === '' || cleaned === '-') return 0;
    const num = Number(cleaned);
    return Number.isFinite(num) ? num : NaN;
  }
  return text;
};

const ForecastGrid = ({
  columns,
  rows,
  onCommit,
  footer = null,
  maxHeight = 'calc(100vh - 320px)',
  emptyMessage = 'No rows',
  className,
  getRowClassName,
}) => {
  const [sort, setSort] = useState({ key: null, direction: 'asc' });
  const [selected, setSelected] = useState(null); // { rowId, key }
  const [editing, setEditing] = useState(null); // { rowId, key, text }
  const [pending, setPending] = useState(() => new Set()); // "rowId::key" being saved
  const [errors, setErrors] = useState({}); // "rowId::key" -> message
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const editingRef = useRef(null);
  editingRef.current = editing;

  // Sticky column offsets are the cumulative widths of the sticky columns before them.
  const stickyLeft = useMemo(() => {
    const offsets = {};
    let left = 0;
    columns.forEach(c => {
      if (c.sticky) {
        offsets[c.key] = left;
        left += c.width || DEFAULT_WIDTH;
      }
    });
    return offsets;
  }, [columns]);

  const sortedRows = useMemo(() => {
    if (!sort.key) return rows;
    const column = columns.find(c => c.key === sort.key);
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sort.key];
      const bv = b[sort.key];
      if (av === bv) return 0;
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (column?.type === 'number') return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
    });
  }, [rows, sort, columns]);

  const rowIndexById = useMemo(() => {
    const map = new Map();
    sortedRows.forEach((r, i) => map.set(r.id, i));
    return map;
  }, [sortedRows]);

  const colIndexByKey = useMemo(() => {
    const map = new Map();
    columns.forEach((c, i) => map.set(c.key, i));
    return map;
  }, [columns]);

  const cellId = (rowId, key) => `${rowId}::${key}`;

  const startEditing = useCallback((row, column, initialText = null) => {
    if (!isEditable(column, row)) return;
    const value = row[column.key];
    const text = initialText !== null ? initialText : (value === null || value === undefined ? '' : String(value));
    setEditing({ rowId: row.id, key: column.key, text, selectAll: initialText === null });
    setSelected({ rowId: row.id, key: column.key });
  }, []);

  const cancelEditing = useCallback(() => {
    setEditing(null);
    containerRef.current?.focus();
  }, []);

  const commit = useCallback(async (edit) => {
    const row = rows.find(r => r.id === edit.rowId);
    const column = columns.find(c => c.key === edit.key);
    if (!row || !column) return true;
    const parse = column.parse || defaultParse(column);
    const value = parse(edit.text);
    const id = cellId(edit.rowId, edit.key);

    if (column.type === 'number' && Number.isNaN(value)) {
      setErrors(prev => ({ ...prev, [id]: 'Not a number' }));
      return false;
    }
    const message = column.validate ? column.validate(value, row) : null;
    if (message) {
      setErrors(prev => ({ ...prev, [id]: message }));
      return false;
    }
    setErrors(prev => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const current = row[column.key];
    const unchanged = column.type === 'number'
      ? Number(current || 0) === Number(value)
      : (current ?? '') === (value ?? '');
    if (unchanged || !onCommit) return true;

    setPending(prev => new Set(prev).add(id));
    try {
      await onCommit(row.id, column.key, value, row);
      return true;
    } catch (err) {
      setErrors(prev => ({ ...prev, [id]: err?.userMessage || err?.message || 'Save failed' }));
      return false;
    } finally {
      setPending(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }, [rows, columns, onCommit]);

  const moveSelection = useCallback((dRow, dCol, from = null) => {
    const origin = from || selected;
    if (!origin) return;
    const r = rowIndexById.get(origin.rowId);
    const c = colIndexByKey.get(origin.key);
    if (r === undefined || c === undefined) return;
    const nr = Math.min(sortedRows.length - 1, Math.max(0, r + dRow));
    const nc = Math.min(columns.length - 1, Math.max(0, c + dCol));
    const row = sortedRows[nr];
    const column = columns[nc];
    if (row && column) setSelected({ rowId: row.id, key: column.key });
  }, [selected, rowIndexById, colIndexByKey, sortedRows, columns]);

  const finishEditing = useCallback(async (move = null) => {
    const edit = editingRef.current;
    if (!edit) return;
    // Clear synchronously: the input's blur and a click on another cell can
    // both call this for the same edit, and it must commit exactly once.
    editingRef.current = null;
    setEditing(null);
    const ok = await commit(edit);
    containerRef.current?.focus();
    if (ok && move) moveSelection(move.dRow, move.dCol, edit);
  }, [commit, moveSelection]);

  // Keep the selected cell visible.
  useEffect(() => {
    if (!selected || !containerRef.current) return;
    const el = containerRef.current.querySelector(`[data-cell="${CSS.escape(cellId(selected.rowId, selected.key))}"]`);
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selected]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (editing.selectAll) inputRef.current.select();
      else {
        const end = inputRef.current.value.length;
        inputRef.current.setSelectionRange(end, end);
      }
    }
  }, [editing?.rowId, editing?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleKeyDown = (e) => {
    if (editing) return; // the input handles its own keys
    if (!selected) return;
    const row = rows.find(r => r.id === selected.rowId);
    const column = columns.find(c => c.key === selected.key);
    if (!row || !column) return;

    const { key, ctrlKey, metaKey } = e;
    const mod = ctrlKey || metaKey;

    if (key === 'ArrowUp') { e.preventDefault(); moveSelection(-1, 0); return; }
    if (key === 'ArrowDown') { e.preventDefault(); moveSelection(1, 0); return; }
    if (key === 'ArrowLeft') { e.preventDefault(); moveSelection(0, -1); return; }
    if (key === 'ArrowRight') { e.preventDefault(); moveSelection(0, 1); return; }
    if (key === 'Tab') { e.preventDefault(); moveSelection(0, e.shiftKey ? -1 : 1); return; }
    if (key === 'Enter' || key === 'F2') { e.preventDefault(); startEditing(row, column); return; }
    if (key === 'Delete' || key === 'Backspace') {
      if (isEditable(column, row)) {
        e.preventDefault();
        commit({ rowId: row.id, key: column.key, text: column.type === 'number' ? '0' : '' });
      }
      return;
    }
    if (mod && (key === 'c' || key === 'C')) {
      e.preventDefault();
      const value = row[column.key];
      try { navigator.clipboard?.writeText(value === null || value === undefined ? '' : String(value)); } catch { /* ignore */ }
      return;
    }
    if (mod && (key === 'v' || key === 'V')) {
      if (!isEditable(column, row) || !navigator.clipboard?.readText) return;
      e.preventDefault();
      navigator.clipboard.readText().then(text => {
        if (text !== undefined && text !== null) commit({ rowId: row.id, key: column.key, text: String(text).trim() });
      }).catch(() => {});
      return;
    }
    // Typing a character starts editing with that character (like a spreadsheet).
    if (!mod && key.length === 1 && isEditable(column, row)) {
      e.preventDefault();
      startEditing(row, column, key);
    }
  };

  const handleInputKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finishEditing({ dRow: 1, dCol: 0 }); }
    else if (e.key === 'Tab') { e.preventDefault(); finishEditing({ dRow: 0, dCol: e.shiftKey ? -1 : 1 }); }
    else if (e.key === 'Escape') { e.preventDefault(); cancelEditing(); }
  };

  const toggleSort = (key) => {
    setSort(prev => ({ key, direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc' }));
  };

  const totalWidth = columns.reduce((sum, c) => sum + (c.width || DEFAULT_WIDTH), 0);
  const groups = useMemo(() => {
    if (!columns.some(c => c.group)) return null;
    const out = [];
    columns.forEach(c => {
      const last = out[out.length - 1];
      if (last && last.group === (c.group || '') && !c.sticky && !last.sticky) last.span += 1;
      else out.push({ group: c.group || '', span: 1, sticky: Boolean(c.sticky), key: c.key });
    });
    return out;
  }, [columns]);

  return (
    <div className={cn('forecast-grid rounded-md border border-gray-200 bg-white', className)}>
      <div
        ref={containerRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="overflow-auto outline-none focus-visible:ring-2 focus-visible:ring-orange-400"
        style={{ maxHeight }}
      >
        <table className="border-separate border-spacing-0 text-sm" style={{ minWidth: totalWidth, tableLayout: 'fixed', width: 'max-content' }}>
          <colgroup>
            {columns.map(c => <col key={c.key} style={{ width: c.width || DEFAULT_WIDTH }} />)}
          </colgroup>
          <thead>
            {groups && (
              <tr>
                {groups.map((g, i) => (
                  <th
                    key={`${g.key}-${i}`}
                    colSpan={g.span}
                    className={cn(
                      'sticky top-0 z-20 border-b border-gray-200 bg-gray-50 px-2 py-1 text-center text-[11px] font-semibold uppercase tracking-wide text-gray-500',
                      g.sticky && 'z-30'
                    )}
                    style={g.sticky ? { left: stickyLeft[g.key] } : undefined}
                  >
                    {g.group}
                  </th>
                ))}
              </tr>
            )}
            <tr>
              {columns.map(c => {
                const sorted = sort.key === c.key;
                return (
                  <th
                    key={c.key}
                    title={c.headerTitle || c.title}
                    onClick={() => toggleSort(c.key)}
                    className={cn(
                      'sticky z-20 cursor-pointer select-none whitespace-nowrap border-b border-r border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100',
                      groups ? 'top-[25px]' : 'top-0',
                      c.align === 'right' ? 'text-right' : 'text-left',
                      c.sticky && 'z-30'
                    )}
                    style={c.sticky ? { left: stickyLeft[c.key] } : undefined}
                  >
                    <span className="overflow-hidden text-ellipsis">{c.title}</span>
                    {sorted && <span className="ml-1 text-gray-400">{sort.direction === 'asc' ? '▲' : '▼'}</span>}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-4 py-8 text-center text-gray-500">{emptyMessage}</td>
              </tr>
            )}
            {sortedRows.map(row => (
              <tr key={row.id} className={cn('group', getRowClassName?.(row))}>
                {columns.map(column => {
                  const id = cellId(row.id, column.key);
                  const isSelected = selected?.rowId === row.id && selected?.key === column.key;
                  const isEditing = editing?.rowId === row.id && editing?.key === column.key;
                  const editable = isEditable(column, row);
                  const error = errors[id];
                  const saving = pending.has(id);
                  const value = row[column.key];
                  const format = column.format || defaultFormat;
                  return (
                    <td
                      key={column.key}
                      data-cell={id}
                      title={error || undefined}
                      onMouseDown={() => {
                        if (editing && !isEditing) finishEditing();
                        setSelected({ rowId: row.id, key: column.key });
                        containerRef.current?.focus();
                      }}
                      onDoubleClick={() => startEditing(row, column)}
                      className={cn(
                        'relative h-9 whitespace-nowrap border-b border-r border-gray-100 px-2 py-0 align-middle',
                        column.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                        column.sticky && 'sticky z-10 bg-white group-hover:bg-gray-50',
                        !column.sticky && 'group-hover:bg-gray-50/70',
                        editable ? 'cursor-cell' : 'cursor-default text-gray-600',
                        !editable && !column.sticky && 'bg-gray-50/40',
                        isSelected && 'z-[11] ring-2 ring-inset ring-orange-500',
                        error && 'bg-red-50',
                        saving && 'opacity-60',
                        column.className
                      )}
                      style={column.sticky ? { left: stickyLeft[column.key] } : undefined}
                    >
                      {isEditing ? (
                        <input
                          ref={inputRef}
                          value={editing.text}
                          onChange={(e) => setEditing(prev => ({ ...prev, text: e.target.value }))}
                          onKeyDown={handleInputKeyDown}
                          onBlur={() => finishEditing()}
                          inputMode={column.type === 'number' ? 'decimal' : 'text'}
                          className={cn(
                            'h-full w-full border-0 bg-white p-0 text-sm outline-none',
                            column.align === 'right' ? 'text-right tabular-nums' : 'text-left'
                          )}
                        />
                      ) : (
                        <span className="block overflow-hidden text-ellipsis">{format(value, row)}</span>
                      )}
                      {error && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-red-500" />}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {footer && sortedRows.length > 0 && (
            <tfoot>
              <tr>
                {columns.map(c => (
                  <td
                    key={c.key}
                    className={cn(
                      'sticky bottom-0 z-20 whitespace-nowrap border-r border-t border-gray-200 bg-gray-50 px-2 py-2 text-xs font-semibold text-gray-800',
                      c.align === 'right' ? 'text-right tabular-nums' : 'text-left',
                      c.sticky && 'z-30'
                    )}
                    style={c.sticky ? { left: stickyLeft[c.key] } : undefined}
                  >
                    {footer[c.key] ?? ''}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <div className="flex items-center justify-between border-t border-gray-100 px-3 py-1.5 text-xs text-gray-500">
        <span>{rows.length} row{rows.length === 1 ? '' : 's'}</span>
        <span>
          {pending.size > 0 ? 'Saving…' : Object.keys(errors).length > 0 ? `${Object.keys(errors).length} cell${Object.keys(errors).length === 1 ? '' : 's'} need attention` : 'Click a cell, type to edit, Enter to save'}
        </span>
      </div>
    </div>
  );
};

export default ForecastGrid;
