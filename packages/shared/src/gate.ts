import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/** PRD §6.2: a confirmation token is valid for ten minutes and exactly one use. */
export const CONFIRMATION_TOKEN_TTL_MS = 10 * 60_000;

/**
 * Token format: `<args_hash>.<issued_at_ms>.<nonce>.<hmac>`. The HMAC is over the first three
 * fields with `MCP_SHARED_SECRET`, so `hr-data-mcp` can verify a token minted by the app server
 * without any shared state, and a token forged by the model (which never sees the secret) fails.
 * Binding the args hash into the signed payload is what makes "confirm this exact action" true.
 */
export function mintConfirmationToken(args_hash: string, secret: string, now = Date.now()): string {
  if (!secret) throw new Error('mintConfirmationToken: secret is required');
  const nonce = randomBytes(12).toString('hex');
  const payload = `${args_hash}.${now}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

export type TokenRejection = 'MALFORMED' | 'BAD_SIGNATURE' | 'ARGS_MISMATCH' | 'EXPIRED';

export type TokenVerification =
  | { ok: true; nonce: string; issued_at: number; expires_at: number }
  | { ok: false; reason: TokenRejection };

export function verifyConfirmationToken(
  token: unknown,
  expected_args_hash: string,
  secret: string,
  opts: { now?: number; ttlMs?: number } = {},
): TokenVerification {
  const now = opts.now ?? Date.now();
  const ttl = opts.ttlMs ?? CONFIRMATION_TOKEN_TTL_MS;
  if (typeof token !== 'string') return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 4) return { ok: false, reason: 'MALFORMED' };
  const [hash, issuedRaw, nonce, sig] = parts as [string, string, string, string];
  const issued_at = Number(issuedRaw);
  if (!/^[0-9a-f]{64}$/.test(hash) || !Number.isFinite(issued_at) || !nonce || !sig) {
    return { ok: false, reason: 'MALFORMED' };
  }
  const expected = sign(`${hash}.${issuedRaw}.${nonce}`, secret);
  if (expected.length !== sig.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))) {
    return { ok: false, reason: 'BAD_SIGNATURE' };
  }
  if (hash !== expected_args_hash) return { ok: false, reason: 'ARGS_MISMATCH' };
  const expires_at = issued_at + ttl;
  if (now > expires_at || now < issued_at - 60_000) return { ok: false, reason: 'EXPIRED' };
  return { ok: true, nonce, issued_at, expires_at };
}

/**
 * Single-use enforcement. Nonces are remembered until their token would have expired anyway, so
 * the set cannot grow without bound. In-memory on purpose: a restart invalidates outstanding
 * tokens, which is the safe direction.
 */
export class UsedTokenRegistry {
  private readonly used = new Map<string, number>();

  /** Returns false if the nonce was already consumed. */
  consume(nonce: string, expires_at: number, now = Date.now()): boolean {
    this.prune(now);
    if (this.used.has(nonce)) return false;
    this.used.set(nonce, expires_at);
    return true;
  }

  prune(now = Date.now()): void {
    for (const [nonce, exp] of this.used) if (exp < now) this.used.delete(nonce);
  }

  get size(): number {
    return this.used.size;
  }
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}
