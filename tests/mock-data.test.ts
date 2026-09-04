import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WORKFORCE_CLASSES, type WorkforceClass } from '@westline/shared';
import { CORPUS_DIR, readMock } from './helpers/corpus.js';

interface Person {
  person_id: string; name: string; workforce_class: WorkforceClass; role: string; title: string;
  department_or_program: string; market: string; home_province_or_state: string;
  work_country: string; manager_id: string | null; start_date: string; employment_status: string;
}
interface Ledger {
  person_id: string; tenure_tier: string; annual_entitlement_days: number;
  monthly_accrual_days: number; accrued_ytd: number; used_ytd: number;
  carryover_from_prior_year: number; balance: number;
  pending_requests: { start: string; end: string; days: number; status: string }[];
}
interface Benefit {
  person_id: string; eligible: boolean; eligibility_reason: string;
  waiting_period_ends: string; enrolled_plans: string[]; fixed_term_months: number | null;
}
interface CreatorRecord {
  person_id: string; tier: number; exclusivity_window_days: number;
  base_segment_rate_cad: number; production_allowance_ceiling_cad: number;
  active_brand_deals: { brand: string; product_category: string; category_exclusivity_ends: string }[];
}
interface PtoConfig {
  accrual_tiers: { tier: string; annual_entitlement_days: number; monthly_accrual_days: number }[];
  carryover: { max_days: number; must_be_used_by: string };
  notice_thresholds: {
    min_working_days: number; max_working_days: number | null;
    notice_calendar_days: number; notice_label: string; source_section: string;
  }[];
  blackout_windows: { name: string; start: string; end: string; markets: string[] | null }[];
  part_time_threshold_hours_per_week: number;
}

const people = readMock<Person[]>('people.json');
const ledger = readMock<Ledger[]>('pto_ledger.json');
const benefits = readMock<Benefit[]>('benefits.json');
const creators = readMock<CreatorRecord[]>('creator_records.json');
const markets = readMock<{ market: string; province: string; market_director_id: string }[]>('markets.json');
const ptoConfig = readMock<PtoConfig>('pto_config.json');
const ptoHtml = readFileSync(join(CORPUS_DIR, 'PTO.html'), 'utf8');

const byName = (name: string) => people.filter((p) => p.name === name);
const one = (name: string) => {
  const found = byName(name);
  expect(found, `expected exactly one ${name}`).toHaveLength(1);
  return found[0]!;
};

describe('people directory', () => {
  it('has around 28 people with unique ids across all three workforce classes', () => {
    expect(people.length).toBeGreaterThanOrEqual(26);
    expect(people.length).toBeLessThanOrEqual(32);
    expect(new Set(people.map((p) => p.person_id)).size).toBe(people.length);
    for (const cls of WORKFORCE_CLASSES) {
      expect(people.some((p) => p.workforce_class === cls), `no ${cls}`).toBe(true);
    }
  });

  it('resolves every manager_id to a real person, with no self-management or cycles', () => {
    const ids = new Set(people.map((p) => p.person_id));
    for (const p of people) {
      if (p.manager_id === null) continue;
      expect(ids.has(p.manager_id), `${p.person_id} -> ${p.manager_id}`).toBe(true);
      expect(p.manager_id).not.toBe(p.person_id);
    }
    for (const p of people) {
      const seen = new Set<string>();
      let cur: string | null = p.person_id;
      while (cur) {
        expect(seen.has(cur), `cycle through ${p.person_id}`).toBe(false);
        seen.add(cur);
        cur = people.find((q) => q.person_id === cur)!.manager_id;
      }
    }
  });

  it('places every person in a real market', () => {
    const known = new Set(markets.map((m) => m.market));
    for (const p of people) expect(known.has(p.market), `${p.name}: ${p.market}`).toBe(true);
  });
});

