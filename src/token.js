const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

function secondsUntilEndOfDay() {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  return Math.floor((endOfDay.getTime() - Date.now()) / 1000) + 60;
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
    { type: 'fill_batch', deviceIds, date: new Date().toISOString().slice(0, 10) },
    SECRET,
    { expiresIn: secondsUntilEndOfDay() }
  );
}

function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws jika invalid/expired
}

module.exports = { makeDailyToken, makeBatchToken, verifyToken };
