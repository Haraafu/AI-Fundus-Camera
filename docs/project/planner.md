# Weekly Planner Software Despro 2

**Project:** Perancangan dan Implementasi Sistem Kamera Fundus Berbasis AI untuk Deteksi Multi-Penyakit dengan 9 Kategori Risiko Kesehatan  
**Fokus:** Sisi Software  
**Periode:** Pekan 2 sampai 28 Oktober 2026  
**Target akhir:** Pada 28 Oktober 2026, sistem software sudah terintegrasi dengan hardware dan siap diuji secara end-to-end.

## Asumsi Dasar

- Dataset sudah diperoleh sejak Despro 1.
- Pipeline preprocessing sudah berjalan dengan baik.
- Training ulang EfficientNetB3 untuk mengurangi overfitting sedang dikerjakan paralel oleh anggota tim lain.
- Model EfficientNetB3 final belum diterima pada Pekan 4. File model lokal belum dianggap sebagai artefak final yang sudah diserahkan dan diverifikasi.
- Backend Despro 2 dijalankan secara lokal.
- Source code disimpan di GitHub agar mudah dipindahkan dan dijalankan di perangkat lain.
- Integrasi hardware dilakukan melalui jaringan lokal/LAN, bukan cloud.
- Fokus awal dipercepat agar Oktober lebih banyak digunakan untuk integrasi, debugging, dan stabilisasi.

---

# A. Weekly Planner Software

| Pekan | Periode | Fokus | Pekerjaan Utama | Target Luaran |
|---|---|---|---|---|
| **Pekan 2** | **31 Agustus - 5 September 2026** | **Development Environment & Repository Setup** | Install VS Code dan Git; setup repository GitHub; import kode preprocessing Despro 1; review kembali arsitektur software; memastikan environment lokal siap digunakan | Repository aktif; Git dan VS Code siap; preprocessing tersedia di repository |
| **Pekan 3** | **7 - 12 September 2026** | **Backend Foundation & Mock AI Integration** | Merapikan struktur repository; membuat backend Node.js + Express; membuat struktur AI service; menentukan kontrak API antara backend dan AI; membuat endpoint upload citra; membuat mock/dummy AI response; membuat struktur status examination; menyiapkan `.env.example`; mulai schema database lokal/terhubung | Backend dapat menerima citra dan menjalankan alur awal menggunakan mock AI tanpa menunggu model EfficientNetB3 final |
| **Pekan 4** | **14 - 19 September 2026** | **Kesiapan Integrasi Tanpa Model Final** | Verifikasi alur backend → AI mock → SQLite → result; modularisasi preprocessing per citra; kunci kontrak input/output, urutan kelas, versi, dan penanda mock; siapkan adapter model serta checklist serah terima; catat hasil uji error | Demo lokal dengan hasil **mock** yang jelas; kontrak dan preprocessing siap diuji; daftar dependensi model final terdokumentasi |
| **Pekan 5** | **21 - 26 September 2026** | **Integrasi EfficientNetB3 Final** | Terima dan verifikasi paket model final; samakan preprocessing dan urutan kelas; muat model pada AI service; ganti adapter mock dengan inference aktual secara eksplisit; simpan probabilitas dan versi model; uji upload → prediksi → database serta kegagalan model | **Target: citra diproses oleh model final dan menghasilkan prediksi aktual yang tersimpan**, dengan bukti uji dan versi model |
| **Pekan 6** | **28 September - 3 Oktober 2026** | **Database, Risk Scoring & Frontend MVP** | Rapikan metadata original/processed image, prediction, confidence, dan versi; pisahkan aturan risiko dari prediksi; buat halaman patient, examination, dan result; tampilkan status/error | Full software MVP lokal menampilkan hasil model aktual dan data pemeriksaan tanpa hardware, bila integrasi Pekan 5 lulus |
| **Pekan 7** | **5 - 10 Oktober 2026** | **Grad-CAM, PDF & Hardware Interface** | Implementasi Grad-CAM pada model terintegrasi; buat PDF; tentukan format upload ESP32, device ID, metadata, dan status/MQTT; buat mock device client | Visualisasi Grad-CAM, PDF, dan mock device siap diuji bersama pipeline |
| **Pekan 8** | **12 - 17 Oktober 2026** | **Local Network & Device Communication Testing** | Menjalankan backend di laptop lokal menggunakan IP LAN; testing request dari perangkat lain; implement MQTT backend; testing status `IDLE`, `READY`, `CAPTURING`, `UPLOADING`, `ERROR`; timeout dan retry handling; pengujian multipart upload | Mock hardware → backend lokal → AI → database → dashboard → PDF berjalan end-to-end |
| **Pekan 9** | **19 - 24 Oktober 2026** | **Integrasi Hardware Asli** | Menghubungkan ESP32/fundus camera asli ke backend melalui Wi-Fi/LAN; uji image upload; sinkronisasi metadata; debugging network, format image, timeout, ukuran file, dan memory; repeated capture testing | Hardware asli berhasil mengirim citra hingga hasil tampil pada dashboard |
| **Pekan 10** | **26 - 28 Oktober 2026** | **Stabilization, Bug Fixing, dan Demo Freeze** | Full end-to-end testing; perbaikan bug terakhir; latency measurement; validasi error handling; logging; pengecekan repository; dokumentasi cara menjalankan sistem di device lain; freeze versi demo | **28 Oktober 2026: software stabil, terintegrasi dengan hardware, dapat dijalankan secara lokal, dan siap demo** |

---

## Milestone Internal

Agar proyek tidak mepet, target internal ditetapkan lebih awal dari deadline akhir.

| Deadline | Milestone |
|---|---|
| **12 September 2026** | Backend dasar + mock AI berjalan |
| **19 September 2026** | Alur mock dan database terverifikasi; kontrak model, preprocessing, dan checklist serah terima tertulis |
| **26 September 2026** | **Target integrasi model final:** inference aktual berjalan dari upload sampai hasil tersimpan, dengan probabilitas, versi model, dan bukti pengujian |
| **3 Oktober 2026** | Database, risk scoring, dan frontend MVP menampilkan hasil model aktual tanpa hardware |
| **10 Oktober 2026** | Grad-CAM, PDF, hardware API, dan mock device siap |
| **17 Oktober 2026** | Simulasi hardware melalui LAN berhasil end-to-end |
| **24 Oktober 2026** | Hardware asli sudah terintegrasi |
| **28 Oktober 2026** | Stabilization dan demo-ready |

---

