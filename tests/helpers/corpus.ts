import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const CORPUS_DIR = join(process.cwd(), 'corpus');
export const PDF_SRC_DIR = join(CORPUS_DIR, '_pdf_src');
export const MOCK_DIR = join(process.cwd(), 'mock_data');

export const EXPECTED_DOC_IDS = [
  'BENEFITS', 'CONDUCT', 'CREATOR', 'EDITORIAL', 'EXPENSE', 'HANDBOOK', 'HOURS', 'INFOSEC',
  'LEAVE', 'ONBOARD', 'PERF', 'PTO', 'REMOTE', 'SAFETY', 'SOCIAL',
] as const;

export const WORDS_PER_PAGE = 450;

export interface CorpusFile {
  doc_id: string;
  format: 'md' | 'html' | 'pdf';
  /** For PDFs this is the authored markdown source in corpus/_pdf_src/. */
  sourcePath: string;
  frontMatter: Record<string, unknown>;
  body: string;
}

/** Deliberately tiny YAML reader: the corpus front matter is flat scalars plus one nested map. */
function parseFrontMatter(raw: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.trim() || /^\s/.test(line)) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (value) {
      out[key] = value.replace(/^["']|["']$/g, '');
      continue;
    }
    const nested: Record<string, string> = {};
    while (i + 1 < lines.length && /^\s+\S/.test(lines[i + 1]!)) {
      const child = lines[++i]!.trim();
      const ci = child.indexOf(':');
      nested[child.slice(0, ci).trim().replace(/^["']|["']$/g, '')] = child
        .slice(ci + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
    out[key] = nested;
  }
  return out;
}

export function loadCorpus(): CorpusFile[] {
  const files: CorpusFile[] = [];

  for (const name of readdirSync(CORPUS_DIR).sort()) {
    if (name.endsWith('.md') || name.endsWith('.html')) {
      const path = join(CORPUS_DIR, name);
      const raw = readFileSync(path, 'utf8');
      const isHtml = name.endsWith('.html');
      const fmMatch = isHtml
        ? /^<!--westline-frontmatter\r?\n([\s\S]*?)\r?\n-->/.exec(raw)
        : /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
      if (!fmMatch) throw new Error(`${name}: no front matter`);
      files.push({
        doc_id: name.replace(/\.(md|html)$/, ''),
        format: isHtml ? 'html' : 'md',
        sourcePath: path,
        frontMatter: parseFrontMatter(fmMatch[1]!),
        body: raw.slice(fmMatch[0].length),
      });
    }
  }

  // PDFs are generated from these sources by scripts/build-pdfs.mjs, which separately verifies
  // that the front matter and every heading survive text extraction.
  for (const name of readdirSync(PDF_SRC_DIR).sort()) {
    if (!name.endsWith('.md')) continue;
    const path = join(PDF_SRC_DIR, name);
    const raw = readFileSync(path, 'utf8');
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(raw);
    if (!fmMatch) throw new Error(`${name}: no front matter`);
    files.push({
      doc_id: name.replace(/\.md$/, ''),
      format: 'pdf',
      sourcePath: path,
      frontMatter: parseFrontMatter(fmMatch[1]!),
      body: raw.slice(fmMatch[0].length),
    });
  }

  return files.sort((a, b) => a.doc_id.localeCompare(b.doc_id));
}

/** Prose word count, with markup removed, used for the page-equivalent estimate. */
export function proseWords(file: CorpusFile): number {
  const text =
    file.format === 'html'
      ? file.body.replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/g, ' ')
      : file.body;
  return text.split(/\s+/).filter(Boolean).length;
}

export function readMock<T>(name: string): T {
  return JSON.parse(readFileSync(join(MOCK_DIR, name), 'utf8')) as T;
}
