import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';
import { extractPdfText } from './pdf.js';

/**
 * Every source format becomes the same markdown dialect before chunking: `## N. Title` for
 * top-level sections, `### N.M Title` for subsections, blank-line-separated paragraphs. The
 * chunker then only has to understand one thing.
 */

// ---------- Markdown ----------

export interface SplitMarkdown {
  yaml: string;
  body: string;
}

export function splitMarkdownFrontMatter(raw: string, file: string): SplitMarkdown {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) throw new Error(`${file}: markdown document has no front matter block`);
  return { yaml: m[1]!, body: raw.slice(m[0].length) };
}

// ---------- HTML ----------

const HTML_FRONT_MATTER = /^\s*<!--westline-frontmatter\r?\n([\s\S]*?)\r?\n-->/;

export function splitHtmlFrontMatter(raw: string, file: string): SplitMarkdown {
  const m = HTML_FRONT_MATTER.exec(raw);
  if (!m) throw new Error(`${file}: HTML document has no <!--westline-frontmatter--> block`);
  return { yaml: m[1]!, body: raw.slice(m[0].length) };
}

let turndown: TurndownService | undefined;

function getTurndown(): TurndownService {
  if (turndown) return turndown;
  turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
    emDelimiter: '*',
  });
  turndown.use(gfm);
  // The HTML corpus wraps policy ids in <code>; keep them as backticks so cross-reference
  // detection sees the same `PTO` §3 shape the markdown documents use.
  turndown.remove(['script', 'style', 'head', 'title']);
  return turndown;
}

/** HTML → markdown, tables preserved as GFM pipe tables. */
export function htmlToMarkdown(html: string): string {
  const body = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ?? html;
  return tidyMarkdown(unescapeHeadingNumbers(getTurndown().turndown(body)));
}

/**
 * Turndown escapes `3. Notice periods` as `3\. Notice periods` so it cannot be mistaken for an
 * ordered list. Inside a heading that escape defeats the numbered-heading pattern the section
 * parser depends on, and every `<h2>` body would be dropped from the index. Undo it there only.
 */
export function unescapeHeadingNumbers(md: string): string {
  return md.replace(/^(#{1,6}\s+\d+(?:\.\d+)*)\\\./gm, '$1.');
}

// ---------- PDF ----------

/**
 * Mirrors the pattern in scripts/build-pdfs.mjs, which verifies at PDF-build time that the only
 * extracted lines matching it are the real headings. Keep the two in step.
 */
export const PDF_HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+(\S.{1,68})$/;

export interface PdfMarkdown extends SplitMarkdown {
  pages: number;
}

/**
 * PDF → markdown by reconstructing headings from the numbered-heading convention every Westline
 * document follows. The front matter travels as literal text at the top of page one.
 */
export async function pdfToMarkdown(data: Buffer, file: string): Promise<PdfMarkdown> {
  const { text, pages } = await extractPdfText(data);

  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!fm) throw new Error(`${file}: PDF text layer does not begin with a front matter block`);
  const yaml = fm[1]!;
  const rest = text.slice(fm[0].length);

  const outLines: string[] = [];
  let sawFirstHeading = false;
  for (const rawLine of rest.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      outLines.push('');
      continue;
    }
    const h = PDF_HEADING_RE.exec(line);
    if (h) {
      sawFirstHeading = true;
      const depth = h[1]!.split('.').length;
      outLines.push(
        '',
        `${depth === 1 ? '##' : '###'} ${h[1]}${depth === 1 ? '.' : ''} ${h[2]!.trim()}`,
        '',
      );
      continue;
    }
    // The document title precedes the first numbered heading; render it as the H1.
    if (!sawFirstHeading && outLines.filter(Boolean).length === 0) {
      outLines.push(`# ${line}`, '');
      continue;
    }
    outLines.push(line);
  }

  return { yaml, body: tidyMarkdown(rejoinWrappedLines(outLines.join('\n'))), pages };
}

/**
 * Inside a paragraph, PDF extraction yields one line per rendered line. Join them back into a
 * single line per paragraph so the chunker's paragraph splitting works on real paragraphs.
 */
function rejoinWrappedLines(md: string): string {
  return md
    .split(/\n{2,}/)
    .map((block) =>
      block.startsWith('#')
        ? block
        : block
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean)
            .join(' '),
    )
    .join('\n\n');
}

// ---------- shared ----------

export function tidyMarkdown(md: string): string {
  return (
    md
      .replace(/\r\n/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim() + '\n'
  );
}
