export type Category =
  | 'straightforward_policy' | 'multi_document' | 'tool_workflow'
  | 'ambiguous_clarification' | 'authorization_audience' | 'out_of_scope_safety';

export type Behaviour = 'answer' | 'clarify' | 'escalate' | 'refuse' | 'confirm_gate' | 'deny';

export interface GoldCitation { doc_id: string; section_path: string }

export interface EvalItem {
  id: string;
  category: Category;
  acting_person_id: string | null;
  message: string;
  gold_answer: string;
  gold_citations: GoldCitation[];
  expected_tools: string[];
  order_required: boolean;
  expected_behaviour: Behaviour;
  latency_item: boolean;
  notes: string;
}

export interface EvalSet {
  version: number;
  seed: number;
  description: string;
  calibration_items: string[];
  items: EvalItem[];
}

/** Mirrors packages/shared ChatEnvelope; kept loose so the harness can score any server version. */
export interface Envelope {
  turn_id: string;
  conversation_id: string;
  answer: {
    answer_markdown: string;
    policy_facts: { id: string; statement: string; citations: { chunk_id: string; doc_id: string; section_path: string; snippet: string; title?: string }[] }[];
    recommendations: { text: string; basis_fact_ids: string[] }[];
    applicability: unknown;
    actions_proposed: { tool: string; args_hash: string }[];
    actions_taken: { tool: string; result_summary: string; ref_id: string }[];
    escalation: { target: string; reason: string };
    clarification: { question: string } | null;
    withheld_by_audience: { doc_ids: string[]; explanation: string } | null;
  };
  trace: TraceEvent[];
  confirmation_required?: { tool: string; args: Record<string, unknown>; args_hash: string; summary: string };
}

export interface TraceEvent {
  ts: string; turn_id: string; seq: number; type: string;
  server?: string; tool?: string; args?: Record<string, unknown>;
  result_summary?: string; result_status?: string;
  citations?: { doc_id: string; section_path: string }[];
  duration_ms?: number; detail?: Record<string, unknown>;
}

/** One item, one run, one configuration. */
export interface ItemRun {
  item_id: string;
  config: string;
  run: number;
  started_at: string;
  latency_ms: number;
  /** Envelope from /chat; when a gate was confirmed, `final` is the post-/confirm envelope. */
  envelope: Envelope;
  final?: Envelope;
  confirmed_gate: boolean;
  error?: string;
  scores: ItemScores;
}

export interface ItemScores {
  behaviour_observed: Behaviour[];
  behaviour_match: boolean;
  tool_selection_subset: boolean;
  tool_order_match: boolean | null;
  plan_vs_actual_jaccard: number | null;
  called_tools: string[];
  citation_precision: number | null;
  citation_recall: number | null;
  workflow_complete: boolean;
  action_safety_pass: boolean;
  gate_events: number;
  ungated_executions: number;
  authorization_correct: boolean | null;
  audience_explained: boolean | null;
  facts: number;
  unsupported_claims_removed: number;
  groundedness: { per_fact: number[]; mean: number | null; fully_supported_pct: number | null } | null;
  answer_match: number | null;
}
