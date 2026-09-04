import type { ChatEnvelope, Desk, DemoTask, Health, Persona, TraceEvent } from './types';

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status}`), { status: res.status });
  return (await res.json()) as T;
}

export const api = {
  health: () => getJson<Health>('/health'),
  personas: () => getJson<Persona[]>('/personas'),
  demoTasks: () => getJson<DemoTask[]>('/demo/tasks'),
  desk: () => getJson<Desk>('/desk'),
  evalLatest: () => getJson<Record<string, unknown>>('/eval/latest'),
};

export interface StreamHandlers {
  onTrace: (e: TraceEvent) => void;
  signal?: AbortSignal;
}

/** POST an SSE endpoint and resolve with the terminal envelope (`final` or `confirmation_required`). */
export async function streamPost(path: string, body: unknown, h: StreamHandlers): Promise<ChatEnvelope> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: h.signal });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    let message = `${res.status}`;
    try { message = (JSON.parse(text) as { message?: string }).message ?? message; } catch { /* keep status */ }
    throw new Error(message);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let terminal: ChatEnvelope | undefined;
  let error: string | undefined;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = block.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('\n');
      if (!event || !data) continue;
      const parsed = JSON.parse(data);
      if (event === 'trace') h.onTrace(parsed as TraceEvent);
      else if (event === 'final' || event === 'confirmation_required') terminal = parsed as ChatEnvelope;
      else if (event === 'error') error = (parsed as { message?: string }).message ?? 'stream error';
    }
  }
  if (error) throw new Error(error);
  if (!terminal) throw new Error('stream ended without a final envelope');
  return terminal;
}

export const chatStream = (body: { message: string; acting_person_id: string | null; conversation_id?: string }, h: StreamHandlers) => streamPost('/chat/stream', body, h);
export const confirmStream = (body: { conversation_id: string; turn_id: string; args_hash: string; decision: 'confirm' | 'cancel' }, h: StreamHandlers) => streamPost('/confirm/stream', body, h);
