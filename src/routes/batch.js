const express = require('express');
const router = express.Router();
const { verifyToken } = require('../token');
const { sendText } = require('../waha');
const {
  getDevicesByIds,
  markFilled,
  areAllFilledToday,
  tryClaimDailyEvent,
} = require('../deviceService');

const ADMIN_WA_NUMBER = process.env.ADMIN_WA_NUMBER;

function renderBatchPage(token, devices) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const items = devices
    .map((d) => {
      const done = d.terakhir_diisi && String(d.terakhir_diisi).slice(0, 10) === todayStr;
      return `
        <div class="item" id="item-${d.id}">
          <div class="info">
            <div class="name">${d.nama_account}</div>
            <div class="sub">${d.device_name || '-'} • ${d.no_hp}</div>
          </div>
          <button
            id="btn-${d.id}"
            class="btn ${done ? 'done' : ''}"
            ${done ? 'disabled' : ''}
            onclick="markDone(${d.id})"
          >${done ? '✅ Sudah Diisi' : 'Tandai Selesai'}</button>
        </div>`;
    })
    .join('');

  return `
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Isi Pulsa Hari Ini</title>
      <style>
        body{font-family:system-ui,sans-serif;padding:16px;max-width:480px;margin:0 auto;background:#f6f7f9}
        h2{margin:4px 0 4px}
        p.sub-header{color:#6b7280;font-size:13px;margin:0 0 16px}
        .item{background:#fff;border-radius:12px;padding:14px 16px;margin-bottom:10px;
              display:flex;justify-content:space-between;align-items:center;
              box-shadow:0 1px 4px rgba(0,0,0,.06);transition:opacity .2s}
        .info .name{font-weight:600;color:#111827}
        .info .sub{font-size:13px;color:#6b7280;margin-top:2px}
        .btn{padding:10px 14px;border:none;border-radius:8px;background:#16a34a;color:#fff;
             font-size:13px;cursor:pointer;white-space:nowrap}
        .btn.done{background:#d1fae5;color:#16a34a;cursor:default}
        .btn:disabled{opacity:.9}
        #banner{display:none;background:#dcfce7;color:#16a34a;padding:12px 16px;border-radius:10px;
                margin-bottom:14px;text-align:center;font-weight:600}
      </style>
    </head>
    <body>
      <h2>🔋 Isi Pulsa Hari Ini</h2>
      <p class="sub-header">Tandai satu-satu setelah selesai diisi, supaya tidak keliru isi dua kali.</p>
      <div id="banner">🎉 Semua nomor sudah diisi hari ini!</div>
      <div id="list">${items}</div>

      <script>
        async function markDone(id) {
          const btn = document.getElementById('btn-' + id);
          btn.disabled = true;
          btn.textContent = 'Menyimpan...';
          try {
            const res = await fetch('/batch/${token}/mark/' + id, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) {
              alert(data.error || 'Gagal menandai.');
              btn.disabled = false;
              btn.textContent = 'Tandai Selesai';
              return;
            }
            btn.classList.add('done');
            btn.textContent = '✅ Sudah Diisi';
            if (data.allDone) {
              document.getElementById('banner').style.display = 'block';
            }
          } catch (e) {
            alert('Gagal menghubungi server.');
            btn.disabled = false;
            btn.textContent = 'Tandai Selesai';
          }
        }
      </script>
    </body>
    </html>
  `;
}

router.get('/batch/:token', async (req, res) => {
  let payload;
  try {
    payload = verifyToken(req.params.token);
  } catch (e) {
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px;color:#dc2626">Link tidak valid atau sudah kedaluwarsa.</p>');
  }
  if (payload.type !== 'fill_batch') {
    return res.status(400).send('<p style="font-family:sans-serif;padding:24px;color:#dc2626">Link tidak valid.</p>');
  }

  const devices = await getDevicesByIds(payload.deviceIds);
  res.send(renderBatchPage(req.params.token, devices));
});

router.post('/batch/:token/mark/:deviceId', async (req, res) => {
  let payload;
  try {
    payload = verifyToken(req.params.token);
  } catch (e) {
    return res.status(400).json({ error: 'Link tidak valid atau sudah kedaluwarsa.' });
  }
  if (payload.type !== 'fill_batch') {
    return res.status(400).json({ error: 'Link tidak valid.' });
  }

  const deviceId = parseInt(req.params.deviceId, 10);
  if (!payload.deviceIds.includes(deviceId)) {
    return res.status(403).json({ error: 'Device ini bukan bagian dari link ini.' });
  }

  await markFilled(deviceId);

  const allDone = await areAllFilledToday(payload.deviceIds);
  if (allDone) {
    const firstClaim = await tryClaimDailyEvent('fill_all_done_thank_you');
    if (firstClaim && ADMIN_WA_NUMBER) {
      try {
        await sendText(
          ADMIN_WA_NUMBER,
          `🎉 Terima kasih! Semua ${payload.deviceIds.length} nomor sudah diisi pulsa hari ini.`
        );
      } catch (e) {
        console.error('Gagal kirim WA ucapan terima kasih:', e.message);
      }
    }
  }

  res.json({ ok: true, allDone });
});

module.exports = router;
