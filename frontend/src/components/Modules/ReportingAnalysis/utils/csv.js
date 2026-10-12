// Client-side CSV building and file downloads for report tables.

const needsQuoting = /[",\n\r]/;

/** One CSV cell: numbers stay raw (no thousands separators), text is quoted when needed. */
export const csvCell = (value) => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(Math.round(value * 10000) / 10000) : '';
  const text = String(value);
  return needsQuoting.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** rows: array of arrays (first row = header). Returns CSV text with a trailing newline. */
export const toCsv = (rows) => `${(rows || []).map(r => r.map(csvCell).join(',')).join('\n')}\n`;

/** Safe file-name fragment. */
export const slug = (text) => String(text || '')
  .trim()
  .replace(/[^A-Za-z0-9._-]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 60) || 'report';

/** Trigger a browser download of a Blob. */
export const downloadBlob = (blob, filename) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const downloadCsv = (rows, filename) =>
  downloadBlob(new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' }), filename);

/** File name from a Content-Disposition header, if any. */
export const filenameFromDisposition = (header) => {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
};
