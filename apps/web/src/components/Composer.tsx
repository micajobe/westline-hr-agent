import { useEffect, useRef, type KeyboardEvent } from 'react';
import type { Persona } from '../lib/types';
import { Label } from './primitives';

/**
 * The single question field. `opening` is the generous one that greets an empty chat; `docked` is
 * the follow-up field that appears under the transcript once an answer has landed. Only one is
 * mounted at a time, so both share the page's one `value`.
 */
export function Composer({
  variant, value, persona, busy, onChange, onSubmit,
}: {
  variant: 'opening' | 'docked';
  value: string;
  persona: Persona | null;
  busy: boolean;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const opening = variant === 'opening';

  // The field is the first thing on the page in either state; land the cursor in it.
  useEffect(() => { ref.current?.focus(); }, [variant]);

  const submit = () => { if (!busy && value.trim()) onSubmit(); };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  const placeholder = opening
    ? persona ? `Ask a question or look up a policy as ${persona.name}…` : 'Ask a question or look up a policy…'
    : persona ? `Ask a follow-up as ${persona.name}…` : 'Ask a follow-up…';

  return (
    <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
      {opening && <Label className="mb-3">Your question</Label>}
      <textarea
        ref={ref}
        rows={opening ? 4 : 2}
        value={value}
        disabled={busy}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        className={`w-full resize-none border border-[var(--ink)] bg-[var(--paper)] disabled:opacity-45 ${opening ? 'px-4 py-4 text-[length:var(--t-lede)] leading-[1.45]' : 'px-3 py-2 text-[length:var(--t-body)]'}`}
      />
      <div className={`flex items-center gap-4 ${opening ? 'mt-4' : 'mt-2'}`}>
        <button type="submit" disabled={busy || !value.trim()} className={`btn ${opening ? '' : 'btn-sm'}`}>{opening ? 'Ask' : 'Send'}</button>
        <span className="mono-xs text-[var(--muted)]">Return to send · Shift+Return for a new line</span>
      </div>
    </form>
  );
}
