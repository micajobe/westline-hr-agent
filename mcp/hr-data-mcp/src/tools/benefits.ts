import type { HrContext } from '../context.js';

export interface BenefitsArgs {
  acting_person_id: string | null;
  person_id: string;
}

/** `lookup_benefits_status`. Self and HR partner only; managers are denied for privacy (PRD §6.2). */
export function lookupBenefitsStatus(ctx: HrContext, args: BenefitsArgs) {
  const { people, benefits } = ctx.data;
  const acting = people.get(args.acting_person_id);
  const isSelf = acting?.person_id === args.person_id;
  if (!acting || (!isSelf && acting.scope !== 'hr_partner')) {
    return {
      status: 'FORBIDDEN' as const,
      reason: 'benefits information is visible to the person themselves and to HR partners only',
      required_scope: 'hr_partner',
    };
  }
  const person = people.get(args.person_id);
  if (!person) return { status: 'NOT_FOUND' as const };
  if (person.workforce_class !== 'staff') {
    return {
      status: 'NOT_APPLICABLE' as const,
      reason: `${person.workforce_class === 'contractor' ? 'contractors' : 'creator partners'} are not enrolled in the benefits plan; the Employee & Family Assistance Program (BENEFITS §6) is open to everyone`,
    };
  }
  const row = benefits.get(args.person_id);
  if (!row) return { status: 'NOT_FOUND' as const };
  return {
    person_id: row.person_id,
    eligible: row.eligible,
    eligibility_reason: row.eligibility_reason,
    waiting_period_ends: row.waiting_period_ends,
    enrolled_plans: row.enrolled_plans,
    next_enrollment_window: row.next_enrollment_window,
  };
}
