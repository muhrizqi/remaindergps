const { pool, SQL_NORM_PHONE } = require('./db');

// Samakan format No HP supaya "0812-3456", "+62 812 3456", dan "628123456" dianggap sama.
// Harus sama dengan SQL_NORM_PHONE di db.js.
function normalizePhone(v) {
  const digits = String(v == null ? '' : v).replace(/\D/g, '');
  return digits.startsWith('62') ? '0' + digits.slice(2) : digits;
}

// IMEI kosong ('' atau spasi) dianggap tidak ada -> disimpan NULL, tidak ikut aturan unik
function normalizeImei(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

// Cari device LAIN (selain excludeId) yang sudah memakai No HP ini
async function findPhoneConflict(noHp, excludeId = null) {
  const norm = normalizePhone(noHp);
  if (!norm) return null;
  const { rows } = await pool.query(
    `SELECT id, nama_account, device_name, status FROM devices
     WHERE ${SQL_NORM_PHONE} = $1 AND ($2::int IS NULL OR id <> $2::int)
     ORDER BY id LIMIT 1`,
    [norm, excludeId]
  );
  return rows[0] || null;
}

// Cari device LAIN (selain excludeId) yang sudah memakai IMEI ini
async function findImeiConflict(imei, excludeId = null) {
  const val = normalizeImei(imei);
  if (!val) return null;
  const { rows } = await pool.query(
    `SELECT id, nama_account, device_name, status FROM devices
     WHERE imei = $1 AND ($2::int IS NULL OR id <> $2::int)
     ORDER BY id LIMIT 1`,
    [val, excludeId]
  );
  return rows[0] || null;
}

async function findDeviceByImei(imei) {
  const val = normalizeImei(imei);
  if (!val) return null;
  const { rows } = await pool.query('SELECT * FROM devices WHERE imei = $1 LIMIT 1', [val]);
  return rows[0] || null;
}

async function findDeviceByPhone(noHp) {
  const norm = normalizePhone(noHp);
  if (!norm) return null;
  const { rows } = await pool.query(
    `SELECT * FROM devices WHERE ${SQL_NORM_PHONE} = $1 ORDER BY id LIMIT 1`,
    [norm]
  );
  return rows[0] || null;
}

// Teks pendek untuk pesan peringatan: "premio2 (Innova AB1540SM)"
function describeDevice(d) {
  const nama = d.nama_account || 'customer lain';
  const extra = d.device_name ? ` (${d.device_name})` : '';
  return `${nama}${extra}${d.status === 'nonactive' ? ' [nonaktif]' : ''}`;
}

const FILL_CYCLE_DAYS = parseInt(process.env.FILL_CYCLE_DAYS || '28', 10);
const MAX_FILL_COUNT = parseInt(process.env.MAX_FILL_COUNT || '13', 10);

function todayStr() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// Device yang harus diisi pulsa hari ini: akan_habis <= hari ini, status active
async function getDevicesDueForFillToday() {
  const { rows } = await pool.query(
    `SELECT * FROM devices
     WHERE status = 'active'
       AND akan_habis <= $1
     ORDER BY nama_account`,
    [todayStr()]
  );
  return rows;
}

// Device yang perlu ditagih perpanjangan tahunan hari ini:
// jumlah_diisi sudah mencapai batas ATAU setahun_saat sudah jatuh tempo
async function getDevicesDueForBillingToday() {
  const { rows } = await pool.query(
    `SELECT * FROM devices
     WHERE status = 'active'
       AND (jumlah_diisi >= $1 OR setahun_saat <= $2)
     ORDER BY nama_account`,
    [MAX_FILL_COUNT, todayStr()]
  );
  return rows;
}

// Tandai device sudah diisi pulsa hari ini
async function markFilled(deviceId) {
  const now = new Date();
  const time = now.toTimeString().slice(0, 8); // HH:MM:SS
  const today = todayStr();

  const { rows } = await pool.query(
    `UPDATE devices
     SET terakhir_diisi = $1,
         jam_diisi = $2,
         jumlah_diisi = jumlah_diisi + 1,
         akan_habis = ($1::date + ($3 || ' days')::interval)::date,
         updated_at = now()
     WHERE id = $4
     RETURNING *`,
    [today, time, FILL_CYCLE_DAYS, deviceId]
  );

  if (rows[0]) {
    await pool.query(
      `INSERT INTO fill_logs (device_id, action, action_date, action_time)
       VALUES ($1, 'fill', $2, $3)`,
      [deviceId, today, time]
    );
  }
  return rows[0];
}

// Tandai device sudah bayar perpanjangan tahunan (reset siklus)
async function markRenewalPaid(deviceId) {
  const today = todayStr();

  const { rows } = await pool.query(
    `UPDATE devices
     SET bayar_1_tahun = $1,
         setahun_saat = ($1::date + interval '1 year')::date,
         jumlah_diisi = 1,
         updated_at = now()
     WHERE id = $2
     RETURNING *`,
    [today, deviceId]
  );

  if (rows[0]) {
    await pool.query(
      `INSERT INTO fill_logs (device_id, action, action_date, note)
       VALUES ($1, 'renew_payment', $2, 'Perpanjangan tahunan dibayar')`,
      [deviceId, today]
    );
  }
  return rows[0];
}

async function getDeviceById(id) {
  const { rows } = await pool.query('SELECT * FROM devices WHERE id = $1', [id]);
  return rows[0];
}

async function wasNotifiedToday(deviceId, notifType) {
  const { rows } = await pool.query(
    `SELECT 1 FROM notification_logs WHERE device_id = $1 AND notif_type = $2 AND sent_date = $3`,
    [deviceId, notifType, todayStr()]
  );
  return rows.length > 0;
}

async function markNotified(deviceId, notifType) {
  await pool.query(
    `INSERT INTO notification_logs (device_id, notif_type, sent_date)
     VALUES ($1, $2, $3)
     ON CONFLICT (device_id, notif_type, sent_date) DO NOTHING`,
    [deviceId, notifType, todayStr()]
  );
}

// Cek apakah semua device dalam daftar ID ini sudah diisi HARI INI
async function areAllFilledToday(deviceIds) {
  if (!deviceIds || deviceIds.length === 0) return false;
  const { rows } = await pool.query(
    `SELECT count(*)::int AS cnt FROM devices WHERE id = ANY($1::int[]) AND terakhir_diisi = $2`,
    [deviceIds, todayStr()]
  );
  return rows[0].cnt >= deviceIds.length;
}

// Coba catat "event harian" (misal ucapan terima kasih) - hanya berhasil sekali per hari.
// Return true kalau ini adalah yang pertama kali (jadi WA boleh dikirim),
// false kalau sudah pernah tercatat sebelumnya (jangan kirim WA lagi).
async function tryClaimDailyEvent(eventType) {
  const { rowCount } = await pool.query(
    `INSERT INTO daily_events (event_date, event_type) VALUES ($1, $2)
     ON CONFLICT (event_date, event_type) DO NOTHING`,
    [todayStr(), eventType]
  );
  return rowCount > 0;
}

async function getDevicesByIds(deviceIds) {
  if (!deviceIds || deviceIds.length === 0) return [];
  const { rows } = await pool.query(
    `SELECT * FROM devices WHERE id = ANY($1::int[]) ORDER BY nama_account`,
    [deviceIds]
  );
  return rows;
}

module.exports = {
  getDevicesDueForFillToday,
  getDevicesDueForBillingToday,
  markFilled,
  markRenewalPaid,
  getDeviceById,
  wasNotifiedToday,
  markNotified,
  areAllFilledToday,
  tryClaimDailyEvent,
  getDevicesByIds,
  normalizePhone,
  normalizeImei,
  findPhoneConflict,
  findImeiConflict,
  findDeviceByImei,
  findDeviceByPhone,
  describeDevice,
};
