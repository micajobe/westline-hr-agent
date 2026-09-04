import { describe, expect, it } from 'vitest';
import {
  CHATS_KEY,
  chatTitle,
  loadChats,
  MAX_CHATS,
  newChat,
  relativeTime,
  saveChats,
  sortChats,
  UNTITLED,
  withPersona,
  type Chat,
  type StorageLike,
} from './chats';
import type { Persona } from './types';

const memory = (seed?: string): StorageLike & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  if (seed !== undefined) data.set(CHATS_KEY, seed);
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};

const persona = (over: Partial<Persona> = {}): Persona => ({
  person_id: 'W-1042',
  name: 'Priya Nair',
  title: 'Engineering Manager',
  workforce_class: 'staff',
  role: 'manager',
  scope: 'team',
  market: 'US',
  ...over,
});

const chat = (over: Partial<Chat> = {}): Chat => ({ ...newChat(persona(), 1_000), ...over });

describe('chatTitle', () => {
  it('collapses whitespace and falls back when there is nothing to name', () => {
    expect(chatTitle('  How much\n PTO   do I have? ')).toBe('How much PTO do I have?');
    expect(chatTitle('   ')).toBe(UNTITLED);
  });

  it('truncates only when the message is actually longer than the title budget', () => {
    const short = 'a'.repeat(64);
    expect(chatTitle(short)).toBe(short);
    const long = chatTitle('b'.repeat(200));
    expect(long).toHaveLength(64);
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('newChat / withPersona', () => {
  it('snapshots the persona so an empty chat can still be labelled', () => {
    const c = newChat(persona());
    expect(c.acting_person_id).toBe('W-1042');
    expect(c.persona_label).toBe('Priya Nair');
    expect(c.workforce_class).toBe('staff');
    expect(c.turns).toEqual([]);
    expect(c.title).toBe(UNTITLED);
  });

  it('labels an anonymous chat and re-points an existing one', () => {
    const anon = newChat(null);
    expect(anon.acting_person_id).toBeNull();
    expect(anon.persona_label).toBe('Anonymous');
    const repointed = withPersona(anon, persona({ person_id: 'W-1099', name: 'Sam Oyelaran', workforce_class: 'contractor' }));
    expect(repointed.acting_person_id).toBe('W-1099');
    expect(repointed.persona_label).toBe('Sam Oyelaran');
    expect(repointed.workforce_class).toBe('contractor');
    expect(repointed.chat_id).toBe(anon.chat_id);
  });
});

describe('loadChats / saveChats', () => {
  it('round-trips newest-first and never persists an in-flight turn', () => {
    const store = memory();
    const older = chat({ chat_id: 'a', updated_at: 10 });
    const newer = chat({
      chat_id: 'b',
      updated_at: 20,
      conversation_id: 'conv_1',
      turns: [{ turn_id: 't1', persona: persona(), message: 'q', events: [], busy: true }],
    });
    saveChats(store, [older, newer]);
    const loaded = loadChats(store);
    expect(loaded.map((c) => c.chat_id)).toEqual(['b', 'a']);
    expect(loaded[0]?.conversation_id).toBe('conv_1');
    expect(loaded[0]?.turns[0]?.busy).toBe(false);
  });

  it('caps the list at MAX_CHATS, dropping the oldest', () => {
    const store = memory();
    const many = Array.from({ length: MAX_CHATS + 5 }, (_, i) => chat({ chat_id: `c${i}`, updated_at: i }));
    saveChats(store, many);
    const loaded = loadChats(store);
    expect(loaded).toHaveLength(MAX_CHATS);
    expect(loaded.at(-1)?.chat_id).toBe('c5');
  });

  it('survives absent, corrupt and wrong-shaped storage instead of throwing', () => {
    expect(loadChats(undefined)).toEqual([]);
    expect(loadChats(memory())).toEqual([]);
    expect(loadChats(memory('not json'))).toEqual([]);
    expect(loadChats(memory('{"chat_id":"x"}'))).toEqual([]);
    expect(loadChats(memory(JSON.stringify([{ chat_id: 'x' }, null, 7])))).toEqual([]);
    const half = JSON.stringify([chat({ chat_id: 'good' }), { chat_id: 'bad', title: 'no turns array' }]);
    expect(loadChats(memory(half)).map((c) => c.chat_id)).toEqual(['good']);
  });

  it('drops a chat whose turns are not renderable', () => {
    const bad = JSON.stringify([{ ...chat({ chat_id: 'x' }), turns: [{ turn_id: 't', message: 'q' }] }]);
    expect(loadChats(memory(bad))).toEqual([]);
  });

  it('swallows a quota failure so a full store cannot break the app', () => {
    const throwing: StorageLike = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    expect(() => saveChats(throwing, [chat()])).not.toThrow();
    expect(() => saveChats(undefined, [chat()])).not.toThrow();
  });
});

describe('sortChats', () => {
  it('orders by last activity without mutating the input', () => {
    const input = [chat({ chat_id: 'a', updated_at: 1 }), chat({ chat_id: 'b', updated_at: 3 }), chat({ chat_id: 'c', updated_at: 2 })];
    expect(sortChats(input).map((c) => c.chat_id)).toEqual(['b', 'c', 'a']);
    expect(input.map((c) => c.chat_id)).toEqual(['a', 'b', 'c']);
  });
});

describe('relativeTime', () => {
  it('reads as a mono age', () => {
    const now = 1_000_000_000;
    expect(relativeTime(now, now)).toBe('now');
    expect(relativeTime(now - 12 * 60_000, now)).toBe('12m');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3h');
    expect(relativeTime(now - 4 * 86_400_000, now)).toBe('4d');
    expect(relativeTime(now + 5_000, now)).toBe('now');
  });
});
