import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { P, startTestHost, type TestHost } from './helpers/mcp.js';

let host: TestHost;
beforeAll(async () => {
  host = await startTestHost();
});
afterAll(() => host.stop());

type Any = Record<string, any>;

describe('hr-data-mcp: scope enforced inside the server', () => {
  it('Jordan can see his own PTO balance, with notice and blackout computed for Oct 14-16', async () => {
    const r = await host.call<Any>('hr', 'check_pto_balance', {
      acting_person_id: P.jordan,
      person_id: P.jordan,
      start_date: '2026-10-14',
      end_date: '2026-10-16',
    });
    expect(r.status).toBeUndefined();
    expect(r.balance).toBe(11);
    expect(r.annual_entitlement_days).toBe(18);
    expect(r.requested_days).toBe(3);
    expect(r.request_fits).toBe(true);
    expect(r.notice_required).toMatch(/14 calendar days/);
    expect(r.notice_required).toMatch(/PTO §3\.2/);
    expect(r.notice_met).toBe(true);
    expect(r.blackout_collision).toBeNull();
  });

  it('flags a Stampede-week request for a Calgary staff member', async () => {
    const r = await host.call<Any>('hr', 'check_pto_balance', {
      acting_person_id: P.jordan, person_id: P.jordan, start_date: '2026-07-07', end_date: '2026-07-09',
    });
    expect(r.blackout_collision?.window).toMatch(/Stampede/);
    expect(r.blackout_collision?.source_section).toBe('PTO §4.1');
  });

  it('Dani (creator partner) gets NOT_APPLICABLE pointing at CREATOR §5', async () => {
    const r = await host.call<Any>('hr', 'check_pto_balance', { acting_person_id: P.dani, person_id: P.dani });
    expect(r.status).toBe('NOT_APPLICABLE');
    expect(r.reason).toMatch(/CREATOR §5/);
  });

  it("Marcus (contractor) asking for Jordan's PTO is FORBIDDEN with the required scope", async () => {
    const r = await host.call<Any>('hr', 'check_pto_balance', { acting_person_id: P.marcus, person_id: P.jordan });
    expect(r.status).toBe('FORBIDDEN');
    expect(['manager', 'hr_partner']).toContain(r.required_scope);
    expect(r.balance).toBeUndefined();
  });

  it("Priya (manager) can see her report Jordan's PTO but not his benefits", async () => {
    const pto = await host.call<Any>('hr', 'check_pto_balance', { acting_person_id: P.priya, person_id: P.jordan });
    expect(pto.balance).toBe(11);
    const ben = await host.call<Any>('hr', 'lookup_benefits_status', { acting_person_id: P.priya, person_id: P.jordan });
    expect(ben.status).toBe('FORBIDDEN');
    expect(ben.required_scope).toBe('hr_partner');
  });

  it("Sam Okafor (HR partner) can see Jordan's benefits", async () => {
    const r = await host.call<Any>('hr', 'lookup_benefits_status', { acting_person_id: P.samOkafor, person_id: P.jordan });
    expect(r.eligible).toBe(true);
    expect(r.enrolled_plans).toContain('dental');
  });

  it('Taylor (intern) is told both reasons she is not benefits-eligible', async () => {
    const r = await host.call<Any>('hr', 'lookup_benefits_status', { acting_person_id: P.taylor, person_id: P.taylor });
    expect(r.eligible).toBe(false);
    expect(r.eligibility_reason).toMatch(/six months/);
    expect(r.eligibility_reason).toMatch(/90-day/);
  });

  it('anonymous callers get nothing personal', async () => {
    const r = await host.call<Any>('hr', 'check_pto_balance', { acting_person_id: null, person_id: P.jordan });
    expect(r.status).toBe('FORBIDDEN');
  });

  it('profile lookup: self, direct report, AMBIGUOUS Sam Lee, NOT_FOUND, missing manager', async () => {
    const self = await host.call<Any>('hr', 'lookup_person_profile', { acting_person_id: P.jordan });
    expect(self.person_id).toBe(P.jordan);
    expect(self.manager).toEqual({ person_id: P.priya, name: 'Priya Nair' });
    expect(self.workforce_class).toBe('staff');

    const sams = await host.call<Any>('hr', 'lookup_person_profile', { acting_person_id: P.samOkafor, name: 'Sam Lee' });
    expect(sams.status).toBe('AMBIGUOUS');
    expect(sams.candidates).toHaveLength(2);
    expect(sams.candidates[0]).toHaveProperty('market');

    const outOfScope = await host.call<Any>('hr', 'lookup_person_profile', { acting_person_id: P.jordan, name: 'Sam Lee' });
    expect(outOfScope.status).toBe('FORBIDDEN');

    const nobody = await host.call<Any>('hr', 'lookup_person_profile', { acting_person_id: P.samOkafor, person_id: 'W-9999' });
    expect(nobody.status).toBe('NOT_FOUND');

    const riley = await host.call<Any>('hr', 'lookup_person_profile', { acting_person_id: P.riley });
    expect(riley.manager).toBeNull();
  });

  it('rejects malformed arguments at the schema boundary', async () => {
    const client = await host.connect('hr');
    const res = await client.callTool({ name: 'check_pto_balance', arguments: { acting_person_id: P.jordan, person_id: P.jordan, start_date: 'next tuesday' } });
    expect(res.isError).toBe(true);
  });
});

