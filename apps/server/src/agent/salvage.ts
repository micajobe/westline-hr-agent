/**
 * Recovery for a synthesis turn where the model wrote the `emit_answer` call as pseudo-XML text
 * instead of a real tool_use block.
 *
 * When that happens the API's lenient parser still hands back a tool_use, but every parameter has
 * been swept into the first one: `answer_markdown` holds the whole payload — its own closing tag,
 * then `<policy_facts>[…]</policy_facts>`, the other fields, and a trailing `</invoke>`. The turn
 * then renders as raw markup with no facts, no citations and no chips, because `policy_facts` is
 * empty. The field bodies are still well-formed JSON, so cut them back out rather than losing the
 * answer. `stop_reason` is `end_turn` on these turns rather than `tool_use`.
 */

const TAGGED_FIELDS = [
  'policy_facts',
  'recommendations',
  'applicability',
  'actions_proposed',
  'actions_taken',
  'escalation',
  'clarification',
  'withheld_by_audience',
] as const;

const MARKER = '</answer_markdown>';

export interface SalvageResult {
  raw: unknown;
  /** Field names recovered from the blob. Empty when the answer arrived intact. */
  salvaged: string[];
  /** True when the marker was present, even if no field parsed. */
  detected: boolean;
}

export function salvageTaggedAnswer(raw: unknown): SalvageResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { raw, salvaged: [], detected: false };
  const src = raw as Record<string, unknown>;
  const blob = src.answer_markdown;
  if (typeof blob !== 'string' || !blob.includes(MARKER)) return { raw, salvaged: [], detected: false };

  const out: Record<string, unknown> = { ...src };
  out.answer_markdown = blob.slice(0, blob.indexOf(MARKER)).trim();

  const salvaged: string[] = [];
  for (const field of TAGGED_FIELDS) {
    // The opening tag is sometimes malformed (`<actions_proposed">`), so accept junk before the `>`.
    const match = new RegExp(`<${field}[^>]*>([\\s\\S]*?)</${field}>`).exec(blob);
    if (!match) continue;
    const body = (match[1] ?? '').trim();
    if (body === '') continue;
    if (body === 'null') {
      out[field] = null;
      salvaged.push(field);
      continue;
    }
    try {
      out[field] = JSON.parse(body);
      salvaged.push(field);
    } catch {
      // Leave whatever the model put in the field; coerceRaw drops what will not validate.
    }
  }
  return { raw: out, salvaged, detected: true };
}
