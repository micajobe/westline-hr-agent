/**
 * The operational trace. Every row the trace rail renders comes from here.
 *
 * Hard rule: this carries *operational* facts only -- what was called, with what, how long it
 * took, what came back. It never carries model reasoning. See CLAUDE.md.
 */

export const TRACE_TYPES = [
  'intent',
  'plan',
  /** One ACT-loop model round trip. Without it a third of a turn's latency is unaccounted for. */
  'act',
  'tool_call',
  'tool_result',
  'retrieval',
  'gate',
  'gate_resolved',
  'synthesis',
  'verify',
  'error',
] as const;
export type TraceType = (typeof TRACE_TYPES)[number];

export type TraceServer = 'policy' | 'hr';

export interface TraceCitationRef {
  doc_id: string;
  section_path: string;
}

export interface TraceEvent {
  ts: string;
  turn_id: string;
  seq: number;
  type: TraceType;
  server?: TraceServer;
  tool?: string;
  /** Redacted before emission: `confirmation_token` is replaced with the bullet mask. */
  args?: Record<string, unknown>;
  result_summary?: string;
  result_status?: string;
  citations?: TraceCitationRef[];
  duration_ms?: number;
  detail?: Record<string, unknown>;
}

// ---------- VERIFY detail (PRD §7.1, ADR 0019) ----------

export type SemanticVerifyProvider = 'typesafe' | 'stub' | 'off';
export type SemanticVerdictLabel = 'supported' | 'unsupported' | 'contradicted' | 'unavailable';

/** One (fact, citation) pair as judged by the semantic verifier. Probabilities only; never prose. */
export interface SemanticVerdictRow {
  fact_id: string;
  chunk_id: string;
  verdict: SemanticVerdictLabel;
  p_supports: number | null;
  confidence: number | null;
}

/** The `semantic` block inside a `verify` event's `detail` when a semantic verifier is configured. */
export interface SemanticVerifyDetail {
  provider: SemanticVerifyProvider;
  model: string | null;
  threshold: number;
  pairs_checked: number;
  supported: number;
  unsupported: number;
  contradicted: number;
  /** Pairs judged on a snippet or truncated text because full chunk text was not available. */
  degraded_input: number;
  /** Pairs the verifier could not judge (error, timeout, malformed answer); structural result kept. */
  unavailable: number;
  /** Why pairs were unavailable, counted by HTTP status or `network` / `malformed`; operational, never prose. */
  errors: Record<string, number>;
  latency_ms: number;
  verdicts: SemanticVerdictRow[];
}

export const REDACTED = '•••';

const SECRET_ARG_KEYS = new Set(['confirmation_token']);

/** Redact secrets from tool arguments before they enter a trace event or a log line. */
export function redactArgs(args: unknown): Record<string, unknown> | undefined {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    out[k] = SECRET_ARG_KEYS.has(k) ? REDACTED : v;
  }
  return out;
}

/** Collects trace events for one turn, stamping sequence numbers and timestamps. */
export class TraceRecorder {
  private seq = 0;
  private readonly events: TraceEvent[] = [];

  constructor(
    readonly turn_id: string,
    private readonly onEvent?: (e: TraceEvent) => void,
  ) {}

  emit(event: Omit<TraceEvent, 'ts' | 'turn_id' | 'seq'>): TraceEvent {
    const full: TraceEvent = {
      ts: new Date().toISOString(),
      turn_id: this.turn_id,
      seq: this.seq++,
      ...event,
      ...(event.args ? { args: redactArgs(event.args) } : {}),
    };
    this.events.push(full);
    this.onEvent?.(full);
    return full;
  }

  all(): TraceEvent[] {
    return [...this.events];
  }

  /** Resumed turns continue the same numbering so the rail reads as one story. */
  resumeFrom(events: TraceEvent[]): void {
    for (const e of events) this.events.push(e);
    this.seq = events.reduce((m, e) => Math.max(m, e.seq + 1), this.seq);
  }
}
