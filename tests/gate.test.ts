import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CONFIRMATION_TOKEN_TTL_MS, UsedTokenRegistry, argsHash, mintConfirmationToken, verifyConfirmationToken,
} from '@westline/shared';
import { P, TEST_SECRET, startTestHost, type TestHost } from './helpers/mcp.js';

type Any = Record<string, any>;

describe('confirmation tokens', () => {
  const hash = argsHash({ about_person_id: P.jordan, summary: 'x' });

  it('verifies a freshly minted token bound to the same args hash', () => {
    const t = mintConfirmationToken(hash, TEST_SECRET);
    const v = verifyConfirmationToken(t, hash, TEST_SECRET);
    expect(v.ok).toBe(true);
  });

  it('rejects a token bound to different arguments', () => {
    const t = mintConfirmationToken(hash, TEST_SECRET);
    const other = argsHash({ about_person_id: P.jordan, summary: 'y' });
    expect(verifyConfirmationToken(t, other, TEST_SECRET)).toEqual({ ok: false, reason: 'ARGS_MISMATCH' });
  });

  it('rejects a token signed with a different secret, and malformed tokens', () => {
    const t = mintConfirmationToken(hash, 'another-secret');
    expect(verifyConfirmationToken(t, hash, TEST_SECRET)).toEqual({ ok: false, reason: 'BAD_SIGNATURE' });
    expect(verifyConfirmationToken('nonsense', hash, TEST_SECRET)).toEqual({ ok: false, reason: 'MALFORMED' });
    expect(verifyConfirmationToken(undefined, hash, TEST_SECRET)).toEqual({ ok: false, reason: 'MALFORMED' });
  });

  it('expires after ten minutes', () => {
    const t0 = 1_700_000_000_000;
    const t = mintConfirmationToken(hash, TEST_SECRET, t0);
    expect(verifyConfirmationToken(t, hash, TEST_SECRET, { now: t0 + CONFIRMATION_TOKEN_TTL_MS - 1 }).ok).toBe(true);
    expect(verifyConfirmationToken(t, hash, TEST_SECRET, { now: t0 + CONFIRMATION_TOKEN_TTL_MS + 1 })).toEqual({ ok: false, reason: 'EXPIRED' });
  });

  it('the used-token registry allows one consumption and forgets expired nonces', () => {
    const reg = new UsedTokenRegistry();
    expect(reg.consume('n1', 2_000, 1_000)).toBe(true);
    expect(reg.consume('n1', 2_000, 1_000)).toBe(false);
    expect(reg.size).toBe(1);
    reg.prune(3_000);
    expect(reg.size).toBe(0);
  });
});

describe('gated tools over MCP', () => {
  let host: TestHost;
  beforeAll(async () => {
    host = await startTestHost();
  });
  afterAll(() => host.stop());

  const ticketArgs = {
    acting_person_id: P.dani,
    about_person_id: P.dani,
    category: 'creator_partnerships',
    summary: 'Confirm production allowance for the Big White sponsored shoot',
    details: 'Drone was purchased personally; asking whether a rental line can be added to the brief.',
  };

  it('refuses to execute without a token and returns the hash to confirm against', async () => {
    const before = host.hr.desk.listTickets().length;
    const r = await host.call<Any>('hr', 'create_mock_hr_ticket', ticketArgs);
    expect(r.status).toBe('CONFIRMATION_REQUIRED');
    expect(r.proposed_args_hash).toBe(argsHash(ticketArgs));
    expect(r.ticket_id).toBeUndefined();
    expect(host.hr.desk.listTickets().length).toBe(before);
  });

  it('refuses a forged token and a token for different arguments', async () => {
    const forged = mintConfirmationToken(argsHash(ticketArgs), 'not-the-secret');
    const r1 = await host.call<Any>('hr', 'create_mock_hr_ticket', { ...ticketArgs, confirmation_token: forged });
    expect(r1.status).toBe('CONFIRMATION_REQUIRED');
    expect(r1.reason).toMatch(/BAD_SIGNATURE/);

    const otherToken = mintConfirmationToken(argsHash({ ...ticketArgs, summary: 'something else' }), TEST_SECRET);
    const r2 = await host.call<Any>('hr', 'create_mock_hr_ticket', { ...ticketArgs, confirmation_token: otherToken });
    expect(r2.status).toBe('CONFIRMATION_REQUIRED');
    expect(r2.reason).toMatch(/ARGS_MISMATCH/);
    expect(host.hr.desk.listTickets().some((t) => t.summary === ticketArgs.summary)).toBe(false);
  });

  it('executes exactly once with a valid token, then refuses the replay', async () => {
    const token = mintConfirmationToken(argsHash(ticketArgs), TEST_SECRET);
    const ok = await host.call<Any>('hr', 'create_mock_hr_ticket', { ...ticketArgs, confirmation_token: token });
    expect(ok.status).toBe('open');
    expect(ok.ticket_id).toMatch(/^TKT-/);
    const stored = host.hr.desk.listTickets().find((t) => t.ticket_id === ok.ticket_id);
    expect(stored).toMatchObject({ created_by: P.dani, about_person_id: P.dani, category: 'creator_partnerships' });

    const replay = await host.call<Any>('hr', 'create_mock_hr_ticket', { ...ticketArgs, confirmation_token: token });
    expect(replay.status).toBe('CONFIRMATION_REQUIRED');
    expect(replay.reason).toMatch(/ALREADY_USED/);
    expect(host.hr.desk.listTickets().filter((t) => t.summary === ticketArgs.summary)).toHaveLength(1);
  });

  it('authorization is checked before the gate: Marcus cannot open a ticket about Jordan even with a token', async () => {
    const args = { acting_person_id: P.marcus, about_person_id: P.jordan, category: 'manager', summary: 'nope' };
    const r = await host.call<Any>('hr', 'create_mock_hr_ticket', { ...args, confirmation_token: mintConfirmationToken(argsHash(args), TEST_SECRET) });
    expect(r.status).toBe('FORBIDDEN');
  });

  it('draft_hr_email drafts deterministically from key points and never sends', async () => {
    const args = {
      acting_person_id: P.jordan,
      about_person_id: P.jordan,
      recipient_role: 'manager',
      purpose: 'Time off request for October 14 to 16',
      key_points: ['Three working days, Oct 14-16', 'Balance is 11 days; request fits', 'Submitted 40 days ahead, inside the 14-day notice in PTO §3.2'],
    };
    const gate = await host.call<Any>('hr', 'draft_hr_email', args);
    expect(gate.status).toBe('CONFIRMATION_REQUIRED');

    const token = mintConfirmationToken(argsHash(args), TEST_SECRET);
    const r = await host.call<Any>('hr', 'draft_hr_email', { ...args, confirmation_token: token });
    expect(r.sent).toBe(false);
    expect(r.draft_id).toMatch(/^DFT-/);
    expect(r.to_role).toBe('manager');
    expect(r.body).toContain('- Three working days, Oct 14-16');
    expect(r.body).toContain('Jordan Reyes');
    expect(r.body).toMatch(/Not sent/);
    expect(host.hr.desk.listDrafts().some((d) => d.draft_id === r.draft_id)).toBe(true);
  });
});
