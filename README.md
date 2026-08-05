# Sistem Reminder & Pencatatan Pulsa GPS Tracker

Sistem untuk mengingatkan pengisian pulsa GPS tracker tiap 28 hari dan
pembayaran perpanjangan tahunan, terintegrasi dengan WhatsApp lewat WAHA.

## Fitur

- Dashboard web (list semua device, status jatuh tempo isi & billing) — **dilindungi login**
- Cron harian → kirim WA reminder ke nomor kamu (admin) berisi daftar device
  yang harus diisi pulsa hari ini + link "Tandai selesai" sekali klik
- Reminder billing terpisah saat `jumlah_diisi >= 13` atau `setahun_saat` jatuh tempo
- Opsional: auto-kirim pesan tagihan langsung ke kontak customer (`AUTO_BILL_CUSTOMER=true`)
- Import data Excel lama langsung dari dashboard (upload file, pilih sheet, klik Import)
- Download/export semua data jadi file Excel kapan saja (tombol "📤 Download Excel"), dengan header persis seperti format Excel lama kamu — cocok untuk backup rutin
- Login admin + tombol "Lupa username/password" yang mengirim info login ke WA admin

## Login

Default (ubah di environment variable `ADMIN_USERNAME` / `ADMIN_PASSWORD`):
- Username: `admin`
- Password: `abcd1234`

**Ganti password default ini sebelum deploy ke production**, karena di dalam
dashboard ada banyak data customer. Kalau lupa, klik "Lupa username/password"
di halaman login — sistem akan kirim username & password ke `ADMIN_WA_NUMBER`
lewat WhatsApp.

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
6. **Schema database jalan otomatis** setiap kali container start — tidak perlu masuk
   terminal sama sekali. Kalau karena suatu hal auto-migrate gagal (misal DB belum
   siap saat container pertama kali start), ada tombol **"🛠️ Perbaiki Database"**
   di dashboard buat menjalankan ulang secara manual, atau restart container-nya.

## Alur Harian

1. Jam `CRON_SCHEDULE` (default 07:00 WIB), sistem cek:
   - Device dengan `akan_habis <= hari ini` → kirim **SATU** WA berisi daftar
     semua nomor yang perlu diisi + **satu link** yang menampilkan semuanya
     sekaligus dengan tombol "Tandai Selesai" masing-masing
   - Device dengan `jumlah_diisi >= 13` atau `setahun_saat <= hari ini` → kirim reminder tagih,
     lengkap dengan nama kendaraan & no HP GPS supaya gampang disebutkan ke customer
2. Buka link dari WA → halaman menampilkan semua nomor jatuh tempo hari itu.
   Tandai satu-satu setelah selesai diisi — tombol yang sudah ditekan berubah
   warna jadi "✅ Sudah Diisi" dan tidak bisa dipencet ulang, jadi kamu tidak
   akan salah isi dua kali.
3. Setelah **semua** nomor di link itu ditandai selesai, sistem otomatis kirim
   WA ucapan terima kasih terpisah.
4. Untuk billing: klik link "Tandai sudah bayar" (link individual, dikirim
   dalam satu pesan berisi daftar semua yang perlu ditagih) setelah customer
   transfer → otomatis reset `bayar_1_tahun`, `setahun_saat` (+1 tahun), `jumlah_diisi = 1`
5. Semua ini juga bisa dilakukan manual lewat dashboard web (`/`) tanpa WA,
   kalau kamu sedang buka laptop

## Struktur Tabel Utama (`devices`)

Field mengikuti kolom Excel lama:
`nama_account, kontak_pemilik, device_name, imei, no_hp, pertama_diisi,
bayar_1_tahun, setahun_saat, terakhir_diisi, jam_diisi, akan_habis,
jumlah_diisi, keterangan_json (u/pe/p kredensial akun tracker)`

Riwayat tersimpan di tabel `fill_logs` (tiap pengisian & pembayaran) dan
`notification_logs` (mencegah WA dobel di hari yang sama).

## Tanpa Akses Terminal (Coolify dll)

Kalau terminal di panel hosting kamu tidak bisa dipakai, semuanya tetap bisa jalan:

- **Schema database**: otomatis dijalankan setiap kali server start (aman diulang).
  Kalau perlu re-run manual, klik tombol **"🛠️ Perbaiki Database"** di dashboard.
- **Import data lama**: klik tombol **"📥 Import Excel"** di dashboard, upload file,
  pilih sheet, klik Import.
- **Backup data**: klik tombol **"📤 Download Excel"** di dashboard kapan saja.

Semua operasi di atas bisa dilakukan 100% lewat browser tanpa SSH/terminal.

## Testing Cepat Tanpa Nunggu Cron

```bash
curl -X POST http://localhost:3000/api/run-check
```
Ini memicu pengecekan & kirim WA manual, berguna buat testing sebelum
benar-benar dijadwalkan.

## Kolom Keterangan

Kolom `Keterangan` dari Excel disimpan lengkap (baik catatan bebas seperti
"Pasang baru+1tahun" maupun kredensial akun tracker seperti
`{u:email, pe:xxx, p:xxx}`), tampil di dashboard, dan bisa diedit langsung
dengan klik selnya.

**Catatan penting**: kalau kamu sempat import data sebelum fitur ini
ditambahkan, catatan bebas (non-kredensial) di baris-baris tersebut
kemungkinan sudah hilang karena versi lama sistem cuma paham format
kredensial. **Import ulang file Excel yang sama** dari dashboard untuk
memulihkan catatan tersebut — data lain (nomor, tanggal, dst) tidak akan
kepengaruh karena proses import pakai upsert berdasarkan IMEI.

## Kelola Customer Manual

Selain import dari Excel, kamu bisa tambah/edit customer langsung dari dashboard:

- **➕ Tambah Customer**: buka form kosong, isi minimal Nama Account & No HP,
  field lain opsional.
- **Edit** (tombol biru di kolom Aksi tiap baris): buka form yang sudah
  terisi data device tersebut, ubah field yang perlu, simpan.
- Validasi otomatis: Nama Account & No HP wajib diisi, dan kalau IMEI yang
  dimasukkan sudah dipakai device lain, sistem akan menolak dengan pesan
  yang jelas (bukan error teknis).
