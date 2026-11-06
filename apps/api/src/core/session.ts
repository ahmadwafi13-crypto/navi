/**
 * Session and identity layer.
 *
 * Identity comes from an authenticated server-side session, never from free
 * text (AC12, TC06, TC16). The demo issues a session for a fixture user id
 * through an explicit login endpoint; the API key on that session is what
 * gates approval and execution.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from '../db/index.js';
import { nowIso } from '../db/index.js';
import { newSessionId } from '../core/ids.js';

export interface Session {
  session_id: string;
  tenant_id: string;
  user_id: string;
  created_at: string;
  expires_at: string;
}

export interface AuthContext {
  session: Session;
  /** The bearer/api key that authenticates this session. */
  apiKey: string;
}

/**
 * API keys are stored hashed. The plaintext key is returned to the client once
 * and never persisted, so a database dump cannot be replayed.
 */
const apiKeyHashes = new Map<string, string>();

export function hashApiKey(key: string): string {
  return createHash('sha256').update(key, 'utf8').digest('hex');
}

export function createSession(db: Db, tenantId: string, userId: string): AuthContext {
  const sessionId = newSessionId();
  const apiKey = `navi_${randomBytes(24).toString('hex')}`;
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + 8 * 3600 * 1000).toISOString();
  db.prepare(
    `INSERT INTO sessions (session_id, tenant_id, user_id, created_at, expires_at)
     VALUES (?,?,?,?,?)`,
  ).run(sessionId, tenantId, userId, createdAt, expiresAt);
  apiKeyHashes.set(hashApiKey(apiKey), sessionId);
  return { session: { session_id: sessionId, tenant_id: tenantId, user_id: userId, created_at: createdAt, expires_at: expiresAt }, apiKey };
}

export function resolveSession(db: Db, apiKey: string | undefined): AuthContext | null {
  if (!apiKey) return null;
  const sessionId = apiKeyHashes.get(hashApiKey(apiKey));
  if (!sessionId) return null;
  const row = db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
    | Record<string, unknown>
    | undefined;
  if (!row) return null;
  if (Date.parse(String(row.expires_at)) <= Date.now()) return null;
  return {
    session: {
      session_id: String(row.session_id),
      tenant_id: String(row.tenant_id),
      user_id: String(row.user_id),
      created_at: String(row.created_at),
      expires_at: String(row.expires_at),
    },
    apiKey,
  };
}

export function destroySession(db: Db, sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId);
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
