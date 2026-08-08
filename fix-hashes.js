process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');
const crypto = require('crypto');

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return new Promise((resolve, reject) => {
    // 256 BITS = 32 bytes (match Worker's deriveBits(..., 256))
    crypto.pbkdf2(password, salt, 100000, 32, 'sha256', (err, derivedKey) => {
      if (err) reject(err);
      const saltB64 = salt.toString('base64');
      const hashB64 = derivedKey.toString('base64');
      resolve(`${saltB64}:${hashB64}`);
    });
  });
}

async function main() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/nassau_ph'
  });
  await client.connect();

  const hash = await hashPassword('Nassau2026!');
  console.log('Hash:', hash);

  await client.query('UPDATE usuarios SET password_hash = $1', [hash]);
  console.log('✅ Contraseñas actualizadas');

  await client.end();
}

main().catch(e => { console.error(e.message); process.exit(1); });
