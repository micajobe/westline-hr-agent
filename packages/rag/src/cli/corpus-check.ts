import { resolve } from 'node:path';
import { chunkCorpus, corpusHash } from '../ingest/chunk.js';
import { parseSections } from '../ingest/headings.js';
import { loadCorpus } from '../ingest/load.js';

const WORDS_PER_PAGE = 450;
const PAGE_RANGE: [number, number] = [70, 90];

/**
 * `npm run corpus:check` -- the M1 acceptance gate as a script: every document loads through the
 * real ingester (so front matter is validated and every format normalises), section and chunk
 * counts per document, and the page estimate PRD §4 requires to land in 70–90. Exit 1 if any
 * document fails to load, has no sections, or the page total is out of range.
 */
async function main(): Promise<number> {
  const repoRoot = process.cwd();
  const corpusDir = resolve(repoRoot, process.env.CORPUS_DIR ?? 'corpus');
  const docs = await loadCorpus(corpusDir, repoRoot);
  const chunks = chunkCorpus(docs);

  let words = 0;
  let failures = 0;
  const rows = docs.map((d) => {
    const sections = parseSections(d.markdown);
    const w = d.markdown.split(/\s+/).filter(Boolean).length;
    words += w;
    const n = chunks.filter((c) => c.doc_id === d.doc_id).length;
    if (sections.length === 0 || n === 0) failures++;
    return {
      doc_id: d.doc_id,
      format: d.source_format,
      audience: d.front_matter.audience,
      overrides: Object.keys(d.front_matter.section_audience_overrides ?? {}).join(' ') || '-',
      sections: sections.length,
      chunks: n,
      words: w,
    };
  });
  console.table(rows);

  const pages = words / WORDS_PER_PAGE;
  const summary = {
    documents: docs.length,
    sections: rows.reduce((a, r) => a + r.sections, 0),
    chunks: chunks.length,
    words,
    page_equivalents: Number(pages.toFixed(1)),
    corpus_hash: corpusHash(docs),
  };
  console.log(JSON.stringify(summary, null, 2));

  if (pages < PAGE_RANGE[0] || pages > PAGE_RANGE[1]) {
    console.error(
      `corpus is ${pages.toFixed(1)} page equivalents; PRD §4 requires ${PAGE_RANGE[0]}–${PAGE_RANGE[1]}`,
    );
    failures++;
  }
  return failures === 0 ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(`[corpus:check] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
