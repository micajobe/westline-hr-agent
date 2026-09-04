import { describe, expect, it } from 'vitest';
import { argsHash, audienceApplies, canonicalJson, redactArgs, TraceRecorder } from '@westline/shared';

describe('audienceApplies', () => {
  it('lets everyone read `all` and nobody but staff read `staff`', () => {
    expect(audienceApplies('all', 'creator_partner')).toBe(true);
    expect(audienceApplies('staff', 'creator_partner')).toBe(false);
    expect(audienceApplies('staff', 'staff')).toBe(true);
    expect(audienceApplies('staff_and_contractors', 'contractor')).toBe(true);
    expect(audienceApplies('staff_and_contractors', 'creator_partner')).toBe(false);
    expect(audienceApplies('creator_partners', 'creator_partner')).toBe(true);
  });

  it('gives an anonymous reader `all` and nothing else', () => {
    expect(audienceApplies('all', null)).toBe(true);
    expect(audienceApplies('staff', null)).toBe(false);
    expect(audienceApplies('hr_only', null)).toBe(false);
  });

  it('gates `hr_only` on scope, not on workforce class', () => {
    expect(audienceApplies('hr_only', 'staff', 'self')).toBe(false);
    expect(audienceApplies('hr_only', 'staff', 'manager')).toBe(false);
    expect(audienceApplies('hr_only', 'staff', 'hr_partner')).toBe(true);
  });
});

describe('argsHash', () => {
  it('is stable under key reordering', () => {
    const a = { about_person_id: 'W-1042', summary: 'x', category: 'manager' };
    const b = { category: 'manager', summary: 'x', about_person_id: 'W-1042' };
    expect(argsHash(a)).toBe(argsHash(b));
  });

  it('ignores the token field so a token cannot be bound to itself', () => {
    const base = { about_person_id: 'W-1042', summary: 'x' };
    expect(argsHash({ ...base, confirmation_token: 'abc' })).toBe(argsHash(base));
  });

  it('changes when any argument changes', () => {
    expect(argsHash({ summary: 'a' })).not.toBe(argsHash({ summary: 'b' }));
  });

  it('sorts nested objects and preserves array order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
    expect(canonicalJson({ k: [2, 1] })).toBe('{"k":[2,1]}');
  });
});

describe('trace', () => {
  it('redacts the confirmation token', () => {
    expect(redactArgs({ confirmation_token: 'secret', summary: 'x' })).toEqual({
      confirmation_token: '•••',
      summary: 'x',
    });
  });

  it('stamps monotonically increasing sequence numbers', () => {
    const rec = new TraceRecorder('t_test');
    rec.emit({ type: 'intent' });
    rec.emit({ type: 'plan' });
    expect(rec.all().map((e) => e.seq)).toEqual([0, 1]);
    expect(rec.all().every((e) => e.turn_id === 't_test')).toBe(true);
  });

  it('redacts tokens passed through emit', () => {
    const rec = new TraceRecorder('t_test');
    rec.emit({ type: 'tool_call', tool: 'hr__draft_hr_email', args: { confirmation_token: 'z' } });
    expect(rec.all()[0]?.args?.confirmation_token).toBe('•••');
  });
});
