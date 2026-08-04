const express = require('express');
const router = express.Router();
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pool } = require('../db');
const {
  getDevicesDueForFillToday,
  getDevicesDueForBillingToday,
  markFilled,
  markRenewalPaid,
} = require('../deviceService');
const { runDailyCheck } = require('../cron');
const { importFromExcel } = require('../migrate-excel');

const upload = multer({ dest: os.tmpdir() });

// Cek nama-nama sheet dalam file Excel yang baru diupload (dipakai dashboard
// buat nampilin pilihan sheet sebelum user klik "Import")
router.post('/import-excel/sheets', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.readFile(req.file.path, { bookSheets: true });
    res.json({ sheetNames: wb.SheetNames, tempPath: req.file.path, originalName: req.file.originalname });
  } catch (e) {
    fs.unlink(req.file.path, () => {});
    res.status(400).json({ error: 'Gagal membaca file: ' + e.message });
  }
});

// Import Excel langsung dari dashboard
router.post('/import-excel', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
  const sheetName = req.body.sheetName || null;
  try {
    const result = await importFromExcel(req.file.path, sheetName);
    res.json(result);
  } catch (e) {
    res.status(400).json({ error: 'Import gagal: ' + e.message });
  } finally {
    fs.unlink(req.file.path, () => {});
  }
});

// Export semua data device jadi file Excel (header sama seperti Excel lama)
router.get('/export-excel', async (req, res) => {
  const XLSX = require('xlsx');
  const { rows } = await pool.query('SELECT * FROM devices ORDER BY nama_account');

  const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-US') : ''); // M/D/YYYY, sama seperti format asal
  const fmtTime = (t) => (t ? String(t).slice(0, 5) : ''); // HH:MM
  const fmtKeterangan = (k) => {
    if (!k) return '';
    const obj = typeof k === 'string' ? JSON.parse(k) : k;
    return `{${Object.entries(obj).map(([key, val]) => `${key}:${val}`).join(', ')}}`;
  };

  const exportRows = rows.map((d, i) => ({
    No: i + 1,
    'nama account': d.nama_account || '',
    'Kontak Pemilik': d.kontak_pemilik || '',
    'Device Name': d.device_name || '',
    imei: d.imei || '',
    'no hp': d.no_hp || '',
    'pertama diisi': fmtDate(d.pertama_diisi),
    'Bayar 1 Tahun': fmtDate(d.bayar_1_tahun),
    'setahun saat': fmtDate(d.setahun_saat),
    'terakhir diisi': fmtDate(d.terakhir_diisi),
    'jam diisi': fmtTime(d.jam_diisi),
    'akan habis': fmtDate(d.akan_habis),
    'jumlah diisi': d.jumlah_diisi,
    Keterangan: fmtKeterangan(d.keterangan_json),
  }));

  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws['!cols'] = [
    { wch: 5 }, { wch: 22 }, { wch: 15 }, { wch: 14 }, { wch: 18 }, { wch: 15 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 9 }, { wch: 12 },
    { wch: 12 }, { wch: 40 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Data GPS Pulsa');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  const filename = `data-pulsa-gps-${new Date().toISOString().slice(0, 10)}.xlsx`;

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
});

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
