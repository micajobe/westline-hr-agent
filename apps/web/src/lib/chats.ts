import type { ChatEnvelope, Persona, TraceEvent } from './types';

/** One user message and everything the agent produced for it. `busy` is never persisted. */
export interface Turn {
  turn_id: string;
  persona: Persona | null;
  message: string;
  events: TraceEvent[];
  envelope?: ChatEnvelope;
  error?: string;
  busy: boolean;
}

/**
 * A chat as the browser remembers it. The server's conversation store is in-memory with a TTL
 * (PRD §8), so this archive is client-side only: it restores the transcript and its trace, and a
 * follow-up may find the server-side context already swept.
 */
export interface Chat {
  chat_id: string;
  /** Server-side conversation this chat is bound to; absent until the first turn returns. */
  conversation_id?: string;
  /** The persona every turn was asked as. Switching persona starts a new chat (ADR 0013). */
  acting_person_id: string | null;
  persona_label: string;
  workforce_class: string | null;
  title: string;
  created_at: number;
  updated_at: number;
  turns: Turn[];
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CHATS_KEY = 'westline.chats.v1';
/** Demo-scale cap: the sidebar is a recent list, not an archive. Oldest chats fall off. */
export const MAX_CHATS = 20;
export const UNTITLED = 'New chat';
const TITLE_MAX = 64;

export function newChat(persona: Persona | null, now = Date.now(), rand = Math.random): Chat {
  return {
    chat_id: `chat_${now.toString(36)}_${Math.floor(rand() * 1e6).toString(36)}`,
    acting_person_id: persona?.person_id ?? null,
    persona_label: persona?.name ?? 'Anonymous',
    workforce_class: persona?.workforce_class ?? null,
    title: UNTITLED,
    created_at: now,
    updated_at: now,
    turns: [],
  };
}

/** The first user message names the chat: one line, no ellipsis unless it was actually cut. */
export function chatTitle(message: string): string {
  const flat = message.replace(/\s+/g, ' ').trim();
  if (!flat) return UNTITLED;
  return flat.length <= TITLE_MAX ? flat : `${flat.slice(0, TITLE_MAX - 1).trimEnd()}…`;
}

/** Re-point a chat at a persona. Only meaningful while it has no turns. */
export function withPersona(chat: Chat, persona: Persona | null): Chat {
  return {
    ...chat,
    acting_person_id: persona?.person_id ?? null,
    persona_label: persona?.name ?? 'Anonymous',
    workforce_class: persona?.workforce_class ?? null,
  };
}

export const sortChats = (chats: Chat[]): Chat[] => [...chats].sort((a, b) => b.updated_at - a.updated_at);

export function loadChats(storage: StorageLike | undefined): Chat[] {
  if (!storage) return [];
  let raw: string | null = null;
  try {
    raw = storage.getItem(CHATS_KEY);
  } catch {
    return [];
  }
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return sortChats(parsed.filter(isChat).map(normalize)).slice(0, MAX_CHATS);
  } catch {
    return [];
  }
}

export function saveChats(storage: StorageLike | undefined, chats: Chat[]): void {
  if (!storage) return;
  const keep = sortChats(chats).slice(0, MAX_CHATS).map(normalize);
  try {
    storage.setItem(CHATS_KEY, JSON.stringify(keep));
  } catch {
    // A full quota must not break the app; the sidebar just stops remembering.
  }
}

/** Nothing in flight survives a reload, and a chat only holds turns it can render. */
function normalize(chat: Chat): Chat {
  return { ...chat, turns: chat.turns.map((t) => ({ ...t, busy: false })) };
}

function isChat(value: unknown): value is Chat {
  if (typeof value !== 'object' || value === null) return false;
  const c = value as Partial<Chat>;
  return (
    typeof c.chat_id === 'string' &&
    typeof c.title === 'string' &&
    typeof c.created_at === 'number' &&
    typeof c.updated_at === 'number' &&
    (c.acting_person_id === null || typeof c.acting_person_id === 'string') &&
    Array.isArray(c.turns) &&
    c.turns.every(isTurn)
  );
}

function isTurn(value: unknown): value is Turn {
  if (typeof value !== 'object' || value === null) return false;
  const t = value as Partial<Turn>;
  return typeof t.turn_id === 'string' && typeof t.message === 'string' && Array.isArray(t.events);
}

/** Mono-friendly age: `now`, `12m`, `3h`, `4d`. */
export function relativeTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

/** `localStorage` throws outright in some privacy modes; the sidebar degrades to memory-only. */
export function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}
