// Tiny PDF writer — PURE, no dependencies (unit-tested).
//
// Why our own instead of rendering HTML in a headless browser: the spec says PDFs come from TRUSTED
// TEMPLATES ONLY. A headless browser renders whatever HTML/URLs end up in the data (SSRF, script, local
// files). Here every piece of lead text is just characters written into a PDF text operator — escaped, never
// interpreted. Nothing is fetched, nothing is executed.
//
// Limits (honest): standard Helvetica fonts → Latin text only (WinAnsi: English, Roman Urdu, accents, € – • …).
// Other scripts (Urdu/Arabic letters, emoji) are shown as "?" and counted in `replacedChars`, so the UI can
// say so; the CSV export always keeps the original text.
import zlib from 'node:zlib';

const A4 = { w: 595.28, h: 841.89 };
const M = 40; // margin

// Helvetica / Helvetica-Bold glyph widths (1/1000 em) for ASCII 32..126 (Adobe AFM)
const HELV = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const HELV_B = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];

// Unicode → WinAnsi (cp1252) for the 0x80–0x9F block
const CP1252 = { 0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f };

/** Unicode text → array of WinAnsi byte codes (+ how many characters could not be shown). */
export function toWinAnsi(text) {
  const out = [];
  let replaced = 0;
  for (const ch of String(text ?? '')) {
    const cp = ch.codePointAt(0);
    if (cp === 0x09) out.push(0x20);
    else if (cp < 0x20 || cp === 0x7f) continue; // control characters dropped
    else if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out.push(cp);
    else if (CP1252[cp]) out.push(CP1252[cp]);
    else {
      out.push(0x3f); // "?"
      replaced += 1;
    }
  }
  return { codes: out, replaced };
}

const charWidth = (code, bold) => (code >= 32 && code <= 126 ? (bold ? HELV_B : HELV)[code - 32] : 556);
export const textWidth = (codes, size, bold) => (codes.reduce((s, c) => s + charWidth(c, bold), 0) * size) / 1000;

/** PDF literal string: ( ) \ escaped, bytes kept as-is (latin1). */
const pdfString = (codes) => `(${codes.map((c) => (c === 0x28 || c === 0x29 || c === 0x5c ? `\\${String.fromCharCode(c)}` : String.fromCharCode(c))).join('')})`;

