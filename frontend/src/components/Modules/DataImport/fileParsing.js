// Pure helpers that turn an uploaded CSV / Excel file into plain row objects
// for the /import endpoints. The server owns column aliases and validation;
// these helpers only clean cell values, drop blank rows and reshape a "wide"
// sales forecast (one column per month) into one row per month.

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

const pad2 = (n) => String(n).padStart(2, '0');

const fullYear = (y) => {
  const n = Number(y);
  if (String(y).length <= 2) return 2000 + n;
  return n;
};

const validMonth = (year, month) => (
  Number.isFinite(year) && year >= 1900 && year <= 2200 && month >= 1 && month <= 12
    ? `${year}-${pad2(month)}`
    : null
);

/**
 * A header or cell that names one calendar month -> 'YYYY-MM', else null.
 * Accepts 2027-01, 2027-1, 2027/01, 2027-01-15, 1/2027, 01/2027, 1/15/2027,
 * 1/1/27, Jan-27, Jan 2027, January 2027, Jan-2027, Jan '27.
 */
export const parseMonthLabel = (value) => {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const shifted = new Date(value.getTime() + 12 * 3600 * 1000);
    return validMonth(shifted.getFullYear(), shifted.getMonth() + 1);
  }
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;

  let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?$/);
  if (m) return validMonth(Number(m[1]), Number(m[2]));

  m = text.match(/^(\d{1,2})[-/.](\d{4})$/);
  if (m) return validMonth(Number(m[2]), Number(m[1]));

  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return validMonth(fullYear(m[3]), Number(m[1]));

  m = text.match(/^([A-Za-z]{3,9})\.?[\s\-/']*'?(\d{2}|\d{4})$/);
  if (m) {
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) {
      const name = m[1].toLowerCase();
      const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
        'september', 'october', 'november', 'december'][idx];
      // "Jan", "Janu", "January", "Sept" are fine; reject words like "Marketing".
      if (full.startsWith(name) || name === 'sept') return validMonth(fullYear(m[2]), idx + 1);
    }
  }
  return null;
};

/** Local 'YYYY-MM-DD' for a Date read from Excel (shifted half a day so a UTC/local midnight lands on the right day). */
export const excelDateToString = (date) => {
  if (!(date instanceof Date) || isNaN(date.getTime())) return '';
  const shifted = new Date(date.getTime() + 12 * 3600 * 1000);
  return `${shifted.getFullYear()}-${pad2(shifted.getMonth() + 1)}-${pad2(shifted.getDate())}`;
};

const MONEY_RE = /^\(?\s*-?\s*\$?\s*-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s*\)?$/;

/**
 * Clean one cell: trim text, '' -> null, Excel dates -> 'YYYY-MM-DD',
 * "$1,110.00" -> "1110.00", "(25.00)" -> "-25.00". Percent text ("2%") and
 * ids are left for the server, which knows what each column means.
 */
export const cleanCell = (value) => {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return excelDateToString(value) || null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  const text = String(value).trim();
  if (!text) return null;
  const looksLikeMoney = text.includes('$') || /\d,\d{3}/.test(text) || /^\(.*\)$/.test(text);
  if (looksLikeMoney && MONEY_RE.test(text)) {
    const negative = text.includes('(') || text.includes('-');
    const digits = text.replace(/[^0-9.]/g, '');
    return negative ? `-${digits}` : digits;
  }
  return text;
};

/**
 * Raw parsed records -> rows to send. Headers are trimmed, blank headers and
 * blank cells dropped, rows with no values at all removed. Each returned
 * row keeps the file's own headers (the server maps aliases).
 */
export const cleanRows = (records) => {
  const out = [];
  (records || []).forEach((record) => {
    if (!record || typeof record !== 'object') return;
    const row = {};
    Object.entries(record).forEach(([rawKey, rawValue]) => {
      const key = String(rawKey ?? '').replace(/^﻿/, '').trim();
      if (!key || /^__EMPTY/.test(key) || /^__parsed_extra$/.test(key)) return;
      const value = cleanCell(rawValue);
      if (value === null) return;
      row[key] = value;
    });
    if (Object.keys(row).length > 0) out.push(row);
  });
  return out;
};

/** Distinct headers across rows, in first-seen order. */
export const collectHeaders = (rows) => {
  const seen = [];
  (rows || []).forEach((row) => {
    Object.keys(row || {}).forEach((key) => {
      if (!seen.includes(key)) seen.push(key);
    });
  });
  return seen;
};

// ---------------------------------------------------------------------------
// Sales forecast rows
// ---------------------------------------------------------------------------

