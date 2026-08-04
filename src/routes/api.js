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
    // Format baru: {raw, parsed}
    if ('raw' in obj || 'parsed' in obj) {
      if (obj.parsed && Object.keys(obj.parsed).length > 0) {
        return `{${Object.entries(obj.parsed).map(([key, val]) => `${key}:${val}`).join(', ')}}`;
      }
      return obj.raw || '';
    }
    // Kompatibilitas data lama (sebelum format {raw,parsed} ada): objek flat key:value
    if (Object.keys(obj).length > 0) {
      return `{${Object.entries(obj).map(([key, val]) => `${key}:${val}`).join(', ')}}`;
    }
    return '';
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

// Jalankan/ulangi migrasi schema database secara manual dari dashboard
// (cadangan kalau auto-migrate saat startup gagal, tanpa perlu akses terminal)
router.post('/run-schema-migration', async (req, res) => {
  const { ensureSchema } = require('../db');
  await ensureSchema();
  res.json({ ok: true, message: 'Schema database berhasil dijalankan/diperbarui.' });
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

  if (!b.nama_account || !b.nama_account.trim()) {
    return res.status(400).json({ error: 'Nama Account wajib diisi.' });
  }
  if (!b.no_hp || !b.no_hp.trim()) {
    return res.status(400).json({ error: 'No HP wajib diisi.' });
  }

  try {
    const { rows } = await pool.query(
      `INSERT INTO devices
        (nama_account, kontak_pemilik, device_name, imei, no_hp, pertama_diisi,
         bayar_1_tahun, setahun_saat, terakhir_diisi, jam_diisi, akan_habis, jumlah_diisi, keterangan_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
        b.nama_account.trim(), b.kontak_pemilik || null, b.device_name || null,
        b.imei || null, b.no_hp.trim(), b.pertama_diisi || null,
        b.bayar_1_tahun || null, b.setahun_saat || null, b.terakhir_diisi || null,
        b.jam_diisi || null, b.akan_habis || null, b.jumlah_diisi || 0, b.keterangan_json || {},
      ]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'IMEI ini sudah dipakai device lain.' });
    }
    throw e;
  }
});

// Update manual field apapun (dibatasi ke kolom yang memang ada, supaya aman)
const ALLOWED_DEVICE_FIELDS = new Set([
  'nama_account', 'kontak_pemilik', 'device_name', 'imei', 'no_hp',
  'pertama_diisi', 'bayar_1_tahun', 'setahun_saat', 'terakhir_diisi',
  'jam_diisi', 'akan_habis', 'jumlah_diisi', 'keterangan_json', 'status',
]);

router.patch('/devices/:id', async (req, res) => {
  const fields = Object.keys(req.body).filter((f) => ALLOWED_DEVICE_FIELDS.has(f));
  if (fields.length === 0) return res.status(400).json({ error: 'Tidak ada field valid untuk diupdate' });

  // Normalisasi string kosong jadi NULL untuk kolom tanggal/waktu, supaya tidak error
  // "invalid input syntax" waktu form dikosongkan
  const values = fields.map((f) => {
    const v = req.body[f];
    return v === '' ? null : v;
  });
  const setClause = fields.map((f, i) => `${f} = $${i + 2}`).join(', ');

  try {
    const { rows } = await pool.query(
      `UPDATE devices SET ${setClause}, updated_at = now() WHERE id = $1 RETURNING *`,
      [req.params.id, ...values]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Device tidak ditemukan' });
    res.json(rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      return res.status(409).json({ error: 'IMEI ini sudah dipakai device lain.' });
    }
    throw e;
  }
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
