// Expected findings: 4 mixed
//
// This file contains one of each issue type to test that preflight can
// detect multiple categories in a single file:
//   1. PHANTOM_PACKAGE:    'express-async-errors-v2' does not exist on npm
//   2. HALLUCINATED_API:   Map.prototype.filter() does not exist
//   3. SECURITY:           Unparameterized SQL query (SQL injection)
//   4. MISSING_ERROR_HANDLING: JSON.parse on untrusted network input without try/catch

import express from "express";
import "express-async-errors-v2"; // PHANTOM: real package is 'express-async-errors'
import pg from "pg";
import { logger } from "../lib/logger";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Session {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  metadata: Record<string, string>;
}

interface SessionStore {
  sessions: Map<string, Session>;
  maxSessions: number;
}

// ---------------------------------------------------------------------------
// Database & store setup
// ---------------------------------------------------------------------------

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

const sessionStore: SessionStore = {
  sessions: new Map(),
  maxSessions: 10_000,
};

// ---------------------------------------------------------------------------
// Issue #1 (PHANTOM_PACKAGE): 'express-async-errors-v2' does not exist
//
// The import at the top of this file pulls in a non-existent package.
// The real package is 'express-async-errors' (no -v2 suffix). This is
// a common AI hallucination -- appending a version suffix to a real name.
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// ---------------------------------------------------------------------------
// Issue #2 (HALLUCINATED_API): Map.prototype.filter() does not exist
// ---------------------------------------------------------------------------

/**
 * Returns all sessions that have not yet expired. Used by the cleanup
 * job and the admin session viewer.
 */
export function getActiveSessions(store: SessionStore): Session[] {
  const now = new Date();

  // BUG: Map.prototype.filter() does not exist in JavaScript.
  // Maps do not have a .filter() method. You need to convert to an array
  // first: Array.from(store.sessions.values()).filter(...)
  const active = store.sessions.filter(
    (_key: string, session: Session) => session.expiresAt > now,
  );

  return Array.from(active.values());
}

/**
 * Adds a session to the store. Evicts the oldest session if the store
 * is at capacity.
 */
export function addSession(store: SessionStore, session: Session): void {
  if (store.sessions.size >= store.maxSessions) {
    // Evict the oldest session by finding the earliest expiresAt
    let oldestKey: string | null = null;
    let oldestExpiry = new Date(8640000000000000); // max date

    for (const [key, s] of store.sessions) {
      if (s.expiresAt < oldestExpiry) {
        oldestExpiry = s.expiresAt;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      store.sessions.delete(oldestKey);
      logger.info("Evicted oldest session", { sessionId: oldestKey });
    }
  }

  store.sessions.set(session.id, session);
}

// ---------------------------------------------------------------------------
// Issue #3 (SECURITY): SQL injection via string interpolation
// ---------------------------------------------------------------------------

/**
 * Looks up a user's session history from the database. Used for the
 * security audit log in the admin panel.
 */
export async function getSessionHistory(
  userId: string,
  ipAddress?: string,
): Promise<Record<string, unknown>[]> {
  // VULNERABILITY: User-supplied values are interpolated directly into the
  // SQL string, allowing SQL injection. Should use parameterized queries:
  //   pool.query('SELECT ... WHERE user_id = $1', [userId])
  let sql = `
    SELECT id, user_id, ip_address, user_agent, created_at, expired_at
    FROM session_history
    WHERE user_id = '${userId}'
  `;

  if (ipAddress) {
    sql += ` AND ip_address = '${ipAddress}'`;
  }

  sql += ` ORDER BY created_at DESC LIMIT 100`;

  try {
    const result = await pool.query(sql);
    return result.rows;
  } catch (err) {
    logger.error("Failed to fetch session history", {
      error: err instanceof Error ? err.message : "Unknown error",
      userId,
    });
    throw new Error("Failed to fetch session history");
  }
}

// ---------------------------------------------------------------------------
// Issue #4 (MISSING_ERROR_HANDLING): JSON.parse on untrusted input
// ---------------------------------------------------------------------------

/**
 * Fetches the user's profile from an external identity provider and
 * returns the parsed profile data.
 */
export async function fetchExternalProfile(
  userId: string,
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${process.env.IDP_BASE_URL}/users/${userId}/profile`,
    {
      headers: {
        Authorization: `Bearer ${process.env.IDP_SERVICE_TOKEN}`,
        Accept: "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Identity provider returned ${response.status}`);
  }

  // BUG: response.text() returns the raw body as a string. If the identity
  // provider returns malformed JSON (e.g., during an outage or if the
  // endpoint changes), JSON.parse will throw an unhandled exception that
  // crashes the request handler.
  //
  // Should wrap in try/catch:
  //   try { return JSON.parse(body); }
  //   catch { throw new Error('Invalid JSON from identity provider'); }
  //
  // Or better yet, use response.json() which at least makes the failure
  // mode more explicit.
  const body = await response.text();
  const profile = JSON.parse(body);

  return profile;
}

// ---------------------------------------------------------------------------
// Route setup
// ---------------------------------------------------------------------------

app.get("/api/sessions/active", async (_req, res) => {
  const active = getActiveSessions(sessionStore);
  res.json({ sessions: active, count: active.length });
});

app.get("/api/sessions/history/:userId", async (req, res) => {
  const history = await getSessionHistory(
    req.params.userId,
    req.query.ip as string | undefined,
  );
  res.json({ history });
});

app.get("/api/users/:userId/external-profile", async (req, res) => {
  const profile = await fetchExternalProfile(req.params.userId);
  res.json({ profile });
});

export default app;