/** Word-wrap byte codes to a width; very long words are broken. → array of code arrays */
export function wrapCodes(codes, maxWidth, size, bold) {
  const lines = [];
  let line = [];
  let word = [];
  const flushWord = () => {
    if (!word.length) return;
    const candidate = line.length ? [...line, 0x20, ...word] : word;
    if (textWidth(candidate, size, bold) <= maxWidth) line = candidate;
    else {
      if (line.length) lines.push(line);
      line = [];
      // break a word that is wider than the line
      let piece = [];
      for (const c of word) {
        if (piece.length && textWidth([...piece, c], size, bold) > maxWidth) {
          lines.push(piece);
          piece = [];
        }
        piece.push(c);
      }
      line = piece;
    }
    word = [];
  };
  for (const c of codes) {
    if (c === 0x20) flushWord();
    else word.push(c);
  }
  flushWord();
  if (line.length || !lines.length) lines.push(line);
  return lines;
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

export class PdfDoc {
  /** @param footer text printed small at the bottom of EVERY page (who / when / "confidential") */
  constructor({ title = 'Document', footer = '', landscape = false } = {}) {
    this.title = title;
    this.footer = footer;
    this.size = landscape ? { w: A4.h, h: A4.w } : A4;
    this.pages = [];
    this.replacedChars = 0;
    this.newPage();
  }

  get width() {
    return this.size.w - 2 * M;
  }

  newPage() {
    this.page = [];
    this.pages.push(this.page);
    this.y = M;
    return this;
  }

  ensure(h) {
    if (this.y + h > this.size.h - M - 20) this.newPage();
  }

  enc(text) {
    const { codes, replaced } = toWinAnsi(text);
    this.replacedChars += replaced;
    return codes;
  }

  drawText(codes, x, y, size, bold, color = [0, 0, 0]) {
    this.page.push(`BT /${bold ? 'F2' : 'F1'} ${fmt(size)} Tf ${color.map(fmt).join(' ')} rg ${fmt(x)} ${fmt(this.size.h - y - size)} Td ${pdfString(codes)} Tj ET`);
  }

  rect(x, y, w, h, { fill = null, stroke = null } = {}) {
    const ops = [];
    if (fill) ops.push(`${fill.map(fmt).join(' ')} rg`);
    if (stroke) ops.push(`${stroke.map(fmt).join(' ')} RG 0.5 w`);
    ops.push(`${fmt(x)} ${fmt(this.size.h - y - h)} ${fmt(w)} ${fmt(h)} re ${fill && stroke ? 'B' : fill ? 'f' : 'S'}`);
    this.page.push(ops.join(' '));
  }

  /** Paragraph (wraps, breaks pages). */
  text(str, { size = 10, bold = false, color, indent = 0, gap = 4, maxLines = Infinity } = {}) {
    const lh = size * 1.3;
    for (const para of String(str ?? '').split(/\r?\n/)) {
      let lines = wrapCodes(this.enc(para), this.width - indent, size, bold);
      if (lines.length > maxLines) lines = [...lines.slice(0, maxLines - 1), [...lines[maxLines - 1].slice(0, -1), 0x85]];
      for (const l of lines) {
        this.ensure(lh);
        this.drawText(l, M + indent, this.y, size, bold, color);
        this.y += lh;
      }
    }
    this.y += gap;
    return this;
  }

  heading(str, level = 1) {
    const size = level === 1 ? 16 : level === 2 ? 12.5 : 11;
    this.ensure(size * 3);
    if (level > 1) this.y += 6;
    this.text(str, { size, bold: true, gap: level === 1 ? 6 : 3 });
    if (level === 2) {
      this.rect(M, this.y - 2, this.width, 0.6, { fill: [0.8, 0.8, 0.8] });
      this.y += 4;
    }
    return this;
  }

  /** Label / value pairs (two columns). Empty values are shown as "—" (missing stays visibly missing). */
  kv(pairs, { size = 9.5, labelWidth = 150 } = {}) {
    const lh = size * 1.3;
    for (const [label, value] of pairs) {
      const vLines = wrapCodes(this.enc(value === null || value === undefined || value === '' ? '—' : value), this.width - labelWidth, size, false);
      const lLines = wrapCodes(this.enc(label), labelWidth - 8, size, true);
      const h = Math.max(vLines.length, lLines.length) * lh;
      this.ensure(h);
      lLines.forEach((l, i) => this.drawText(l, M, this.y + i * lh, size, true, [0.35, 0.35, 0.35]));
      vLines.forEach((l, i) => this.drawText(l, M + labelWidth, this.y + i * lh, size, false));
      this.y += h + 2;
    }
    this.y += 4;
    return this;
  }

  /**
   * @param columns [{ header, width }] width = share of the line (numbers, any scale)
   * @param rows    array of arrays of cell values
   */
  table(columns, rows, { size = 8, maxCellLines = 4 } = {}) {
    const total = columns.reduce((s, c) => s + (c.width || 1), 0);
    const widths = columns.map((c) => (this.width * (c.width || 1)) / total);
    const lh = size * 1.25;
    const pad = 3;
    const drawRow = (cells, header) => {
      const wrapped = cells.map((v, i) => {
        let lines = wrapCodes(this.enc(v === null || v === undefined ? '' : v), widths[i] - 2 * pad, size, header);
        if (lines.length > maxCellLines) lines = [...lines.slice(0, maxCellLines - 1), [...lines[maxCellLines - 1].slice(0, -1), 0x85]];
        return lines;
      });
      const h = Math.max(...wrapped.map((l) => l.length)) * lh + 2 * pad;
      return { wrapped, h };
    };
    const paint = ({ wrapped, h }, header) => {
      let x = M;
      if (header) this.rect(M, this.y, this.width, h, { fill: [0.92, 0.92, 0.92] });
      wrapped.forEach((lines, i) => {
        lines.forEach((l, j) => this.drawText(l, x + pad, this.y + pad + j * lh, size, header));
        x += widths[i];
      });
      this.rect(M, this.y + h, this.width, 0.4, { fill: [0.85, 0.85, 0.85] });
      this.y += h;
    };
    const head = drawRow(columns.map((c) => c.header), true);
    this.ensure(head.h * 2);
    paint(head, true);
    for (const r of rows) {
      const row = drawRow(r, false);
      if (this.y + row.h > this.size.h - M - 20) {
        this.newPage();
        paint(head, true); // header repeated on every page
      }
      paint(row, false);
    }
    this.y += 8;
    return this;
  }

  spacer(h = 8) {
    this.y += h;
    return this;
  }

  /** → Buffer (a complete PDF file) */
  toBuffer() {
    const n = this.pages.length;
    this.pages.forEach((ops, i) => {
      const y = this.size.h - M + 6;
      const foot = this.enc(this.footer).slice(0, 180);
      ops.push(`BT /F1 7 Tf 0.45 0.45 0.45 rg ${fmt(M)} ${fmt(this.size.h - y - 7)} Td ${pdfString(foot)} Tj ET`);
      const pg = this.enc(`Page ${i + 1} of ${n}`);
      ops.push(`BT /F1 7 Tf 0.45 0.45 0.45 rg ${fmt(this.size.w - M - textWidth(pg, 7, false))} ${fmt(this.size.h - y - 7)} Td ${pdfString(pg)} Tj ET`);
    });

    const objects = []; // index i → object number i + 1
    const add = (body) => objects.push(body) && objects.length;
    const catalog = add(null);
    const pagesObj = add(null);
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const info = add(`<< /Title ${pdfString(this.enc(this.title).slice(0, 200))} /Producer (LeadFlow) /CreationDate (D:${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}Z) >>`);
    const pageNums = [];
    for (const ops of this.pages) {
      const data = zlib.deflateSync(Buffer.from(ops.join('\n'), 'latin1'));
      const content = add({ stream: data });
      pageNums.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${fmt(this.size.w)} ${fmt(this.size.h)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
    objects[pagesObj - 1] = `<< /Type /Pages /Kids [${pageNums.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageNums.length} >>`;

    const chunks = [Buffer.from('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n', 'latin1')];
    let offset = chunks[0].length;
    const offsets = [];
    objects.forEach((body, i) => {
      offsets.push(offset);
      const head = Buffer.from(`${i + 1} 0 obj\n`, 'latin1');
      const parts = body && body.stream
        ? [head, Buffer.from(`<< /Length ${body.stream.length} /Filter /FlateDecode >>\nstream\n`, 'latin1'), body.stream, Buffer.from('\nendstream\nendobj\n', 'latin1')]
        : [head, Buffer.from(`${body}\nendobj\n`, 'latin1')];
      for (const p of parts) {
        chunks.push(p);
        offset += p.length;
      }
    });
    const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
    chunks.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${offset}\n%%EOF\n`, 'latin1'));
    return Buffer.concat(chunks);
  }
}
