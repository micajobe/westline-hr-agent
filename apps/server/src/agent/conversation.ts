import type { Answer, TraceEvent } from '@westline/shared';
import type { StoredCitation } from './citations.js';
import type { MessageParam } from './model.js';
import type { Plan } from './schemas.js';
import type { ActionTakenRecord } from './tools.js';

export interface PendingGate {
  tool_use_id: string;
  tool: string;
  /** Model-proposed args (server-owned fields excluded). */
  args: Record<string, unknown>;
  args_hash: string;
  summary: string;
}

/** Everything needed to pick the ACT loop back up after the user confirms or cancels. */
export interface SuspendedTurn {
  turn_id: string;
  plan: Plan;
  system: string;
  /** Loop messages so far, ending with the assistant turn that contains the gated tool_use. */
  messages: MessageParam[];
  /** tool_result blocks already produced for other tool_use blocks in that assistant turn. */
  completed_results: { tool_use_id: string; content: string }[];
  pending: PendingGate;
  iteration: number;
  trace: TraceEvent[];
  citations: StoredCitation[];
  actions: ActionTakenRecord[];
  /** The answer written and verified before the gate was raised (ADR 0020); reused on resolution. */
  answer: Answer;
  started_at: number;
}

export interface Conversation {
  conversation_id: string;
  acting_person_id: string | null;
  /** Completed turns as user/assistant text, for follow-ups. */
  history: MessageParam[];
  prior_queries: string[];
  suspended?: SuspendedTurn;
  updated_at: number;
}

/**
 * In-memory conversation state keyed by conversation_id with a TTL (PRD §8: a documented demo-scale
 * choice). Holds the suspended ACT loop between the confirmation card and the user's decision.
 */
export class ConversationStore {
  private readonly map = new Map<string, Conversation>();
  constructor(private readonly ttlMs: number, private readonly now: () => number = Date.now) {}

  get(id: string): Conversation | undefined {
    this.sweep();
    return this.map.get(id);
  }

  getOrCreate(id: string, acting_person_id: string | null): Conversation {
    const existing = this.get(id);
    if (existing) {
      existing.updated_at = this.now();
      return existing;
    }
    const c: Conversation = { conversation_id: id, acting_person_id, history: [], prior_queries: [], updated_at: this.now() };
    this.map.set(id, c);
    return c;
  }

  touch(c: Conversation): void {
    c.updated_at = this.now();
  }

  get size(): number {
    return this.map.size;
  }

  sweep(): void {
    const cutoff = this.now() - this.ttlMs;
    for (const [id, c] of this.map) if (c.updated_at < cutoff) this.map.delete(id);
  }
}
