import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnswerView } from '../components/AnswerView';
import { CitationCard } from '../components/CitationCard';
import { ConfirmationCard } from '../components/ConfirmationCard';
import { ClassBadge, Label } from '../components/primitives';
import { TraceRail, type TraceTurn } from '../components/TraceRail';
import { api, chatStream, confirmStream } from '../lib/api';
import type { ChatEnvelope, Citation, DemoTask, Persona, TraceEvent } from '../lib/types';

interface Turn {
  turn_id: string;
  persona: Persona | null;
  message: string;
  events: TraceEvent[];
  envelope?: ChatEnvelope;
  error?: string;
  busy: boolean;
}

/** PRD §9.1 Chat: conversation left, trace rail right, input and the two demo buttons at the bottom. */
export function ChatPage({ persona, personas, onPersona }: { persona: Persona | null; personas: Persona[]; onPersona: (p: Persona | null) => void }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [input, setInput] = useState('');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  const busy = turns.some((t) => t.busy);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { api.demoTasks().then(setTasks).catch(() => setTasks([])); }, []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }); }, [turns]);

  const patchTurn = useCallback((turn_id: string, patch: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.turn_id === turn_id ? patch(t) : t))), []);

  const send = useCallback(async (message: string, as: Persona | null) => {
    const text = message.trim();
    if (!text || busy) return;
    const tempId = `pending_${Date.now()}`;
    setTurns((ts) => [...ts, { turn_id: tempId, persona: as, message: text, events: [], busy: true }]);
    setInput('');
    let realId = tempId;
    try {
      const env = await chatStream({ message: text, acting_person_id: as?.person_id ?? null, conversation_id: conversationId }, {
        onTrace: (e) => {
          if (realId === tempId && e.turn_id) {
            realId = e.turn_id;
            setTurns((ts) => ts.map((t) => (t.turn_id === tempId ? { ...t, turn_id: e.turn_id } : t)));
          }
          patchTurn(realId, (t) => ({ ...t, events: [...t.events, e] }));
        },
      });
      setConversationId(env.conversation_id);
      patchTurn(realId, (t) => ({ ...t, turn_id: env.turn_id, envelope: env, events: env.trace, busy: false }));
    } catch (err) {
      patchTurn(realId, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err), busy: false }));
    }
  }, [busy, conversationId, patchTurn]);

  const decide = useCallback(async (turn: Turn, decision: 'confirm' | 'cancel') => {
    const req = turn.envelope?.confirmation_required;
    if (!req || !turn.envelope) return;
    patchTurn(turn.turn_id, (t) => ({ ...t, busy: true }));
    try {
      const env = await confirmStream({ conversation_id: turn.envelope.conversation_id, turn_id: turn.turn_id, args_hash: req.args_hash, decision }, {
        onTrace: (e) => patchTurn(turn.turn_id, (t) => (t.events.some((x) => x.seq === e.seq) ? t : { ...t, events: [...t.events, e] })),
      });
      patchTurn(turn.turn_id, (t) => ({ ...t, envelope: env, events: env.trace, busy: false }));
    } catch (err) {
      patchTurn(turn.turn_id, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err), busy: false }));
    }
  }, [patchTurn]);

  const runDemo = (task: DemoTask) => {
    const p = personas.find((x) => x.person_id === task.acting_person_id) ?? null;
    onPersona(p);
    void send(task.message, p);
  };

  const traceTurns: TraceTurn[] = useMemo(() => turns.map((t) => ({ turn_id: t.turn_id, label: `${t.persona?.name ?? 'anonymous'} — ${t.message}`, events: t.events, live: t.busy })), [turns]);

  return (
    <div className="mx-auto grid max-w-[var(--max-content)] flex-1 grid-cols-[minmax(0,1fr)_var(--trace-rail)] gap-0" style={{ minHeight: 'calc(100vh - 49px)' }}>
      <section className="flex min-w-0 flex-col">
        <div className="mx-auto w-full max-w-[var(--chat-col)] flex-1 px-6 py-8">
          {turns.length === 0 && (
            <div className="mt-12">
              <h1 className="display text-[var(--text-40)] leading-[1.05]">Ask about Westline policy as the person you picked.</h1>
              <p className="mt-4 max-w-[560px] text-[var(--text-16)] text-[var(--muted)]">Answers come only from the policy corpus and the HR data this persona is allowed to see. Anything that would create or draft something pauses for your confirmation first. The trace on the right shows every tool call as it happens.</p>
            </div>
          )}
          <ol className="space-y-10">
            {turns.map((t) => (
              <li key={t.turn_id}>
                <div className="flex items-baseline gap-3">
                  <Label>{t.persona?.name ?? 'Anonymous'}</Label>
                  {t.persona && <ClassBadge workforce_class={t.persona.workforce_class} />}
                </div>
                <p className="display mt-1 text-[var(--text-20)] leading-snug">{t.message}</p>
                <div className="mt-4 border-t border-[var(--rule)] pt-4">
                  {t.busy && !t.envelope && <p className="text-[var(--muted)]">{describeProgress(t.events)}</p>}
                  {t.error && <p className="text-[var(--accent)]">{t.error}</p>}
                  {t.envelope && (
                    <div className="space-y-4">
                      <AnswerView answer={t.envelope.answer} onCite={setCitation} />
                      {t.envelope.confirmation_required && <ConfirmationCard request={t.envelope.confirmation_required} busy={t.busy} onDecision={(d) => void decide(t, d)} />}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
          <div ref={bottomRef} />
        </div>

        <div className="sticky bottom-0 border-t border-[var(--rule)] bg-[var(--paper)]">
          <div className="mx-auto w-full max-w-[var(--chat-col)] px-6 py-4">
            {citation && <div className="mb-4"><CitationCard citation={citation} onClose={() => setCitation(null)} /></div>}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(input, persona); }}>
              <input className="flex-1 border border-[var(--rule)] bg-white px-3 py-2 text-[var(--text-16)] placeholder:text-[var(--muted)]" placeholder={persona ? `Ask as ${persona.name}…` : 'Ask a policy question (no persona selected)…'} value={input} onChange={(e) => setInput(e.target.value)} disabled={busy} />
              <button type="submit" disabled={busy || !input.trim()} className="border border-[var(--ink)] bg-[var(--ink)] px-4 py-2 text-[color:var(--paper)] disabled:opacity-40">Send</button>
            </form>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[var(--text-12)]">
              {tasks.map((task, i) => (
                <button key={task.id} type="button" disabled={busy} onClick={() => runDemo(task)} className="border border-[var(--rule)] px-2 py-1 text-[var(--muted)] hover:border-[var(--ink)] hover:text-[var(--ink)] disabled:opacity-40" title={task.message}>Run demo task {i + 1}</button>
              ))}
              {conversationId && <button type="button" className="ml-auto text-[var(--muted)] hover:text-[var(--ink)]" onClick={() => { setTurns([]); setConversationId(undefined); setCitation(null); }}>New conversation</button>}
            </div>
          </div>
        </div>
      </section>
      <TraceRail turns={traceTurns} />
    </div>
  );
}

function describeProgress(events: TraceEvent[]): string {
  const last = events.at(-1);
  if (!last) return 'Planning…';
  if (last.type === 'plan') return `Plan: ${last.result_summary ?? ''}`;
  if (last.type === 'tool_call') return `Calling ${last.tool?.replace('__', ' · ')}…`;
  if (last.type === 'tool_result' || last.type === 'retrieval') return `${last.tool?.replace('__', ' · ')} → ${last.result_summary ?? ''}`;
  if (last.type === 'gate') return 'Waiting for your confirmation…';
  if (last.type === 'synthesis') return 'Verifying citations…';
  return 'Working…';
}
