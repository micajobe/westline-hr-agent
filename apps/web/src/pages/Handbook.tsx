import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import Markdown, { type Options } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Badge, GLYPH, Label, PanelToggle } from '../components/primitives';
import { api } from '../lib/api';
import { useNarrow } from '../lib/useNarrow';
import type {
  Applicability,
  DocumentSection,
  HandbookDocument,
  HandbookSearch,
  Library,
  LibraryDocument,
  Persona,
  SearchHit,
} from '../lib/types';

/** Policy tables are wide; give each its own scroll box so the reading column never shifts. */
const MD: Options = {
  remarkPlugins: [remarkGfm],
  components: {
    table: ({ children }) => (
      <div className="prose-scroll">
        <table>{children}</table>
      </div>
    ),
  },
};

/** DOM id for a section anchor: `§3.2` is not a safe fragment, `sec-3.2` is. */
export const sectionId = (section_path: string) => `sec-${section_path.replace('§', '')}`;

/** The link a citation chip points at — see `CitationCard`. */
export const handbookHref = (doc_id: string, section_path?: string) =>
  `/handbook/${doc_id}${section_path ? `?section=${encodeURIComponent(section_path)}` : ''}`;

/**
 * PRD §9.1 Handbook: the corpus as a reader would meet it, categorised by HANDBOOK §4 "Who owns
 * what" and filtered to what the acting persona may read. Landing here from a citation opens the
 * document at the cited section, which is the point — an answer's excerpt is a chunk, and a chunk
 * without its section around it is easy to misread.
 */
export function HandbookPage({ persona }: { persona: Persona | null }) {
  const { doc_id } = useParams<{ doc_id?: string }>();
  const [params] = useSearchParams();
  const citedSection = params.get('section');
  const actingId = persona?.person_id ?? null;

  const [library, setLibrary] = useState<Library | null>(null);
  const [libraryErr, setLibraryErr] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const narrow = useNarrow();
  const [showContents, setShowContents] = useState(false);
  const [query, setQuery] = useState('');
  const search = useSectionSearch(query, actingId);

  // Choosing a document on a phone must reveal it, not leave the reader hidden behind the contents.
  useEffect(() => {
    if (narrow) setShowContents(false);
  }, [doc_id, narrow]);

  // The persona resolves a tick after mount, so the first fetch here is anonymous and the second
  // is the real one. Without this guard the anonymous reply can land last and withhold documents
  // the acting person may in fact read.
  useEffect(() => {
    let live = true;
    setLibrary(null);
    setLibraryErr(null);
    api
      .handbook(actingId)
      .then((l) => {
        if (live) setLibrary(l);
      })
      .catch((e: Error) => {
        if (live) setLibraryErr(e.message);
      });
    return () => {
      live = false;
    };
  }, [actingId]);

  return (
    <>
      {narrow && (
        <div className="flex items-stretch border-b border-[var(--ink)]">
          <button
            type="button"
            aria-pressed={showContents}
            onClick={() => setShowContents((s) => !s)}
            className={`flex-1 px-4 py-3 text-left text-[length:var(--t-label)] uppercase tracking-[var(--track-label)] ${showContents ? 'bg-[var(--ink)] text-[var(--paper)]' : 'text-[var(--muted)]'}`}
          >
            {showContents ? 'Close contents' : 'Contents'}
          </button>
        </div>
      )}
      <div
        className="grid min-h-0 w-full flex-1 overflow-hidden"
        style={{
          gridTemplateRows: 'minmax(0,1fr)',
          // One column, one child on a phone: a 300px rail beside the document left a pane so
          // narrow the prose wrapped one word per line.
          gridTemplateColumns: narrow
            ? 'minmax(0,1fr)'
            : `${collapsed ? 'var(--rail-collapsed)' : '300px'} minmax(0,1fr)`,
        }}
      >
        {(!narrow || showContents) && (
          <ContentsRail
            library={library}
            error={libraryErr}
            activeDoc={doc_id?.toUpperCase() ?? null}
            citedSection={citedSection}
            collapsed={narrow ? false : collapsed}
            onToggle={() => (narrow ? setShowContents(false) : setCollapsed((c) => !c))}
            query={query}
            onQuery={setQuery}
            search={search}
            onNavigate={() => narrow && setShowContents(false)}
          />
        )}
        {(!narrow || !showContents) && (
          <main className="min-w-0 overflow-y-auto">
            {doc_id ? (
              <DocumentReader
                doc_id={doc_id.toUpperCase()}
                actingId={actingId}
                citedSection={citedSection}
                persona={persona}
              />
            ) : (
              <LibraryOverview library={library} error={libraryErr} persona={persona} />
            )}
          </main>
        )}
      </div>
    </>
  );
}

