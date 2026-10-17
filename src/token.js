const jwt = require('jsonwebtoken');

const { todayStr, nowTimeStr } = require('./time');

const SECRET = process.env.JWT_SECRET;

function secondsUntilEndOfDay() {
  // sampai akhir hari menurut zona waktu bisnis (bukan zona server)
  const [h, m, sec] = nowTimeStr().split(':').map(Number);
  return 86400 - (h * 3600 + m * 60 + sec) + 60;
}

/**
 * Token untuk satu device + satu aksi (dipakai buat link billing "tandai sudah bayar")
 * Berlaku sampai akhir hari ini.
 */
function makeDailyToken(deviceId, action) {
  return jwt.sign({ deviceId, action }, SECRET, { expiresIn: secondsUntilEndOfDay() });
}

/**
 * Token untuk SATU LINK yang mewakili banyak device sekaligus
 * (dipakai buat reminder isi pulsa harian - satu link, semua nomor jatuh tempo hari itu)
 * Berlaku sampai akhir hari ini.
 */
function makeBatchToken(deviceIds) {
  return jwt.sign(
    { type: 'fill_batch', deviceIds, date: todayStr() },
    SECRET,
    { expiresIn: secondsUntilEndOfDay() }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws jika invalid/expired
}

module.exports = { makeDailyToken, makeBatchToken, verifyToken };
