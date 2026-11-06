import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { hashChain } from '../core/hash.js';
import { MemDatabase } from './memory-db.js';

/**
 * Db can be either a real SQLite database (node:sqlite) or an in-memory
 * database (MemDatabase). Both implement the same prepare()/exec() interface.
 * Vercel serverless uses MemDatabase because node:sqlite requires filesystem
 * persistence which is not available on Vercel's ephemeral runtime.
 */
export type Db = DatabaseSync | MemDatabase;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS runs (
  run_id            TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  session_id        TEXT NOT NULL,
  locale            TEXT NOT NULL,
  timezone          TEXT NOT NULL,
  reference_now     TEXT NOT NULL,
  source_text       TEXT NOT NULL,
  source_hash       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'OPEN',
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sources (
  source_id         TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  kind              TEXT NOT NULL,
  trust_level       TEXT NOT NULL,
  content           TEXT NOT NULL,
  content_hash      TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS actions (
  action_id         TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  type              TEXT NOT NULL,
  state             TEXT NOT NULL,
  version           INTEGER NOT NULL DEFAULT 1,
  payload           TEXT NOT NULL,
  payload_hash      TEXT NOT NULL,
  risk_level        TEXT NOT NULL DEFAULT 'LOW',
  provenance        TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  last_error        TEXT,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  conflict_id        TEXT PRIMARY KEY,
  run_id             TEXT NOT NULL,
  action_id          TEXT,
  type               TEXT NOT NULL,
  severity           TEXT NOT NULL,
  evidence           TEXT NOT NULL,
  question           TEXT,
  options            TEXT NOT NULL DEFAULT '[]',
  requires_clarification INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'OPEN',
  resolution         TEXT,
  created_at         TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES runs(run_id)
);

CREATE TABLE IF NOT EXISTS approvals (
  approval_id       TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  action_id         TEXT NOT NULL,
  tenant_id         TEXT NOT NULL,
  approver_id       TEXT NOT NULL,
  version           INTEGER NOT NULL,
  payload_hash      TEXT NOT NULL,
  decision          TEXT NOT NULL,
  issued_at         TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  consumed_at       TEXT,
  invalidated_at    TEXT,
  invalidate_reason TEXT,
  FOREIGN KEY (action_id) REFERENCES actions(action_id)
);

CREATE TABLE IF NOT EXISTS executions (
  execution_id      TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  action_id         TEXT NOT NULL,
  idempotency_key   TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL,
  receipt           TEXT,
  provider_error    TEXT,
  created_at        TEXT NOT NULL,
  FOREIGN KEY (action_id) REFERENCES actions(action_id)
);

CREATE TABLE IF NOT EXISTS mock_email_messages (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  action_id         TEXT NOT NULL,
  recipient_ids     TEXT NOT NULL,
  recipient_emails  TEXT NOT NULL,
  subject           TEXT NOT NULL,
  body              TEXT NOT NULL,
  attachments       TEXT NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_calendar_events (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  action_id         TEXT NOT NULL,
  title             TEXT NOT NULL,
  start_at          TEXT NOT NULL,
  end_at            TEXT NOT NULL,
  timezone          TEXT NOT NULL,
  location          TEXT,
  participant_ids   TEXT NOT NULL,
  description       TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mock_tasks (
  id                TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  action_id         TEXT NOT NULL,
  assignee_id       TEXT NOT NULL,
  title             TEXT NOT NULL,
  description       TEXT,
  due_at            TEXT,
  due_timezone      TEXT,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  event_id          TEXT PRIMARY KEY,
  seq               INTEGER NOT NULL,
  tenant_id         TEXT NOT NULL,
  run_id            TEXT,
  action_id         TEXT,
  actor             TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  state_before      TEXT,
  state_after       TEXT,
  metadata          TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  prev_hash         TEXT NOT NULL,
  hash              TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_traces (
  trace_id          TEXT PRIMARY KEY,
  run_id            TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  schema_version    TEXT NOT NULL,
  input_hash        TEXT NOT NULL,
  output            TEXT NOT NULL,
  warnings          TEXT NOT NULL DEFAULT '[]',
  elapsed_ms        INTEGER NOT NULL,
  created_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id        TEXT PRIMARY KEY,
  tenant_id         TEXT NOT NULL,
  user_id           TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  expires_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id);
CREATE INDEX IF NOT EXISTS idx_conflicts_run ON conflicts(run_id);
CREATE INDEX IF NOT EXISTS idx_audit_run ON audit_events(run_id, seq);
CREATE INDEX IF NOT EXISTS idx_approvals_action ON approvals(action_id);
`;

export function openDatabase(filePath: string): Db {
  // Use in-memory database when running on Vercel or when node:sqlite is
  // unavailable (e.g., older Node.js without --experimental-sqlite flag).
  const useMemory = process.env.NAVI_DB_MODE === 'memory' ||
    !existsSync(resolve(filePath)) && process.env.VERCEL;

  if (useMemory || process.env.VERCEL) {
    const db = new MemDatabase();
    db.exec(SCHEMA);
    return db;
  }

  const absolute = resolve(filePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const db = new DatabaseSync(absolute);
  db.exec(SCHEMA);
  return db;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Append-only audit log with a tamper-evident hash chain.
 * Every event stores prev_hash + hash so that any edit to historical rows is
 * detectable. PRD 9.2 asks for append-only / tamper-evident audit.
 */
export function appendAuditEvent(
  db: Db,
  event: {
    tenant_id: string;
    run_id: string | null;
    action_id?: string | null;
    actor: string;
    event_type: string;
    state_before?: string | null;
    state_after?: string | null;
    metadata?: Record<string, unknown>;
    event_id: string;
    created_at?: string;
  },
): { seq: number; hash: string } {
  const createdAt = event.created_at ?? nowIso();
  const row = db.prepare('SELECT seq, hash FROM audit_events ORDER BY seq DESC LIMIT 1').get() as
    | { seq: number; hash: string }
    | undefined;
  const seq = (row?.seq ?? 0) + 1;
  const prevHash = row?.hash ?? 'GENESIS';
  const metadata = event.metadata ?? {};
  const hash = hashChain(prevHash, {
    seq,
    tenant_id: event.tenant_id,
    run_id: event.run_id,
    action_id: event.action_id ?? null,
    actor: event.actor,
    event_type: event.event_type,
    state_before: event.state_before ?? null,
    state_after: event.state_after ?? null,
    metadata,
    created_at: createdAt,
  });

  db.prepare(
    `INSERT INTO audit_events
      (event_id, seq, tenant_id, run_id, action_id, actor, event_type,
       state_before, state_after, metadata, created_at, prev_hash, hash)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    event.event_id,
    seq,
    event.tenant_id,
    event.run_id,
    event.action_id ?? null,
    event.actor,
    event.event_type,
    event.state_before ?? null,
    event.state_after ?? null,
    JSON.stringify(metadata),
    createdAt,
    prevHash,
    hash,
  );

  return { seq, hash };
}

/** Verify the audit hash chain. Used by tests and the audit viewer. */
export function verifyAuditChain(db: Db): { ok: boolean; brokenAt: number | null } {
  const rows = db
    .prepare('SELECT * FROM audit_events ORDER BY seq ASC')
    .all() as Array<Record<string, unknown>>;
  let prev = 'GENESIS';
  for (const row of rows) {
    if (row.prev_hash !== prev) return { ok: false, brokenAt: Number(row.seq) };
    const expected = hashChain(prev, {
      seq: Number(row.seq),
      tenant_id: row.tenant_id,
      run_id: row.run_id,
      action_id: row.action_id,
      actor: row.actor,
      event_type: row.event_type,
      state_before: row.state_before,
      state_after: row.state_after,
      metadata: JSON.parse(String(row.metadata)),
      created_at: row.created_at,
    });
    if (expected !== row.hash) return { ok: false, brokenAt: Number(row.seq) };
    prev = String(row.hash);
  }
  return { ok: true, brokenAt: null };
}
