import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import { CaseEventSchema, type CaseEvent, type NewCaseEvent } from "@caseflow/shared";

/**
 * CaseFlow's audit record (ADR-0005): an append-only event log plus immutable document storage.
 * The code only ever INSERTs; database triggers reject UPDATE and DELETE, so history cannot be rewritten
 * even by a bug. Every event is validated against its schema on the way in and on the way out.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  case_number TEXT NOT NULL,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  payload     TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_by_case ON events (case_number, id);
CREATE TRIGGER IF NOT EXISTS events_no_update BEFORE UPDATE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;
CREATE TRIGGER IF NOT EXISTS events_no_delete BEFORE DELETE ON events
  BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TABLE IF NOT EXISTS documents (
  id          TEXT PRIMARY KEY,
  case_number TEXT NOT NULL,
  file_name   TEXT NOT NULL,
  media_type  TEXT NOT NULL,
  sha256      TEXT NOT NULL,
  size_bytes  INTEGER NOT NULL,
  content     BLOB NOT NULL,
  stored_at   TEXT NOT NULL
);
CREATE TRIGGER IF NOT EXISTS documents_no_update BEFORE UPDATE ON documents
  BEGIN SELECT RAISE(ABORT, 'documents are immutable'); END;
CREATE TRIGGER IF NOT EXISTS documents_no_delete BEFORE DELETE ON documents
  BEGIN SELECT RAISE(ABORT, 'documents are immutable'); END;
`;

interface EventRow {
  id: number;
  case_number: string;
  type: string;
  actor: string;
  payload: string;
  created_at: string;
}

export interface StoredDocument {
  documentId: string;
  caseNumber: string;
  fileName: string;
  mediaType: string;
  sha256: string;
  sizeBytes: number;
  content: Uint8Array;
}

export type EventListener = (event: CaseEvent) => void;

export class EventStore {
  private readonly db: Database.Database;
  private readonly listeners = new Set<EventListener>();

  constructor(
    path = ":memory:",
    private readonly now: () => Date = () => new Date(),
  ) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
  }

  append(event: NewCaseEvent): CaseEvent {
    const createdAt = this.now().toISOString();
    // Validate before writing: a malformed event never reaches the log.
    CaseEventSchema.parse({ ...event, id: 1, createdAt });
    const { lastInsertRowid } = this.db
      .prepare("INSERT INTO events (case_number, type, actor, payload, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(event.caseNumber, event.type, event.actor, JSON.stringify(event.payload), createdAt);
    const stored = CaseEventSchema.parse({ ...event, id: Number(lastInsertRowid), createdAt });
    for (const listener of this.listeners) listener(stored);
    return stored;
  }

  events(caseNumber: string): CaseEvent[] {
    const rows = this.db.prepare("SELECT * FROM events WHERE case_number = ? ORDER BY id").all(caseNumber) as EventRow[];
    return rows.map(toEvent);
  }

  caseNumbers(): string[] {
    return (this.db.prepare("SELECT DISTINCT case_number FROM events ORDER BY case_number").all() as { case_number: string }[]).map(
      (r) => r.case_number,
    );
  }

  /** Store a document's bytes. The same file uploaded twice to a case is stored once. */
  putDocument(caseNumber: string, fileName: string, mediaType: string, content: Uint8Array): StoredDocument {
    const sha256 = createHash("sha256").update(content).digest("hex");
    const documentId = `${caseNumber}-${sha256.slice(0, 12)}`;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO documents (id, case_number, file_name, media_type, sha256, size_bytes, content, stored_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(documentId, caseNumber, fileName, mediaType, sha256, content.byteLength, Buffer.from(content), this.now().toISOString());
    return this.getDocument(documentId)!;
  }

  getDocument(documentId: string): StoredDocument | undefined {
    const row = this.db.prepare("SELECT * FROM documents WHERE id = ?").get(documentId) as
      | { id: string; case_number: string; file_name: string; media_type: string; sha256: string; size_bytes: number; content: Buffer }
      | undefined;
    if (!row) return undefined;
    return {
      documentId: row.id,
      caseNumber: row.case_number,
      fileName: row.file_name,
      mediaType: row.media_type,
      sha256: row.sha256,
      sizeBytes: row.size_bytes,
      content: new Uint8Array(row.content),
    };
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Exposed for tests that prove the log is tamper-resistant. */
  rawExec(sql: string): void {
    this.db.exec(sql);
  }

  close(): void {
    this.db.close();
  }
}

function toEvent(row: EventRow): CaseEvent {
  return CaseEventSchema.parse({
    id: row.id,
    caseNumber: row.case_number,
    type: row.type,
    actor: row.actor,
    payload: JSON.parse(row.payload),
    createdAt: row.created_at,
  });
}
