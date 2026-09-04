import type { Answer } from './answer.js';
import type { TraceEvent } from './trace.js';

export interface ConfirmationRequest {
  tool: string;
  /** Arguments as proposed by the model, minus the token. Shown verbatim on the card. */
  args: Record<string, unknown>;
  args_hash: string;
  /** Plain-language description of what confirming will do. */
  summary: string;
}

/** What `POST /chat` returns, and what the SSE `final` event carries. */
export interface ChatEnvelope {
  turn_id: string;
  conversation_id: string;
  answer: Answer;
  trace: TraceEvent[];
  confirmation_required?: ConfirmationRequest;
}

export interface PersonaSummary {
  person_id: string;
  name: string;
  title: string;
  workforce_class: string;
  role: string;
  scope: string;
  market: string;
}

export interface DemoTask {
  id: string;
  title: string;
  acting_person_id: string;
  message: string;
  expected_tools: string[];
}
