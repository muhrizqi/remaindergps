const XLSX = require('xlsx');
const { pool } = require('./db');
const {
  normalizeImei,
  findDeviceByImei,
  findDeviceByPhone,
  findPhoneConflict,
  describeDevice,
} = require('./deviceService');

function excelDateToISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    const d = XLSX.SSF.parse_date_code(val);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (m) {
      const [, mo, da, yr] = m;
      return `${yr}-${mo.padStart(2, '0')}-${da.padStart(2, '0')}`;
    }
  }
  return null;
}

function excelTimeToStr(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toTimeString().slice(0, 8);
  }
  if (typeof val === 'string') {
    const m = val.trim().match(/^(\d{1,2}):(\d{2})(:(\d{2}))?$/);
    if (m) return `${m[1].padStart(2, '0')}:${m[2]}:${m[4] || '00'}`;
  }
  if (typeof val === 'number') {
    const totalSec = Math.round(val * 86400);
    const h = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return null;
}

// Simpan Keterangan sebagai {raw, parsed}:
// - raw: teks aslinya persis seperti di Excel (misal "Pasang baru+1tahun")
// - parsed: kalau formatnya kredensial "{u:xxx, pe:yyy, p:zzz}", ini berisi key:value-nya
// Ini supaya catatan bebas (paling umum di data asli) TIDAK hilang seperti sebelumnya,
// tapi kredensial akun tracker tetap bisa diambil terpisah kalau formatnya cocok.
function parseKeterangan(val) {
  if (!val || typeof val !== 'string') return { raw: '', parsed: {} };
  const raw = val.trim();

  // Hanya dianggap "kredensial terstruktur" kalau dibungkus {} DAN semua bagian
  // yang dipisah koma punya pola key:value
  if (raw.startsWith('{') && raw.endsWith('}')) {
    const inner = raw.slice(1, -1);
    const parts = inner.split(',');
    const parsed = {};
    const allLookLikeKeyValue = parts.every((p) => p.includes(':'));
    if (allLookLikeKeyValue) {
      parts.forEach((pair) => {
        const idx = pair.indexOf(':');
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) parsed[key] = value;
      });
      if (Object.keys(parsed).length > 0) {
        return { raw, parsed };
      }
    }
  }

  return { raw, parsed: {} };
}

/**
 * Import data dari file Excel ke tabel devices.
 * @param {string} filePath - path file .xlsx di disk
 * @param {string|null} sheetName - nama sheet, default sheet pertama
 * @returns {Promise<{inserted:number, updated:number, skipped:number, errors:string[], warnings:string[], sheetNames:string[]}>}
 */
async function importFromExcel(filePath, sheetName = null) {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[sheetName || wb.SheetNames[0]];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" tidak ditemukan. Sheet tersedia: ${wb.SheetNames.join(', ')}`);
  }
  const rawRows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  // Normalisasi nama kolom: buang spasi berlebih di awal/akhir header
  // (file Excel kadang punya header seperti "pertama diisi " dengan spasi nyasar)
  const rows = rawRows.map((r) => {
    const clean = {};
    for (const key of Object.keys(r)) {
      clean[key.trim()] = r[key];
    }
    return clean;
  });

  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];   // baris yang DILEWATI (tidak masuk database)
  const warnings = []; // baris yang masuk, tapi ada hal yang perlu admin tahu
  const seenImei = new Map(); // imei -> label baris pertama, untuk mendeteksi baris kembar di file

  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const noHp = r['no hp'] || r['No HP'] || r['No Hp'];
    const namaAccount = r['nama account'] || r['Nama Account'];
    if (!noHp || !namaAccount) {
      skipped++;
      continue;
    }

    const rowLabel = `No ${r['No'] != null ? r['No'] : idx + 2}`;
    const noHpStr = String(noHp).trim();
    const imei = normalizeImei(r['imei'] || r['IMEI']);

    try {
      // Cocokkan dengan device yang sudah ada: lewat IMEI; kalau IMEI kosong, lewat No HP.
      const existing = imei ? await findDeviceByImei(imei) : await findDeviceByPhone(noHpStr);

      // No HP tidak boleh dipakai device LAIN (device yang sama boleh, itu berarti update)
      const phoneOwner = await findPhoneConflict(noHpStr, existing ? existing.id : null);
      if (phoneOwner) {
        errors.push(
          `${rowLabel} (${namaAccount}): No HP ${noHpStr} sudah dipakai ${describeDevice(phoneOwner)} - baris dilewati`
        );
        skipped++;
        continue;
      }

      // Baris kembar di dalam file yang sama: yang terakhir menang (data terbaru), tapi diberi tahu
      if (imei) {
        if (seenImei.has(imei)) {
          warnings.push(
            `${rowLabel} (${namaAccount}): IMEI ${imei} sama dengan ${seenImei.get(imei)} - data baris sebelumnya ditimpa baris ini`
          );
        }
        seenImei.set(imei, rowLabel);
      }

      const values = [
        namaAccount,
        r['Kontak Pemilik'] || r['kontak pemilik'] || null,
        r['Device Name'] || r['device name'] || null,
        imei,
        noHpStr,
        excelDateToISO(r['pertama diisi']),
        excelDateToISO(r['Bayar 1 Tahun'] || r['bayar 1 tahun']),
        excelDateToISO(r['setahun saat']),
        excelDateToISO(r['terakhir diisi']),
        excelTimeToStr(r['jam diisi']),
        excelDateToISO(r['akan habis']),
        parseInt(r['jumlah diisi'], 10) || 0,
        JSON.stringify(parseKeterangan(r['Keterangan'] || r['keterangan'])),
      ];

      if (existing) {
        await pool.query(
          `UPDATE devices SET
             nama_account = $1, kontak_pemilik = $2, device_name = $3, imei = $4, no_hp = $5,
             pertama_diisi = $6, bayar_1_tahun = $7, setahun_saat = $8, terakhir_diisi = $9,
             jam_diisi = $10, akan_habis = $11, jumlah_diisi = $12, keterangan_json = $13,
             updated_at = now()
           WHERE id = $14`,
          [...values, existing.id]
        );
        updated++;
      } else {
        await pool.query(
          `INSERT INTO devices
            (nama_account, kontak_pemilik, device_name, imei, no_hp,
             pertama_diisi, bayar_1_tahun, setahun_saat, terakhir_diisi,
             jam_diisi, akan_habis, jumlah_diisi, keterangan_json)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          values
        );
        inserted++;
      }
    } catch (e) {
      errors.push(`${rowLabel} (${namaAccount}): ${e.message}`);
      skipped++;
    }
  }

  return { inserted, updated, skipped, errors, warnings, sheetNames: wb.SheetNames };
}

module.exports = { importFromExcel };

// Tetap bisa dipakai lewat CLI: node src/migrate-excel.js file.xlsx "Nama Sheet"
if (require.main === module) {
  require('dotenv').config();
  const filePath = process.argv[2];
  const sheetName = process.argv[3];
  if (!filePath) {
    console.error('Pakai: node src/migrate-excel.js /path/ke/file.xlsx [nama-sheet]');
    process.exit(1);
  }
  importFromExcel(filePath, sheetName)
    .then((r) => {
      console.log(`Selesai. Baru: ${r.inserted}, diperbarui: ${r.updated}, dilewati: ${r.skipped}`);
      if (r.warnings.length) console.log('Peringatan:', r.warnings);
      if (r.errors.length) console.log('Dilewati:', r.errors);
      process.exit(0);
    })
    .catch((e) => {
      console.error('Migrasi gagal:', e.message);
      process.exit(1);
    });
}
