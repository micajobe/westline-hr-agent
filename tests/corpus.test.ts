import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIENCES, type Audience } from '@westline/shared';
import {
  CORPUS_DIR, EXPECTED_DOC_IDS, WORDS_PER_PAGE, loadCorpus, proseWords,
} from './helpers/corpus.js';

const corpus = loadCorpus();

describe('corpus inventory', () => {
  it('has exactly the 15 documents the PRD specifies', () => {
    expect(corpus.map((f) => f.doc_id)).toEqual([...EXPECTED_DOC_IDS]);
  });

  it('covers three source formats, with at least two documents in each of md/html/pdf', () => {
    const counts = corpus.reduce<Record<string, number>>((acc, f) => {
      acc[f.format] = (acc[f.format] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts.md).toBeGreaterThanOrEqual(2);
    expect(counts.html).toBe(2);
    expect(counts.pdf).toBe(2);
  });

  it('ships a built PDF for every PDF-format document', () => {
    for (const f of corpus.filter((c) => c.format === 'pdf')) {
      expect(existsSync(join(CORPUS_DIR, `${f.doc_id}.pdf`))).toBe(true);
    }
  });
});

describe('front matter', () => {
  it.each(corpus.map((f) => [f.doc_id, f] as const))('%s is complete and valid', (docId, file) => {
    for (const key of ['doc_id', 'title', 'version', 'effective_date', 'owner', 'audience']) {
      expect(file.frontMatter[key], `${docId} is missing ${key}`).toBeTruthy();
    }
    expect(file.frontMatter.doc_id).toBe(docId);
    expect(AUDIENCES).toContain(file.frontMatter.audience as Audience);
    expect(file.frontMatter.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('assigns the audiences the applicability model depends on', () => {
    const audienceOf = (id: string) =>
      corpus.find((f) => f.doc_id === id)!.frontMatter.audience;
    expect(audienceOf('PTO')).toBe('staff');
    expect(audienceOf('BENEFITS')).toBe('staff');
    expect(audienceOf('CREATOR')).toBe('creator_partners');
    expect(audienceOf('EXPENSE')).toBe('staff_and_contractors');
    expect(audienceOf('HANDBOOK')).toBe('all');
    expect(audienceOf('EDITORIAL')).toBe('all');
    expect(audienceOf('HOURS')).toBe('staff');
  });

  it('overrides EXPENSE §7 to creator partners, which is what makes demo task 1 work', () => {
    const expense = corpus.find((f) => f.doc_id === 'EXPENSE')!;
    expect(expense.frontMatter.section_audience_overrides).toEqual({ '§7': 'creator_partners' });
  });

  it('opens HOURS §6 to contractors, who are on the same call sheets as staff', () => {
    const hours = corpus.find((f) => f.doc_id === 'HOURS')!;
    expect(hours.frontMatter.section_audience_overrides).toEqual({ '§6': 'staff_and_contractors' });
  });

  it('only overrides sections to valid audiences', () => {
    for (const file of corpus) {
      const overrides = file.frontMatter.section_audience_overrides as
        | Record<string, string>
        | undefined;
      if (!overrides) continue;
      for (const [section, audience] of Object.entries(overrides)) {
        expect(section, `${file.doc_id} override key`).toMatch(/^§\d+(\.\d+)*$/);
        expect(AUDIENCES).toContain(audience as Audience);
      }
    }
  });
});

describe('headings', () => {
  const headingsOf = (body: string, format: string) => {
    const re =
      format === 'html'
        ? /<h([23])>\s*(\d+(?:\.\d+)*)\.?\s+([^<]+)<\/h\1>/g
        : /^(#{2,3})\s+(\d+(?:\.\d+)*)\.?\s+(.+)$/gm;
    return [...body.matchAll(re)].map((m) => ({ number: m[2]!, title: m[3]!.trim() }));
  };

  it.each(corpus.map((f) => [f.doc_id, f] as const))(
    '%s uses stable numbered sections with no duplicates',
    (docId, file) => {
      const headings = headingsOf(file.body, file.format);
      expect(headings.length, `${docId} has too few numbered sections`).toBeGreaterThanOrEqual(6);
      const numbers = headings.map((h) => h.number);
      expect(new Set(numbers).size, `${docId} has duplicate section numbers`).toBe(numbers.length);
    },
  );

  it('numbers top-level sections consecutively from 1', () => {
    for (const file of corpus) {
      const tops = headingsOf(file.body, file.format)
        .map((h) => h.number)
        .filter((n) => !n.includes('.'))
        .map(Number);
      expect(tops, `${file.doc_id} top-level numbering`).toEqual(
        Array.from({ length: tops.length }, (_, i) => i + 1),
      );
    }
  });
});

describe('cross-references', () => {
  const ids = new Set<string>(EXPECTED_DOC_IDS);

  it('never references a document that does not exist', () => {
    // Markdown and HTML cite as `DOC` §n; the PDF sources spell it "DOC section n" because the
    // section sign survives extraction but reads badly in a rendered PDF body.
    for (const file of corpus) {
      const refs = [
        ...file.body.matchAll(/\b([A-Z]{4,10})\b\s*(?:§|section\s)\s*\d/g),
      ].map((m) => m[1]!);
      const unknown = [...new Set(refs)].filter((r) => !ids.has(r));
      expect(unknown, `${file.doc_id} references unknown documents`).toEqual([]);
    }
  });

  it('has HANDBOOK reference every other document from its applicability matrix', () => {
    const handbook = corpus.find((f) => f.doc_id === 'HANDBOOK')!;
    for (const id of EXPECTED_DOC_IDS) {
      expect(handbook.body, `HANDBOOK does not mention ${id}`).toContain(`\`${id}\``);
    }
  });

  it('creates the multi-document tensions the eval set depends on', () => {
    const bodyOf = (id: string) => corpus.find((f) => f.doc_id === id)!.body;
    // Out-of-country work: REMOTE, EXPENSE (tax), INFOSEC (border), BENEFITS (coverage).
    expect(bodyOf('REMOTE')).toMatch(/INFOSEC/);
    expect(bodyOf('REMOTE')).toMatch(/EXPENSE/);
    expect(bodyOf('REMOTE')).toMatch(/BENEFITS/);
    // Creator equipment: CREATOR and EXPENSE must agree, and both point at disclosure and safety.
    expect(bodyOf('CREATOR')).toMatch(/EXPENSE/);
    expect(bodyOf('CREATOR')).toMatch(/EDITORIAL/);
    expect(bodyOf('CREATOR')).toMatch(/SAFETY/);
    // Leave interacts with PTO and benefits continuation.
    expect(bodyOf('LEAVE')).toMatch(/PTO/);
    expect(bodyOf('LEAVE')).toMatch(/BENEFITS/);
  });
});

describe('volume', () => {
  it('totals 70 to 90 page equivalents', () => {
    const words = corpus.reduce((sum, f) => sum + proseWords(f), 0);
    const pages = words / WORDS_PER_PAGE;
    expect(pages).toBeGreaterThanOrEqual(70);
    expect(pages).toBeLessThanOrEqual(90);
  });

  it('gives every document at least 3 page equivalents', () => {
    for (const file of corpus) {
      expect(proseWords(file) / WORDS_PER_PAGE, `${file.doc_id} is too thin`).toBeGreaterThan(3);
    }
  });
});

describe('HTML documents', () => {
  it('contain real tables, so the HTML-to-markdown path is exercised on table markup', () => {
    for (const file of corpus.filter((f) => f.format === 'html')) {
      expect(file.body, `${file.doc_id}`).toMatch(/<table>[\s\S]*<\/table>/);
      expect((file.body.match(/<table>/g) ?? []).length).toBeGreaterThanOrEqual(2);
    }
  });
});
