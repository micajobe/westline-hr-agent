import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import * as sqliteVec from 'sqlite-vec';
import type { Chunk, IndexMeta, LoadedDocument, SourceFormat } from '../types.js';
import { effectiveAudience, parseSections } from '../ingest/headings.js';
import type { PolicySection } from '../retrieve/section.js';
import type { Audience } from '@westline/shared';
import { Bm25Index } from './bm25.js';

export interface VectorHit {
  chunk_id: string;
  /** Cosine distance in [0, 2]; `score` is `1 - distance`. */
  distance: number;
  score: number;
}

export interface VectorSearchOptions {
  k: number;
  /** Restrict to chunks whose effective audience is one of these. Applied inside the KNN query. */
  audiences?: readonly Audience[];
  doc_ids?: readonly string[];
}

const META_KEYS: (keyof IndexMeta)[] = [
  'corpus_hash',
  'doc_count',
  'chunk_count',
  'embedding_model',
  'embedding_dimensions',
  'chunker',
  'built_at',
];

/**
 * The on-disk index: one SQLite file holding chunk metadata + text, the `sqlite-vec` vector table,
 * the serialised BM25 index and the build metadata. One artifact, one `corpus_hash`, so the app and
 * MCP services can never disagree about what they loaded.
 *
 * `node:sqlite` binding per ADR 0003. All methods are synchronous; SQLite is in-process and the
 * corpus is a few hundred chunks.
 */
export class IndexStore {
  private bm25Cache: Bm25Index | undefined;

  private constructor(
    readonly path: string,
    private readonly db: DatabaseSync,
  ) {}

  /** Open an existing index. Throws if the file has no `meta` table (never built or half-written). */
  static open(path: string): IndexStore {
    const db = connect(path);
    const store = new IndexStore(path, db);
    if (!store.hasSchema()) {
      db.close();
      throw new Error(`${path}: not a Westline index (missing meta table)`);
    }
    return store;
  }

  /** Create a fresh, empty index with a vector table of the given width. Use `:memory:` in tests. */
  static create(path: string, dimensions: number): IndexStore {
    const db = connect(path);
    db.exec(`
      CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE documents (
        doc_id         TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        source_format  TEXT NOT NULL,
        path           TEXT NOT NULL,
        audience       TEXT NOT NULL,
        effective_date TEXT NOT NULL,
        version        TEXT NOT NULL,
        owner          TEXT NOT NULL,
        overrides_json TEXT NOT NULL,
        markdown       TEXT NOT NULL
      );
      CREATE TABLE chunks (
        chunk_id      TEXT PRIMARY KEY,
        doc_id        TEXT NOT NULL,
        title         TEXT NOT NULL,
        section_path  TEXT NOT NULL,
        section_title TEXT NOT NULL,
        chunk_index   INTEGER NOT NULL,
        source_format TEXT NOT NULL,
        audience      TEXT NOT NULL,
        char_start    INTEGER NOT NULL,
        char_end      INTEGER NOT NULL,
        snippet       TEXT NOT NULL,
        content_hash  TEXT NOT NULL,
        text          TEXT NOT NULL
      );
      CREATE INDEX chunks_doc ON chunks(doc_id, section_path);
      CREATE VIRTUAL TABLE vec_chunks USING vec0(
        chunk_id  TEXT PRIMARY KEY,
        audience  TEXT,
        doc_id    TEXT,
        embedding FLOAT[${Math.floor(dimensions)}] distance_metric=cosine
      );
      CREATE TABLE bm25 (id INTEGER PRIMARY KEY CHECK (id = 1), json TEXT NOT NULL);
    `);
    return new IndexStore(path, db);
  }

  static exists(path: string): boolean {
    if (path === ':memory:') return false;
    try {
      const store = IndexStore.open(path);
      store.close();
      return true;
    } catch {
      return false;
    }
  }

  // ---------- writing ----------

