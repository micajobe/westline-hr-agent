import { argsHash, type TraceRecorder } from '@westline/shared';
import type { McpToolClient } from '../mcp/client.js';
import type { CitationRegistry } from './citations.js';

export interface ActionTakenRecord {
  tool: string;
  result_summary: string;
  ref_id: string;
}

export interface ExecutedTool {
  tool_use_id: string;
  tool: string;
  args: Record<string, unknown>;
  /** What the model gets back as the tool_result content. */
  result: unknown;
  status: string;
}

/**
 * Execute one (non-suspended) tool call through the MCP client, tracing call and result, feeding the
 * citation registry, and recording executed gated actions. Errors are structured results, never thrown.
 */
export async function executeTool(
  client: McpToolClient,
  citations: CitationRegistry,
  trace: TraceRecorder,
  actions: ActionTakenRecord[],
  call: { tool_use_id: string; tool: string; args: Record<string, unknown> },
  ctx: { acting_person_id: string | null; confirmation_token?: string },
): Promise<ExecutedTool> {
  const split = McpToolClient_split(call.tool);
  trace.emit({ type: 'tool_call', server: split?.server, tool: call.tool, args: { ...call.args, acting_person_id: ctx.acting_person_id, ...(ctx.confirmation_token ? { confirmation_token: ctx.confirmation_token } : {}) } });

  const outcome = await client.call(call.tool, call.args, ctx);
  let result: unknown;
  let status: string;
  if (outcome.ok) {
    result = outcome.result;
    status = statusOf(result);
  } else {
    result = { status: outcome.status, server: outcome.server, message: outcome.message };
    status = outcome.status;
    if (outcome.status === 'TOOL_UNAVAILABLE') {
      trace.emit({ type: 'error', server: outcome.server, tool: call.tool, result_status: 'TOOL_UNAVAILABLE', result_summary: `${outcome.server} MCP server unreachable: ${outcome.message}` });
    }
  }

  const refs = split?.server === 'policy' && outcome.ok ? citations.ingest(call.tool, result) : [];
  trace.emit({ type: 'tool_result', server: split?.server, tool: call.tool, result_status: status, result_summary: summarize(call.tool, result, status), duration_ms: outcome.duration_ms, detail: { result: truncateForTrace(result) } });
  if (refs.length) {
    const r = result as Record<string, any>;
    trace.emit({ type: 'retrieval', server: 'policy', tool: call.tool, citations: dedupeRefs(refs), result_summary: `${refs.length} cited chunk${refs.length === 1 ? '' : 's'}${r.withheld_by_audience ? ` · withheld: ${(r.withheld_doc_ids ?? []).join(', ')}` : ''}`, detail: { withheld_by_audience: Boolean(r.withheld_by_audience), withheld_doc_ids: r.withheld_doc_ids ?? [], retrieval: r.retrieval ?? null } });
  }

  if (outcome.ok && isExecutedAction(call.tool, result)) {
    const r = result as Record<string, any>;
    actions.push({ tool: call.tool, ref_id: r.ticket_id ?? r.draft_id ?? '', result_summary: call.tool.endsWith('draft_hr_email') ? `Draft ${r.draft_id} to ${r.to_role}: "${r.subject}" (not sent)` : `Ticket ${r.ticket_id} opened (${r.category})` });
  }
  return { tool_use_id: call.tool_use_id, tool: call.tool, args: call.args, result, status };
}

function McpToolClient_split(name: string): { server: 'policy' | 'hr'; name: string } | undefined {
  const i = name.indexOf('__');
  const server = name.slice(0, i);
  return server === 'policy' || server === 'hr' ? { server, name: name.slice(i + 2) } : undefined;
}

export function statusOf(result: unknown): string {
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.status === 'string') return r.status;
    if (typeof r.error === 'string') return r.error;
  }
  return 'ok';
}

export function isExecutedAction(tool: string, result: unknown): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return (tool.endsWith('create_mock_hr_ticket') && typeof r.ticket_id === 'string') || (tool.endsWith('draft_hr_email') && typeof r.draft_id === 'string');
}

export function proposedArgsHash(args: Record<string, unknown>, acting_person_id: string | null): string {
  // The server injects acting_person_id before hashing, matching what hr-data-mcp hashes.
  return argsHash({ ...args, acting_person_id });
}

function summarize(tool: string, result: unknown, status: string): string {
  if (!result || typeof result !== 'object') return status;
  const r = result as Record<string, any>;
  if (status !== 'ok') return `${status}${r.reason ? `: ${String(r.reason).slice(0, 140)}` : r.message ? `: ${String(r.message).slice(0, 140)}` : ''}`;
  if (Array.isArray(r.results)) return `${r.results.length} chunks from ${[...new Set(r.results.map((x: any) => x.doc_id))].join(', ') || 'nothing'}${r.withheld_by_audience ? ` · withheld: ${r.withheld_doc_ids.join(', ')}` : ''}`;
  if (Array.isArray(r.rules)) return `${r.rules.length} rules, ${r.gaps?.length ?? 0} gaps`;
  if (Array.isArray(r.applies)) return `${r.workforce_class}: ${r.summary?.full?.length ?? 0} full, ${r.summary?.partial?.length ?? 0} partial, ${r.summary?.none?.length ?? 0} none`;
  if (tool.endsWith('get_policy_section')) return `${r.doc_id} ${r.section_path} "${r.section_title}" (${r.audience})`;
  if (tool.endsWith('lookup_person_profile')) return `${r.name} · ${r.workforce_class} · ${r.title} · scope ${r.scope}`;
  if (tool.endsWith('check_pto_balance')) return `balance ${r.balance}/${r.annual_entitlement_days}${r.requested_days != null ? ` · ${r.requested_days} requested · fits ${r.request_fits}` : ''}${r.blackout_collision ? ` · blackout: ${r.blackout_collision.window}` : ''}${r.notice_calendar_days != null ? ` · notice ${r.notice_calendar_days}d (${r.notice_met ? 'met' : 'not met'})` : ''}`;
  if (tool.endsWith('lookup_benefits_status')) return `eligible ${r.eligible} · ${(r.enrolled_plans ?? []).length} plans`;
  if (r.ticket_id) return `ticket ${r.ticket_id} open`;
  if (r.draft_id) return `draft ${r.draft_id} (not sent)`;
  return 'ok';
}

function dedupeRefs<T extends { doc_id: string; section_path: string }>(refs: T[]): T[] {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(`${r.doc_id}${r.section_path}`) ? false : (seen.add(`${r.doc_id}${r.section_path}`), true)));
}

/** Keep the trace rail readable: drop full chunk text, keep everything else. */
function truncateForTrace(result: unknown): unknown {
  if (!result || typeof result !== 'object') return result;
  const clone = structuredClone(result) as Record<string, any>;
  if (Array.isArray(clone.results)) clone.results = clone.results.map((x: any) => ({ ...x, text: undefined }));
  if (typeof clone.text === 'string' && clone.text.length > 600) clone.text = `${clone.text.slice(0, 600)}…`;
  return clone;
}