describe('required personas (PRD §5)', () => {
  it('Jordan Reyes is a Calgary producer reporting to Priya Nair with 11 days banked', () => {
    const jordan = one('Jordan Reyes');
    const priya = one('Priya Nair');
    expect(jordan.workforce_class).toBe('staff');
    expect(jordan.market).toBe('Calgary');
    expect(jordan.manager_id).toBe(priya.person_id);
    const bank = ledger.find((l) => l.person_id === jordan.person_id)!;
    expect(bank.balance).toBe(11);
    expect(bank.annual_entitlement_days).toBe(18);
    expect(bank.tenure_tier).toBe('tier_2');
  });

  it('Priya Nair is a newsroom lead, so she carries manager scope over Jordan', () => {
    const priya = one('Priya Nair');
    expect(priya.role).toBe('newsroom_lead');
    expect(people.filter((p) => p.manager_id === priya.person_id).length).toBeGreaterThan(0);
  });

  it('Sam Okafor is an HR partner', () => {
    expect(one('Sam Okafor').role).toBe('hr_partner');
  });

  it('Dani Kowalczyk is a tier 2 Kelowna creator partner with a live exclusivity window', () => {
    const dani = one('Dani Kowalczyk');
    expect(dani.workforce_class).toBe('creator_partner');
    expect(dani.market).toBe('Kelowna');
    const rec = creators.find((c) => c.person_id === dani.person_id)!;
    expect(rec.tier).toBe(2);
    expect(rec.active_brand_deals.length).toBeGreaterThan(0);
    expect(rec.exclusivity_window_days).toBe(30);
  });

  it('Marcus Lee is a Vancouver contractor with no PTO and no benefits record', () => {
    const marcus = one('Marcus Lee');
    expect(marcus.workforce_class).toBe('contractor');
    expect(marcus.market).toBe('Vancouver');
    expect(ledger.find((l) => l.person_id === marcus.person_id)).toBeUndefined();
    expect(benefits.find((b) => b.person_id === marcus.person_id)).toBeUndefined();
  });

  it('Avery Chen is a Vancouver host, for the six-weeks-from-Lisbon item', () => {
    const avery = one('Avery Chen');
    expect(avery.workforce_class).toBe('staff');
    expect(avery.market).toBe('Vancouver');
  });

  it('Taylor Brooks is an intern who is not benefits-eligible', () => {
    const taylor = one('Taylor Brooks');
    expect(taylor.role).toBe('intern');
    const b = benefits.find((x) => x.person_id === taylor.person_id)!;
    expect(b.eligible).toBe(false);
    expect(b.enrolled_plans).toEqual([]);
    expect(b.fixed_term_months).toBeLessThan(6);
    // The reason has to name both grounds, because the agent quotes it back to the user.
    expect(b.eligibility_reason).toMatch(/six months/i);
    expect(b.eligibility_reason).toMatch(/90-day waiting period/i);
  });

  it('has two different people called Sam Lee, for the ambiguity item', () => {
    const sams = byName('Sam Lee');
    expect(sams).toHaveLength(2);
    expect(sams[0]!.person_id).not.toBe(sams[1]!.person_id);
    expect(sams[0]!.market).not.toBe(sams[1]!.market);
  });

  it('Riley Dube has no manager, for the missing-manager item', () => {
    const riley = one('Riley Dube');
    expect(riley.manager_id).toBeNull();
    expect(riley.market).toBe('Winnipeg');
  });

  it('Noor Haddad manages the creator partners', () => {
    const noor = one('Noor Haddad');
    expect(noor.role).toBe('creator_partnerships_manager');
    const creatorPeople = people.filter((p) => p.workforce_class === 'creator_partner');
    for (const c of creatorPeople) expect(c.manager_id).toBe(noor.person_id);
  });
});

describe('PTO ledger', () => {
  it('covers every staff member and nobody else', () => {
    const staff = people.filter((p) => p.workforce_class === 'staff').map((p) => p.person_id).sort();
    expect(ledger.map((l) => l.person_id).sort()).toEqual(staff);
  });

  it('balances add up: accrued + carryover - used', () => {
    for (const l of ledger) {
      const expected = l.accrued_ytd + l.carryover_from_prior_year - l.used_ytd;
      expect(l.balance, l.person_id).toBeCloseTo(expected, 2);
    }
  });

  it('never carries over more than the cap the policy states', () => {
    for (const l of ledger) {
      expect(l.carryover_from_prior_year, l.person_id).toBeLessThanOrEqual(
        ptoConfig.carryover.max_days,
      );
    }
  });

  it('uses only entitlements and accrual rates that exist in pto_config', () => {
    const tiers = new Map(ptoConfig.accrual_tiers.map((t) => [t.tier, t]));
    for (const l of ledger) {
      const tier = tiers.get(l.tenure_tier);
      expect(tier, `${l.person_id} has unknown tier ${l.tenure_tier}`).toBeDefined();
      expect(l.annual_entitlement_days).toBe(tier!.annual_entitlement_days);
      expect(l.monthly_accrual_days).toBe(tier!.monthly_accrual_days);
    }
  });
});

describe('benefits records', () => {
  it('cover every staff member and nobody else', () => {
    const staff = people.filter((p) => p.workforce_class === 'staff').map((p) => p.person_id).sort();
    expect(benefits.map((b) => b.person_id).sort()).toEqual(staff);
  });

  it('give every eligible person a waiting-period end date on the first of a month', () => {
    for (const b of benefits) {
      expect(b.waiting_period_ends, b.person_id).toMatch(/^\d{4}-\d{2}-01$/);
    }
  });
});

describe('creator records', () => {
  it('cover every creator partner and nobody else', () => {
    const cps = people
      .filter((p) => p.workforce_class === 'creator_partner')
      .map((p) => p.person_id)
      .sort();
    expect(creators.map((c) => c.person_id).sort()).toEqual(cps);
  });

  it('match the CREATOR §1.3 rate card', () => {
    const card: Record<number, [number, number]> = { 1: [850, 350], 2: [1400, 600], 3: [2200, 1100] };
    for (const c of creators) {
      const [rate, ceiling] = card[c.tier]!;
      expect(c.base_segment_rate_cad, `tier ${c.tier} rate`).toBe(rate);
      expect(c.production_allowance_ceiling_cad, `tier ${c.tier} ceiling`).toBe(ceiling);
    }
  });
});

