/** Client-side mirrors of packages/shared types (the shared package targets Node). */
export interface TraceEvent {
  ts: string; turn_id: string; seq: number;
  type: 'intent' | 'plan' | 'tool_call' | 'tool_result' | 'retrieval' | 'gate' | 'gate_resolved' | 'synthesis' | 'verify' | 'error';
  server?: 'policy' | 'hr'; tool?: string;
  args?: Record<string, unknown>; result_summary?: string; result_status?: string;
  citations?: { doc_id: string; section_path: string }[];
  duration_ms?: number; detail?: Record<string, unknown>;
}
export interface Citation { chunk_id: string; doc_id: string; title: string; section_path: string; snippet: string }
export interface PolicyFact { id: string; statement: string; citations: Citation[] }
export interface Answer {
  answer_markdown: string;
  policy_facts: PolicyFact[];
  recommendations: { text: string; basis_fact_ids: string[] }[];
  applicability: { workforce_class: string; note: string; citation?: Citation | null } | null;
  actions_proposed: { tool: string; args: Record<string, unknown>; args_hash: string }[];
  actions_taken: { tool: string; result_summary: string; ref_id: string }[];
  escalation: { target: string; reason: string };
  clarification: { question: string } | null;
  withheld_by_audience: { doc_ids: string[]; explanation: string } | null;
}
export interface ConfirmationRequest { tool: string; args: Record<string, unknown>; args_hash: string; summary: string }
export interface ChatEnvelope { turn_id: string; conversation_id: string; answer: Answer; trace: TraceEvent[]; confirmation_required?: ConfirmationRequest }
export interface Persona { person_id: string; name: string; title: string; workforce_class: string; role: string; scope: string; market: string }
export interface DemoTask { id: string; title: string; acting_person_id: string; message: string; expected_tools: string[] }
export interface Health {
  status: string; uptime_s: number; version: string;
  mcp: Record<string, { status: string; tools: number; latency_ms: number | null; error?: string }>;
  index: { chunk_count: number; corpus_hash: string; embedding_model: string; built_at: string } | null;
  models: { agent: string; judge: string; available: boolean };
  mode: { mcp: string; chaos: boolean; rerank: boolean };
}
export interface Desk {
  tickets: { ticket_id: string; created_by: string; about_person_id: string; category: string; summary: string; status: string; created_at: string; turn_id: string | null }[];
  drafts: { draft_id: string; created_by: string; about_person_id: string; recipient_role: string; subject: string; body: string; created_at: string; turn_id: string | null }[];
  resets_on_redeploy?: boolean;
}

// ---------- Handbook (browse) ----------

/** HANDBOOK §2 row for the acting person's class: does this document bind them, and how much of it. */
export interface Applicability { doc_id: string; title: string; scope: 'full' | 'partial' | 'none'; sections?: string[]; note: string }
export interface LibrarySection { section_path: string; section_title: string; level: number; audience: string; readable: boolean }
export interface LibraryDocument {
  doc_id: string; title: string; source_format: 'md' | 'html' | 'pdf';
  version: string; effective_date: string; owner: string; audience: string;
  readable: boolean; section_count: number; readable_section_count: number;
  sections: LibrarySection[];
}
/** One row of HANDBOOK §4 "Who owns what", with its documents. */
export interface LibraryCategory { area: string; owner: string; doc_ids: string[]; documents: LibraryDocument[] }
export interface Library {
  categories: LibraryCategory[];
  viewer: { workforce_class: string | null; scope: string | null };
  workforce_class: string | null;
  applicability: Record<string, Applicability>;
  withheld_doc_ids: string[];
  doc_count: number;
  readable_doc_count: number;
}
export interface DocumentSection extends LibrarySection { text: string | null; withheld_reason: string | null }
export interface HandbookDocument {
  doc_id: string; title: string; source_format: 'md' | 'html' | 'pdf';
  version: string; effective_date: string; owner: string; audience: string;
  preamble: string | null; sections: DocumentSection[]; withheld_section_count: number;
  applicability: Applicability | null;
}
