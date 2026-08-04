const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Jalankan schema.sql - aman dipanggil berkali-kali (pakai IF NOT EXISTS)
async function ensureSchema() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { pool, ensureSchema };

// Tetap bisa dipanggil manual lewat CLI: node src/db.js  (atau npm run migrate:schema)
if (require.main === module) {
  require('dotenv').config();
  ensureSchema()
    .then(() => {
      console.log('Schema berhasil dijalankan.');
      process.exit(0);
    })
    .catch((e) => {
      console.error('Gagal menjalankan schema:', e.message);
      process.exit(1);
    });
}
