// db.js — PostgreSQL connection via Cloudflare Hyperdrive (using postgres.js)
import postgres from 'postgres';

/**
 * Convenience wrapper for parameterized queries.
 * Each call creates a fresh connection (Workers I/O isolation).
 * @param {Object} env - Worker env bindings
 * @param {string} sqlText - SQL with $1, $2 placeholders
 * @param {Array} params - Parameter array
 * @returns {Promise<Array>} Result rows
 */
export async function query(env, sqlText, params = []) {
  const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('HYPERDRIVE or DATABASE_URL is not configured');
  }
  const sql = postgres(connectionString, { max: 1 });
  try {
    const result = await sql.unsafe(sqlText, params);
    return result;
  } finally {
    await sql.end();
  }
}

let migrated = false;
export async function ensureMigrations(env) {
  if (migrated) return;
  try {
    const connectionString = env.HYPERDRIVE?.connectionString || env.DATABASE_URL;
    const sql = postgres(connectionString, { max: 1 });
    try {
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS logo_base64 TEXT`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS plan_activo BOOLEAN DEFAULT FALSE`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS fecha_pago TIMESTAMPTZ`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS fecha_expiracion TIMESTAMPTZ`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS paypal_order_id VARCHAR(100)`);
      await sql.unsafe(`ALTER TABLE urbanizaciones ADD COLUMN IF NOT EXISTS monto_pago DECIMAL(10,2)`);
      // Activar urbanizaciones existentes que ya estaban admitidas
      await sql.unsafe(`UPDATE urbanizaciones SET plan_activo = TRUE, fecha_expiracion = NOW() + INTERVAL '1 year' WHERE estado = 'admitida' AND (plan_activo IS FALSE OR plan_activo IS NULL)`);
      migrated = true;
    } finally { await sql.end(); }
  } catch (e) { console.error('Migration error:', e.message); }
}
