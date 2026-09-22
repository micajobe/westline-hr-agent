/**
 * Split docs/demo-script.md (the combined DO/SCREEN/SAY/READ/BRANCH teleprompter script) into
 *   docs/demo-narration.md  -- the spoken track, tagged [D3]-style at every screen change
 *   docs/demo-shot-list.md  -- the screen track, one row per tag, with a Values column
 * for two-track recording: dry run for the values, narration, click-through driven by the narration,
 * pickups for any READ passage whose value differed, composite.
 * The combined script is the source; edit it and re-run `node scripts/split-demo-script.mjs`.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync('docs/demo-script.md', 'utf8');
const beats = [...src.matchAll(/^### ([A-H]) — (.*?) \((\d+:\d+)–(\d+:\d+)\)\n([\s\S]*?)(?=^### [A-H] — |^## 4\. Word budget)/gm)];
const MARKERS = new Set(['DO', 'SCREEN', 'SAY', 'READ', 'BRANCH']);
const isMarker = (l) => MARKERS.has(l.trim()) || /^IF /.test(l.trim());

/** Shots: { do[], screen[], say[[kind, lines]], branch: null | { note[], alts[{label, do, screen, say}] } } */
function parse(block) {
  const lines = block.split('\n');
  const shots = [];
  let cur = null, mode = null, branch = null, alt = null;
  const newShot = () => { cur = { do: [], screen: [], say: [], branch: null }; shots.push(cur); return cur; };
  const nextMarker = (i) => { for (let j = i + 1; j < lines.length; j++) if (isMarker(lines[j])) return lines[j].trim(); return null; };
  const pushSay = (target, kind, text) => {
    const last = target.say[target.say.length - 1];
    if (last && last[0] === kind) last[1].push(text); else target.say.push([kind, [text]]);
  };
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].replace(/\s+$/, '');
    const st = t.trim();
    if (MARKERS.has(st)) {
      if (st === 'BRANCH') { newShot(); branch = { note: [], alts: [] }; cur.branch = branch; alt = null; mode = 'BNOTE'; continue; }
      if (branch && alt) {
        // A DO inside an alternative belongs to it only if another IF follows; otherwise it starts the next shot.
        if (st === 'DO' && !/^IF /.test(nextMarker(i) ?? '')) { branch = null; alt = null; newShot(); mode = 'DO'; continue; }
        mode = 'A' + st; continue;
      }
      if (st === 'DO') { newShot(); branch = null; alt = null; } else if (!cur) newShot();
      mode = st; continue;
    }
    if (branch && /^IF /.test(st)) { alt = { label: st.slice(3).replace(/[\s\-–—]+$/, ''), do: [], screen: [], say: [] }; branch.alts.push(alt); mode = 'ASAY'; continue; }
    if (!st && !['SAY', 'READ', 'ASAY', 'AREAD'].includes(mode)) continue;
    if (mode === 'DO') cur.do.push(st);
    else if (mode === 'SCREEN') cur.screen.push(st);
    else if (mode === 'SAY' || mode === 'READ') pushSay(cur, mode, t);
    else if (mode === 'BNOTE') branch.note.push(st);
    else if (mode === 'ADO') alt.do.push(st);
    else if (mode === 'ASCREEN') alt.screen.push(st);
    else if (mode === 'ASAY' || mode === 'AREAD') pushSay(alt, mode.slice(1), t);
  }
  return shots;
}

const words = (say) => say.reduce((n, [, ls]) => n + ls.join(' ').split(/\s+/).filter(Boolean).length, 0);
const sayText = (say) => say.map(([kind, ls]) => {
  const body = ls.join('\n').replace(/\n{2,}/g, '\n').trim();
  return kind === 'READ' ? `*READ, values from the shot list:*\n${body}` : body;
}).join('\n\n');
const esc = (x) => x.replace(/\|/g, '\\|');

