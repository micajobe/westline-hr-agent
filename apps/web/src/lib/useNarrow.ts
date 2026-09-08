import { useEffect, useState } from 'react';

/**
 * Below this width the rails cannot share the viewport with the thing they annotate. The chat
 * screen asks for 240px of chat list plus 440px of trace rail before the conversation column gets
 * anything at all, so at 375px the middle column resolved to literally 0px and the product was
 * invisible; the handbook's 300px contents rail left a document pane that wrapped one word per
 * line. 860px is the point where a readable chat column still fits beside both rails.
 */
export const NARROW_QUERY = '(max-width: 860px)';

/** True when the viewport is too narrow for the desktop rail layout. */
export function useNarrow(query: string = NARROW_QUERY): boolean {
  const [narrow, setNarrow] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const sync = () => setNarrow(mq.matches);
    sync();
    // `change` is the right signal, but it is not the only one worth trusting: under devtools
    // viewport emulation the query re-evaluated while no change event arrived, which left the
    // three-column layout mounted at 768px with an 88px conversation column. `resize` covers
    // rotation and that case both, and re-reading `mq.matches` keeps it idempotent.
    mq.addEventListener('change', sync);
    window.addEventListener('resize', sync);
    return () => {
      mq.removeEventListener('change', sync);
      window.removeEventListener('resize', sync);
    };
  }, [query]);

  return narrow;
}
