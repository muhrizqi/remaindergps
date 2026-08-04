const cron = require('node-cron');
const { sendText } = require('./waha');
const { makeDailyToken } = require('./token');
const {
  getDevicesDueForFillToday,
  getDevicesDueForBillingToday,
  wasNotifiedToday,
  markNotified,
} = require('./deviceService');

const BASE_URL = process.env.BASE_URL;
const ADMIN_WA_NUMBER = process.env.ADMIN_WA_NUMBER;
const AUTO_BILL_CUSTOMER = process.env.AUTO_BILL_CUSTOMER === 'true';

function fmtDate(d) {
  if (!d) return '-';
  return new Date(d).toLocaleDateString('id-ID');
}

async function runDailyCheck() {
  console.log('[cron] Menjalankan pengecekan harian...');

  // 1) Reminder isi pulsa
  const dueFill = await getDevicesDueForFillToday();
  const fillItems = [];
  for (const d of dueFill) {
    if (await wasNotifiedToday(d.id, 'fill_reminder')) continue;
    const token = makeDailyToken(d.id, 'fill');
    const link = `${BASE_URL}/u/${token}`;
    fillItems.push(
      `• *${d.nama_account}* (${d.device_name || '-'})\n  No: ${d.no_hp}\n  IMEI: ${d.imei}\n  Isi ke-${d.jumlah_diisi + 1}\n  Tandai selesai: ${link}`
    );
    await markNotified(d.id, 'fill_reminder');
  }

  if (fillItems.length > 0) {
    const msg =
      `🔋 *Reminder Isi Pulsa GPS - ${fmtDate(new Date())}*\n\n` +
      `Ada ${fillItems.length} device yang perlu diisi pulsa hari ini:\n\n` +
      fillItems.join('\n\n') +
      `\n\nKlik link di atas setelah selesai isi pulsa masing-masing, sistem otomatis update.`;
    await sendText(ADMIN_WA_NUMBER, msg);
  } else {
    console.log('[cron] Tidak ada device yang perlu diisi hari ini.');
  }

  // 2) Reminder billing perpanjangan tahunan
  const dueBilling = await getDevicesDueForBillingToday();
  const billingItems = [];
  for (const d of dueBilling) {
    if (await wasNotifiedToday(d.id, 'billing_reminder')) continue;
    const token = makeDailyToken(d.id, 'paid');
    const link = `${BASE_URL}/u/${token}`;
    billingItems.push(
      `• *${d.nama_account}*\n  Kontak: ${d.kontak_pemilik || '-'}\n  Jumlah diisi: ${d.jumlah_diisi}x | Jatuh tempo: ${fmtDate(d.setahun_saat)}\n  Tandai sudah bayar: ${link}`
    );
    await markNotified(d.id, 'billing_reminder');

    if (AUTO_BILL_CUSTOMER && d.kontak_pemilik) {
      const customerChatId = d.kontak_pemilik.replace(/\D/g, '');
      const custId = customerChatId.startsWith('62')
        ? `${customerChatId}@c.us`
        : `62${customerChatId.replace(/^0/, '')}@c.us`;
      try {
        await sendText(
          custId,
          `Halo, waktunya perpanjangan layanan pulsa GPS untuk device ${d.device_name || d.nama_account}. Mohon konfirmasi pembayaran perpanjangan tahunan ya. Terima kasih 🙏`
        );
      } catch (e) {
        console.error('Gagal kirim tagihan ke customer:', d.nama_account, e.message);
      }
    }
  }

  if (billingItems.length > 0) {
    const msg =
      `💰 *Reminder Tagih Perpanjangan Tahunan - ${fmtDate(new Date())}*\n\n` +
      billingItems.join('\n\n') +
      `\n\nSetelah customer bayar, klik link "Tandai sudah bayar" masing-masing.`;
    await sendText(ADMIN_WA_NUMBER, msg);
  } else {
    console.log('[cron] Tidak ada tagihan perpanjangan hari ini.');
  }
}

function startCron() {
  const schedule = process.env.CRON_SCHEDULE || '0 7 * * *';
  cron.schedule(schedule, runDailyCheck, {
    timezone: process.env.TIMEZONE || 'Asia/Jakarta',
  });
  console.log(`[cron] Terjadwal: "${schedule}" (${process.env.TIMEZONE || 'Asia/Jakarta'})`);
}

module.exports = { startCron, runDailyCheck };
