import { SEMANTIC_VERIFY_PROVIDERS, SemanticVerifyError, type SemanticVerifier, type SemanticVerifyProviderId } from './provider.js';
import { StubVerifier } from './stub.js';
import { TypeSafeVerifier } from './typesafe.js';

export * from './provider.js';
export { StubVerifier, stubRelation, SUPPORT_FRACTION } from './stub.js';
export { TypeSafeVerifier, DEFAULT_TIMEOUT_MS, DEFAULT_TYPESAFE_MODEL, type TypeSafeVerifierOptions } from './typesafe.js';

export interface SemanticVerifyConfig {
  provider: SemanticVerifyProviderId;
  apiKey?: string | undefined;
  model?: string | undefined;
  timeoutMs?: number | undefined;
}

export const isSemanticVerifyProvider = (v: unknown): v is SemanticVerifyProviderId => typeof v === 'string' && (SEMANTIC_VERIFY_PROVIDERS as readonly string[]).includes(v);

/** `off` yields no verifier: VERIFY is then structural only, exactly as before this package existed. */
export function createSemanticVerifier(config: SemanticVerifyConfig): SemanticVerifier | undefined {
  switch (config.provider) {
    case 'off':
      return undefined;
    case 'stub':
      return new StubVerifier();
    case 'typesafe':
      if (!config.apiKey) throw new SemanticVerifyError('TYPESAFE_API_KEY is required when SEMANTIC_VERIFY_PROVIDER=typesafe');
      return new TypeSafeVerifier({ apiKey: config.apiKey, ...(config.model ? { model: config.model } : {}), ...(config.timeoutMs ? { timeoutMs: config.timeoutMs } : {}) });
  }
}
