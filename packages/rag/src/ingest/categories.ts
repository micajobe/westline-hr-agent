import type { LoadedDocument, PolicyCategory } from '../types.js';
import { parseSections } from './headings.js';

export const CATEGORY_SOURCE = { doc_id: 'HANDBOOK', section_path: '§4' } as const;

/**
 * Parse the HANDBOOK §4 "Who owns what" table into the browse taxonomy. Like the §2 applicability
 * matrix, the categorisation is read out of the corpus rather than duplicated in code: if People &
 * Culture reorganise the handbook, the Handbook tab follows without a deploy.
 *
 * Expected columns: `Area | Owner | Documents`, where Documents is a comma-separated list of
 * backticked doc_ids.
 */
export function parseCategories(handbook: LoadedDocument): PolicyCategory[] {
  if (handbook.doc_id !== CATEGORY_SOURCE.doc_id) {
    throw new Error(`category map must come from HANDBOOK, got ${handbook.doc_id}`);
  }
  const section = parseSections(handbook.markdown).find(
    (s) => s.section_path === CATEGORY_SOURCE.section_path,
  );
  if (!section) throw new Error('HANDBOOK has no §4');

  const rows = section.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));
  const header = rows.shift();
  if (!header) throw new Error('HANDBOOK §4 has no table');
  const col = (name: string) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`HANDBOOK §4 table lacks an "${name}" column`);
    return i;
  };
  const cols = { area: col('Area'), owner: col('Owner'), documents: col('Documents') };

  const categories: PolicyCategory[] = [];
  for (const cells of rows) {
    if (cells.every((c) => /^-+$/.test(c))) continue; // separator row
    const doc_ids = cells[cols.documents]!
      .split(',')
      .map((d) => d.replace(/`/g, '').trim())
      .filter(Boolean);
    if (doc_ids.length === 0) continue;
    categories.push({ area: cells[cols.area]!, owner: cells[cols.owner]!, doc_ids });
  }
  if (categories.length === 0) throw new Error('HANDBOOK §4 table has no rows');
  return categories;
}

/**
 * Every indexed document must land in exactly one category, including any the handbook's §4 table
 * does not name -- HANDBOOK itself is the standing example, since the index does not list itself.
 * A missing document joins the category whose owner matches its front-matter `owner`, and failing
 * that gets a category of its own named after that owner. Nothing is silently dropped.
 */
export function assignCategories(
  categories: readonly PolicyCategory[],
  docs: readonly { doc_id: string; owner: string }[],
): PolicyCategory[] {
  const known = new Set(categories.flatMap((c) => c.doc_ids));
  const out: PolicyCategory[] = categories.map((c) => ({ ...c, doc_ids: [...c.doc_ids] }));
  const byId = new Set(docs.map((d) => d.doc_id));
  for (const c of out) c.doc_ids = c.doc_ids.filter((id) => byId.has(id));

  for (const doc of docs) {
    if (known.has(doc.doc_id)) continue;
    const home = out.find((c) => c.owner === doc.owner);
    if (home) home.doc_ids.push(doc.doc_id);
    else out.push({ area: doc.owner, owner: doc.owner, doc_ids: [doc.doc_id] });
  }
  return out.filter((c) => c.doc_ids.length > 0);
}
