require('dotenv').config();
require('express-async-errors'); // supaya error di async route ditangkap, bukan bikin server crash
const express = require('express');
const path = require('path');
const session = require('express-session');

const apiRoutes = require('./routes/api');
const updateRoutes = require('./routes/update');
const authRoutes = require('./routes/auth');
const { requireAuth } = require('./middleware/auth');
const { startCron } = require('./cron');
const { ensureSchema } = require('./db');

const app = express();
app.set('trust proxy', 1); // penting kalau di belakang reverse proxy (Coolify/Traefik) supaya cookie secure jalan

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || process.env.JWT_SECRET || 'ganti-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 hari
    },
  })
);

// Route login/logout/lupa-password TIDAK butuh auth
app.use('/', authRoutes);

// Magic-link dari WA (pakai token sendiri, bukan session) TIDAK butuh auth
app.use(updateRoutes);

// Health check untuk Coolify/Docker - HARUS bisa diakses tanpa login
app.get('/health', (req, res) => res.json({ ok: true }));

// Semua di bawah ini WAJIB login
app.use('/api', requireAuth, apiRoutes);
app.use(requireAuth, express.static(path.join(__dirname, '..', 'public')));

app.get('/', requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'dashboard.html'));
});

// Error handler global - supaya error apapun (misal koneksi DB putus) balas JSON/500
// dan TIDAK mematikan seluruh server
app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Terjadi kesalahan di server. Coba lagi sebentar.' });
});

// Jaga-jaga tambahan: kalau ada promise rejection yang lolos, jangan sampai crash proses
process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});

const PORT = process.env.PORT || 3000;

// Jalankan migrasi schema database otomatis tiap kali server start.
// Aman diulang - schema.sql pakai CREATE TABLE IF NOT EXISTS.
// Ini menghindari kebutuhan akses terminal manual (misal kalau terminal Coolify bermasalah).
async function start() {
  try {
    await ensureSchema();
    console.log('[startup] Schema database siap.');
  } catch (e) {
    console.error('[startup] Gagal menjalankan schema database:', e.message);
    console.error('[startup] Server tetap jalan, tapi fitur yang butuh DB kemungkinan error sampai ini diperbaiki.');
  }

  app.listen(PORT, () => {
    console.log(`Server jalan di port ${PORT}`);
    startCron();
  });
}

start();
