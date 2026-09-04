import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Desk as DeskData } from '../lib/types';
import { Details, Label } from '../components/primitives';

/** PRD §9.1 /desk: tickets and drafts with who/about/category/turn; note about reset on redeploy. */
export function DeskPage() {
  const [desk, setDesk] = useState<DeskData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.desk().then(setDesk).catch((e: Error) => setErr(e.message)); }, []);
  return (
    <main className="mx-auto max-w-[var(--max-content)] px-6 py-8">
      <h1 className="headline text-[length:var(--t-h1)]">The desk</h1>
      <p className="lede mt-4 max-w-[640px] text-[var(--muted)]">Mock tickets and drafts written by the two gated tools. Nothing here was sent anywhere. The store lives in <span className="mono">desk.sqlite</span> on the MCP service and resets on every redeploy.</p>
      {err && <p className="mt-6 font-medium">Desk unavailable: {err}</p>}
      {desk && (
        <>
          <section className="mt-8">
            <Label className="mb-2">Tickets · {desk.tickets.length}</Label>
            <table className="w-full border-t border-[var(--ink)] text-left text-[length:var(--t-body)]">
              <thead><tr className="eyebrow"><th className="py-2 pr-3 font-normal">id</th><th className="py-2 pr-3 font-normal">created by</th><th className="py-2 pr-3 font-normal">about</th><th className="py-2 pr-3 font-normal">category</th><th className="py-2 pr-3 font-normal">summary</th><th className="py-2 pr-3 font-normal">status</th><th className="py-2 pr-3 font-normal">created</th><th className="py-2 font-normal">turn</th></tr></thead>
              <tbody>
                {desk.tickets.map((t) => (
                  <tr key={t.ticket_id} className="border-t border-[var(--ink)] align-top">
                    <td className="mono py-2 pr-3">{t.ticket_id}</td><td className="mono py-2 pr-3">{t.created_by}</td><td className="mono py-2 pr-3">{t.about_person_id}</td><td className="py-2 pr-3">{t.category.replace('_', ' ')}</td><td className="py-2 pr-3">{t.summary}</td><td className="py-2 pr-3">{t.status}</td><td className="mono py-2 pr-3 text-[var(--muted)]">{t.created_at.slice(0, 16).replace('T', ' ')}</td><td className="mono py-2 text-[var(--muted)]">{t.turn_id ?? 'seed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="mt-10">
            <Label className="mb-2">Drafts · {desk.drafts.length} · never sent</Label>
            <table className="w-full border-t border-[var(--ink)] text-left text-[length:var(--t-body)]">
              <thead><tr className="eyebrow"><th className="py-2 pr-3 font-normal">id</th><th className="py-2 pr-3 font-normal">created by</th><th className="py-2 pr-3 font-normal">about</th><th className="py-2 pr-3 font-normal">to</th><th className="py-2 pr-3 font-normal">subject</th><th className="py-2 pr-3 font-normal">created</th><th className="py-2 font-normal">turn</th></tr></thead>
              <tbody>
                {desk.drafts.map((d) => (
                  <tr key={d.draft_id} className="border-t border-[var(--ink)] align-top">
                    <td className="mono py-2 pr-3">{d.draft_id}</td><td className="mono py-2 pr-3">{d.created_by}</td><td className="mono py-2 pr-3">{d.about_person_id}</td><td className="py-2 pr-3">{d.recipient_role.replace('_', ' ')}</td>
                    <td className="py-2 pr-3"><Details summary={<span className="text-[var(--ink)]">{d.subject}</span>}><pre className="whitespace-pre-wrap font-[inherit] text-[length:var(--t-body)] leading-relaxed">{d.body}</pre></Details></td>
                    <td className="mono py-2 pr-3 text-[var(--muted)]">{d.created_at.slice(0, 16).replace('T', ' ')}</td><td className="mono py-2 text-[var(--muted)]">{d.turn_id ?? 'seed'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </main>
  );
}
