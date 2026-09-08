import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Persona } from '../lib/types';
import { ClassBadge, Label } from './primitives';

/**
 * The persona switcher. A native `<select>` draws itself in the OS chrome — rounded corners, its
 * own type, its own highlight colour — which is the one control on the page ADR 0012 cannot reach.
 * This is the same thing drawn in the system: hairline box, mono meta line, class carried by border
 * treatment, and the listbox keyboard contract (arrows, Home/End, Enter, Escape) written out.
 */
export function PersonaSelect({
  personas,
  persona,
  onPersona,
}: {
  personas: Persona[];
  persona: Persona | null;
  onPersona: (p: Persona | null) => void;
}) {
  /** `null` is a real option — anonymous is a persona the demo uses (PRD §12.1), not an empty state. */
  const options: (Persona | null)[] = [null, ...personas];
  const selectedIndex = Math.max(
    0,
    options.findIndex((p) => (p?.person_id ?? null) === (persona?.person_id ?? null)),
  );
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) setActiveIndex(selectedIndex);
  }, [open, selectedIndex]);

  // A pointer anywhere outside the control closes it without choosing.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  // Twelve personas do not fit the panel; the active row is kept in view as the arrows walk it.
  useEffect(() => {
    if (!open) return;
    list.current
      ?.querySelector<HTMLElement>('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex]);

  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  const choose = (i: number) => {
    onPersona(options[i] ?? null);
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpen(true);
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveIndex(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      choose(activeIndex);
    }
  };

  return (
    <div ref={root} className="flex items-center gap-3" onKeyDown={onKeyDown}>
      <Label>Acting as</Label>
      {/* The panel is anchored to the trigger, not to the row: the badge and scope to its right
          come and go with the persona, and anchoring to the row would drift the panel with them. */}
      <div className="relative min-w-0 w-full max-w-[300px]">
        <button
          ref={trigger}
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label={`Acting as ${persona ? persona.name : 'no persona'}. Change persona.`}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-2 border border-[var(--ink)] bg-[var(--paper)] px-2 py-1 text-left text-[length:var(--t-body-sm)] hover:bg-[var(--paper-2)]"
        >
          <span className="min-w-0 flex-1 truncate">
            {persona ? (
              <>
                {persona.name} <span className="text-[var(--muted)]">· {persona.title}</span>
              </>
            ) : (
              <span className="text-[var(--muted)]">No persona (anonymous)</span>
            )}
          </span>
          <Caret open={open} />
        </button>
        {open && (
          <ul
            ref={list}
            role="listbox"
            aria-label="Acting as"
            className="absolute right-0 top-9 z-30 m-0 max-h-[60vh] w-[420px] list-none overflow-y-auto border border-[var(--ink)] bg-[var(--paper)] p-0"
          >
            {options.map((p, i) => {
              const selected = i === selectedIndex;
              const active = i === activeIndex;
              return (
                <li
                  key={p?.person_id ?? 'anonymous'}
                  role="option"
                  aria-selected={selected}
                  data-active={active}
                  onMouseEnter={() => setActiveIndex(i)}
                  onClick={() => choose(i)}
                  className={`rule-soft cursor-pointer border-l-2 py-2 pl-3 pr-3 first:border-t-0 ${active ? 'border-l-[var(--ink)] bg-[var(--paper-2)]' : 'border-l-transparent'}`}
                >
                  <div className="flex items-center gap-2">
                    <span className="mono-xs w-3 shrink-0">{selected ? '●' : ''}</span>
                    <span className="min-w-0 flex-1 truncate text-[length:var(--t-body-sm)]">
                      {p ? p.name : 'No persona (anonymous)'}
                    </span>
                    {p && <ClassBadge workforce_class={p.workforce_class} />}
                  </div>
                  <div className="mono-xs mt-1 pl-5 uppercase text-[var(--muted)]">
                    {p ? (
                      <>
                        {p.title} · {p.market} · scope {p.scope}
                      </>
                    ) : (
                      'no HR data · policy questions only'
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {persona && <ClassBadge workforce_class={persona.workforce_class} />}
      {persona && <span className="mono-xs uppercase text-[var(--muted)]">{persona.scope}</span>}
    </div>
  );
}

/** The 16px stroked chevron of `PanelToggle` (ADR 0013), pointing the way the panel will move. */
function Caret({ open }: { open: boolean }) {
  return (
    <svg
      className="h-4 w-4 shrink-0 text-[var(--muted)]"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d={open ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
      />
    </svg>
  );
}
