-- Skema database sistem pengisian pulsa GPS Tracker

CREATE TABLE IF NOT EXISTS devices (
  id                  SERIAL PRIMARY KEY,
  nama_account        TEXT NOT NULL,
  kontak_pemilik      TEXT,
  device_name         TEXT,
  imei                TEXT UNIQUE,
  no_hp               TEXT NOT NULL,          -- nomor SIM di GPS tracker yang diisi pulsa
  pertama_diisi       DATE,
  bayar_1_tahun       DATE,                   -- tanggal terakhir bayar perpanjangan tahunan
  setahun_saat        DATE,                   -- jatuh tempo tahunan (bayar_1_tahun + 1 tahun)
  terakhir_diisi      DATE,
  jam_diisi           TIME,
  akan_habis          DATE,                   -- terakhir_diisi + 28 hari
  jumlah_diisi        INTEGER DEFAULT 0,      -- reset ke 1 tiap kali bayar tahunan
  keterangan_json      JSONB,                  -- {u, pe, p} kredensial akun tracker
  status              TEXT DEFAULT 'active',  -- active / nonactive
  created_at          TIMESTAMPTZ DEFAULT now(),
  updated_at          TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_akan_habis ON devices(akan_habis);
CREATE INDEX IF NOT EXISTS idx_devices_setahun_saat ON devices(setahun_saat);

-- Log tiap pengisian pulsa & pembayaran, buat riwayat + audit
CREATE TABLE IF NOT EXISTS fill_logs (
  id           SERIAL PRIMARY KEY,
  device_id    INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  action       TEXT NOT NULL,     -- 'fill' | 'renew_payment'
  action_date  DATE NOT NULL,
  action_time  TIME,
  note         TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- Log notifikasi WA yang sudah dikirim, biar tidak dikirim dobel di hari yang sama
CREATE TABLE IF NOT EXISTS notification_logs (
  id          SERIAL PRIMARY KEY,
  device_id   INTEGER REFERENCES devices(id) ON DELETE CASCADE,
  notif_type  TEXT NOT NULL,      -- 'fill_reminder' | 'billing_reminder'
  sent_date   DATE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE(device_id, notif_type, sent_date)
);

-- Event harian global (dedup notifikasi yang tidak spesifik per-device,
-- misal "ucapan terima kasih semua sudah diisi hari ini")
CREATE TABLE IF NOT EXISTS daily_events (
  event_date  DATE NOT NULL,
  event_type  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (event_date, event_type)
);
