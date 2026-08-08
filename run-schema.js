process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'postgresql://localhost:5432/nassau_ph';

async function runSQL(client, filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  console.log(`\nEjecutando: ${path.basename(filePath)}...`);
  try {
    await client.query(sql);
    console.log(`✅ ${path.basename(filePath)} ejecutado correctamente`);
  } catch (err) {
    console.error(`❌ Error en ${path.basename(filePath)}:`, err.message);
  }
}

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  console.log('✅ Conectado a Aiven PostgreSQL');

  await runSQL(client, path.join(__dirname, 'database', 'schema.sql'));
  await runSQL(client, path.join(__dirname, 'database', 'seeds.sql'));

  // Verificar tablas
  const tablas = await client.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
  );
  console.log('\n📋 Tablas creadas:');
  tablas.rows.forEach(r => console.log(`   - ${r.table_name}`));

  await client.end();
  console.log('\n✅ Listo');
}

main().catch(e => {
  console.error('❌ ERROR:', e.message);
  process.exit(1);
});
