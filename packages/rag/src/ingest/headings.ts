import type { Section } from '../types.js';

/** `## 3. Notice periods` or `### 3.2 Requests of three to five days`. */
const HEADING_RE = /^(#{2,3})\s+(\d+(?:\.\d+)*)\.?\s+(.+?)\s*$/;

/**
 * Split normalised markdown into numbered sections. Each section's text runs from just after its
 * heading to the next heading of the same or higher level, so a `##` section's text *includes*
 * its `###` children here; `leafUnits` below is what separates them for chunking.
 */
export function parseSections(markdown: string): Section[] {
  const lines = markdown.split('\n');
  const headings: { idx: number; level: number; number: string; title: string; offset: number }[] =
    [];

  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING_RE.exec(lines[i]!);
    if (m) headings.push({ idx: i, level: m[1]!.length, number: m[2]!, title: m[3]!, offset });
    offset += lines[i]!.length + 1;
  }

  const sections: Section[] = [];
  for (let h = 0; h < headings.length; h++) {
    const cur = headings[h]!;
    let end = lines.length;
    for (let n = h + 1; n < headings.length; n++) {
      if (headings[n]!.level <= cur.level) {
        end = headings[n]!.idx;
        break;
      }
    }
    const bodyLines = lines.slice(cur.idx + 1, end);
    const rawBody = bodyLines.join('\n');
    const leading = rawBody.length - rawBody.trimStart().length;
    const text = rawBody.trim();
    // Offsets are exact: `markdown.slice(char_start, char_end) === text`. The chunker relies on
    // this so that every chunk can be located in its source document.
    const char_start = cur.offset + lines[cur.idx]!.length + 1 + leading;
    sections.push({
      section_path: `§${cur.number}`,
      section_title: cur.title,
      level: cur.level,
      heading_offset: cur.offset,
      text,
      char_start,
      char_end: char_start + text.length,
    });
  }
  return sections;
}

export interface ChunkUnit {
  section_path: string;
  section_title: string;
  text: string;
  char_start: number;
}

/**
 * The units that become chunks: every leaf section in full, plus the preamble of any parent
 * section (text that sits under `## 3.` before `### 3.1` begins). Preambles routinely carry the
 * rule that the subsections then elaborate -- the PTO notice table lives in one -- so dropping
 * them would lose the most citable sentence in the section.
 */
export function leafUnits(sections: Section[], minPreambleChars = 80): ChunkUnit[] {
  const units: ChunkUnit[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i]!;
    const firstChild = sections
      .slice(i + 1)
      .find((c) => c.level > s.level && c.section_path.startsWith(`${s.section_path}.`));
    const hasChild = Boolean(firstChild) && sections[i + 1]?.level === s.level + 1;

    if (!hasChild) {
      if (s.text)
        units.push({
          section_path: s.section_path,
          section_title: s.section_title,
          text: s.text,
          char_start: s.char_start,
        });
      continue;
    }
    const preambleEnd = sections[i + 1]!.heading_offset;
    const preamble = s.text.slice(0, Math.max(0, preambleEnd - s.char_start)).trimEnd();
    if (preamble.length >= minPreambleChars) {
      units.push({
        section_path: s.section_path,
        section_title: s.section_title,
        text: preamble,
        char_start: s.char_start,
      });
    }
  }
  return units;
}

/** Effective audience for a section: deepest matching override prefix, else the document's. */
export function effectiveAudience<A extends string>(
  sectionPath: string,
  docAudience: A,
  overrides: Record<string, A> | undefined,
): A {
  if (!overrides) return docAudience;
  let best: { len: number; audience: A } | undefined;
  for (const [prefix, audience] of Object.entries(overrides)) {
    if (sectionPath === prefix || sectionPath.startsWith(`${prefix}.`)) {
      if (!best || prefix.length > best.len) best = { len: prefix.length, audience };
    }
  }
  return best?.audience ?? docAudience;
}

/**
 * A section's own body: from its text to wherever the next heading starts, descendants excluded.
 * `parseSections` gives a `##` section the text of its `###` children too, so anything that walks
 * sections one by one -- the reading view, the section search -- needs this to avoid counting a
 * paragraph once for the leaf that owns it and again for every ancestor above it.
 */
export function sectionOwnBody(
  markdown: string,
  section: Section,
  next: Section | undefined,
): string {
  const end = next ? Math.min(section.char_end, next.heading_offset) : section.char_end;
  return markdown.slice(section.char_start, Math.max(section.char_start, end)).trim();
}
