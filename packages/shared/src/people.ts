import { readFileSync } from 'node:fs';
import type { Scope, WorkforceClass } from './domain.js';

/** `mock_data/people.json` row, before scope derivation. */
export interface RawPerson {
  person_id: string;
  name: string;
  workforce_class: WorkforceClass;
  role: string;
  title: string;
  department_or_program: string;
  market: string;
  home_province_or_state: string;
  work_country: string;
  manager_id: string | null;
  start_date: string;
  employment_status: string;
}

export interface Person extends RawPerson {
  /** Derived at load (PRD §5): `hr_partner` by role, `manager` by having direct reports, else `self`. */
  scope: Scope;
}

const HR_ROLES = new Set(['hr_partner', 'hr_director']);

export type Authorization =
  { ok: true } | { ok: false; status: 'FORBIDDEN'; reason: string; required_scope: Scope };

/**
 * The people directory both MCP servers resolve `acting_person_id` against. It answers two
 * questions and nothing else: who is this person (class, scope), and may they see that person.
 */
export class PeopleDirectory {
  private readonly byId = new Map<string, Person>();

  private constructor(people: Person[]) {
    for (const p of people) this.byId.set(p.person_id, p);
  }

  static fromRaw(raw: RawPerson[]): PeopleDirectory {
    const reportCounts = new Map<string, number>();
    for (const p of raw)
      if (p.manager_id) reportCounts.set(p.manager_id, (reportCounts.get(p.manager_id) ?? 0) + 1);
    const people = raw.map<Person>((p) => ({
      ...p,
      scope: HR_ROLES.has(p.role)
        ? 'hr_partner'
        : (reportCounts.get(p.person_id) ?? 0) > 0
          ? 'manager'
          : 'self',
    }));
    return new PeopleDirectory(people);
  }

  static load(peopleJsonPath: string): PeopleDirectory {
    return PeopleDirectory.fromRaw(JSON.parse(readFileSync(peopleJsonPath, 'utf8')) as RawPerson[]);
  }

  get(person_id: string | null | undefined): Person | undefined {
    return person_id ? this.byId.get(person_id) : undefined;
  }

  all(): Person[] {
    return [...this.byId.values()].sort((a, b) => a.person_id.localeCompare(b.person_id));
  }

  /** Case-insensitive; exact full-name matches win, otherwise any name containing the query. */
  search(name: string): Person[] {
    const q = name.trim().toLowerCase();
    if (!q) return [];
    const all = this.all();
    const exact = all.filter((p) => p.name.toLowerCase() === q);
    if (exact.length > 0) return exact;
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }

  directReports(person_id: string): Person[] {
    return this.all().filter((p) => p.manager_id === person_id);
  }

  /** What retrieval needs to know about a reader. Unknown or missing id ⇒ anonymous. */
  viewer(person_id: string | null | undefined): {
    workforce_class: WorkforceClass | null;
    scope: Scope | null;
  } {
    const p = this.get(person_id);
    return p
      ? { workforce_class: p.workforce_class, scope: p.scope }
      : { workforce_class: null, scope: null };
  }

  /**
   * PRD §6.2 scope rules: `self` sees self, `manager` sees self and direct reports, `hr_partner`
   * sees anyone. Enforced here, inside the data server, never in the prompt.
   */
  authorize(acting_person_id: string | null | undefined, target_person_id: string): Authorization {
    const acting = this.get(acting_person_id);
    if (!acting) {
      return {
        ok: false,
        status: 'FORBIDDEN',
        reason: 'no acting person; personal data requires an identified requester',
        required_scope: 'self',
      };
    }
    if (acting.person_id === target_person_id || acting.scope === 'hr_partner') return { ok: true };
    const target = this.get(target_person_id);
    if (acting.scope === 'manager' && target?.manager_id === acting.person_id) return { ok: true };
    const required: Scope =
      target?.manager_id === acting.person_id ? 'manager' : target ? 'manager' : 'hr_partner';
    return {
      ok: false,
      status: 'FORBIDDEN',
      reason: `${acting.name} (${acting.scope}) may not view ${target_person_id}: not self, not a direct report`,
      required_scope: target && target.manager_id ? required : 'hr_partner',
    };
  }
}
