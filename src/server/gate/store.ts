import crypto from 'crypto';
import { getDb } from '../db/database.js';
import { config } from '../config.js';

export type SessionStatus = 'PENDING' | 'APPROVED' | 'DENIED' | 'REVOKED';

export interface GateSession {
  sessionId: string;
  clientIp: string;
  userAgent: string;
  status: SessionStatus;
  createdAt: string;
  approvedAt?: string | null;
  expiresAt?: string | null;
}

export const COOKIE_NAME = 'telebhaja_gate';

const sessionsCache = new Map<string, GateSession>();
let initialized = false;

function getSecret(): string {
  return config.gate?.secret || process.env.GATE_SECRET || 'telebhaja-gate-secret-key-2026';
}

/**
 * Sign a session ID with HMAC-SHA256
 */
export function signSession(sessionId: string): string {
  const secret = getSecret();
  const signature = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');
  return `${sessionId}.${signature}`;
}

/**
 * Verify a signed session cookie and return the session ID if authentic
 */
export function verifySignedSession(cookieValue?: string): string | null {
  if (!cookieValue || typeof cookieValue !== 'string') return null;
  const parts = cookieValue.split('.');
  if (parts.length !== 2) return null;

  const [sessionId, providedSignature] = parts;
  if (!sessionId || !providedSignature) return null;

  const secret = getSecret();
  const expectedSignature = crypto.createHmac('sha256', secret).update(sessionId).digest('hex');

  // Constant-time comparison to prevent timing attacks
  const bufProvided = Buffer.from(providedSignature);
  const bufExpected = Buffer.from(expectedSignature);
  if (bufProvided.length !== bufExpected.length) return null;
  if (!crypto.timingSafeEqual(bufProvided, bufExpected)) return null;

  return sessionId;
}

/**
 * Initialize gate store from database
 */