const normKey = (key) => String(key || '').toLowerCase().replace(/[\s_\-.#]+/g, '');

const SALES_ALIASES = {
  customer_id: ['customerid', 'customer', 'customercode', 'customerno', 'customernumber', 'custid', 'cust', 'account', 'accountid', 'accountnumber'],
  customer_name: ['customername', 'accountname', 'custname'],
  customer_type: ['customertype', 'customerclass', 'channel', 'class', 'type', 'segment'],
  unit_id: ['unitid', 'productid', 'product', 'sku', 'item', 'itemid', 'itemnumber', 'partnumber', 'part', 'model', 'unit'],
  unit_name: ['unitname', 'productname', 'itemname', 'description', 'productdescription'],
  unit_type: ['unittype', 'producttype', 'category', 'productcategory'],
  period: ['period', 'month', 'date', 'shipmonth', 'forecastmonth', 'shipdate', 'monthyear'],
  quantity: ['quantity', 'qty', 'units', 'unitqty', 'volume', 'forecastqty', 'forecastunits'],
  unit_price: ['unitprice', 'price', 'netprice', 'sellprice', 'sellingprice', 'invoiceprice'],
  total_revenue: ['totalrevenue', 'revenue', 'sales', 'amount', 'extendedprice', 'extended', 'grosssales', 'dollars'],
};

const ALIAS_LOOKUP = Object.entries(SALES_ALIASES).reduce((acc, [canonical, aliases]) => {
  aliases.forEach((alias) => { acc[alias] = canonical; });
  return acc;
}, {});

/** Header -> canonical sales field (customer_id, unit_id, period, quantity, unit_price, ...) or null. */
export const salesFieldFor = (header) => ALIAS_LOOKUP[normKey(header)] || null;

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
};

// Row-total columns in a wide layout are not data; they are dropped.
const TOTAL_HEADERS = ['total', 'totals', 'sum', 'grandtotal', 'annual', 'annualtotal', 'fy', 'fytotal', 'year', 'yeartotal'];

/** A row-total column of a wide sales file ("Total", "FY Total", ...). */
export const isTotalHeader = (header) => TOTAL_HEADERS.includes(normKey(header));

/**
 * Detect a wide sales layout: no period column and two or more headers that
 * are months. Returns {monthColumns: [{header, period}], idColumns: [...]} or null.
 */
export const detectWideSales = (headers) => {
  const list = headers || [];
  if (list.some((h) => salesFieldFor(h) === 'period')) return null;
  const monthColumns = [];
  const idColumns = [];
  list.forEach((header) => {
    const period = parseMonthLabel(header);
    if (period) monthColumns.push({ header, period });
    else idColumns.push(header);
  });
  return monthColumns.length >= 2 ? { monthColumns, idColumns } : null;
};

/**
 * Rows from a sales file -> rows for POST /forecast/smart_import_sales.
 * Maps common header names to customer_id / unit_id / period / quantity /
 * unit_price (+ customer_name, customer_type, unit_name, unit_type for
 * auto-created records), melts a wide month-per-column layout into one row
 * per month (blank or zero months skipped), and derives a unit price from
 * revenue / quantity when only revenue is given. A blank price stays blank
 * so the server can fill it from the price list.
 *
 * Returns {rows, layout: 'long'|'wide', monthColumns, sourceRowFor: [index into input rows]}.
 */
export const prepareSalesRows = (rows) => {
  const input = rows || [];
  const headers = collectHeaders(input);
  const wide = detectWideSales(headers);
  const out = [];
  const sourceRowFor = [];

  const mapFields = (row, skip = []) => {
    const mapped = {};
    Object.entries(row).forEach(([key, value]) => {
      if (skip.includes(key)) return;
      const field = salesFieldFor(key);
      if (field && mapped[field] === undefined) mapped[field] = value;
      else if (!field && mapped[key] === undefined) mapped[key] = value;
    });
    return mapped;
  };

  const finish = (mapped) => {
    const row = { ...mapped };
    if (row.period !== undefined && row.period !== null) {
      // Excel date cells arrive as 'YYYY-MM-DD'; text like 'Jan-27' is left to the server.
      const month = parseMonthLabel(row.period);
      if (month) row.period = month;
    }
    const qty = toNumber(row.quantity);
    if (qty !== null) row.quantity = qty;
    const price = toNumber(row.unit_price);
    if (price !== null) row.unit_price = price;
    const revenue = toNumber(row.total_revenue);
    if ((row.unit_price === undefined || row.unit_price === null) && revenue !== null && qty) {
      row.unit_price = Math.round((revenue / qty) * 10000) / 10000;
    }
    delete row.total_revenue;
    if (row.unit_id !== undefined && row.unit_id !== null) row.unit_id = String(row.unit_id);
    if (row.customer_id !== undefined && row.customer_id !== null) row.customer_id = String(row.customer_id);
    return row;
  };

  if (wide) {
    const totalHeaders = wide.idColumns.filter(isTotalHeader);
    const monthHeaders = wide.monthColumns.map((c) => c.header).concat(totalHeaders);
    input.forEach((row, index) => {
      const base = mapFields(row, monthHeaders);
      wide.monthColumns.forEach(({ header, period }) => {
        const qty = toNumber(row[header]);
        if (qty === null || qty === 0) return;
        out.push(finish({ ...base, period, quantity: qty }));
        sourceRowFor.push(index);
      });
    });
    return { rows: out, layout: 'wide', monthColumns: wide.monthColumns, sourceRowFor };
  }

  input.forEach((row, index) => {
    out.push(finish(mapFields(row)));
    sourceRowFor.push(index);
  });
  return { rows: out, layout: 'long', monthColumns: [], sourceRowFor };
};

/** Short label for a row in an error table: the first two or three values. */
export const describeRow = (row, max = 3) => {
  if (!row) return '';
  return Object.values(row)
    .filter((v) => v !== null && v !== undefined && v !== '')
    .slice(0, max)
    .map((v) => String(v))
    .join(' · ');
};

// ---------------------------------------------------------------------------
// Header row detection
// ---------------------------------------------------------------------------

const HEADER_SCAN_ROWS = 10;

const isBlankCell = (value) => value === null || value === undefined || String(value).trim() === '';

/**
 * Does one cell read like a column name? Text that is not a number or an
 * amount ("Qty Per", "Jan-27", "C1001") and dates (wide sales files often
 * have real dates as month headers) count; numbers, "$118.00", "2%" and
 * "1,250" do not.
 */
export const looksLikeLabel = (value) => {
  if (isBlankCell(value)) return false;
  if (value instanceof Date) return !isNaN(value.getTime());
  if (typeof value === 'number' || typeof value === 'boolean') return false;
  const text = String(value).trim();
  return !/^[($\-+\s]*[\d,]*\.?\d+\s*%?\)?$/.test(text);
};

/**
 * Which row of a sheet is the header? ERP exports often put a title (and a
 * run date) above the real column names:
 *
 *   row 1: Ridgeline Precision Arms - Indented BOM Export (run 10/11/2026)
 *   row 2: BOM Number | Assembly Name | Rev | ... | FG Part Number
 *   row 3: BOM-RF100  | RF-100 assembly | A | ...
 *
 * The header is the first row within the first 10 whose filled cells mostly
 * read like column names, with at least 2 filled cells, more filled cells
 * than any (title) row above it, and at least half as many as the widest
 * row in those 10 (so a two-cell "Report ... / Run date ..." line above a
 * wide table is a title, not the header). When no row qualifies the first
 * non-blank row is the header, as before.
 *
 * Returns {index (0-based into matrix), skipped (non-blank rows above it)}.
 */
export const detectHeaderRow = (matrix, maxScan = HEADER_SCAN_ROWS) => {
  const rows = (matrix || []).slice(0, maxScan).map((row) => (Array.isArray(row) ? row : []));
  const filledOf = (row) => row.filter((cell) => !isBlankCell(cell));
  const widest = rows.reduce((max, row) => Math.max(max, filledOf(row).length), 0);
  let maxAbove = 0;
  let firstNonBlank = -1;
  for (let i = 0; i < rows.length; i += 1) {
    const filled = filledOf(rows[i]);
    if (filled.length > 0) {
      if (firstNonBlank < 0) firstNonBlank = i;
      const labels = filled.filter(looksLikeLabel).length;
      if (
        filled.length >= 2
        && labels / filled.length > 0.5
        && filled.length > maxAbove
        && filled.length * 2 >= widest
      ) {
        const skipped = rows.slice(0, i).filter((row) => filledOf(row).length > 0).length;
        return { index: i, skipped };
      }
      maxAbove = Math.max(maxAbove, filled.length);
    }
  }
  return { index: Math.max(firstNonBlank, 0), skipped: 0 };
};

const headerLabel = (value) => {
  if (value instanceof Date) return excelDateToString(value);
  if (value === null || value === undefined) return '';
  return String(value).replace(/^﻿/, '').trim();
};

/**
 * Rows of cells (a CSV or a sheet) -> {records, header}. The header row is
 * found with detectHeaderRow; rows above it are dropped and every later row
 * becomes {header label: cell}. Blank labels become __EMPTY_n (dropped by
 * cleanRows) and a repeated label gets " (2)" so no value silently
 * overwrites another. `headerLabels(index)` may supply the header cells'
 * display text (Excel: "Jan-27" rather than a Date).
 *
 * header: {row: 1-based row of the header in the file, skipped: title rows above it};
 * columns: the header labels in file order.
 */
export const matrixToRecords = (matrix, { headerLabels = null, firstRow = 1 } = {}) => {
  const list = Array.isArray(matrix) ? matrix : [];
  if (list.length === 0) return { records: [], header: null };
  const { index, skipped } = detectHeaderRow(list);
  const raw = headerLabels ? headerLabels(index) : (list[index] || []);
  const seen = {};
  const labels = (raw || []).map((value, col) => {
    const label = headerLabel(value);
    if (!label) return `__EMPTY_${col}`;
    const key = label.toLowerCase();
    seen[key] = (seen[key] || 0) + 1;
    return seen[key] > 1 ? `${label} (${seen[key]})` : label;
  });
  const records = list.slice(index + 1).map((row) => {
    const record = {};
    (Array.isArray(row) ? row : []).forEach((cell, col) => {
      record[labels[col] || `__EMPTY_${col}`] = cell === undefined ? null : cell;
    });
    return record;
  });
  return {
    records,
    header: { row: firstRow + index, skipped },
    // The file's column names in file order (blank ones left out).
    columns: labels.filter((label) => !/^__EMPTY/.test(label)),
  };
};

/** "Header found on row 2; 1 title row skipped", or null when the header is the first row. */
export const describeHeaderRow = (header) => {
  if (!header || !header.row || header.row <= 1) return null;
  const skipped = Number(header.skipped) || 0;
  const titles = skipped > 0 ? `; ${skipped} title ${skipped === 1 ? 'row' : 'rows'} skipped` : '';
  return `Header found on row ${header.row}${titles}`;
};

// ---------------------------------------------------------------------------
// File reading (browser only)
// ---------------------------------------------------------------------------

export const fileKind = (name) => {
  const lower = String(name || '').toLowerCase();
  if (lower.endsWith('.csv') || lower.endsWith('.txt')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || lower.endsWith('.xlsm')) return 'excel';
  return null;
};

/** Papa.parse rows (header: false) -> {records, header}. Exported for tests. */
export const csvMatrixToRecords = (data) => matrixToRecords(data || []);

const readCsv = (file) => new Promise((resolve, reject) => {
  import('papaparse').then(({ default: Papa }) => {
    Papa.parse(file, {
      header: false,
      // Blank lines are kept so the header's row number matches the file;
      // empty records are dropped by cleanRows.
      skipEmptyLines: false,
      complete: (result) => resolve({ ...csvMatrixToRecords(result.data), sheetName: null }),
      error: (err) => reject(err),
    });
  }).catch(reject);
});

/**
 * An Excel workbook (ArrayBuffer) -> {records, header, sheetName} from its
 * first sheet. Exported for tests (`XLSX` is the xlsx module).
 */
export const parseExcelBuffer = (XLSX, buffer) => {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { records: [], header: null, columns: [], sheetName: null };
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet['!ref']) return { records: [], header: null, columns: [], sheetName };
  const range = XLSX.utils.decode_range(sheet['!ref']);
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  // Header cells as Excel shows them: a month header formatted "Jan-27" is
  // read as "Jan-27", not as a date.
  const headerLabels = (index) => (matrix[index] || []).map((value, col) => {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r + index, c: range.s.c + col })];
    if (cell && typeof cell.w === 'string' && cell.w.trim()) return cell.w;
    return value;
  });
  const { records, header, columns } = matrixToRecords(matrix, { headerLabels, firstRow: range.s.r + 1 });
  return { records, header, columns, sheetName };
};

const readExcel = async (file) => {
  const XLSX = await import('xlsx');
  const buffer = await file.arrayBuffer();
  return parseExcelBuffer(XLSX, buffer);
};

/**
 * Read a CSV or Excel file (first sheet) -> {rows, headers, columns,
 * sheetName, header: {row, skipped}}. Title rows above the header are skipped (see
 * detectHeaderRow). Throws a readable Error for unsupported files.
 */
export const readImportFile = async (file) => {
  const kind = fileKind(file?.name);
  if (!kind) throw new Error('Choose a .csv, .xlsx or .xls file.');
  const { records, sheetName, header, columns } = kind === 'csv' ? await readCsv(file) : await readExcel(file);
  const rows = cleanRows(records);
  const headers = collectHeaders(rows);
  return {
    rows,
    headers,
    // Every column in file order, including any with no values.
    columns: [...(columns || []), ...headers.filter((h) => !(columns || []).includes(h))],
    sheetName,
    header: header || null,
  };
};
