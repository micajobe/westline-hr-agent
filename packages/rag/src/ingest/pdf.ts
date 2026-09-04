import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ExtractedPdf {
  text: string;
  pages: number;
}

/**
 * Extract a PDF's text layer as lines, with blank lines where the original had paragraph breaks.
 *
 * pdfjs hands back positioned glyph runs, not lines. `hasEOL` marks the end of each rendered line,
 * which is what lets the heading reconstruction in `normalize.ts` see a section number at the start
 * of a line. Paragraph boundaries are recovered from the vertical gap between lines: pdfkit leaves
 * a larger gap between paragraphs than between wrapped lines of the same one, so a gap noticeably
 * bigger than the page's usual line pitch is treated as a paragraph break. Without this, every
 * section would collapse into a single run-on block and snippets would be unreadable.
 */
export async function extractPdfText(data: Uint8Array | Buffer): Promise<ExtractedPdf> {
  const loadingTask = getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    useSystemFonts: true,
    isEvalSupported: false,
  });
  const doc = await loadingTask.promise;
  const pages = doc.numPages;
  const out: string[] = [];

  for (let p = 1; p <= pages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();

    const lines: { text: string; y: number }[] = [];
    let buffer = '';
    let y = 0;
    for (const item of content.items) {
      if (!('str' in item)) continue;
      if (!buffer) y = item.transform[5] as number;
      buffer += item.str;
      if (item.hasEOL) {
        if (buffer.trim()) lines.push({ text: buffer.trim(), y });
        buffer = '';
      }
    }
    if (buffer.trim()) lines.push({ text: buffer.trim(), y });

    out.push(joinWithParagraphBreaks(lines));
    page.cleanup();
  }

  await loadingTask.destroy();
  return { text: out.join('\n\n'), pages };
}

function joinWithParagraphBreaks(lines: { text: string; y: number }[]): string {
  if (lines.length < 3) return lines.map((l) => l.text).join('\n');

  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1]!.y - lines[i]!.y;
    if (gap > 0) gaps.push(gap);
  }
  gaps.sort((a, b) => a - b);
  const medianGap = gaps[Math.floor(gaps.length / 2)] ?? 0;
  const paragraphGap = medianGap * 1.4;

  const parts: string[] = [lines[0]!.text];
  for (let i = 1; i < lines.length; i++) {
    const gap = lines[i - 1]!.y - lines[i]!.y;
    parts.push(gap > paragraphGap || gap < 0 ? `\n\n${lines[i]!.text}` : `\n${lines[i]!.text}`);
  }
  return parts.join('');
}
