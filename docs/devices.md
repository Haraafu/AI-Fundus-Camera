# Antarmuka perangkat kamera

**Authentication update:** every camera API request now requires `Authorization: Bearer <camera-token>`. Generate a seven-day token in your signed-in LUXORA account using **Camera token**. Uploads belong to that account. See [authentication](authentication.md). For the CLI set `$env:LUXORA_DEVICE_TOKEN` first. Legacy unauthenticated examples below require this header.


Backend menerima citra melalui HTTP multipart. MQTT dan integrasi kamera fisik belum menjadi bagian implementasi ini. Klien `ESP32-SIM-01` menyimulasikan urutan pengiriman kamera, sedangkan inferensi tetap menggunakan model aktual apabila `AI_MODE=model`.

## Pembagian tanggung jawab

Tim hardware mengatur akuisisi citra, koneksi Wi-Fi, dan kode pengiriman pada perangkat. Tim software menyediakan alamat server, kontrak API, validasi unggahan, pemrosesan AI, penyimpanan hasil, dashboard, serta log penerimaan. Perangkat tidak perlu mengakses MongoDB atau layanan Python secara langsung.

Transport foto menggunakan HTTP multipart/form-data. Wi-Fi adalah koneksi jaringannya, bukan format payload. MQTT untuk status atau perintah dapat diintegrasikan terpisah setelah disepakati bersama tim hardware. Telemetri HTTP yang sudah tersedia dapat dipakai selama persiapan.

## Menjalankan penerima pada Wi-Fi lokal

1. Jalankan layanan AI sesuai mode pada `.env`, lalu pastikan `/ready` berhasil. Konfigurasi database juga harus siap. Panduan utama tetap di README.
2. Dari root proyek, jalankan `npm run backend:lan`. Perintah ini memakai database dan mode AI pada `.env`, tetapi membuka listener backend pada `0.0.0.0`. Tidak ada pengubahan `.env` atau pergantian database otomatis.
3. Pilih alamat IPv4 adaptor Wi-Fi yang dicetak pada terminal. Berikan alamat seperti `http://192.168.1.20:3001` kepada tim hardware. Jangan gunakan `127.0.0.1`, `localhost`, atau `0.0.0.0` sebagai alamat tujuan perangkat.
4. Dari perangkat lain di jaringan yang sama, buka `http://<IP-LAPTOP>:3001/health`. Lanjutkan dengan `/api/system`, pastikan `aiReady=true`, lalu buka `/api/device-contract` untuk kontrak dan batas ukuran aktual.
5. Jika akses terhalang, periksa profil jaringan privat dan izin Windows Firewall untuk Node/port backend pada jaringan tersebut. Guest Wi-Fi atau AP client isolation dapat mencegah komunikasi antarklien. Gunakan jaringan uji atau hotspot yang mengizinkan akses antarklien. Tidak diperlukan port forwarding router atau membuka port AI 8000/8001 ke jaringan.

Alamat server dapat berubah setelah laptop tersambung ulang. Konfirmasi IPv4 sebelum uji bersama. Layanan ini adalah prototipe lokal dengan autentikasi akun; HTTPS disediakan oleh reverse proxy, sehingga gunakan jaringan uji tepercaya dan kode pasien anonim.

`GET /api/device-contract` mengembalikan versi kontrak `fundus-device-http-v1`, endpoint, nama field, batas unggahan, dan kebijakan retry. Endpoint `/health` hanya menguji backend hidup. Kesiapan AI diperiksa melalui `/api/system`.

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

Hanya `image` yang wajib pada request upload. Informasi mata dan jenis capture telah ditetapkan saat pemeriksaan dibuat, sehingga field opsional tersebut harus sama jika dikirim lagi. `device_id` dan `capture_timestamp` disarankan agar sumber citra dapat ditelusuri. Timestamp harus memiliki zona waktu `Z` atau offset `+07:00`. Field yang tidak dikenal atau kosong ditolak. Jangan mengirim foto sebagai JSON/base64 dan jangan menetapkan header multipart boundary secara manual saat menggunakan library HTTP atau curl.