const narr = [
  '# Demo video — narration track (draft 7, split from `demo-script.md`)', '',
  'The spoken track, recorded first. The click-through is driven by this recording, so its timing is',
  'yours, not the model\'s. Each `[D3]`-style tag marks the moment the screen changes; the same tags key the',
  'shot list, and they are never spoken. Line breaks are pacing for the prompter, not sentence ends.', '',
  'Order of work: (1) one dry run of both tasks, writing the values into `demo-shot-list.md`; (2) record',
  'this narration against those values; (3) record the screen while listening to the narration, pausing',
  'playback while the model works and cutting the gap; (4) re-record only the `READ` passages whose value',
  'came out different in the real click-through, as pickups; (5) composite. Where a `BRANCH` offers',
  'alternatives, the dry run decides which one is recorded; delete the others.', '',
  'Rules carried over from the combined script: name the rubric item, then the baseline, then what was',
  'built; every behaviour claim gets a rule or a number; weak numbers first, with the cause; say why after',
  'each what. `docs/demo-script.md` is the source of both files; regenerate with `node scripts/split-demo-script.mjs`.', '',
];
const shotsDoc = [
  '# Demo video — shot list (draft 7, split from `demo-script.md`)', '',
  'The screen track, recorded second, in silence, while listening to the narration; each tag is the',
  'sync point with `demo-narration.md`. The **Values** column lists every number or name the narration',
  'reads aloud in that shot. Fill **Actual** from the dry run before recording the narration, then check',
  'it again after the real click-through: any row where the two differ is a narration pickup. Where a',
  'shot is a `BRANCH`, note which alternative happened; the narration keeps only that one.', '',
  'Browser tabs in order: (1) `/health`, (2) chat, (3) `/desk`, (4) `/eval`, (5) GitHub Actions,',
  '(6) `docs/architecture.html`. Editor tabs: `apps/server/src/mcp/client.ts`, `.github/workflows/ci.yml`,',
  '`.github/workflows/deploy.yml`. Warm both Render services first; the full checklist is in the combined script.', '',
];
let total = 0;
for (const [, beat, title, t0, t1, body] of beats) {
  const block = body.match(/```\n([\s\S]*?)\n```/)[1];
  const shots = parse(block);
  narr.push(`## ${beat} — ${title}`, '');
  shotsDoc.push(`## ${beat} — ${title} (planned ${t0}–${t1})`, '', '| Tag | Do | Screen | Values the narration reads | Actual |', '|---|---|---|---|---|');
  let n = 0;
  for (const s of shots) {
    const tag = `${beat}${++n}`;
    if (s.branch) {
      const b = s.branch;
      narr.push(`\`[${tag}]\` **ONE OF** — ${b.note.join(' ')}`, '');
      for (const a of b.alts) { const txt = sayText(a.say).trim(); narr.push(`*If ${a.label}:*`, '', txt || '*(say nothing)*', ''); }
      const alts = b.alts.map((a) => `**if ${a.label}**: ${a.do.join(' ') || '—'}${a.screen.length ? ` · screen: ${a.screen.join(' ')}` : ''}`).join('; ');
      const reads = b.alts.flatMap((a) => a.say.filter(([k]) => k === 'READ').map(([, ls]) => ls.join(' '))).join('; ') || '—';
      shotsDoc.push(`| \`${tag}\` | BRANCH: ${esc(b.note.join(' '))} ${esc(alts)} | — | ${esc(reads)} | |`);
      total += Math.max(0, ...b.alts.map((a) => words(a.say)));
      continue;
    }
    const txt = sayText(s.say).trim();
    if (txt) { narr.push(`\`[${tag}]\``, '', txt, ''); total += words(s.say); }
    const reads = s.say.filter(([k]) => k === 'READ').map(([, ls]) => ls.join(' ')).join('; ') || '—';
    shotsDoc.push(`| \`${tag}\` | ${esc(s.do.join(' ') || '—')} | ${esc(s.screen.join(' ') || '—')} | ${esc(reads)} | |`);
  }
  shotsDoc.push('');
}
narr.push('---', `*Spoken words (longest branch counted): ${total.toLocaleString()} · ≈ ${Math.floor(total / 160)}:${String(Math.floor(((total % 160) * 60) / 160)).padStart(2, '0')} at 160 wpm. The 10-minute limit applies to the composited video; the screen track is cut to this.*`);
writeFileSync('docs/demo-narration.md', narr.join('\n') + '\n');
writeFileSync('docs/demo-shot-list.md', shotsDoc.join('\n') + '\n');
console.log(`words ${total} · shots ${shotsDoc.filter((l) => l.startsWith('| `')).length}`);
