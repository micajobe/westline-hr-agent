import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { parseFrontMatter } from './frontmatter.js';
import {
  htmlToMarkdown,
  pdfToMarkdown,
  splitHtmlFrontMatter,
  splitMarkdownFrontMatter,
  tidyMarkdown,
} from './normalize.js';
import type { LoadedDocument, SourceFormat } from '../types.js';

const FORMAT_BY_EXT: Record<string, SourceFormat> = { '.md': 'md', '.html': 'html', '.pdf': 'pdf' };

/**
 * Load every policy document under `corpusDir`, detecting format by extension and normalising
 * each to markdown. Subdirectories (e.g. `_pdf_src/`, the authored sources the PDFs are built
 * from) are ignored on purpose: indexing both the PDF and its source would double every citation.
 */
export async function loadCorpus(corpusDir: string, repoRoot = process.cwd()): Promise<LoadedDocument[]> {
  const entries = (await readdir(corpusDir, { withFileTypes: true }))
    .filter((e) => e.isFile() && FORMAT_BY_EXT[extname(e.name)])
    .map((e) => e.name)
    .sort();

  const docs: LoadedDocument[] = [];
  for (const name of entries) {
    const path = join(corpusDir, name);
    docs.push(await loadDocument(path, relative(repoRoot, path)));
  }

  const seen = new Map<string, string>();
  for (const d of docs) {
    const prior = seen.get(d.doc_id);
    if (prior) throw new Error(`duplicate doc_id ${d.doc_id} in ${prior} and ${d.path}`);
    seen.set(d.doc_id, d.path);
  }
  return docs.sort((a, b) => a.doc_id.localeCompare(b.doc_id));
}

export async function loadDocument(path: string, displayPath = path): Promise<LoadedDocument> {
  const format = FORMAT_BY_EXT[extname(path)];
  if (!format) throw new Error(`${displayPath}: unsupported format`);

  let yaml: string;
  let markdown: string;

  if (format === 'md') {
    const split = splitMarkdownFrontMatter(await readFile(path, 'utf8'), displayPath);
    yaml = split.yaml;
    markdown = tidyMarkdown(split.body);
  } else if (format === 'html') {
    const split = splitHtmlFrontMatter(await readFile(path, 'utf8'), displayPath);
    yaml = split.yaml;
    markdown = htmlToMarkdown(split.body);
  } else {
    const split = await pdfToMarkdown(await readFile(path), displayPath);
    yaml = split.yaml;
    markdown = split.body;
  }

  const front_matter = parseFrontMatter(displayPath, yaml);
  return {
    doc_id: front_matter.doc_id,
    title: front_matter.title,
    source_format: format,
    path: displayPath,
    front_matter,
    markdown,
  };
}