describe('policy-mcp: audience enforced before ranking', () => {
  it('Jordan asking about notice for a three-day vacation gets PTO notice material first', async () => {
    const r = await host.call<Any>('policy', 'search_policy_documents', {
      acting_person_id: P.jordan, query: 'notice for a three day vacation', k: 6,
    });
    expect(r.results.length).toBe(6);
    expect(r.results.slice(0, 3).every((c: Any) => c.doc_id === 'PTO')).toBe(true);
    expect(r.results.slice(0, 5).some((c: Any) => c.section_path === '§3.2')).toBe(true);
    expect(r.withheld_by_audience).toBe(false);
    expect(r.retrieval.mode).toBe('hybrid');
    expect(r.viewer).toEqual({ workforce_class: 'staff', scope: 'self' });
    for (const c of r.results) expect(c.chunk_id).toMatch(/^[A-Z]+#§\d/);
  });

  it('Dani asking about staff vacation entitlement never sees PTO text and is told it was withheld', async () => {
    const r = await host.call<Any>('policy', 'search_policy_documents', {
      acting_person_id: P.dani, query: 'annual vacation entitlement days by tenure', k: 6,
    });
    expect(r.results.some((c: Any) => c.doc_id === 'PTO')).toBe(false);
    expect(r.withheld_by_audience).toBe(true);
    expect(r.withheld_doc_ids).toContain('PTO');
    expect(r.results.some((c: Any) => c.doc_id === 'CREATOR')).toBe(true);
  });

  it('anonymous callers only see `all`-audience documents', async () => {
    const r = await host.call<Any>('policy', 'search_policy_documents', { acting_person_id: null, query: 'carryover cap unused days', k: 6 });
    expect(r.results.every((c: Any) => ['HANDBOOK', 'INFOSEC', 'CONDUCT', 'EDITORIAL', 'SAFETY', 'SOCIAL', 'BENEFITS', 'ONBOARD'].includes(c.doc_id))).toBe(true);
    expect(r.withheld_by_audience).toBe(true);
  });

  it('get_policy_section: EXPENSE §7 is readable by Dani and refused for Jordan', async () => {
    const dani = await host.call<Any>('policy', 'get_policy_section', { acting_person_id: P.dani, doc_id: 'EXPENSE', section_path: '§7' });
    expect(dani.error).toBeUndefined();
    expect(dani.audience).toBe('creator_partners');
    expect(dani.text).toMatch(/not reimburse/i);
    expect(dani.effective_date).toBe('2026-01-01');

    const jordan = await host.call<Any>('policy', 'get_policy_section', { acting_person_id: P.jordan, doc_id: 'EXPENSE', section_path: '7.2' });
    expect(jordan.error).toBe('FORBIDDEN_AUDIENCE');

    const missing = await host.call<Any>('policy', 'get_policy_section', { acting_person_id: P.jordan, doc_id: 'PTO', section_path: '§99' });
    expect(missing.error).toBe('NOT_FOUND');
  });

  it('get_policy_applicability defaults to the acting person and always cites HANDBOOK §2', async () => {
    const dani = await host.call<Any>('policy', 'get_policy_applicability', { acting_person_id: P.dani });
    expect(dani.workforce_class).toBe('creator_partner');
    expect(dani.source).toEqual({ doc_id: 'HANDBOOK', section_path: '§2' });
    const expense = dani.applies.find((r: Any) => r.doc_id === 'EXPENSE');
    expect(expense).toMatchObject({ scope: 'partial', sections: ['§7'] });
    expect(dani.applies.find((r: Any) => r.doc_id === 'PTO').scope).toBe('none');

    const hrAsking = await host.call<Any>('policy', 'get_policy_applicability', { acting_person_id: P.samOkafor, workforce_class: 'contractor' });
    expect(hrAsking.workforce_class).toBe('contractor');
    expect(hrAsking.applies.find((r: Any) => r.doc_id === 'EXPENSE').sections).toEqual(['§6', '§8']);

    const anon = await host.call<Any>('policy', 'get_policy_applicability', { acting_person_id: null });
    expect(anon.status).toBe('NOT_FOUND');
  });

  it('check_policy_compliance returns cited evidence and marks what binds the class', async () => {
    const r = await host.call<Any>('policy', 'check_policy_compliance', {
      acting_person_id: P.dani,
      scenario: 'I bought a drone for a sponsored shoot and want to expense it and post the video',
      policy_areas: ['equipment reimbursement for creator partners', 'drone approval and certification', 'sponsored content disclosure'],
    });
    expect(r.workforce_class).toBe('creator_partner');
    expect(r.rules.length).toBeGreaterThanOrEqual(6);
    const docs = new Set(r.rules.map((x: Any) => x.doc_id));
    expect(docs.has('SAFETY')).toBe(true);
    expect(docs.has('EDITORIAL') || docs.has('CREATOR')).toBe(true);
    for (const rule of r.rules) {
      expect(rule.chunk_id).toMatch(/#§/);
      expect(typeof rule.applies_to_class).toBe('boolean');
      expect(rule.rule.length).toBeGreaterThan(20);
      // Additive (ADR 0019): the full chunk text rides along so VERIFY can judge the passage, not the snippet.
      expect(typeof rule.text).toBe('string');
      expect(rule.text.length).toBeGreaterThanOrEqual(rule.rule.length);
    }
    expect(r.rules.some((x: Any) => x.doc_id === 'PTO')).toBe(false);
    expect(r.applicability_note).toMatch(/creator_partner/);
    expect(r.source).toEqual({ doc_id: 'HANDBOOK', section_path: '§2' });
  });
});
