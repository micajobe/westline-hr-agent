import { relativeTime, type Chat } from '../lib/chats';
import { GLYPH, Label } from './primitives';

/**
 * Recent chats. The left column of the Nimble navigator pattern (~/strategy-navigator
 * `navigator-layout.tsx`): hairline border, eyebrow header, collapsible, one truncated row per
 * item, the active row filled with paper-2 and marked with a glyph rather than colour.
 */
export function ChatList({
  chats,
  activeId,
  collapsed,
  busy,
  onToggle,
  onSelect,
  onNew,
  onDelete,
}: {
  chats: Chat[];
  activeId: string | null;
  collapsed: boolean;
  busy: boolean;
  onToggle: () => void;
  onSelect: (chat: Chat) => void;
  onNew: () => void;
  onDelete: (chat: Chat) => void;
}) {
  if (collapsed) {
    return (
      <aside className="flex h-full flex-col items-center gap-3 border-r border-[var(--ink)] py-2.5">
        <button type="button" className="link link-muted" onClick={onToggle} title="Show recent chats">
          ▸
        </button>
        <span className="mono-xs text-[var(--muted)]">{chats.length}</span>
      </aside>
    );
  }
  return (
    <aside className="flex h-full flex-col border-r border-[var(--ink)]">
      <div className="flex items-center justify-between border-b border-[var(--ink)] px-4 py-2.5">
        <Label>Chats</Label>
        <button type="button" className="link link-muted" onClick={onToggle} title="Hide recent chats">
          collapse
        </button>
      </div>
      <div className="border-b border-[var(--ink)] px-4 py-3">
        <button type="button" className="btn btn-outline btn-sm w-full" onClick={onNew} disabled={busy}>
          New chat
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {chats.length === 0 && (
          <p className="p-4 text-[length:var(--t-body-sm)] text-[var(--muted)]">
            Chats you start are kept in this browser only, one per persona.
          </p>
        )}
        <ol className="m-0 list-none p-0">
          {chats.map((chat) => {
            const active = chat.chat_id === activeId;
            return (
              <li key={chat.chat_id} className={`relative border-b border-[var(--paper-2)] ${active ? 'bg-[var(--paper-2)]' : ''}`}>
                <button
                  type="button"
                  onClick={() => onSelect(chat)}
                  title={chat.title}
                  className="block w-full px-4 py-3 pr-9 text-left hover:bg-[var(--paper-2)]"
                >
                  <span className="flex items-baseline gap-2">
                    <span className="mono-xs shrink-0 text-[var(--muted)]">{active ? GLYPH.on : GLYPH.off}</span>
                    <span className={`min-w-0 flex-1 truncate text-[length:var(--t-body-sm)] ${active ? '' : 'text-[var(--muted)]'}`}>
                      {chat.title}
                    </span>
                  </span>
                  <span className="mt-1.5 flex items-baseline gap-2 pl-5">
                    <span className="mono-xs min-w-0 flex-1 truncate uppercase text-[var(--muted)]">{chat.persona_label}</span>
                    <span className="mono-xs shrink-0 text-[var(--muted)]">{relativeTime(chat.updated_at)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(chat)}
                  title="Forget this chat"
                  aria-label={`Forget chat: ${chat.title}`}
                  className="mono-xs absolute right-3 top-3 px-1 text-[var(--muted)] hover:text-[var(--ink)]"
                >
                  ×
                </button>
              </li>
            );
          })}
        </ol>
      </div>
    </aside>
  );
}