Ukuran citra maksimum 40 megapiksel. JPEG sebaiknya digunakan pada kamera yang memiliki keterbatasan memori. Backend memeriksa isi berkas, bukan hanya ekstensi.

## Contoh pengiriman untuk tim hardware

Jika pemeriksaan sudah dibuat dari dashboard, gunakan `examinationId` yang sama. Jika belum, contoh berikut membuat pemeriksaan anonim, lalu mengirim satu citra dari PowerShell. Ganti alamat server dan path gambar JPEG sesuai perangkat uji.

```powershell
$base = 'http://192.168.1.20:3001'
$headers = @{ Authorization = "Bearer $env:LUXORA_DEVICE_TOKEN" }
Invoke-RestMethod "$base/health" -Headers $headers
Invoke-RestMethod "$base/api/system" -Headers $headers
$metadata = @{ patientId = 'HW-DEMO-001'; eye = 'RIGHT'; captureType = 'MACULA_CENTERED' }
$exam = Invoke-RestMethod "$base/api/examinations" -Headers $headers -Method Post -ContentType 'application/json' -Body ($metadata | ConvertTo-Json)
$imagePath = 'C:\captures\fundus.jpg'
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
curl.exe -H "Authorization: Bearer $env:LUXORA_DEVICE_TOKEN" --connect-timeout 5 --max-time 180 -sS -X POST "$base/api/examinations/$($exam.examinationId)/images" -F "image=@$imagePath;type=image/jpeg" -F 'device_id=CAMERA-01' -F 'eye=RIGHT' -F 'capture_type=MACULA_CENTERED' -F "capture_timestamp=$timestamp"
Invoke-RestMethod "$base/api/examinations/$($exam.examinationId)" -Headers $headers
```

Pada PNG, ubah MIME menjadi `image/png`. Respons berhasil adalah HTTP 200 dengan `status=COMPLETED`, `image`, dan `result`. Upload bersifat sinkron, sehingga koneksi menunggu AI selesai. Sesuaikan waktu tunggu perangkat minimal dengan `recommendedClientTimeoutMs` pada kontrak. Hasil dapat dibuka di `/examinations/<examinationId>` dan PDF melalui `/api/examinations/<examinationId>/report`.

| HTTP / kode | Makna | Tindakan perangkat |
| --- | --- | --- |
| 400 / INVALID_IMAGE | Berkas rusak, MIME salah, atau field image tidak ada | Periksa byte citra dan pembentukan multipart |
| 400 / INVALID_METADATA | Nama field, nilai mata, jenis capture, atau timestamp tidak valid | Perbaiki metadata, lalu periksa status pemeriksaan |
| 404 / EXAMINATION_NOT_FOUND | ID pemeriksaan tidak ditemukan | Konfirmasi ID dari respons pembuatan pemeriksaan |
| 409 / EXAMINATION_LOCKED | Citra sudah diterima atau sedang diproses | Ambil status pemeriksaan. Jangan mengunggah ulang |
| 413 / UPLOAD_TOO_LARGE | Berkas melebihi batas | Kurangi ukuran berkas sesuai batas kontrak |
| 502 / AI_UNAVAILABLE atau AI_TIMEOUT | Penerimaan dapat berhasil, tetapi pemrosesan AI gagal | Ambil pemeriksaan dan error tersimpan untuk penelusuran |

Jika koneksi putus, panggil GET pemeriksaan terlebih dahulu. Status CREATED mengizinkan pengiriman ulang pada ID yang sama. IMAGE_RECEIVED atau PROCESSING berarti tunggu dan periksa lagi. COMPLETED berarti ambil hasilnya. FAILED berarti periksa error dan koordinasikan pemulihan dengan software. Jangan membuat pemeriksaan baru secara otomatis hanya karena respons upload tidak diterima. Pengambilan foto ulang merupakan pemeriksaan baru.

Semua respons membawa header `X-Request-Id`. Log backend mencatat request ID, examination ID, status HTTP, kode kesalahan, durasi, dan waktu penerimaan. Saat melaporkan masalah, sertakan request ID dan status pemeriksaan, tanpa mengirim kredensial atau identitas pribadi pasien.

## Status perangkat

