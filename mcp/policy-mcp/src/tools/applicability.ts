import { APPLICABILITY_SOURCE } from '@westline/rag';
import { WORKFORCE_CLASSES, type WorkforceClass } from '@westline/shared';
import type { PolicyContext } from '../context.js';

export interface ApplicabilityArgs {
  acting_person_id: string | null;
  workforce_class?: WorkforceClass;
}

/**
 * `get_policy_applicability`: which documents bind a workforce class, from HANDBOOK §2. Defaults to
 * the acting person's class; an anonymous caller must name one.
 */
export function getPolicyApplicability(ctx: PolicyContext, args: ApplicabilityArgs) {
  const cls = args.workforce_class ?? ctx.people.viewer(args.acting_person_id).workforce_class;
  if (!cls) {
    return {
      status: 'NOT_FOUND' as const,
      reason: 'no acting person and no workforce_class given; nothing to look up',
      valid_classes: WORKFORCE_CLASSES,
    };
  }
  const applies = ctx.applicability[cls];
  return {
    workforce_class: cls,
    applies,
    summary: {
      full: applies.filter((r) => r.scope === 'full').map((r) => r.doc_id),
      partial: applies.filter((r) => r.scope === 'partial').map((r) => `${r.doc_id} ${(r.sections ?? []).join(', ')}`),
      none: applies.filter((r) => r.scope === 'none').map((r) => r.doc_id),
    },
    source: APPLICABILITY_SOURCE,
  };
}
