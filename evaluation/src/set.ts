import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvalSet } from './types.js';

export const EVAL_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');

const CATEGORIES = new Set(['straightforward_policy', 'multi_document', 'tool_workflow', 'ambiguous_clarification', 'authorization_audience', 'out_of_scope_safety']);
const BEHAVIOURS = new Set(['answer', 'clarify', 'escalate', 'refuse', 'confirm_gate', 'deny']);

export function loadEvalSet(path = join(EVAL_DIR, 'eval_set.json')): EvalSet {
  const set = JSON.parse(readFileSync(path, 'utf8')) as EvalSet;
  const ids = new Set<string>();
  for (const it of set.items) {
    if (ids.has(it.id)) throw new Error(`duplicate eval item id ${it.id}`);
    ids.add(it.id);
    if (!CATEGORIES.has(it.category)) throw new Error(`${it.id}: bad category ${it.category}`);
    if (!BEHAVIOURS.has(it.expected_behaviour)) throw new Error(`${it.id}: bad behaviour ${it.expected_behaviour}`);
    for (const t of it.expected_tools) if (!/^(policy|hr)__[a-z_]+$/.test(t)) throw new Error(`${it.id}: bad tool ${t}`);
    for (const c of it.gold_citations) if (!/^§\d+(\.\d+)*$/.test(c.section_path)) throw new Error(`${it.id}: bad section ${c.section_path}`);
  }
  for (const id of set.calibration_items) if (!ids.has(id)) throw new Error(`calibration item ${id} not in set`);
  if (set.items.length < 20 || set.items.length > 30) throw new Error(`PRD §12.1 wants 20–30 items, got ${set.items.length}`);
  return set;
}
