/**
 * PDF text extraction, shared by the corpus PDF builder and mirrored by the ingester
 * (packages/rag/src/ingest/pdf.ts). Uses pdfjs-dist's legacy build, which runs in plain Node.
 *
 * pdfjs returns positioned glyph runs, not lines. Line breaks are reconstructed from `hasEOL`,
 * which pdfjs sets on the last item of each text line -- that is what lets the ingester's heading
 * pattern see "3.2 Requests of three to five days" as its own line.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export async function extractPdfText(buffer) {
  const loadingTask = getDocument({
    data: new Uint8Array(buffer),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const numpages = doc.numPages;

  const pageTexts = [];
  for (let p = 1; p <= numpages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    let line = '';
    const lines = [];
    for (const item of content.items) {
      if (!('str' in item)) continue;
      line += item.str;
      if (item.hasEOL) {
        lines.push(line.trim());
        line = '';
      }
    }
    if (line.trim()) lines.push(line.trim());
    pageTexts.push(lines.join('\n'));
    page.cleanup();
  }
  await loadingTask.destroy();

  return { text: pageTexts.join('\n'), numpages };
}
