// db.js — PostgreSQL connection via Cloudflare Hyperdrive (using postgres.js)
import postgres from 'postgres';

let sql;

/**
 * Returns a postgres.js client connected via Hyperdrive.
 */
function getClient(env) {
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('HYPERDRIVE or DATABASE_URL is not configured');
  }
  if (!sql) {
    sql = postgres(connectionString, { ssl: 'require' });
  }
  return sql;
}

/**
 * Convenience wrapper for parameterized queries.
 * @param {Object} env - Worker env bindings
 * @param {string} sqlText - SQL with $1, $2 placeholders
 * @param {Array} params - Parameter array
 * @returns {Promise<Array>} Result rows
 */
export async function query(env, sqlText, params = []) {
  const client = getClient(env);
  const result = await client.unsafe(sqlText, params);
  return result;
}
