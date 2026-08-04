require('dotenv').config();
const XLSX = require('xlsx');
const path = require('path');
const { pool } = require('./db');

// Pakai: node src/migrate-excel.js /path/ke/file.xlsx "Nama Sheet"
const filePath = process.argv[2];
const sheetName = process.argv[3];

if (!filePath) {
  console.error('Pakai: node src/migrate-excel.js /path/ke/file.xlsx [nama-sheet]');
  process.exit(1);
}

function excelDateToISO(val) {
  if (!val) return null;
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'number') {
    // serial number Excel
    const d = XLSX.SSF.parse_date_code(val);
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  if (typeof val === 'string') {
    const s = val.trim();
    // format M/D/YYYY
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
    // fraction of a day
    const totalSec = Math.round(val * 86400);
    const h = Math.floor(totalSec / 3600);
    const min = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return null;
}

// Parse "{u:xxx, pe:yyy, p:zzz}" -> {u:"xxx", pe:"yyy", p:"zzz"}
function parseKeterangan(val) {
  if (!val || typeof val !== 'string') return {};
  const inner = val.trim().replace(/^\{/, '').replace(/\}$/, '');
  const result = {};
  inner.split(',').forEach((pair) => {
    const idx = pair.indexOf(':');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) result[key] = value;
  });
  return result;
}

async function migrate() {
  const wb = XLSX.readFile(filePath, { cellDates: true });
  const sheet = wb.Sheets[sheetName || wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: null });

  let inserted = 0;
  let skipped = 0;

  for (const r of rows) {
    const noHp = r['no hp'] || r['No HP'] || r['No Hp'];
    const namaAccount = r['nama account'] || r['Nama Account'];
    if (!noHp || !namaAccount) {
      skipped++;
      continue;
    }

    try {
      await pool.query(
        `INSERT INTO devices
          (nama_account, kontak_pemilik, device_name, imei, no_hp,
           pertama_diisi, bayar_1_tahun, setahun_saat, terakhir_diisi,
           jam_diisi, akan_habis, jumlah_diisi, keterangan_json)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (imei) DO UPDATE SET
           nama_account = EXCLUDED.nama_account,
           kontak_pemilik = EXCLUDED.kontak_pemilik,
           device_name = EXCLUDED.device_name,
           no_hp = EXCLUDED.no_hp,
           pertama_diisi = EXCLUDED.pertama_diisi,
           bayar_1_tahun = EXCLUDED.bayar_1_tahun,
           setahun_saat = EXCLUDED.setahun_saat,
           terakhir_diisi = EXCLUDED.terakhir_diisi,
           jam_diisi = EXCLUDED.jam_diisi,
           akan_habis = EXCLUDED.akan_habis,
           jumlah_diisi = EXCLUDED.jumlah_diisi,
           keterangan_json = EXCLUDED.keterangan_json,
           updated_at = now()`,
        [
          namaAccount,
          r['Kontak Pemilik'] || r['kontak pemilik'],
          r['Device Name'] || r['device name'],
          String(r['imei'] || r['IMEI'] || '').trim(),
          String(noHp).trim(),
          excelDateToISO(r['pertama diisi']),
          excelDateToISO(r['Bayar 1 Tahun'] || r['bayar 1 tahun']),
          excelDateToISO(r['setahun saat']),
          excelDateToISO(r['terakhir diisi']),
          excelTimeToStr(r['jam diisi']),
          excelDateToISO(r['akan habis']),
          parseInt(r['jumlah diisi'], 10) || 0,
          JSON.stringify(parseKeterangan(r['Keterangan'] || r['keterangan'])),
        ]
      );
      inserted++;
    } catch (e) {
      console.error('Gagal insert baris:', namaAccount, e.message);
      skipped++;
    }
  }

  console.log(`Selesai. Berhasil: ${inserted}, dilewati: ${skipped}`);
  process.exit(0);
}

migrate();