Nilai yang diterima adalah `IDLE`, `READY`, `CAPTURING`, `UPLOADING`, dan `ERROR`. JSON boleh membawa `examinationId` yang sudah ada dan `message` maksimal 240 karakter. Timestamp penerimaan dicatat oleh backend. Endpoint ini mencatat telemetri, bukan perintah kendali kamera atau state machine hardware.

`GET /api/devices` mengembalikan status terakhir dan maksimal 12 perubahan terakhir. Status online berlaku 60 detik sejak heartbeat terakhir. Perangkat sebaiknya mengirim heartbeat setiap 15 detik. Registri status disimpan dalam memori dan kosong setelah backend dimulai ulang, sedangkan `deviceId` dan waktu capture pada metadata citra tetap tersimpan dalam database.

Saat upload sedang berjalan, perangkat boleh mengirim heartbeat `UPLOADING` dari task terpisah. Sesudah hasil diterima, kirim `READY` beserta examination ID. Jika upload timeout, baca status pemeriksaan sebelum mengulang. Pemeriksaan yang sudah menerima citra terkunci untuk mencegah inferensi ganda. Gunakan pemeriksaan baru untuk pengambilan ulang.

## Klien simulasi

```powershell
npm run device:mock -- "colored_images/Severe/299086c6d1b5.png" DEMO-RECORDING ESP32-SIM-01
```

Tambahkan `--watch` untuk mempertahankan heartbeat setelah pengiriman berhasil. Hanya satu citra yang diunggah. Tekan Ctrl+C untuk menghentikannya.

Tujuan dapat diubah dengan `BACKEND_URL`. Untuk LAN, atur `BACKEND_HOST` ke alamat antarmuka yang sesuai, izinkan port backend pada jaringan privat, dan gunakan IP laptop pada kamera. Pengujian LAN dan perangkat fisik harus dilakukan terpisah. API ini masih untuk prototipe lokal dengan autentikasi akun.

Contoh dari laptop pengirim di jaringan Wi-Fi:

```powershell
$env:BACKEND_URL = 'http://192.168.1.20:3001'
npm run device:mock -- 'C:\captures\fundus.jpg' HW-DEMO-001 CAMERA-01 --eye=LEFT --capture-type=OPTIC_DISC_CENTERED
```

Klien memeriksa kesiapan AI dan batas ukuran sebelum membuat pemeriksaan. Selama upload, heartbeat dikirim setiap 15 detik. Jika respons gagal, klien membaca pemeriksaan untuk mengetahui apakah hasil sudah tersimpan, tanpa mengulangi upload otomatis.

Untuk uji bersama, jalankan klien dari laptop kedua pada jaringan Wi-Fi perangkat. Hasil `receiptVerified: true` berarti pemeriksaan berstatus `COMPLETED`, metadata sesuai, dan citra asli yang diunduh kembali memiliki SHA-256 yang sama dengan berkas pengirim. Simpan keluaran terminal untuk mencatat `requestId`, `examinationId`, ukuran berkas, waktu inferensi, dan mode AI. `elapsedMs` mencakup unggahan, pemrosesan, dan verifikasi hasil. Setelah tes laptop kedua berhasil, ulangi uji dengan pengiriman dari perangkat kamera dan periksa hasil pada dashboard.

## Kriteria uji bersama

- Perangkat pengirim dapat menjangkau `/health` dan memperoleh kontrak API dari alamat IPv4 penerima.
- JPEG atau PNG diterima dengan device ID, mata, jenis capture, dan timestamp yang benar.
- Hasil tersimpan dan dapat ditinjau pada dashboard. Mode mock atau model harus dicatat sesuai `/api/system` dan `result.isMock`.
- Berkas tidak valid ditolak dengan respons terstruktur. Pengiriman ganda tidak menghasilkan inferensi kedua.
- Ketika respons terputus, tim dapat memeriksa pemeriksaan yang sama tanpa menggandakan data.

Tes otomatis memverifikasi receiver, kontrak, dan klien simulasi pada mesin lokal. Kelulusannya tidak menggantikan uji antarperangkat melalui Wi-Fi atau uji dengan kamera fisik. Catat waktu pengiriman, ukuran citra, waktu pemrosesan, dan kegagalan pada uji bersama.
