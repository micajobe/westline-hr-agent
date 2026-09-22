import { describe, expect, it } from 'vitest';
import { RELATION_CRITERIA, SemanticVerifyError, TypeSafeVerifier, parseChoiceAnswer } from '@westline/semantic-verify';

type Call = { url: string; body: any; headers: Record<string, string> };

/** A fake TypeSafe API: records the request and replays scripted responses in order. */
function fakeApi(responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init?.body)), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    const next = responses.shift();
    if (!next) throw new Error('no scripted response left');
    if (next instanceof Error) throw next;
    return next;
  };
  return { calls, fetch };
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const answer = (choice: string, supports: number, contradicts: number, says_nothing: number) => ({ type: 'choice', choice, probabilities: { supports, contradicts, says_nothing }, confidence: Math.max(supports, contradicts, says_nothing) });

describe('semantic-verify: TypeSafe provider over the SDK', () => {
  it('sends one request per fact with the claim, full passages and one Choice per passage', async () => {
    const api = fakeApi([json(200, { model: 'jev-1.13.0', answers: { c1: answer('supports', 0.93, 0.02, 0.05), c2: answer('says_nothing', 0.2, 0.05, 0.75) }, usage: { input_tokens: 412, output_tokens: 40 } })]);
    const v = new TypeSafeVerifier({ apiKey: 'test-key', fetch: api.fetch });
    const r = await v.relate('Requests of 3-5 days need 14 days notice.', [
      { id: 'PTO#§3.2#0', source: 'PTO §3.2 · Paid Time Off', text: 'Requests of three to five days require 14 calendar days notice.' },
      { id: 'SAFETY#§5#0', source: 'SAFETY §5 · Drones', text: 'Drone flights need a certified operator.' },
    ]);
    expect(api.calls).toHaveLength(1);
    const call = api.calls[0]!;
    expect(call.url).toBe('https://api.typesafe.ai/v1/systemone');
    expect(call.headers.authorization).toBe('Bearer test-key');
    expect(call.body.model).toBe('jev-latest');
    expect(call.body.state).toEqual({ claim: 'Requests of 3-5 days need 14 days notice.', passages: { c1: { source: 'PTO §3.2 · Paid Time Off', text: 'Requests of three to five days require 14 calendar days notice.' }, c2: { source: 'SAFETY §5 · Drones', text: 'Drone flights need a certified operator.' } } });
    expect(Object.keys(call.body.questions)).toEqual(['c1', 'c2']);
    expect(call.body.questions.c1).toEqual({ type: 'choice', instructions: 'How does the passage at `passages.c1` relate to the claim at `claim`?', criteria: RELATION_CRITERIA });
    // Chunk ids (with § and #) never reach the API as keys; they come back on the verdicts.
    expect(JSON.stringify(call.body)).not.toContain('PTO#');
    expect(r.model).toBe('jev-1.13.0');
    expect(r.usage).toEqual({ input_tokens: 412, output_tokens: 40 });
    expect(r.verdicts).toEqual([
      { passage_id: 'PTO#§3.2#0', relation: 'supports', probabilities: { supports: 0.93, contradicts: 0.02, says_nothing: 0.05 }, confidence: 0.93 },
      { passage_id: 'SAFETY#§5#0', relation: 'says_nothing', probabilities: { supports: 0.2, contradicts: 0.05, says_nothing: 0.75 }, confidence: 0.75 },
    ]);
  });

  it('retries once on 429 and then surfaces a SemanticVerifyError with the status', async () => {
    const api = fakeApi([json(429, { error: 'rate limited' }), json(429, { error: 'rate limited' })]);
    const v = new TypeSafeVerifier({ apiKey: 'k', fetch: api.fetch });
    await expect(v.relate('c', [{ id: 'x', source: 's', text: 't' }])).rejects.toMatchObject({ name: 'SemanticVerifyError', status: 429 });
    expect(api.calls).toHaveLength(2);
  });

  it('does not retry a 401 and reports it', async () => {
    const api = fakeApi([json(401, { error: 'bad key' })]);
    const v = new TypeSafeVerifier({ apiKey: 'k', fetch: api.fetch });
    await expect(v.relate('c', [{ id: 'x', source: 's', text: 't' }])).rejects.toMatchObject({ status: 401 });
    expect(api.calls).toHaveLength(1);
  });

  it('turns a connection failure into a SemanticVerifyError', async () => {
    const api = fakeApi([new TypeError('fetch failed'), new TypeError('fetch failed')]);
    const v = new TypeSafeVerifier({ apiKey: 'k', fetch: api.fetch });
    await expect(v.relate('c', [{ id: 'x', source: 's', text: 't' }])).rejects.toBeInstanceOf(SemanticVerifyError);
  });

  it('rejects a malformed answer instead of guessing a verdict', async () => {
    const api = fakeApi([json(200, { model: 'jev-1.13.0', answers: { c1: { type: 'noul', noul: 0.9 } }, usage: { input_tokens: 1, output_tokens: 1 } })]);
    const v = new TypeSafeVerifier({ apiKey: 'k', fetch: api.fetch });
    await expect(v.relate('c', [{ id: 'x', source: 's', text: 't' }])).rejects.toThrow(/malformed answer for x/);
    expect(() => parseChoiceAnswer('y', { type: 'choice', choice: 'maybe', probabilities: {} })).toThrow(/choice maybe/);
    expect(() => parseChoiceAnswer('y', { type: 'choice', choice: 'supports', probabilities: { supports: 1 } })).toThrow(/probability contradicts/);
  });

  it('asks nothing for a fact with no passages', async () => {
    const api = fakeApi([]);
    const v = new TypeSafeVerifier({ apiKey: 'k', fetch: api.fetch });
    expect(await v.relate('c', [])).toEqual({ verdicts: [], model: null, usage: null });
    expect(api.calls).toHaveLength(0);
  });
});
