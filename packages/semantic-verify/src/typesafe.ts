import { APIConnectionError, APIError, TypeSafeClient, choice, type Fetch } from '@typesafe-ai/sdk';
import { RELATION_CRITERIA, SemanticVerifyError, parseChoiceAnswer, relationInstructions, type Passage, type RelateResult, type SemanticVerifier } from './provider.js';

export const DEFAULT_TYPESAFE_MODEL = 'jev-latest';
/** Per-attempt timeout. VERIFY sits on the answer path, so this is short and the fallback is structural verification. */
export const DEFAULT_TIMEOUT_MS = 4_000;

export interface TypeSafeVerifierOptions {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
  /** Injected by tests; defaults to the global fetch. */
  fetch?: Fetch;
  baseURL?: string;
}

/**
 * Jev over the TypeSafe SDK. One request per fact; one Choice question per cited passage, all in
 * the same request so they run in parallel and share the state. One retry on 429/5xx/timeouts
 * (the SDK's default retry set, capped at one), then the error surfaces and VERIFY falls back.
 */
export class TypeSafeVerifier implements SemanticVerifier {
  readonly id = 'typesafe' as const;
  readonly model: string;
  private readonly client: TypeSafeClient;

  constructor(opts: TypeSafeVerifierOptions) {
    this.model = opts.model ?? DEFAULT_TYPESAFE_MODEL;
    this.client = new TypeSafeClient({
      apiKey: opts.apiKey,
      defaultModel: this.model,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      retry: { maxRetries: 1 },
      logLevel: 'off',
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      ...(opts.baseURL ? { baseURL: opts.baseURL } : {}),
    });
  }

  async relate(claim: string, passages: Passage[]): Promise<RelateResult> {
    if (passages.length === 0) return { verdicts: [], model: null, usage: null };
    // Keys are positional (`c1`, `c2`, …) so the backticked state paths in the instructions are
    // always valid identifiers; chunk ids carry `#` and `§`.
    const keyed = passages.map((p, i) => ({ key: `c${i + 1}`, passage: p }));
    const state = {
      claim,
      passages: Object.fromEntries(keyed.map((k) => [k.key, { source: k.passage.source, text: k.passage.text }])),
    };
    const questions = Object.fromEntries(keyed.map((k) => [k.key, choice(relationInstructions(k.key), RELATION_CRITERIA)]));
    let res: { model: string; answers: Record<string, unknown>; usage: { input_tokens: number; output_tokens: number } };
    try {
      res = await this.client.systemOne({ state, questions });
    } catch (err) {
      throw toSemanticError(err);
    }
    const verdicts = keyed.map((k) => parseChoiceAnswer(k.passage.id, res.answers[k.key]));
    return { verdicts, model: res.model, usage: res.usage };
  }
}

function toSemanticError(err: unknown): SemanticVerifyError {
  if (err instanceof SemanticVerifyError) return err;
  if (err instanceof APIError) return new SemanticVerifyError(`typesafe: HTTP ${err.status}`, { status: err.status, cause: err });
  if (err instanceof APIConnectionError) return new SemanticVerifyError(`typesafe: ${err.message}`, { cause: err });
  return new SemanticVerifyError(`typesafe: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
}
