import { createHash } from 'node:crypto';

/**
 * Deterministic JSON with sorted keys. Used for the confirmation-token args hash, so the token
 * a user confirms is bound to the exact arguments the model proposed -- key order in the
 * model's tool-call JSON must not change the hash.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) out[key] = sortValue(src[key]);
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/** The hash a confirmation token must match. Excludes the token field itself. */
export function argsHash(args: Record<string, unknown>): string {
  const { confirmation_token: _drop, ...rest } = args;
  return sha256(canonicalJson(rest));
}
