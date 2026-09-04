import type { Message, MessageCreateParamsNonStreaming, ModelClient } from '@westline/server';

type Params = Omit<MessageCreateParamsNonStreaming, 'model'>;

export interface ScriptedTurn {
  /** Tool calls to emit for this ACT iteration; empty array = stop with text. */
  tools?: { name: string; input: Record<string, unknown> }[];
  text?: string;
}

/**
 * A deterministic stand-in for the Anthropic API. Forced `emit_plan` and `emit_answer` calls get
 * the supplied objects; each free tool-use iteration pops the next scripted turn. Every call is
 * recorded so tests can assert what the orchestrator sent (tools, schemas, messages).
 */
export class FakeModel implements ModelClient {
  readonly model = 'fake-model';
  readonly calls: Params[] = [];
  private actIndex = 0;

  constructor(private readonly script: { plan: Record<string, unknown>; act?: ScriptedTurn[]; answer?: (params: Params) => Record<string, unknown> }) {}

  async create(params: Params): Promise<Message> {
    this.calls.push(params);
    const forced = params.tool_choice && params.tool_choice.type === 'tool' ? params.tool_choice.name : undefined;
    if (forced === 'emit_plan') {
      this.actIndex = 0; // every turn starts with a plan; replay the ACT script from the top
      return message([toolUse('emit_plan', this.script.plan)], 'tool_use');
    }
    if (forced === 'emit_answer') return message([toolUse('emit_answer', this.script.answer?.(params) ?? {})], 'tool_use');
    const turn = this.script.act?.[this.actIndex++];
    if (!turn || !turn.tools?.length) return message([{ type: 'text', text: turn?.text ?? 'Done.', citations: null }], 'end_turn');
    return message(turn.tools.map((t, i) => toolUse(t.name, t.input, `tu_${this.actIndex}_${i}`)), 'tool_use');
  }
}

let n = 0;
function toolUse(name: string, input: Record<string, unknown>, id = `tu_${++n}`) {
  return { type: 'tool_use' as const, id, name, input };
}

function message(content: any[], stop_reason: Message['stop_reason']): Message {
  return { id: `msg_${++n}`, type: 'message', role: 'assistant', model: 'fake-model', content, stop_reason, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } as Message;
}
