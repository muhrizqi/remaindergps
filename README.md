# Sistem Reminder & Pencatatan Pulsa GPS Tracker

Sistem untuk mengingatkan pengisian pulsa GPS tracker tiap 28 hari dan
pembayaran perpanjangan tahunan, terintegrasi dengan WhatsApp lewat WAHA.

## Fitur

- Dashboard web (list semua device, status jatuh tempo isi & billing)
- Cron harian → kirim WA reminder ke nomor kamu (admin) berisi daftar device
  yang harus diisi pulsa hari ini + link "Tandai selesai" sekali klik
- Reminder billing terpisah saat `jumlah_diisi >= 13` atau `setahun_saat` jatuh tempo
- Opsional: auto-kirim pesan tagihan langsung ke kontak customer (`AUTO_BILL_CUSTOMER=true`)
- Migrasi data dari Excel lama ke Postgres

## Setup Lokal / Development

```bash
cp .env.example .env
# edit .env: DATABASE_URL, WAHA_BASE_URL, WAHA_API_KEY, ADMIN_WA_NUMBER, JWT_SECRET

npm install
docker compose up -d postgres
npm run migrate:schema

# import data lama dari excel
npm run migrate:excel -- /path/ke/file.xlsx "Nama Sheet"

npm start
```

Dashboard: http://localhost:3000

## Deploy ke EasyPanel (mengikuti pola project futsal-booking)

1. Push repo ini ke GitHub (repo baru, mis. `gps-pulsa-system`)
2. Di EasyPanel: buat App baru dari GitHub repo, pilih Dockerfile build
3. Tambahkan service Postgres (atau reuse instance Postgres yang sudah ada,
   asal buat database baru `gps_pulsa`)
4. Set environment variables sesuai `.env.example`:
   - `DATABASE_URL` → connection string Postgres di EasyPanel
   - `WAHA_BASE_URL` & `WAHA_API_KEY` → **pakai instance WAHA yang sudah ada**
     di infrastruktur `lewat.web.id` (yang dipakai futsal-booking)
   - `WAHA_SESSION` → nama session WA yang sudah login
   - `ADMIN_WA_NUMBER` → nomor WA kamu sendiri, format `62xxxxxxxxxx@c.us`
   - `BASE_URL` → domain publik app ini, misal `https://gps.lewat.web.id`
5. Set subdomain `gps.lewat.web.id` mengarah ke app ini (via Zoraxy/EasyPanel)
6. Setelah container jalan, exec masuk container sekali untuk:
   ```bash
   npm run migrate:schema
   npm run migrate:excel -- /path/di/dalam/container/file.xlsx
   ```
   (upload file Excel dulu ke container, atau jalankan migrasi dari lokal
   mengarah ke DATABASE_URL production)

## Alur Harian

1. Jam `CRON_SCHEDULE` (default 07:00 WIB), sistem cek:
   - Device dengan `akan_habis <= hari ini` → kirim reminder isi pulsa ke WA kamu
   - Device dengan `jumlah_diisi >= 13` atau `setahun_saat <= hari ini` → kirim reminder tagih
2. Tiap device di pesan WA ada link `https://.../u/<token>` yang aman
   (kadaluwarsa otomatis di akhir hari), tinggal klik dari HP setelah selesai isi pulsa
3. Klik link → halaman konfirmasi ringkas → tekan tombol → otomatis update
   `terakhir_diisi`, `jam_diisi`, `jumlah_diisi +1`, `akan_habis` (+28 hari)
4. Untuk billing: klik link "Tandai sudah bayar" setelah customer transfer →
   otomatis reset `bayar_1_tahun`, `setahun_saat` (+1 tahun), `jumlah_diisi = 1`
5. Semua ini juga bisa dilakukan manual lewat dashboard web (`/`) tanpa WA,
   kalau kamu sedang buka laptop

## Struktur Tabel Utama (`devices`)

Field mengikuti kolom Excel lama:
`nama_account, kontak_pemilik, device_name, imei, no_hp, pertama_diisi,
bayar_1_tahun, setahun_saat, terakhir_diisi, jam_diisi, akan_habis,
jumlah_diisi, keterangan_json (u/pe/p kredensial akun tracker)`

Riwayat tersimpan di tabel `fill_logs` (tiap pengisian & pembayaran) dan
`notification_logs` (mencegah WA dobel di hari yang sama).

## Testing Cepat Tanpa Nunggu Cron

```bash
curl -X POST http://localhost:3000/api/run-check
```
Ini memicu pengecekan & kirim WA manual, berguna buat testing sebelum
benar-benar dijadwalkan.
