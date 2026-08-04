const express = require('express');
const router = express.Router();
const { verifyToken, makeDailyToken } = require('../token');
const {
  getDeviceById,
  markFilled,
  markRenewalPaid,
} = require('../deviceService');

// Halaman konfirmasi (dibuka dari link di WA)
router.get('/u/:token', async (req, res) => {
  let payload;
  try {
    payload = verifyToken(req.params.token);
  } catch (e) {
    return res.status(400).send(renderPage('Link tidak valid atau sudah kedaluwarsa.', true));
  }

  const device = await getDeviceById(payload.deviceId);
  if (!device) return res.status(404).send(renderPage('Device tidak ditemukan.', true));

  const actionLabel = payload.action === 'fill' ? 'Tandai sudah isi pulsa' : 'Tandai sudah bayar perpanjangan';

  res.send(`
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Update Device</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;max-width:420px;margin:0 auto;background:#f6f7f9}
      .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 4px rgba(0,0,0,.08)}
      h2{margin-top:0} .field{margin:6px 0;color:#333}
      button{width:100%;padding:14px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:16px;margin-top:16px}
    </style></head>
    <body>
      <div class="card">
        <h2>${device.nama_account}</h2>
        <div class="field">Device: ${device.device_name || '-'}</div>
        <div class="field">No HP: ${device.no_hp}</div>
        <div class="field">IMEI: ${device.imei}</div>
        <div class="field">Jumlah diisi saat ini: ${device.jumlah_diisi}</div>
        <form method="POST" action="/u/${req.params.token}/confirm">
          <button type="submit">${actionLabel}</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

// Konfirmasi update
router.post('/u/:token/confirm', async (req, res) => {
  let payload;
  try {
    payload = verifyToken(req.params.token);
  } catch (e) {
    return res.status(400).send(renderPage('Link tidak valid atau sudah kedaluwarsa.', true));
  }

  const device = await getDeviceById(payload.deviceId);
  if (!device) return res.status(404).send(renderPage('Device tidak ditemukan.', true));

  if (payload.action === 'fill') {
    await markFilled(payload.deviceId);
    return res.send(renderPage(`✅ ${device.nama_account} berhasil ditandai sudah diisi pulsa hari ini.`));
  } else {
    await markRenewalPaid(payload.deviceId);
    return res.send(renderPage(`✅ ${device.nama_account} berhasil ditandai sudah bayar perpanjangan tahunan. Siklus direset.`));
  }
});

function renderPage(message, isError = false) {
  return `
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Update Device</title>
    <style>
      body{font-family:system-ui,sans-serif;padding:24px;max-width:420px;margin:0 auto;background:#f6f7f9}
      .card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}
      .msg{font-size:16px;color:${isError ? '#dc2626' : '#16a34a'}}
    </style></head>
    <body><div class="card"><p class="msg">${message}</p></div></body>
    </html>
  `;
}

module.exports = router;
