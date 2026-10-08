// A small, strict CSV parser (RFC 4180): quoted fields, "" escapes, commas/newlines inside quotes,
// CRLF or LF, UTF-8 BOM, and auto-detected delimiter (comma, semicolon or tab — Excel in some
// countries saves with semicolons). Hard limits protect the server from huge or malformed files.
export const CSV_LIMITS = Object.freeze({ maxBytes: 2 * 1024 * 1024, maxRows: 5000, maxColumns: 50, maxCellLength: 5000 });

export class CsvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CsvError';
  }
}

function detectDelimiter(text) {
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (const ch of firstLine) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch in counts) counts[ch] += 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][1] > 0 ? Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0] : ',';
}

/** @returns {{ headers: string[], rows: string[][], delimiter: string }} */
export function parseCsv(input, limits = CSV_LIMITS) {
  if (typeof input !== 'string') throw new CsvError('File must be text');
  if (Buffer.byteLength(input, 'utf8') > limits.maxBytes) throw new CsvError(`File is larger than ${limits.maxBytes / 1024 / 1024} MB`);
  const text = input.replace(/^﻿/, ''); // Excel adds a BOM
  if (!text.trim()) throw new CsvError('The file is empty');
  if (text.includes('\u0000')) throw new CsvError('This does not look like a text CSV file');

  const delimiter = detectDelimiter(text);
  const records = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  let i = 0;

  const pushCell = () => {
    if (cell.length > limits.maxCellLength) throw new CsvError(`A cell is longer than ${limits.maxCellLength} characters (row ${records.length + 1})`);
    row.push(cell);
    cell = '';
    if (row.length > limits.maxColumns) throw new CsvError(`More than ${limits.maxColumns} columns`);
  };
  const pushRow = () => {
    pushCell();
    if (!row.every((c) => c.trim() === '')) records.push(row); // skip blank lines and rows of only commas
    row = [];
    if (records.length > limits.maxRows + 1) throw new CsvError(`More than ${limits.maxRows} rows — split the file`);
  };

  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else if (ch === delimiter) {
      pushCell();
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      pushRow();
    } else {
      cell += ch;
    }
    i += 1;
  }
  if (inQuotes) throw new CsvError('A quoted value is never closed (check for a missing ")');
  if (cell !== '' || row.length) pushRow();

  if (records.length < 2) throw new CsvError('The file needs a header row and at least one data row');
  const headers = records[0].map((h) => h.trim());
  if (headers.some((h) => !h)) throw new CsvError('Every column needs a header name');
  const rows = records.slice(1).map((r) => headers.map((_, idx) => (r[idx] ?? '').trim()));
  return { headers, rows, delimiter };
}

// ---------------------------------------------------------------- header → field mapping

export const IMPORT_FIELDS = ['name', 'personName', 'companyName', 'industry', 'country', 'city', 'website', 'email', 'phone', 'socialProfileUrl', 'source', 'notes'];

const SYNONYMS = {
  name: ['name', 'lead', 'lead name', 'title'],
  personName: ['person', 'person name', 'contact', 'contact name', 'contact person', 'full name', 'first name'],
  companyName: ['company', 'company name', 'business', 'business name', 'organization', 'organisation', 'brand'],
  industry: ['industry', 'category', 'sector', 'business type'],
  country: ['country'],
  city: ['city', 'town', 'location'],
  website: ['website', 'web', 'site', 'url', 'website url', 'domain'],
  email: ['email', 'e-mail', 'email address', 'mail'],
  phone: ['phone', 'phone number', 'mobile', 'cell', 'tel', 'telephone', 'whatsapp', 'contact number'],
  socialProfileUrl: ['social', 'social profile', 'social url', 'instagram', 'facebook', 'linkedin', 'profile', 'profile url'],
  source: ['source', 'lead source'],
  notes: ['notes', 'note', 'description', 'comments', 'comment', 'remarks'],
};

const canon = (h) => h.toLowerCase().replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** { "Company Name": "companyName", "E-mail": "email", "Random": null } — each field used at most once */
export function suggestMapping(headers) {
  const used = new Set();
  const mapping = {};
  for (const header of headers) {
    const c = canon(header);
    // compare both sides in the same simplified form ("E-mail" = "e mail" = "e-mail")
    const field = IMPORT_FIELDS.find((f) => !used.has(f) && (SYNONYMS[f].some((syn) => canon(syn) === c) || canon(f) === c || f.toLowerCase() === c.replace(/\s/g, '')));
    mapping[header] = field || null;
    if (field) used.add(field);
  }
  return mapping;
}
