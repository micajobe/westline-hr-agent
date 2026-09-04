import { WORKFORCE_CLASSES, type WorkforceClass } from '@westline/shared';
import type { ApplicabilityMatrix, ApplicabilityRow, LoadedDocument } from '../types.js';
import { parseSections } from './headings.js';

export const APPLICABILITY_SOURCE = { doc_id: 'HANDBOOK', section_path: '§2' } as const;

/**
 * Parse the HANDBOOK §2 applicability matrix (PRD §6.1 `get_policy_applicability`). The table is
 * the authoritative statement of which policy binds which class, so it is parsed from the corpus
 * at index-build time rather than duplicated in code -- if the handbook changes, the tool follows.
 *
 * Expected columns: `doc_id | Title | staff | contractor | creator_partner | Notes`, cells
 * `Full`, `None` or `Partial (§6, §8)`.
 */
export function parseApplicabilityMatrix(handbook: LoadedDocument): ApplicabilityMatrix {
  if (handbook.doc_id !== APPLICABILITY_SOURCE.doc_id) {
    throw new Error(`applicability matrix must come from HANDBOOK, got ${handbook.doc_id}`);
  }
  const section = parseSections(handbook.markdown).find(
    (s) => s.section_path === APPLICABILITY_SOURCE.section_path,
  );
  if (!section) throw new Error('HANDBOOK has no §2');

  const rows = section.text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'))
    .map((l) => l.slice(1, -1).split('|').map((c) => c.trim()));
  const header = rows.shift();
  if (!header) throw new Error('HANDBOOK §2 has no table');
  const col = (name: string) => {
    const i = header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
    if (i < 0) throw new Error(`HANDBOOK §2 table lacks a "${name}" column`);
    return i;
  };
  const cols = {
    doc_id: col('doc_id'),
    title: col('Title'),
    notes: col('Notes'),
    ...Object.fromEntries(WORKFORCE_CLASSES.map((c) => [c, col(c)])),
  } as Record<'doc_id' | 'title' | 'notes' | WorkforceClass, number>;

  const matrix: ApplicabilityMatrix = { staff: [], contractor: [], creator_partner: [] };
  for (const cells of rows) {
    if (cells.every((c) => /^-+$/.test(c))) continue; // separator row
    const doc_id = cells[cols.doc_id]!.replace(/`/g, '');
    const title = cells[cols.title]!;
    const note = cells[cols.notes]!.replace(/`/g, '');
    for (const cls of WORKFORCE_CLASSES) {
      matrix[cls].push({ doc_id, title, ...parseCell(cells[cols[cls]]!, doc_id, cls), note });
    }
  }
  if (matrix.staff.length === 0) throw new Error('HANDBOOK §2 table has no rows');
  return matrix;
}

function parseCell(
  cell: string,
  doc_id: string,
  cls: WorkforceClass,
): Pick<ApplicabilityRow, 'scope' | 'sections'> {
  const c = cell.trim();
  if (/^full$/i.test(c)) return { scope: 'full' };
  if (/^none$/i.test(c)) return { scope: 'none' };
  const m = /^partial\s*\(([^)]+)\)$/i.exec(c);
  if (m) {
    const sections = m[1]!.split(',').map((s) => s.trim()).filter(Boolean);
    if (!sections.every((s) => /^§\d+(\.\d+)*$/.test(s))) {
      throw new Error(`HANDBOOK §2: ${doc_id}/${cls} has malformed sections "${m[1]}"`);
    }
    return { scope: 'partial', sections };
  }
  throw new Error(`HANDBOOK §2: ${doc_id}/${cls} cell "${cell}" is not Full, None or Partial (§n)`);
}
