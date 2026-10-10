# Antarmuka perangkat kamera

Backend menerima citra melalui HTTP multipart. MQTT dan integrasi kamera fisik belum menjadi bagian implementasi ini. Klien `ESP32-SIM-01` menyimulasikan urutan pengiriman kamera, sedangkan inferensi tetap menggunakan model aktual apabila `AI_MODE=model`.

## Kontrak pengiriman

1. Kirim status melalui `POST /api/devices/:deviceId/status`, JSON `{"status":"READY"}`.
2. Buat pemeriksaan melalui `POST /api/examinations` dengan `patientId`, `eye`, dan `captureType`.
3. Simpan `examinationId` yang dikembalikan backend.
4. Kirim citra ke `POST /api/examinations/:id/images` sebagai multipart.
5. Baca hasil melalui `GET /api/examinations/:id`.

| Field multipart | Nilai |
| --- | --- |
| `image` | Berkas JPEG atau PNG, maksimum sesuai `MAX_UPLOAD_BYTES` |
| `device_id` | Kode perangkat 1–64 karakter, huruf, angka, `_`, atau `-` |
| `eye` | `LEFT` atau `RIGHT`, harus cocok dengan pemeriksaan |
| `capture_type` | `MACULA_CENTERED` atau `OPTIC_DISC_CENTERED`, harus cocok dengan pemeriksaan |
| `capture_timestamp` | Timestamp ISO 8601 dari perangkat, misalnya `2026-10-10T01:00:00+07:00` |

Ukuran citra maksimum 40 megapiksel. JPEG sebaiknya digunakan pada kamera yang memiliki keterbatasan memori. Backend memeriksa isi berkas, bukan hanya ekstensi.

## Status perangkat

Nilai yang diterima adalah `IDLE`, `READY`, `CAPTURING`, `UPLOADING`, dan `ERROR`. JSON boleh membawa `examinationId` yang sudah ada dan `message` maksimal 240 karakter. Timestamp penerimaan dicatat oleh backend. Endpoint ini mencatat telemetri, bukan perintah kendali kamera atau state machine hardware.

`GET /api/devices` mengembalikan status terakhir dan maksimal 12 perubahan terakhir. Status online berlaku 60 detik sejak heartbeat terakhir. Perangkat sebaiknya mengirim heartbeat setiap 15 detik. Registri status disimpan dalam memori dan kosong setelah backend dimulai ulang, sedangkan `deviceId` dan waktu capture pada metadata citra tetap tersimpan dalam database.

Saat upload sedang berjalan, perangkat boleh mengirim heartbeat `UPLOADING` dari task terpisah. Sesudah hasil diterima, kirim `READY` beserta examination ID. Jika upload timeout, baca status pemeriksaan sebelum mengulang. Pemeriksaan yang sudah menerima citra terkunci untuk mencegah inferensi ganda. Gunakan pemeriksaan baru untuk pengambilan ulang.

## Klien simulasi

```powershell
npm run device:mock -- "colored_images/Severe/299086c6d1b5.png" DEMO-RECORDING ESP32-SIM-01
```

Tambahkan `--watch` untuk mempertahankan heartbeat setelah pengiriman berhasil. Hanya satu citra yang diunggah. Tekan Ctrl+C untuk menghentikannya.

Tujuan dapat diubah dengan `BACKEND_URL`. Untuk LAN, atur `BACKEND_HOST` ke alamat antarmuka yang sesuai, izinkan port backend pada jaringan privat, dan gunakan IP laptop pada kamera. Pengujian LAN dan perangkat fisik harus dilakukan terpisah. API ini masih untuk prototipe lokal tanpa autentikasi.
