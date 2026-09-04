import Anthropic from '@anthropic-ai/sdk';
import type { Message, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/messages/messages.js';

/**
 * The one seam between the orchestrator and the Anthropic API. Tests inject a `FakeModel`; the app
 * injects `AnthropicModel`. Nothing else in `agent/` imports the SDK.
 */
export interface ModelClient {
  readonly model: string;
  create(params: Omit<MessageCreateParamsNonStreaming, 'model'>): Promise<Message>;
}

export class AnthropicModel implements ModelClient {
  private readonly client: Anthropic;
  constructor(apiKey: string, readonly model: string) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  }
  create(params: Omit<MessageCreateParamsNonStreaming, 'model'>): Promise<Message> {
    // Claude 5 models reject `temperature` (400: deprecated). Determinism for the eval comes from
    // tool-forced structured output and fixed prompts, not a sampling knob (PRD §12 says temperature 0;
    // ai-tooling.md records why that is no longer possible).
    const { temperature: _ignored, ...rest } = params;
    return this.client.messages.create({ ...rest, model: this.model });
  }
}

export type { Message, MessageCreateParamsNonStreaming };
export type MessageParam = MessageCreateParamsNonStreaming['messages'][number];
export type ContentBlock = Message['content'][number];
