#!/usr/bin/env node
/**
 * Render the markdown sources in corpus/_pdf_src/ to committed PDFs in corpus/.
 *
 * The point of shipping two documents as PDFs is that the ingestion pipeline has to survive a real
 * PDF text layer, not a synthetic one. So this renders normal-looking pages and then *verifies*
 * that the heading reconstruction the ingester relies on actually works against the extracted text.
 */
import { createWriteStream } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { extractPdfText } from './lib/pdf-text.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'corpus', '_pdf_src');
const OUT_DIR = join(ROOT, 'corpus');

/** Mirrors the ingester's heading pattern. Keep the two in step. */
const HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+(\S.{1,68})$/;

const MARGIN = 72;
const FONT_BODY = 'Helvetica';
const FONT_BOLD = 'Helvetica-Bold';

function splitFrontMatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) throw new Error('missing front matter');
  return { frontMatter: m[1], body: raw.slice(m[0].length) };
}

/**
 * Re-emit front matter as flow-style YAML so it survives PDF text extraction, where leading
 * indentation is not reliably preserved. `{"§7": "creator_partners"}` is valid YAML and parses
 * back to the same object a block mapping would have produced.
 */
function flattenFrontMatter(fm) {
  const lines = [];
  const raw = fm.split(/\r?\n/);
  for (let i = 0; i < raw.length; i++) {
    const line = raw[i];
    if (!line.trim()) continue;
    if (/^\s/.test(line)) continue; // handled by its parent key below
    const key = line.slice(0, line.indexOf(':'));
    const rest = line.slice(line.indexOf(':') + 1).trim();
    if (rest) {
      lines.push(`${key}: ${rest}`);
      continue;
    }
    // Nested block mapping -> flow mapping on one line.
    const entries = [];
    while (i + 1 < raw.length && /^\s+\S/.test(raw[i + 1])) {
      const child = raw[++i].trim();
      const ck = child.slice(0, child.indexOf(':')).trim().replace(/^"|"$/g, '');
      const cv = child.slice(child.indexOf(':') + 1).trim().replace(/^"|"$/g, '');
      entries.push(`"${ck}": "${cv}"`);
    }
    lines.push(`${key}: {${entries.join(', ')}}`);
  }
  return lines;
}

/** Strip the markdown that would otherwise show up as literal characters in the PDF. */
const clean = (s) =>
  s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[(.+?)\]\(.+?\)/g, '$1');

function render(doc, frontMatterLines, body) {
  doc.font(FONT_BODY).fontSize(9).fillColor('#444444');
  doc.text('---');
  for (const line of frontMatterLines) doc.text(line);
  doc.text('---');
  doc.moveDown(1);
  doc.fillColor('#000000');

  const paragraphs = body.split(/\r?\n\r?\n/);
  for (const para of paragraphs) {
    const text = clean(para.replace(/\r?\n/g, ' ').trim());
    if (!text) continue;

    if (text.startsWith('# ')) {
      doc.moveDown(0.5).font(FONT_BOLD).fontSize(20).text(text.slice(2)).moveDown(1);
    } else if (text.startsWith('### ')) {
      doc.moveDown(0.6).font(FONT_BOLD).fontSize(11.5).text(text.slice(4)).moveDown(0.35);
    } else if (text.startsWith('## ')) {
      doc.moveDown(0.9).font(FONT_BOLD).fontSize(14).text(text.slice(3)).moveDown(0.4);
    } else {
      doc.font(FONT_BODY).fontSize(10.5).text(text, { align: 'left', lineGap: 1.5 }).moveDown(0.55);
    }
  }
}

async function buildOne(srcPath, outPath) {
  const raw = await readFile(srcPath, 'utf8');
  const { frontMatter, body } = splitFrontMatter(raw);
  const fmLines = flattenFrontMatter(frontMatter);

  await new Promise((res, rej) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: MARGIN, autoFirstPage: true });
    const stream = createWriteStream(outPath);
    doc.pipe(stream);
    render(doc, fmLines, body);
    doc.end();
    stream.on('finish', res);
    stream.on('error', rej);
  });

  return { fmLines, body };
}

/**
 * The verification that makes this script worth running: extract the PDF we just wrote and confirm
 * that every line the ingester would read as a heading really is one. A wrapped body line starting
 * with a digit would silently invent a section, so it fails the build instead.
 */
async function verify(outPath, source) {
  const parsed = await extractPdfText(await readFile(outPath));
  const lines = parsed.text.split(/\r?\n/).map((l) => l.trim());

  const expected = new Set();
  for (const line of source.body.split(/\r?\n/)) {
    const m = /^#{2,3}\s+(\d+(?:\.\d+)*)\.?\s+(.*)$/.exec(line.trim());
    if (m) expected.add(m[1]);
  }

  const found = new Set();
  const bogus = [];
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (!m) continue;
    if (expected.has(m[1])) found.add(m[1]);
    else bogus.push(line);
  }

  const missing = [...expected].filter((s) => !found.has(s));
  if (!parsed.text.includes('doc_id:')) throw new Error(`${outPath}: front matter did not survive extraction`);
  if (missing.length) throw new Error(`${outPath}: headings lost in extraction: ${missing.join(', ')}`);
  if (bogus.length) throw new Error(`${outPath}: body lines look like headings:\n  ${bogus.join('\n  ')}`);

  return { sections: expected.size, pages: parsed.numpages, chars: parsed.text.length };
}

const files = (await readdir(SRC_DIR)).filter((f) => f.endsWith('.md')).sort();
for (const file of files) {
  const docId = file.replace(/\.md$/, '');
  const outPath = join(OUT_DIR, `${docId}.pdf`);
  const source = await buildOne(join(SRC_DIR, file), outPath);
  const stats = await verify(outPath, source);
  console.log(
    `${docId}.pdf  ${stats.pages} pages, ${stats.sections} sections, ${stats.chars} chars extracted`,
  );
}
