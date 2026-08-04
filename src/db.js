const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Schema berhasil dijalankan.');
  process.exit(0);
}

module.exports = { pool, runSchema };

if (require.main === module) {
  runSchema();
}
