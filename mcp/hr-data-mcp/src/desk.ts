import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

export interface Ticket {
  ticket_id: string;
  created_by: string;
  about_person_id: string;
  category: string;
  summary: string;
  details: string | null;
  status: string;
  created_at: string;
  turn_id: string | null;
}

export interface Draft {
  draft_id: string;
  created_by: string;
  about_person_id: string;
  recipient_role: string;
  subject: string;
  body: string;
  created_at: string;
  turn_id: string | null;
}

/**
 * `data/desk.sqlite`: where the two gated tools write. Mock only -- nothing here is ever sent
 * anywhere. Seeded from `mock_data/tickets.seed.json` so `/desk` is not empty on a cold start;
 * resets on redeploy by design.
 */
export class DeskStore {
  private constructor(private readonly db: DatabaseSync) {}

  static open(path: string): DeskStore {
    const db = new DatabaseSync(path);
    db.exec(`
      CREATE TABLE IF NOT EXISTS tickets (
        ticket_id TEXT PRIMARY KEY, created_by TEXT NOT NULL, about_person_id TEXT NOT NULL,
        category TEXT NOT NULL, summary TEXT NOT NULL, details TEXT, status TEXT NOT NULL,
        created_at TEXT NOT NULL, turn_id TEXT
      );
      CREATE TABLE IF NOT EXISTS drafts (
        draft_id TEXT PRIMARY KEY, created_by TEXT NOT NULL, about_person_id TEXT NOT NULL,
        recipient_role TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
        created_at TEXT NOT NULL, turn_id TEXT
      );
    `);
    return new DeskStore(db);
  }

  /** Idempotent: seed rows use INSERT OR IGNORE so a restart does not duplicate them. */
  seed(seedJsonPath: string): void {
    const seed = JSON.parse(readFileSync(seedJsonPath, 'utf8')) as {
      tickets: Omit<Ticket, 'details'>[];
      drafts: Draft[];
    };
    for (const t of seed.tickets) this.insertTicket({ ...t, details: null }, true);
    for (const d of seed.drafts) this.insertDraft(d, true);
  }

  insertTicket(t: Ticket, ignoreDuplicate = false): void {
    this.db
      .prepare(
        `INSERT ${ignoreDuplicate ? 'OR IGNORE ' : ''}INTO tickets
         (ticket_id, created_by, about_person_id, category, summary, details, status, created_at, turn_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        t.ticket_id,
        t.created_by,
        t.about_person_id,
        t.category,
        t.summary,
        t.details,
        t.status,
        t.created_at,
        t.turn_id,
      );
  }

  insertDraft(d: Draft, ignoreDuplicate = false): void {
    this.db
      .prepare(
        `INSERT ${ignoreDuplicate ? 'OR IGNORE ' : ''}INTO drafts
         (draft_id, created_by, about_person_id, recipient_role, subject, body, created_at, turn_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.draft_id,
        d.created_by,
        d.about_person_id,
        d.recipient_role,
        d.subject,
        d.body,
        d.created_at,
        d.turn_id,
      );
  }

  listTickets(): Ticket[] {
    return this.db
      .prepare('SELECT * FROM tickets ORDER BY created_at DESC')
      .all() as unknown as Ticket[];
  }

  listDrafts(): Draft[] {
    return this.db
      .prepare('SELECT * FROM drafts ORDER BY created_at DESC')
      .all() as unknown as Draft[];
  }

  close(): void {
    this.db.close();
  }
}
