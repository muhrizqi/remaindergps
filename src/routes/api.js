const express = require('express');
const router = express.Router();
const { pool } = require('../db');
const {
  getDevicesDueForFillToday,
  getDevicesDueForBillingToday,
  markFilled,
  markRenewalPaid,
} = require('../deviceService');
const { runDailyCheck } = require('../cron');

// List semua device
router.get('/devices', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM devices ORDER BY nama_account');
  res.json(rows);
});

// Detail device
router.get('/devices/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Tidak ditemukan' });
  res.json(rows[0]);
});

// Buat device baru (manual, di luar import Excel)
router.post('/devices', async (req, res) => {
  const b = req.body;
  const { rows } = await pool.query(
    `INSERT INTO devices
      (nama_account, kontak_pemilik, device_name, imei, no_hp, pertama_diisi,
       bayar_1_tahun, setahun_saat, terakhir_diisi, jam_diisi, akan_habis, jumlah_diisi, keterangan_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     RETURNING *`,
    [
      b.nama_account, b.kontak_pemilik, b.device_name, b.imei, b.no_hp,
      b.pertama_diisi, b.bayar_1_tahun, b.setahun_saat, b.terakhir_diisi,
      b.jam_diisi, b.akan_habis, b.jumlah_diisi || 0, b.keterangan_json || {},
    ]
  );
  res.status(201).json(rows[0]);
});

// Update manual field apapun
router.patch('/devices/:id', async (req, res) => {
  const fields = Object.keys(req.body);
  if (fields.length === 0) return res.status(400).json({ error: 'Tidak ada field untuk diupdate' });

  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');
  const values = fields.map((f) => req.body[f]);

  const { rows } = await pool.query(
    `UPDATE devices SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
    [req.params.id, ...values]
  );
  res.json(rows[0]);
});

// Hapus / nonaktifkan device
router.delete('/devices/:id', async (req, res) => {
  await pool.query(`UPDATE devices SET status = 'nonactive' WHERE id = $1`, [req.params.id]);
  res.json({ ok: true });
});

// Lihat daftar due hari ini (dashboard)
router.get('/due/fill', async (req, res) => res.json(await getDevicesDueForFillToday()));
router.get('/due/billing', async (req, res) => res.json(await getDevicesDueForBillingToday()));

// Tandai manual dari dashboard (tanpa link WA)
router.post('/devices/:id/mark-filled', async (req, res) => res.json(await markFilled(req.params.id)));
router.post('/devices/:id/mark-paid', async (req, res) => res.json(await markRenewalPaid(req.params.id)));

// Trigger ulang pengecekan & kirim notifikasi WA manual (testing / kalau cron kelewat)
router.post('/run-check', async (req, res) => {
  await runDailyCheck();
  res.json({ ok: true });
});

module.exports = router;
