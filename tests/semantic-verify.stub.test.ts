import { describe, expect, it } from 'vitest';
import { StubVerifier, createSemanticVerifier, stubRelation } from '@westline/semantic-verify';

const CLAIM = 'Requests of 3-5 days need 14 calendar days notice.';
const SUPPORTING = "Requests of three to five consecutive working days require 14 calendar days' notice and newsroom lead approval. A request submitted with less than 14 days' notice is not automatically declined.";
const UNRELATED = 'Creator partners may expense a drone only after the safety team has approved the shoot plan.';
const CONTRADICTING = "Requests of three to five days need no notice and no calendar approval; same-day requests are accepted.";

describe('semantic-verify: the stub is a deterministic test double', () => {
  it('says supports when the passage carries the claim\'s content words', () => {
    const v = stubRelation(CLAIM, SUPPORTING);
    expect(v.relation).toBe('supports');
    expect(v.probabilities.supports).toBe(0.95);
    expect(v.confidence).toBe(0.95);
  });

  it('says says_nothing for an unrelated passage', () => {
    const v = stubRelation(CLAIM, UNRELATED);
    expect(v.relation).toBe('says_nothing');
    expect(v.probabilities.says_nothing).toBe(0.9);
  });

  it('says contradicts when the claim words appear right after a negation marker', () => {
    const v = stubRelation(CLAIM, CONTRADICTING);
    expect(v.relation).toBe('contradicts');
    expect(v.probabilities.contradicts).toBe(0.9);
  });

  it('is deterministic and echoes passage ids in order', async () => {
    const stub = new StubVerifier();
    const passages = [{ id: 'a', source: 'PTO §3.2', text: SUPPORTING }, { id: 'b', source: 'SAFETY §5', text: UNRELATED }, { id: 'c', source: 'X', text: CONTRADICTING }];
    const r1 = await stub.relate(CLAIM, passages);
    const r2 = await stub.relate(CLAIM, passages);
    expect(r1).toEqual(r2);
    expect(r1.verdicts.map((v) => `${v.passage_id}:${v.relation}`)).toEqual(['a:supports', 'b:says_nothing', 'c:contradicts']);
    expect(r1.model).toBe('stub');
    expect(r1.usage).toBeNull();
  });

  it('createSemanticVerifier: off is undefined, stub is the stub, typesafe needs a key', () => {
    expect(createSemanticVerifier({ provider: 'off' })).toBeUndefined();
    expect(createSemanticVerifier({ provider: 'stub' })?.id).toBe('stub');
    expect(() => createSemanticVerifier({ provider: 'typesafe' })).toThrow(/TYPESAFE_API_KEY/);
    expect(createSemanticVerifier({ provider: 'typesafe', apiKey: 'k' })?.id).toBe('typesafe');
  });
});
