import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnswerView } from '../components/AnswerView';
import { ChatList } from '../components/ChatList';
import { CitationCard } from '../components/CitationCard';
import { Composer } from '../components/Composer';
import { ConfirmationCard } from '../components/ConfirmationCard';
import { ClassBadge, GLYPH, Label } from '../components/primitives';
import { TraceRail, type TraceTurn } from '../components/TraceRail';
import { api, chatStream, confirmStream } from '../lib/api';
import {
  browserStorage,
  chatTitle,
  loadChats,
  MAX_CHATS,
  newChat,
  pruneEmpty,
  saveChats,
  sortChats,
  withPersona,
  type Chat,
  type Turn,
} from '../lib/chats';
import type { Citation, DemoTask, Persona, TraceEvent } from '../lib/types';

const storage = browserStorage();

/**
 * PRD §9.1 Chat, restructured per ADR 0014: recent chats left, trace rail right, and one question
 * field that moves. An empty chat opens with the generous field under the header; once the first
 * answer lands the field re-appears docked at the bottom for follow-ups. Every turn — first or
 * follow-up — goes through the same `/chat/stream` pipeline, so the guardrails do not change.
 */
export function ChatPage({ persona, personas, onPersona }: { persona: Persona | null; personas: Persona[]; onPersona: (p: Persona | null) => void }) {
  const [chats, setChats] = useState<Chat[]>(() => {
    const loaded = loadChats(storage);
    return loaded.length > 0 ? loaded : [newChat(null)];
  });
  const [activeId, setActiveId] = useState<string>(() => chats[0]?.chat_id ?? '');
  const [listCollapsed, setListCollapsed] = useState(false);
  const [traceCollapsed, setTraceCollapsed] = useState(false);
  const [input, setInput] = useState('');
  const [tasks, setTasks] = useState<DemoTask[]>([]);
  const [citation, setCitation] = useState<Citation | null>(null);
  /** Chats this page load has actually talked to; the rest were restored from storage. */
  const touched = useRef(new Set<string>());
  const bottomRef = useRef<HTMLDivElement>(null);

  const active = chats.find((c) => c.chat_id === activeId) ?? chats[0];
  const turns = active?.turns ?? [];
  const busy = turns.some((t) => t.busy);
  const restored = Boolean(active && active.turns.length > 0 && !touched.current.has(active.chat_id));
  /** The opening field owns an empty chat; the docked field only exists once there is something to discuss. */
  const opening = turns.length === 0;
  const answered = turns.some((t) => t.envelope || t.error);
  /**
   * The docked field appears once the first turn has settled, and then stays put so a follow-up
   * does not make the page jump. `!busy` also covers a reload mid-flight, where the restored turn
   * has neither envelope nor error and would otherwise leave the chat with no field at all.
   */
  const showDocked = !opening && (answered || !busy);

  useEffect(() => { api.demoTasks().then(setTasks).catch(() => setTasks([])); }, []);
  // Only the transcript follows its tail; the opening panel must stay pinned at the top.
  useEffect(() => { if (turns.length > 0) bottomRef.current?.scrollIntoView({ block: 'end' }); }, [turns]);
  // Writing on every trace event would thrash storage; one write per settled turn is enough.
  useEffect(() => { if (!busy) saveChats(storage, chats); }, [chats, busy]);

  const updateChat = useCallback(
    (chat_id: string, patch: (c: Chat) => Chat) => setChats((cs) => sortChats(cs.map((c) => (c.chat_id === chat_id ? patch(c) : c)))),
    [],
  );

  const patchTurn = useCallback(
    (chat_id: string, turn_id: string, patch: (t: Turn) => Turn) =>
      updateChat(chat_id, (c) => ({ ...c, updated_at: Date.now(), turns: c.turns.map((t) => (t.turn_id === turn_id ? patch(t) : t)) })),
    [updateChat],
  );

  const startChat = useCallback((as: Persona | null): Chat => {
    const chat = newChat(as);
    touched.current.add(chat.chat_id);
    setChats((cs) => sortChats([chat, ...pruneEmpty(cs, chat.chat_id)]).slice(0, MAX_CHATS));
    setActiveId(chat.chat_id);
    setCitation(null);
    return chat;
  }, []);

  /**
   * The acting person is the authorization boundary (ADR 0007/0008), so a chat belongs to exactly
   * one persona: switching in the header starts a new chat rather than carrying answers written
   * for one audience into another persona's context (ADR 0013). An empty chat just re-points.
   */
  useEffect(() => {
    if (personas.length === 0 || !active) return;
    const wanted = persona?.person_id ?? null;
    if (active.acting_person_id === wanted) return;
    if (active.turns.length === 0) {
      updateChat(active.chat_id, (c) => withPersona(c, persona));
      return;
    }
    startChat(persona);
  }, [persona, personas, active, updateChat, startChat]);

  const send = useCallback(async (message: string, as: Persona | null, target: Chat) => {
    const text = message.trim();
    if (!text || busy) return;
    const chat_id = target.chat_id;
    touched.current.add(chat_id);
    const tempId = `pending_${Date.now()}`;
    setChats((cs) => sortChats(cs.map((c) => (c.chat_id === chat_id
      ? { ...c, title: c.turns.length === 0 ? chatTitle(text) : c.title, updated_at: Date.now(), turns: [...c.turns, { turn_id: tempId, persona: as, message: text, events: [], busy: true }] }
      : c))));
    setInput('');
    let realId = tempId;
    try {
      const env = await chatStream({ message: text, acting_person_id: as?.person_id ?? null, conversation_id: target.conversation_id }, {
        onTrace: (e) => {
          if (realId === tempId && e.turn_id) {
            realId = e.turn_id;
            updateChat(chat_id, (c) => ({ ...c, turns: c.turns.map((t) => (t.turn_id === tempId ? { ...t, turn_id: e.turn_id } : t)) }));
          }
          patchTurn(chat_id, realId, (t) => ({ ...t, events: [...t.events, e] }));
        },
      });
      updateChat(chat_id, (c) => ({
        ...c,
        conversation_id: env.conversation_id,
        updated_at: Date.now(),
        turns: c.turns.map((t) => (t.turn_id === realId ? { ...t, turn_id: env.turn_id, envelope: env, events: env.trace, busy: false } : t)),
      }));
    } catch (err) {
      patchTurn(chat_id, realId, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err), busy: false }));
    }
  }, [busy, patchTurn, updateChat]);

  const decide = useCallback(async (chat_id: string, turn: Turn, decision: 'confirm' | 'cancel') => {
    const req = turn.envelope?.confirmation_required;
    if (!req || !turn.envelope) return;
    touched.current.add(chat_id);
    patchTurn(chat_id, turn.turn_id, (t) => ({ ...t, busy: true }));
    try {
      const env = await confirmStream({ conversation_id: turn.envelope.conversation_id, turn_id: turn.turn_id, args_hash: req.args_hash, decision }, {
        onTrace: (e) => patchTurn(chat_id, turn.turn_id, (t) => (t.events.some((x) => x.seq === e.seq) ? t : { ...t, events: [...t.events, e] })),
      });
      patchTurn(chat_id, turn.turn_id, (t) => ({ ...t, envelope: env, events: env.trace, busy: false }));
    } catch (err) {
      patchTurn(chat_id, turn.turn_id, (t) => ({ ...t, error: err instanceof Error ? err.message : String(err), busy: false }));
    }
  }, [patchTurn]);

  const selectChat = (chat: Chat) => {
    setChats((cs) => pruneEmpty(cs, chat.chat_id));
    setActiveId(chat.chat_id);
    setCitation(null);
    if ((persona?.person_id ?? null) !== chat.acting_person_id) {
      onPersona(personas.find((p) => p.person_id === chat.acting_person_id) ?? null);
    }
  };

  const deleteChat = (chat: Chat) => {
    const rest = sortChats(chats.filter((c) => c.chat_id !== chat.chat_id));
    const next = rest.length > 0 ? rest : [newChat(persona)];
    setChats(next);
    saveChats(storage, next);
    const head = next[0];
    if (chat.chat_id === activeId && head) {
      setActiveId(head.chat_id);
      setCitation(null);
    }
  };

  // A scenario owns both the persona and the chat, so it always runs in a clean conversation.
  const runScenario = (task: DemoTask) => {
    const p = personas.find((x) => x.person_id === task.acting_person_id) ?? null;
    onPersona(p);
    void send(task.message, p, startChat(p));
  };

  const onNew = () => {
    if (!active) return;
    if (active.turns.length === 0) {
      updateChat(active.chat_id, (c) => withPersona(c, persona));
      return;
    }
    startChat(persona);
  };

  const traceTurns: TraceTurn[] = useMemo(
    () => turns.map((t) => ({ turn_id: t.turn_id, label: `${t.persona?.name ?? 'anonymous'} — ${t.message}`, events: t.events, live: t.busy })),
    [turns],
  );

  return (
    <div
      className="grid min-h-0 w-full flex-1 gap-0 overflow-hidden"
      style={{ gridTemplateRows: 'minmax(0,1fr)', gridTemplateColumns: `${listCollapsed ? 'var(--rail-collapsed)' : 'var(--chat-list)'} minmax(0,1fr) ${traceCollapsed ? 'var(--rail-collapsed)' : 'var(--trace-rail)'}` }}
    >
      <ChatList
        chats={chats}
        activeId={active?.chat_id ?? null}
        collapsed={listCollapsed}
        busy={busy}
        onToggle={() => setListCollapsed((c) => !c)}
        onSelect={selectChat}
        onNew={onNew}
        onDelete={deleteChat}
      />
      <section className="flex min-w-0 min-h-0 flex-col">
        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[var(--chat-col)] px-6 py-8">
            {opening ? (
              <div className="mt-6">
                <Label className="mb-4">Westline · policy assistant · HANDBOOK §2</Label>
                <h1 className="headline text-[length:var(--t-h1)]">Ask about Westline policy<br />as the person <em>you picked</em>.</h1>
                <p className="lede mt-6 max-w-[560px] text-[var(--muted)]">Answers come only from the policy corpus and the HR data this persona is allowed to see. Anything that would create or draft something pauses for your confirmation first. The trace on the right shows every tool call as it happens.</p>
                <div className="rule mt-8 pt-8">
                  <Composer variant="opening" value={input} persona={persona} busy={busy} onChange={setInput} onSubmit={() => { if (active) void send(input, persona, active); }} />
                </div>
                {tasks.length > 0 && (
                  <div className="rule mt-10 pt-5">
                    <Label className="mb-3">Test scenarios · sets the persona and runs the question</Label>
                    <ul className="m-0 list-none space-y-2 p-0">
                      {tasks.map((task, i) => (
                        <li key={task.id}>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => runScenario(task)}
                            title={task.message}
                            className="flex w-full items-baseline gap-3 border border-[var(--ink)] px-3 py-2 text-left hover:bg-[var(--paper-2)] disabled:opacity-45"
                          >
                            <span className="mono-xs uppercase text-[var(--muted)]">Scenario {String(i + 1).padStart(2, '0')}</span>
                            <span className="text-[length:var(--t-body-sm)]">{task.title}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <ol className="m-0 list-none space-y-8 p-0">
                {turns.map((t) => (
                  <li key={t.turn_id} className="space-y-5">
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex items-center gap-2">
                        <Label>{t.persona?.name ?? 'Anonymous'}</Label>
                        {t.persona && <ClassBadge workforce_class={t.persona.workforce_class} />}
                      </div>
                      <p className="m-0 max-w-[85%] whitespace-pre-wrap bg-[var(--paper-2)] px-4 py-3 text-[length:var(--t-body)]">{t.message}</p>
                    </div>
                    <div>
                      <Label className="mb-3">Westline</Label>
                      {t.busy && !t.envelope && <p className="mono text-[var(--muted)]">{GLYPH.off} {describeProgress(t.events)}</p>}
                      {t.error && <p className="mono">{GLYPH.warn} {t.error}</p>}
                      {t.envelope && (
                        <div className="space-y-4">
                          <AnswerView answer={t.envelope.answer} onCite={setCitation} />
                          {t.envelope.confirmation_required && active && <ConfirmationCard request={t.envelope.confirmation_required} busy={t.busy} onDecision={(d) => void decide(active.chat_id, t, d)} />}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
            <div ref={bottomRef} />
          </div>
        </div>

        {showDocked && (
          <div className="shrink-0 border-t border-[var(--ink)] bg-[var(--paper)]">
            <div className="mx-auto w-full max-w-[var(--chat-col)] px-6 py-4">
              {citation && <div className="mb-4"><CitationCard citation={citation} onClose={() => setCitation(null)} /></div>}
              {restored && (
                <p className="mono-xs mb-3 text-[var(--muted)]">
                  {GLYPH.warn} Restored from this browser. The server keeps conversation context only briefly, so treat a follow-up here as a fresh question.
                </p>
              )}
              <Composer variant="docked" value={input} persona={persona} busy={busy} onChange={setInput} onSubmit={() => { if (active) void send(input, persona, active); }} />
              <div className="mt-3 flex">
                <button type="button" className="link link-muted ml-auto" onClick={onNew} disabled={busy}>New chat</button>
              </div>
            </div>
          </div>
        )}
      </section>
      <TraceRail turns={traceTurns} collapsed={traceCollapsed} onToggle={() => setTraceCollapsed((c) => !c)} />
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
