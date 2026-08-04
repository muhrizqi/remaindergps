const { pool } = require('./db');

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

module.exports = {
  getDevicesDueForFillToday,
  getDevicesDueForBillingToday,
  markFilled,
  markRenewalPaid,
  getDeviceById,
  wasNotifiedToday,
  markNotified,
};