  /** Insert documents, every chunk with its vector, then the BM25 index and metadata, in one transaction. */
  write(
    docs: LoadedDocument[],
    chunks: Chunk[],
    vectors: Float32Array[],
    bm25: Bm25Index,
    meta: IndexMeta,
  ): void {
    if (chunks.length !== vectors.length) {
      throw new Error(`chunk/vector count mismatch: ${chunks.length} vs ${vectors.length}`);
    }
    const insDoc = this.db.prepare(`
      INSERT INTO documents (doc_id, title, source_format, path, audience, effective_date, version,
        owner, overrides_json, markdown)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insChunk = this.db.prepare(`
      INSERT INTO chunks (chunk_id, doc_id, title, section_path, section_title, chunk_index,
        source_format, audience, char_start, char_end, snippet, content_hash, text)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insVec = this.db.prepare(
      'INSERT INTO vec_chunks (chunk_id, audience, doc_id, embedding) VALUES (?, ?, ?, ?)',
    );
    const insMeta = this.db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');

    this.db.exec('BEGIN');
    try {
      for (const d of docs) {
        const fm = d.front_matter;
        insDoc.run(
          d.doc_id,
          d.title,
          d.source_format,
          d.path,
          fm.audience,
          fm.effective_date,
          fm.version,
          fm.owner,
          JSON.stringify(fm.section_audience_overrides ?? {}),
          d.markdown,
        );
      }
      chunks.forEach((c, i) => {
        insChunk.run(
          c.chunk_id,
          c.doc_id,
          c.title,
          c.section_path,
          c.section_title,
          c.chunk_index,
          c.source_format,
          c.audience,
          c.char_start,
          c.char_end,
          c.snippet,
          c.content_hash,
          c.text,
        );
        insVec.run(c.chunk_id, c.audience, c.doc_id, vectors[i]!);
      });
      this.db.prepare('INSERT OR REPLACE INTO bm25 (id, json) VALUES (1, ?)').run(bm25.toJSON());
      for (const key of META_KEYS) insMeta.run(key, String(meta[key]));
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    this.bm25Cache = bm25;
  }

  // ---------- reading ----------

  meta(): IndexMeta {
    const rows = this.db.prepare('SELECT key, value FROM meta').all() as {
      key: string;
      value: string;
    }[];
    const kv = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    for (const key of META_KEYS)
      if (kv[key] === undefined) throw new Error(`${this.path}: meta.${key} missing`);
    return {
      corpus_hash: kv.corpus_hash!,
      doc_count: Number(kv.doc_count),
      chunk_count: Number(kv.chunk_count),
      embedding_model: kv.embedding_model!,
      embedding_dimensions: Number(kv.embedding_dimensions),
      chunker: kv.chunker!,
      built_at: kv.built_at!,
    };
  }

  get bm25(): Bm25Index {
    if (!this.bm25Cache) {
      const row = this.db.prepare('SELECT json FROM bm25 WHERE id = 1').get() as
        { json: string } | undefined;
      if (!row) throw new Error(`${this.path}: BM25 index missing`);
      this.bm25Cache = Bm25Index.fromJSON(row.json);
    }
    return this.bm25Cache;
  }

  chunkCount(): number {
    return Number(
      (this.db.prepare('SELECT COUNT(*) AS n FROM chunks').get() as { n: number | bigint }).n,
    );
  }

  getChunk(chunk_id: string): Chunk | undefined {
    const row = this.db.prepare('SELECT * FROM chunks WHERE chunk_id = ?').get(chunk_id);
    return row ? rowToChunk(row as Record<string, SQLInputValue>) : undefined;
  }

  /** Fetch many chunks by id, returned in the order asked for; unknown ids are skipped. */
  getChunks(chunk_ids: readonly string[]): Chunk[] {
    if (chunk_ids.length === 0) return [];
    const placeholders = chunk_ids.map(() => '?').join(', ');
    const rows = this.db
      .prepare(`SELECT * FROM chunks WHERE chunk_id IN (${placeholders})`)
      .all(...chunk_ids) as Record<string, SQLInputValue>[];
    const byId = new Map(rows.map((r) => [String(r.chunk_id), rowToChunk(r)]));
    return chunk_ids.map((id) => byId.get(id)).filter((c): c is Chunk => Boolean(c));
  }

  getDocument(doc_id: string): LoadedDocument | undefined {
    const r = this.db.prepare('SELECT * FROM documents WHERE doc_id = ?').get(doc_id) as
      Record<string, SQLInputValue> | undefined;
    if (!r) return undefined;
    const overrides = JSON.parse(String(r.overrides_json)) as Record<string, Audience>;
    return {
      doc_id: String(r.doc_id),
      title: String(r.title),
      source_format: String(r.source_format) as SourceFormat,
      path: String(r.path),
      markdown: String(r.markdown),
      front_matter: {
        doc_id: String(r.doc_id),
        title: String(r.title),
        version: String(r.version),
        effective_date: String(r.effective_date),
        owner: String(r.owner),
        audience: String(r.audience) as Audience,
        ...(Object.keys(overrides).length ? { section_audience_overrides: overrides } : {}),
      },
    };
  }

  documentIds(): string[] {
    return (
      this.db.prepare('SELECT doc_id FROM documents ORDER BY doc_id').all() as { doc_id: string }[]
    ).map((r) => r.doc_id);
  }

  /**
   * A section's full text straight from the stored document (a `##` section includes its `###`
   * children, as a reader would expect), with the effective audience after overrides.
   */
  getSection(doc_id: string, section_path: string): PolicySection | undefined {
    const doc = this.getDocument(doc_id);
    if (!doc) return undefined;
    const section = parseSections(doc.markdown).find((s) => s.section_path === section_path);
    if (!section) return undefined;
    return {
      doc_id,
      title: doc.title,
      section_path,
      section_title: section.section_title,
      text: section.text,
      audience: effectiveAudience(
        section_path,
        doc.front_matter.audience,
        doc.front_matter.section_audience_overrides,
      ),
      effective_date: doc.front_matter.effective_date,
    };
  }

  allChunks(): Chunk[] {
    const rows = this.db.prepare('SELECT * FROM chunks ORDER BY doc_id, char_start').all();
    return (rows as Record<string, SQLInputValue>[]).map(rowToChunk);
  }

  /**
   * Exact KNN over the vector table. Audience and doc filters are metadata constraints inside the
   * `MATCH` query, so the top-k is computed over the permitted chunks only -- PRD §6.1's "filter
   * before ranking", not a post-hoc cut that could return fewer than k results.
   */
  vectorSearch(query: Float32Array, opts: VectorSearchOptions): VectorHit[] {
    const where: string[] = ['embedding MATCH ?', 'k = ?'];
    const params: SQLInputValue[] = [query, Math.max(1, Math.floor(opts.k))];
    if (opts.audiences) {
      if (opts.audiences.length === 0) return [];
      where.push(`audience IN (${opts.audiences.map(() => '?').join(', ')})`);
      params.push(...opts.audiences);
    }
    if (opts.doc_ids) {
      if (opts.doc_ids.length === 0) return [];
      where.push(`doc_id IN (${opts.doc_ids.map(() => '?').join(', ')})`);
      params.push(...opts.doc_ids);
    }
    const rows = this.db
      .prepare(
        `SELECT chunk_id, distance FROM vec_chunks WHERE ${where.join(' AND ')} ORDER BY distance`,
      )
      .all(...params) as { chunk_id: string; distance: number }[];
    return rows.map((r) => ({ chunk_id: r.chunk_id, distance: r.distance, score: 1 - r.distance }));
  }

  close(): void {
    this.db.close();
  }

  private hasSchema(): boolean {
    const row = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
      .get();
    return Boolean(row);
  }
}

function connect(path: string): DatabaseSync {
  const db = new DatabaseSync(path, { allowExtension: true });
  sqliteVec.load(db);
  return db;
}

function rowToChunk(r: Record<string, SQLInputValue>): Chunk {
  return {
    chunk_id: String(r.chunk_id),
    doc_id: String(r.doc_id),
    title: String(r.title),
    section_path: String(r.section_path),
    section_title: String(r.section_title),
    chunk_index: Number(r.chunk_index),
    source_format: String(r.source_format) as SourceFormat,
    audience: String(r.audience) as Audience,
    char_start: Number(r.char_start),
    char_end: Number(r.char_end),
    snippet: String(r.snippet),
    content_hash: String(r.content_hash),
    text: String(r.text),
  };
}