export async function initGateStore(): Promise<void> {
  const db = getDb();
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS gate_sessions (
        session_id   TEXT PRIMARY KEY,
        client_ip    TEXT NOT NULL,
        user_agent   TEXT,
        status       TEXT NOT NULL CHECK(status IN ('PENDING', 'APPROVED', 'DENIED', 'REVOKED')),
        created_at   TEXT DEFAULT (datetime('now')),
        approved_at  TEXT,
        expires_at   TEXT
      )
    `);
    await db.execute(`CREATE INDEX IF NOT EXISTS idx_gate_sessions_status ON gate_sessions(status)`);

    const rows = await db.prepare(`SELECT * FROM gate_sessions ORDER BY created_at DESC`).all() as unknown as Array<{
      session_id: string;
      client_ip: string;
      user_agent: string | null;
      status: SessionStatus;
      created_at: string;
      approved_at: string | null;
      expires_at: string | null;
    }>;

    sessionsCache.clear();
    const now = Date.now();

    for (const r of rows) {
      const sess: GateSession = {
        sessionId: r.session_id,
        clientIp: r.client_ip,
        userAgent: r.user_agent ?? 'Unknown',
        status: r.status,
        createdAt: r.created_at,
        approvedAt: r.approved_at,
        expiresAt: r.expires_at,
      };

      // Auto-expire active sessions whose duration passed
      if (sess.status === 'APPROVED' && sess.expiresAt) {
        if (new Date(sess.expiresAt).getTime() < now) {
          sess.status = 'REVOKED';
        }
      }

      sessionsCache.set(sess.sessionId, sess);
    }

    initialized = true;
    console.log(`[GateStore] Initialized with ${sessionsCache.size} session(s) in cache.`);
  } catch (err) {
    console.error('[GateStore] Initialization failed:', err);
  }
}

/**
 * Register a new visitor in the waiting room
 */
export async function createSession(clientIp: string, userAgent: string): Promise<GateSession> {
  if (!initialized) await initGateStore();

  const sessionId = 'gate_' + crypto.randomBytes(16).toString('hex');
  const now = new Date().toISOString();

  const session: GateSession = {
    sessionId,
    clientIp,
    userAgent,
    status: 'PENDING',
    createdAt: now,
  };

  sessionsCache.set(sessionId, session);

  try {
    const db = getDb();
    await db.execute({
      sql: `INSERT INTO gate_sessions (session_id, client_ip, user_agent, status, created_at) VALUES (?, ?, ?, ?, ?)`,
      args: [sessionId, clientIp, userAgent, 'PENDING', now],
    });
  } catch (err) {
    console.error('[GateStore] Failed to persist new session:', err);
  }

  return session;
}

/**
 * Find an existing recent PENDING session for the same IP and User Agent (within 30 minutes)
 */
export function findPendingSession(clientIp: string, userAgent: string): GateSession | undefined {
  const now = Date.now();
  for (const session of sessionsCache.values()) {
    if (session.status === 'PENDING' && session.clientIp === clientIp && session.userAgent === userAgent) {
      const age = now - new Date(session.createdAt).getTime();
      if (age < 30 * 60 * 1000) {
        return session;
      }
    }
  }
  return undefined;
}

/**
 * Find an active, unexpired APPROVED session by client IP.
 * Used for media streams (video/audio/subtitles) where native players
 * (such as iOS Safari AVPlayer / AppleCoreMedia) do not forward browser cookies.
 */
export function findApprovedSessionByIp(clientIp: string): GateSession | undefined {
  const now = Date.now();
  for (const session of sessionsCache.values()) {
    if (session.status === 'APPROVED' && session.clientIp === clientIp) {
      if (!session.expiresAt || new Date(session.expiresAt).getTime() > now) {
        return session;
      }
    }
  }
  return undefined;
}

/**
 * Register a new visitor in the waiting room, or reuse recent pending session if duplicate request
 */
export async function getOrCreatePendingSession(clientIp: string, userAgent: string): Promise<GateSession> {
  if (!initialized) await initGateStore();

  const existing = findPendingSession(clientIp, userAgent);
  if (existing) {
    return existing;
  }

  return createSession(clientIp, userAgent);
}

/**
 * Retrieve session by ID and check expiration
 */
export function getSession(sessionId: string): GateSession | undefined {
  const session = sessionsCache.get(sessionId);
  if (!session) return undefined;

  // Check expiration for approved sessions
  if (session.status === 'APPROVED' && session.expiresAt) {
    if (new Date(session.expiresAt).getTime() < Date.now()) {
      session.status = 'REVOKED';
      // Asynchronously update DB
      const db = getDb();
      db.execute({
        sql: `UPDATE gate_sessions SET status = 'REVOKED' WHERE session_id = ?`,
        args: [sessionId],
      }).catch(() => {});
    }
  }

  return session;
}

/**
 * Approve a pending visitor session with configurable expiry duration
 */
export async function approveSession(sessionId: string, durationHours: number = 4): Promise<GateSession | null> {
  const session = getSession(sessionId);
  if (!session) return null;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + durationHours * 3600 * 1000).toISOString();
  const approvedAt = now.toISOString();

  session.status = 'APPROVED';
  session.approvedAt = approvedAt;
  session.expiresAt = expiresAt;

  sessionsCache.set(sessionId, session);

  // Cascading approval: also approve any linked pending sessions from the same device
  for (const other of sessionsCache.values()) {
    if (other.sessionId !== sessionId && other.status === 'PENDING' && other.clientIp === session.clientIp && other.userAgent === session.userAgent) {
      other.status = 'APPROVED';
      other.approvedAt = approvedAt;
      other.expiresAt = expiresAt;
      sessionsCache.set(other.sessionId, other);
    }
  }

  try {
    const db = getDb();
    await db.execute({
      sql: `UPDATE gate_sessions SET status = 'APPROVED', approved_at = ?, expires_at = ? WHERE session_id = ? OR (client_ip = ? AND user_agent = ? AND status = 'PENDING')`,
      args: [approvedAt, expiresAt, sessionId, session.clientIp, session.userAgent],
    });
  } catch (err) {
    console.error('[GateStore] Failed to update approved session:', err);
  }

  return session;
}

/**
 * Deny a visitor request
 */
export async function denySession(sessionId: string): Promise<GateSession | null> {
  const session = getSession(sessionId);
  if (!session) return null;

  session.status = 'DENIED';
  sessionsCache.set(sessionId, session);

  try {
    const db = getDb();
    await db.execute({
      sql: `UPDATE gate_sessions SET status = 'DENIED' WHERE session_id = ?`,
      args: [sessionId],
    });
  } catch (err) {
    console.error('[GateStore] Failed to update denied session:', err);
  }

  return session;
}

/**
 * Revoke an active session immediately
 */
export async function revokeSession(sessionId: string): Promise<GateSession | null> {
  const session = getSession(sessionId);
  if (!session) return null;

  session.status = 'REVOKED';
  sessionsCache.set(sessionId, session);

  try {
    const db = getDb();
    await db.execute({
      sql: `UPDATE gate_sessions SET status = 'REVOKED' WHERE session_id = ?`,
      args: [sessionId],
    });
  } catch (err) {
    console.error('[GateStore] Failed to revoke session:', err);
  }

  return session;
}

/**
 * List all sessions categorized for the Admin Dashboard
 */
export function listSessions(): {
  pending: GateSession[];
  approved: GateSession[];
  history: GateSession[];
} {
  const now = Date.now();
  const pendingMap = new Map<string, GateSession>();
  const approvedMap = new Map<string, GateSession>();
  const history: GateSession[] = [];

  for (const session of sessionsCache.values()) {
    if (session.status === 'PENDING') {
      // Deduplicate pending by (clientIp + userAgent) so one device shows exactly once with newest timestamp
      const key = `${session.clientIp}|${session.userAgent}`;
      const existing = pendingMap.get(key);
      if (!existing || new Date(session.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        pendingMap.set(key, session);
      }
    } else if (session.status === 'APPROVED') {
      if (session.expiresAt && new Date(session.expiresAt).getTime() < now) {
        session.status = 'REVOKED';
        history.push(session);
      } else {
        const key = `${session.clientIp}|${session.userAgent}`;
        const existing = approvedMap.get(key);
        if (!existing || new Date(session.approvedAt || session.createdAt).getTime() > new Date(existing.approvedAt || existing.createdAt).getTime()) {
          approvedMap.set(key, session);
        }
      }
    } else {
      history.push(session);
    }
  }

  const pending = Array.from(pendingMap.values());
  const approved = Array.from(approvedMap.values());

  // Sort by created_at descending
  pending.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  approved.sort((a, b) => new Date(b.approvedAt || b.createdAt).getTime() - new Date(a.approvedAt || a.createdAt).getTime());
  history.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return { pending, approved, history };
}

/**
 * Clean up old sessions
 */
export async function pruneExpiredSessions(): Promise<number> {
  const now = new Date().toISOString();
  let count = 0;
  for (const [id, s] of sessionsCache.entries()) {
    if (s.status === 'REVOKED' || s.status === 'DENIED' || (s.expiresAt && s.expiresAt < now)) {
      sessionsCache.delete(id);
      count++;
    }
  }
  try {
    const db = getDb();
    await db.execute({
      sql: `DELETE FROM gate_sessions WHERE status IN ('REVOKED', 'DENIED') OR (expires_at IS NOT NULL AND expires_at < ?)`,
      args: [now],
    });
  } catch (err) {
    console.error('[GateStore] Prune error:', err);
  }
  return count;
}
