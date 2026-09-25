// Export CSV was a dead button in the prototype. It is three lines of real work
// and the first thing anyone will press, so it does the actual thing here.

/** RFC 4180 quoting: double the quotes, wrap anything with a delimiter in them. */
function cell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(filename: string, headers: string[], rows: unknown[][]): void {
  // The BOM is what makes Excel open a UTF-8 file as UTF-8. Without it every
  // Filipino ingredient name with an accent arrives mangled.
  const blob = new Blob(['﻿' + toCsv(headers, rows)], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
