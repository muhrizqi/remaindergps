const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Ekspresi SQL untuk menormalkan No HP: buang semua selain angka, lalu awalan 62 jadi 0.
// Jadi "0812-3456", "+62 812 3456", dan "62812 3456" dianggap nomor yang sama.
// Harus sama persis dengan normalizePhone() di deviceService.js.
const SQL_NORM_PHONE = `regexp_replace(regexp_replace(no_hp, '\\D', '', 'g'), '^62', '0')`;

// Jalankan schema.sql - aman dipanggil berkali-kali (pakai IF NOT EXISTS).
// Mengembalikan { warnings: [...] } untuk hal yang perlu diketahui admin tapi tidak fatal.
async function ensureSchema() {
  const warnings = [];
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);

  // Unique index No HP (versi ternormalisasi). Dibuat terpisah dari schema.sql karena kalau
  // data lama sudah ada nomor kembar, pembuatan index gagal - dan itu tidak boleh
  // menggagalkan seluruh migrasi. Validasi di aplikasi tetap jalan walau index gagal dibuat.
  try {
    await pool.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_devices_no_hp_norm ON devices ((${SQL_NORM_PHONE}))`
    );
  } catch (e) {
    let detail = '';
    try {
      const { rows } = await pool.query(
        `SELECT ${SQL_NORM_PHONE} AS nomor, string_agg(nama_account, ', ') AS pemilik
         FROM devices GROUP BY 1 HAVING count(*) > 1`
      );
      detail = rows.map((r) => `${r.nomor} (${r.pemilik})`).join('; ');
    } catch (_) { /* abaikan */ }
    warnings.push(
      'Index unik No HP belum bisa dibuat karena ada No HP kembar di data lama' +
        (detail ? `: ${detail}` : '') +
        '. Rapikan datanya lewat tombol Edit, lalu jalankan "Perbaiki Database" lagi.'
    );
  }

  return { warnings };
}

module.exports = { pool, ensureSchema, SQL_NORM_PHONE };

// Tetap bisa dipanggil manual lewat CLI: node src/db.js  (atau npm run migrate:schema)
if (require.main === module) {
  require('dotenv').config();
  ensureSchema()
    .then(({ warnings }) => {
      console.log('Schema berhasil dijalankan.');
      warnings.forEach((w) => console.warn('[peringatan]', w));
      process.exit(0);
    })
    .catch((e) => {
      console.error('Gagal menjalankan schema:', e.message);
      process.exit(1);
    });
}
