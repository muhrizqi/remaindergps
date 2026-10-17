// Tanggal & jam mengikuti zona waktu bisnis (TIMEZONE, default Asia/Jakarta),
// bukan zona waktu server (container biasanya UTC).
function tz() {
  return process.env.TIMEZONE || 'Asia/Jakarta';
}

function todayStr(date = new Date()) {
  // en-CA menghasilkan YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz(),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function nowTimeStr(date = new Date()) {
  // HH:MM:SS
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz(),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

module.exports = { todayStr, nowTimeStr };
