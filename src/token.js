const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;

/**
 * Token berlaku sampai akhir hari ini (dipakai untuk link "tandai selesai" harian)
 */
function makeDailyToken(deviceId, action) {
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const expiresInSec = Math.floor((endOfDay.getTime() - Date.now()) / 1000) + 60;

  return jwt.sign({ deviceId, action }, SECRET, { expiresIn: expiresInSec });
}

function verifyToken(token) {
  return jwt.verify(token, SECRET); // throws jika invalid/expired
}

module.exports = { makeDailyToken, verifyToken };
