const express = require('express');
const router = express.Router();
const { sendText } = require('../waha');

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'abcd1234';
const ADMIN_WA_NUMBER = process.env.ADMIN_WA_NUMBER;

// Rate-limit sederhana untuk tombol lupa password (in-memory, cukup buat single-admin tool)
let lastForgotSentAt = 0;
const FORGOT_COOLDOWN_MS = 60 * 1000; // 1 menit

router.get('/login', (req, res) => {
  if (req.session && req.session.loggedIn) return res.redirect('/');
  res.sendFile('login.html', { root: require('path').join(__dirname, '..', '..', 'public') });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
    req.session.loggedIn = true;
    req.session.username = username;
    return res.json({ ok: true });
  }
  return res.status(401).json({ ok: false, error: 'Username atau password salah.' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.post('/forgot-password', async (req, res) => {
  if (!ADMIN_WA_NUMBER) {
    return res.status(500).json({ ok: false, error: 'ADMIN_WA_NUMBER belum diset di server.' });
  }

  const now = Date.now();
  if (now - lastForgotSentAt < FORGOT_COOLDOWN_MS) {
    return res.status(429).json({ ok: false, error: 'Tunggu sebentar sebelum kirim ulang.' });
  }
  lastForgotSentAt = now;

  try {
    await sendText(
      ADMIN_WA_NUMBER,
      `🔑 *Info Login Dashboard Pulsa GPS*\n\nUsername: ${ADMIN_USERNAME}\nPassword: ${ADMIN_PASSWORD}\n\nJangan bagikan info ini ke siapapun.`
    );
    res.json({ ok: true, message: 'Info login sudah dikirim ke WhatsApp admin.' });
  } catch (e) {
    res.status(500).json({ ok: false, error: 'Gagal kirim WA. Cek koneksi WAHA.' });
  }
});

module.exports = router;
