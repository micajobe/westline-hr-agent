import type { Person } from '@westline/shared';
import type { HrContext } from '../context.js';

export interface ProfileArgs {
  acting_person_id: string | null;
  person_id?: string;
  name?: string;
}

/**
 * `lookup_person_profile`. With no `person_id` or `name` it returns the acting person's own
 * profile. Name matches outside the caller's scope are FORBIDDEN without confirming anything
 * beyond the name; AMBIGUOUS lists only in-scope candidates for the same reason.
 */
export function lookupPersonProfile(ctx: HrContext, args: ProfileArgs) {
  const { people } = ctx.data;
  let target: Person | undefined;

  if (args.person_id) {
    target = people.get(args.person_id);
    if (!target) return { status: 'NOT_FOUND' as const };
  } else if (args.name) {
    const matches = people.search(args.name);
    if (matches.length === 0) return { status: 'NOT_FOUND' as const };
    const inScope = matches.filter((m) => people.authorize(args.acting_person_id, m.person_id).ok);
    if (inScope.length === 0) {
      return {
        status: 'FORBIDDEN' as const,
        reason: `"${args.name}" resolves to a person outside your scope`,
        required_scope: 'hr_partner',
      };
    }
    if (inScope.length > 1) {
      return {
        status: 'AMBIGUOUS' as const,
        candidates: inScope.map((m) => ({
          person_id: m.person_id,
          name: m.name,
          title: m.title,
          market: m.market,
        })),
      };
    }
    target = inScope[0]!;
  } else {
    target = people.get(args.acting_person_id);
    if (!target) return { status: 'NOT_FOUND' as const };
  }

  const auth = people.authorize(args.acting_person_id, target.person_id);
  if (!auth.ok)
    return {
      status: 'FORBIDDEN' as const,
      reason: auth.reason,
      required_scope: auth.required_scope,
    };

  const manager = target.manager_id ? people.get(target.manager_id) : undefined;
  return {
    person_id: target.person_id,
    name: target.name,
    workforce_class: target.workforce_class,
    role: target.role,
    title: target.title,
    department_or_program: target.department_or_program,
    market: target.market,
    manager: manager ? { person_id: manager.person_id, name: manager.name } : null,
    start_date: target.start_date,
    scope: target.scope,
  };
}
