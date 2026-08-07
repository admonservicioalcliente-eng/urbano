// db.js — Neon PostgreSQL connection (edge-compatible via HTTP/WebSocket)
import { neon } from '@neondatabase/serverless';

/**
 * Returns a tagged-template SQL executor bound to the DATABASE_URL secret.
 * Usage: const sql = getDB(env); const rows = await sql`SELECT * FROM propietarios`;
 */
export function getDB(env) {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL secret is not configured. Run: wrangler secret put DATABASE_URL');
  }
  return neon(env.DATABASE_URL);
}

/**
 * Convenience wrapper for parameterized queries.
 * @param {Object} env - Worker env bindings
 * @param {string} sqlText - SQL with $1, $2 placeholders
 * @param {Array} params - Parameter array
 * @returns {Promise<Array>} Result rows
 */
export async function query(env, sqlText, params = []) {
  const sql = getDB(env);
  // neon() tagged template doesn't support raw strings directly,
  // so we use neon(url) with the query method pattern
  const db = neon(env.DATABASE_URL);
  return await db(sqlText, params);
}