/**
 * The consistency test PRD §15 M1 asks for. `pto_config.json` is the machine-readable form of
 * PTO §1 to §4, and `check_pto_balance` computes from it. If the two ever drift, the agent starts
 * citing a policy that says something different from the number it just quoted -- which is exactly
 * the failure mode this whole project is meant to avoid.
 */
describe('pto_config agrees with the PTO document', () => {
  it('accrual tiers match the §1.1 table', () => {
    const rows = [...ptoHtml.matchAll(
      /<tr><td>(Tier \d)<\/td><td>[^<]*<\/td><td>(\d+) days<\/td><td>([\d.]+) days<\/td><\/tr>/g,
    )];
    expect(rows).toHaveLength(3);
    for (const [, label, entitlement, accrual] of rows) {
      const tier = ptoConfig.accrual_tiers.find(
        (t) => t.tier === label!.toLowerCase().replace(' ', '_'),
      );
      expect(tier, `${label} missing from pto_config`).toBeDefined();
      expect(tier!.annual_entitlement_days).toBe(Number(entitlement));
      expect(tier!.monthly_accrual_days).toBeCloseTo(Number(accrual), 3);
    }
  });

  it('notice thresholds match the §3 table', () => {
    const rows = [...ptoHtml.matchAll(
      /<tr><td>([^<]*working days)<\/td><td>([^<]+)<\/td><td>[^<]+<\/td><\/tr>/g,
    )];
    expect(rows, 'the §3 notice table did not parse').toHaveLength(3);

    const documented = rows.map(([, length, notice]) => ({ length: length!, notice: notice! }));
    expect(documented[0]!.notice).toBe('48 hours');
    expect(documented[1]!.notice).toContain('14 calendar days');
    expect(documented[2]!.notice).toContain('28 calendar days');

    const [short, mid, long] = ptoConfig.notice_thresholds;
    expect(short!.min_working_days).toBe(1);
    expect(short!.max_working_days).toBe(2);
    expect(short!.notice_calendar_days).toBe(2);
    expect(short!.notice_label).toBe('48 hours');
    expect(short!.source_section).toBe('§3.1');

    expect(mid!.min_working_days).toBe(3);
    expect(mid!.max_working_days).toBe(5);
    expect(mid!.notice_calendar_days).toBe(14);
    expect(mid!.source_section).toBe('§3.2');

    expect(long!.min_working_days).toBe(6);
    expect(long!.max_working_days).toBeNull();
    expect(long!.notice_calendar_days).toBe(28);
    expect(long!.source_section).toBe('§3.3');
  });

  it('carryover cap and deadline match §2.1', () => {
    expect(ptoHtml).toMatch(/maximum of\s*<strong>5 unused days<\/strong>/);
    expect(ptoHtml).toMatch(/<strong>March 31<\/strong>/);
    expect(ptoConfig.carryover.max_days).toBe(5);
    expect(ptoConfig.carryover.must_be_used_by).toBe('03-31');
  });

  it('the part-time threshold matches §1.2 and BENEFITS §2.1', () => {
    expect(ptoHtml).toMatch(/at least 20 hours per week/);
    expect(ptoConfig.part_time_threshold_hours_per_week).toBe(20);
  });

  it('blackout windows name only real markets and match the §4.1 windows', () => {
    const known = new Set(markets.map((m) => m.market));
    const names = ptoConfig.blackout_windows.map((w) => w.name);
    expect(names.some((n) => /Stampede/i.test(n))).toBe(true);
    expect(names.some((n) => /Grey Cup/i.test(n))).toBe(true);
    for (const w of ptoConfig.blackout_windows) {
      expect(new Date(w.start).toString()).not.toBe('Invalid Date');
      expect(new Date(w.end) >= new Date(w.start)).toBe(true);
      for (const m of w.markets ?? []) expect(known.has(m), `${w.name}: ${m}`).toBe(true);
    }
    const stampede = ptoConfig.blackout_windows.find((w) => /Stampede/i.test(w.name))!;
    expect(stampede.markets).toEqual(['Calgary', 'Edmonton']);
    expect(ptoHtml).toMatch(/July 3 &ndash; July 13|July 3 – July 13/);
  });

  it('leaves Jordan\'s Oct 14-16 request clear of every blackout window', () => {
    const jordan = one('Jordan Reyes');
    const start = new Date('2026-10-14');
    const end = new Date('2026-10-16');
    for (const w of ptoConfig.blackout_windows) {
      const overlaps = new Date(w.start) <= end && new Date(w.end) >= start;
      const appliesToMarket = !w.markets || w.markets.includes(jordan.market);
      expect(overlaps && appliesToMarket, `demo task 2 collides with ${w.name}`).toBe(false);
    }
  });
});
