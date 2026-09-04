import matter from 'gray-matter';
import { AUDIENCES, type Audience } from '@westline/shared';
import type { DocumentFrontMatter } from '../types.js';

export class FrontMatterError extends Error {
  constructor(
    readonly file: string,
    message: string,
  ) {
    super(`${file}: ${message}`);
  }
}

const REQUIRED = ['doc_id', 'title', 'version', 'effective_date', 'owner', 'audience'] as const;

/**
 * Parse and validate front matter. Fails loudly: a document without an `audience` would be
 * indexed as visible to nobody or everybody depending on a default, and both are wrong.
 */
export function parseFrontMatter(
  file: string,
  yamlBlock: string,
): DocumentFrontMatter {
  const parsed = matter(`---\n${yamlBlock}\n---\n`).data as Record<string, unknown>;

  for (const key of REQUIRED) {
    if (parsed[key] === undefined || parsed[key] === null || parsed[key] === '') {
      throw new FrontMatterError(file, `front matter is missing required field "${key}"`);
    }
  }
  if (!isAudience(parsed.audience)) {
    throw new FrontMatterError(
      file,
      `audience "${String(parsed.audience)}" is not one of ${AUDIENCES.join(', ')}`,
    );
  }

  const overrides = parsed.section_audience_overrides;
  let section_audience_overrides: Record<string, Audience> | undefined;
  if (overrides !== undefined) {
    if (typeof overrides !== 'object' || overrides === null || Array.isArray(overrides)) {
      throw new FrontMatterError(file, 'section_audience_overrides must be a map');
    }
    section_audience_overrides = {};
    for (const [section, audience] of Object.entries(overrides as Record<string, unknown>)) {
      if (!/^§\d+(\.\d+)*$/.test(section)) {
        throw new FrontMatterError(file, `override key "${section}" must look like §7 or §7.2`);
      }
      if (!isAudience(audience)) {
        throw new FrontMatterError(file, `override for ${section} has invalid audience "${String(audience)}"`);
      }
      section_audience_overrides[section] = audience;
    }
  }

  return {
    doc_id: String(parsed.doc_id),
    title: String(parsed.title),
    version: String(parsed.version),
    effective_date: toDateString(parsed.effective_date),
    owner: String(parsed.owner),
    audience: parsed.audience,
    ...(section_audience_overrides ? { section_audience_overrides } : {}),
  };
}

function isAudience(value: unknown): value is Audience {
  return typeof value === 'string' && (AUDIENCES as readonly string[]).includes(value);
}

/** YAML turns an unquoted 2026-01-01 into a Date; the corpus quotes them, but be tolerant. */
function toDateString(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}