// ---------- left rail: the categorised table of contents ----------

function ContentsRail({
  library,
  error,
  activeDoc,
  citedSection,
  collapsed,
  onToggle,
  query,
  onQuery,
  search,
  onNavigate,
}: {
  library: Library | null;
  error: string | null;
  activeDoc: string | null;
  citedSection: string | null;
  collapsed: boolean;
  onToggle: () => void;
  query: string;
  onQuery: (q: string) => void;
  search: SearchState;
  onNavigate: () => void;
}) {
  const searching = query.trim().length > 0;
  return (
    <aside className="flex min-h-0 flex-col border-r border-[var(--ink)]">
      <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ink)] px-3 py-2">
        {!collapsed && (
          <Label className="truncate">
            Contents{library ? ` · ${library.readable_doc_count}/${library.doc_count}` : ''}
          </Label>
        )}
        <div className="ml-auto">
          <PanelToggle side="left" collapsed={collapsed} onToggle={onToggle} label="contents" />
        </div>
      </div>
      {!collapsed && (
        <div className="shrink-0 border-b border-[var(--ink)] px-3 py-2">
          <input
            type="text"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onQuery('')}
            placeholder="Find a section…"
            aria-label="Search the handbook"
            className="w-full border-0 border-b border-[var(--paper-2)] bg-transparent py-1 text-[length:var(--t-body-sm)] outline-none focus:border-[var(--ink)]"
          />
        </div>
      )}
      {collapsed ? null : searching ? (
        <SearchResults state={search} onNavigate={onNavigate} onClear={() => onQuery('')} />
      ) : (
        <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {error && (
            <p className="mono-xs text-[var(--muted)]">
              {GLYPH.warn} {error}
            </p>
          )}
          {!library && !error && (
            <p className="mono-xs text-[var(--muted)]">{GLYPH.off} loading…</p>
          )}
          {library?.categories.map((cat) => (
            <section key={cat.area} className="mb-5">
              <Label className="mb-2 leading-tight">{cat.area}</Label>
              <ul className="m-0 list-none p-0">
                {cat.documents.map((doc) => (
                  <li key={doc.doc_id}>
                    <RailDocument
                      doc={doc}
                      applies={library.applicability[doc.doc_id]}
                      active={doc.doc_id === activeDoc}
                      citedSection={citedSection}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      )}
    </aside>
  );
}

function RailDocument({
  doc,
  applies,
  active,
  citedSection,
}: {
  doc: LibraryDocument;
  applies: Applicability | undefined;
  active: boolean;
  citedSection: string | null;
}) {
  const glyph = !doc.readable
    ? GLYPH.warn
    : doc.readable_section_count < doc.section_count
      ? GLYPH.off
      : GLYPH.on;
  const body = (
    <span className="grid grid-cols-[14px_1fr] gap-2 py-1">
      <span className="mono-xs pt-0.5 text-[var(--muted)]">{glyph}</span>
      <span>
        <span className="mono block">{doc.doc_id}</span>
        <span className="block text-[length:var(--t-body-sm)] leading-tight text-[var(--muted)]">
          {doc.title}
        </span>
      </span>
    </span>
  );
  return (
    <>
      {doc.readable ? (
        <Link
          to={handbookHref(doc.doc_id)}
          className={`block no-underline ${active ? 'bg-[var(--paper-2)]' : 'hover:bg-[var(--paper-2)]'}`}
        >
          {body}
        </Link>
      ) : (
        <span
          className="block opacity-55"
          title={`Tagged ${doc.audience}; not available to this reader`}
        >
          {body}
        </span>
      )}
      {active && (
        <ul className="mb-2 ml-[22px] list-none border-l border-[var(--paper-2)] p-0 pl-3">
          {doc.sections
            .filter((s) => s.level === 2)
            .map((s) => (
              <li key={s.section_path} className="py-px">
                {s.readable ? (
                  <a
                    href={`#${sectionId(s.section_path)}`}
                    className={`mono-xs block no-underline hover:text-[var(--ink)] ${s.section_path === citedSection ? 'text-[var(--ink)]' : 'text-[var(--muted)]'}`}
                  >
                    {s.section_path === citedSection ? `${GLYPH.on} ` : ''}
                    {s.section_path} {s.section_title}
                  </a>
                ) : (
                  <span className="mono-xs block text-[var(--muted)] opacity-55">
                    {GLYPH.warn} {s.section_path} withheld
                  </span>
                )}
              </li>
            ))}
        </ul>
      )}
      {applies && applies.scope !== 'full' && doc.readable && (
        <div className="mb-1 ml-[22px]">
          <ApplicabilityTag applies={applies} />
        </div>
      )}
    </>
  );
}

function ApplicabilityTag({ applies }: { applies: Applicability }) {
  if (applies.scope === 'full') return <Badge>applies in full</Badge>;
  if (applies.scope === 'none') return <Badge tone="muted">does not apply to you</Badge>;
  return <Badge tone="dashed">applies: {applies.sections?.join(', ') ?? 'part'}</Badge>;
}

// ---------- left rail: section search ----------

interface SearchState {
  results: HandbookSearch | null;
  error: string | null;
  pending: boolean;
}

/** Long enough to be a word, short enough that `pto` and `t4` still search. */
const MIN_QUERY = 2;
const DEBOUNCE_MS = 160;

/**
 * Section search against `GET /handbook?q=` (ADR 0018). Server-side because that is where the
 * audience filter is: the client never holds the corpus, and a section this persona may not open is
 * never matched, never snippeted, and never counted as a hit. Debounced so a typed word is one
 * request rather than one per keystroke, and guarded so a slow earlier reply cannot land last.
 */
function useSectionSearch(query: string, actingId: string | null): SearchState {
  const [state, setState] = useState<SearchState>({ results: null, error: null, pending: false });
  const q = query.trim();

  useEffect(() => {
    if (q.length < MIN_QUERY) {
      setState({ results: null, error: null, pending: false });
      return;
    }
    let live = true;
    setState((s) => ({ ...s, pending: true }));
    const timer = setTimeout(() => {
      api
        .handbookSearch(q, actingId)
        .then((r) => live && setState({ results: r, error: null, pending: false }))
        .catch((e: Error) => live && setState({ results: null, error: e.message, pending: false }));
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [q, actingId]);

  return state;
}

function SearchResults({
  state,
  onNavigate,
  onClear,
}: {
  state: SearchState;
  onNavigate: () => void;
  onClear: () => void;
}) {
  const { results, error, pending } = state;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
      <div className="mono-xs mb-3 flex items-baseline gap-2 text-[var(--muted)]">
        <span className="truncate">
          {error ? (
            <>
              {GLYPH.warn} {error}
            </>
          ) : pending || !results ? (
            <>{GLYPH.off} searching…</>
          ) : (
            <>
              {results.hits.length === 0 ? GLYPH.warn : GLYPH.on} {results.hits.length}
              {results.truncated ? '+' : ''} section{results.hits.length === 1 ? '' : 's'}
            </>
          )}
        </span>
        <button type="button" onClick={onClear} className="link link-muted ml-auto shrink-0">
          clear
        </button>
      </div>

      {results && results.hits.length === 0 && !pending && (
        <p className="text-[length:var(--t-body-sm)] leading-snug text-[var(--muted)]">
          Nothing in the {results.sections_searched} sections open to this reader matches every word
          of that. Try fewer words.
        </p>
      )}

      <ul className="m-0 list-none p-0">
        {results?.hits.map((hit) => (
          <li key={`${hit.doc_id}${hit.section_path}`} className="rule-soft py-2 first:border-t-0">
            <SearchResult hit={hit} terms={results.terms} onNavigate={onNavigate} />
          </li>
        ))}
      </ul>

      {/* Withheld is named, never hidden (ADR 0015): say what was not searched, but never whether
          any of it matched — a count of hits inside closed sections would report their contents. */}
      {results && results.sections_withheld > 0 && (
        <p className="mono-xs mt-4 border-t border-[var(--paper-2)] pt-2 text-[var(--muted)]">
          {GLYPH.warn} {results.sections_withheld} sections outside your audience were not searched
        </p>
      )}
    </div>
  );
}

function SearchResult({
  hit,
  terms,
  onNavigate,
}: {
  hit: SearchHit;
  terms: string[];
  onNavigate: () => void;
}) {
  return (
    <Link
      to={handbookHref(hit.doc_id, hit.section_path)}
      onClick={onNavigate}
      className="block no-underline hover:bg-[var(--paper-2)]"
    >
      <span className="mono-xs block text-[var(--muted)]">
        {hit.doc_id} {hit.section_path}
      </span>
      <span className="block text-[length:var(--t-body-sm)] leading-tight">
        <Marked text={hit.section_title} terms={terms} />
      </span>
      <span className="mt-1 block text-[length:var(--t-body-sm)] leading-snug text-[var(--muted)]">
        <Marked text={hit.snippet} terms={terms} />
      </span>
    </Link>
  );
}

/**
 * The matched terms underlined in a snippet. An ink hairline rather than a highlight: the palette is
 * B&W (ADR 0012), so a marker colour is not available and an inverted block would shout. Rendered
 * as text nodes, never as HTML — the snippet is corpus text and is not trusted as markup.
 */
function Marked({ text, terms }: { text: string; terms: string[] }) {
  const parts = useMemo(() => splitOnTerms(text, terms), [text, terms]);
  return (
    <>
      {parts.map((part, i) =>
        part.hit ? (
          <span key={i} className="border-b border-[var(--ink)] text-[var(--ink)]">
            {part.text}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

/** Split `text` on any of `terms`, case-insensitively, longest term first so `pto` inside a longer match does not win. */
function splitOnTerms(text: string, terms: string[]): { text: string; hit: boolean }[] {
  const ordered = [...terms].filter(Boolean).sort((a, b) => b.length - a.length);
  if (ordered.length === 0) return [{ text, hit: false }];
  const re = new RegExp(`(${ordered.map(escapeRe).join('|')})`, 'gi');
  return text
    .split(re)
    .filter((piece) => piece.length > 0)
    .map((piece) => ({
      text: piece,
      hit: ordered.some((t) => t.toLowerCase() === piece.toLowerCase()),
    }));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ---------- main column: the categorised index ----------

function LibraryOverview({
  library,
  error,
  persona,
}: {
  library: Library | null;
  error: string | null;
  persona: Persona | null;
}) {
  return (
    <div className="mx-auto w-full max-w-[var(--max-content)] px-6 py-8">
      <Label>Westline · policy corpus · HANDBOOK §4</Label>
      <h1 className="headline mt-2 text-[length:var(--t-h1)]">
        The handbook,
        <br />
        <em>by who owns it</em>.
      </h1>
      <p className="lede mt-6 max-w-[620px] text-[var(--muted)]">
        Every policy document in the corpus, grouped the way the handbook groups them. What you can
        open depends on who you are acting as —{' '}
        {persona ? (
          <>
            {persona.name}, {persona.workforce_class.replace('_', ' ')}
          </>
        ) : (
          <>
            nobody, so only material tagged <span className="mono">all</span>
          </>
        )}
        .
        {library && (
          <>
            {' '}
            {library.readable_doc_count} of {library.doc_count} documents are open to this reader.
          </>
        )}
      </p>
      {error && (
        <p className="mono mt-6">
          {GLYPH.warn} Handbook unavailable: {error}
        </p>
      )}
      {!library && !error && <p className="mono mt-6 text-[var(--muted)]">{GLYPH.off} loading…</p>}

      {library?.categories.map((cat) => (
        <section key={cat.area} className="rule mt-10 pt-5">
          <div className="flex flex-wrap items-baseline gap-x-4">
            <h2 className="headline text-[length:var(--t-h2)]">{cat.area}</h2>
            <span className="mono text-[var(--muted)]">owner · {cat.owner}</span>
          </div>
          <ul className="mt-4 grid list-none grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-8 gap-y-0 p-0">
            {cat.documents.map((doc) => (
              <li key={doc.doc_id} className="rule-soft py-3">
                <DocumentTeaser doc={doc} applies={library.applicability[doc.doc_id]} />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function DocumentTeaser({
  doc,
  applies,
}: {
  doc: LibraryDocument;
  applies: Applicability | undefined;
}) {
  const partial = doc.readable && doc.readable_section_count < doc.section_count;
  const heading = (
    <>
      <span className="mono">{doc.doc_id}</span>
      <span className="headline ml-2 text-[19px]">{doc.title}</span>
    </>
  );
  return (
    <div className="grid grid-cols-[14px_1fr] gap-3">
      <span className="mono-xs pt-1.5 text-[var(--muted)]">
        {!doc.readable ? GLYPH.warn : partial ? GLYPH.off : GLYPH.on}
      </span>
      <div>
        {doc.readable ? (
          <Link
            to={handbookHref(doc.doc_id)}
            className="block no-underline hover:text-[var(--muted)]"
          >
            {heading}
          </Link>
        ) : (
          <span className="block opacity-55">{heading}</span>
        )}
        <div className="mono-xs mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[var(--muted)]">
          <span>v{doc.version}</span>
          <span>effective {doc.effective_date}</span>
          <span>{doc.source_format.toUpperCase()}</span>
          <span>
            {doc.readable
              ? `${doc.readable_section_count}/${doc.section_count} sections`
              : `tagged ${doc.audience}`}
          </span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {applies && <ApplicabilityTag applies={applies} />}
          {applies?.note && (
            <span className="text-[length:var(--t-body-sm)] text-[var(--muted)]">
              {applies.note}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- main column: one document, opened at the cited section ----------

function DocumentReader({
  doc_id,
  actingId,
  citedSection,
  persona,
}: {
  doc_id: string;
  actingId: string | null;
  citedSection: string | null;
  persona: Persona | null;
}) {
  const [doc, setDoc] = useState<HandbookDocument | null>(null);
  const [err, setErr] = useState<{ message: string; status?: number } | null>(null);
  const scrolled = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    setDoc(null);
    setErr(null);
    scrolled.current = null;
    api
      .handbookDoc(doc_id, actingId)
      .then((d) => {
        if (live) setDoc(d);
      })
      .catch((e: Error & { status?: number }) => {
        if (live) setErr({ message: e.message, status: e.status });
      });
    return () => {
      live = false;
    };
  }, [doc_id, actingId]);

  // Scroll once per (document, section): re-running on every render would fight the user's scrolling.
  useEffect(() => {
    if (!doc || !citedSection) return;
    const key = `${doc.doc_id}${citedSection}`;
    if (scrolled.current === key) return;
    scrolled.current = key;
    const jump = () =>
      document.getElementById(sectionId(citedSection))?.scrollIntoView({ block: 'start' });
    jump();
    // The display fonts arrive after the first paint (`display=swap`) and re-flow every line, so the
    // offset measured against fallback metrics ends up somewhere else -- usually clamped to the end
    // of the document. Land it again once the real metrics are in.
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) requestAnimationFrame(jump);
    });
    return () => {
      live = false;
    };
  }, [doc, citedSection]);

  const cited = useMemo(
    () =>
      citedSection && doc?.sections.some((s) => s.section_path === citedSection)
        ? citedSection
        : null,
    [citedSection, doc],
  );

  if (err) {
    return (
      <div className="mx-auto w-full max-w-[var(--chat-col)] px-6 py-8">
        <Label>{doc_id}</Label>
        <h1 className="headline mt-2 text-[length:var(--t-h2)]">
          {err.status === 403 ? 'Not available to this reader' : 'Not found'}
        </h1>
        <p className="lede mt-4 text-[var(--muted)]">
          {err.status === 403 ? (
            <>
              This document is closed to{' '}
              {persona
                ? `${persona.name} (${persona.workforce_class.replace('_', ' ')})`
                : 'an anonymous reader'}
              . The same audience rule applies here as in an answer — nothing is hidden from the
              listing, but nothing outside your audience opens either.
            </>
          ) : (
            err.message
          )}
        </p>
        <p className="mt-6">
          <Link to="/handbook" className="link">
            Back to the handbook
          </Link>
        </p>
      </div>
    );
  }
  if (!doc)
    return (
      <p className="mono px-6 py-8 text-[var(--muted)]">
        {GLYPH.off} loading {doc_id}…
      </p>
    );

  return (
    <article className="mx-auto w-full max-w-[760px] px-6 py-8">
      <Label>
        {doc.doc_id} · {doc.owner}
      </Label>
      <h1 className="headline mt-2 text-[length:var(--t-h1)]">{doc.title}</h1>
      <div className="mono mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[var(--muted)]">
        <span>v{doc.version}</span>
        <span>effective {doc.effective_date}</span>
        <span>source {doc.source_format.toUpperCase()}</span>
        <span>audience {doc.audience}</span>
        {doc.withheld_section_count > 0 && (
          <span>
            {GLYPH.warn} {doc.withheld_section_count} sections withheld
          </span>
        )}
      </div>
      {doc.applicability && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ApplicabilityTag applies={doc.applicability} />
          {doc.applicability.note && (
            <span className="text-[length:var(--t-body-sm)] text-[var(--muted)]">
              {doc.applicability.note}
            </span>
          )}
        </div>
      )}
      {cited && (
        <p className="mono-xs mt-4 text-[var(--muted)]">
          {GLYPH.on} Opened at {cited}, the section your answer cited.
        </p>
      )}
      {doc.preamble && (
        <div className="prose lede mt-6">
          <Markdown {...MD}>{doc.preamble}</Markdown>
        </div>
      )}

      <div className="mt-8">
        {doc.sections.map((s) => (
          <SectionBlock key={s.section_path} section={s} cited={s.section_path === cited} />
        ))}
      </div>

      <p className="rule mt-10 pt-4">
        <Link to="/handbook" className="link link-muted">
          All documents
        </Link>
      </p>
    </article>
  );
}

function SectionBlock({ section, cited }: { section: DocumentSection; cited: boolean }) {
  const size = section.level === 2 ? 'text-[length:var(--t-h2)]' : 'text-[22px]';
  return (
    <section
      id={sectionId(section.section_path)}
      className={`scroll-mt-6 py-4 ${section.level === 2 ? 'rule mt-4' : 'mt-2'} ${cited ? 'border-l border-[var(--ink)] pl-4' : ''}`}
    >
      {cited && <Label className="mb-2">{GLYPH.on} cited passage</Label>}
      <h2 className={`headline ${size}`}>
        <span className="mono mr-3 align-middle text-[0.5em] tracking-normal text-[var(--muted)]">
          {section.section_path}
        </span>
        {section.section_title}
      </h2>
      {section.text !== null ? (
        <div className="prose mt-3">
          <Markdown {...MD}>{section.text}</Markdown>
        </div>
      ) : (
        <p className="strip-dashed mono-xs mt-3 p-3 text-[var(--muted)]">
          {GLYPH.warn} {section.withheld_reason}
        </p>
      )}
    </section>
  );
}
