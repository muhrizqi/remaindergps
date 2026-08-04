const axios = require('axios');

const WAHA_BASE_URL = process.env.WAHA_BASE_URL;
const WAHA_API_KEY = process.env.WAHA_API_KEY;
const WAHA_SESSION = process.env.WAHA_SESSION || 'default';

/**
 * Kirim pesan teks WhatsApp lewat WAHA.
 * chatId format: 62xxxxxxxxxx@c.us
 */
async function sendText(chatId, text) {
  try {
    const res = await axios.post(
      `${WAHA_BASE_URL}/api/sendText`,
      {
        session: WAHA_SESSION,
        chatId,
        text,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          ...(WAHA_API_KEY ? { 'X-Api-Key': WAHA_API_KEY } : {}),
        },
        timeout: 15000,
      }
    );
    return res.data;
  } catch (err) {
    console.error('Gagal kirim WA:', err.response?.data || err.message);
    throw err;
  }
}

module.exports = { sendText };
