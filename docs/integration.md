# Integrasi dan Validasi Model

Dokumen ini menjelaskan checkpoint yang sedang dipakai aplikasi dan bukti pengujian lokal. Model aktif adalah EfficientNetB3 biner. Belum ada pengujian tambahan bersama tim hardware pada Pekan 12 (9–14 November 2026).

## Model aktif

| Item | Nilai |
|---|---|
| Model | `models/kaggle-binary/combined_dr_binary_b3_v1/best.keras` |
| Versi | `combined-dr-binary-b3-v1-kaggle-v3` |
| Ukuran | 44.497.131 byte (42,44 MiB), ekspor inferensi dalam Git |
| SHA-256 | `d30299156bc174ce77da0aebe9ea5e1a7dd02faec560ae9e96512397a452ab45` |
| Input | `[batch, 300, 300, 3]`, RGB float32, rentang 0–255 |
| Output | `[batch, 2]`, probabilitas berjumlah satu |
| Urutan output | `No DR`, `DR` |
| Runtime terverifikasi | Python 3.11.0, TensorFlow 2.21.0, Keras 3.14.1 |

Label training `No DR` dipetakan menjadi label API `No_DR`. Model biner menyimpan `riskLevel=NOT_ASSESSED` karena tidak menentukan tingkat keparahan. Evaluasi 5.553 citra uji dan keterbatasannya ada di [hasil evaluasi biner](combined-training.md#hasil-evaluasi-model-biner).

Ekspor inferensi mengeluarkan state optimizer dari checkpoint training 178.114.358 byte. Seluruh 499 bobot dan prediksi pada tiga citra lokal identik sebelum dan sesudah ekspor. Checkpoint training biner lengkap diarsipkan lokal di `data/model-archives/` dan tidak masuk Git. Checkpoint lama di folder `models/` sudah dihapus.

Validasi paket biner pada 14 November 2026: 18/18 tes backend dan 13/13 tes Python lulus. Unggahan melalui klien simulasi lokal dengan model ekspor menghasilkan `COMPLETED`, prediksi `DR`, `isMock=false`, dan `riskLevel=NOT_ASSESSED`. Citra asli yang diambil kembali identik dengan berkas pengirim, metadata perangkat tersimpan, dan PDF berhasil dibuat (230.853 byte). Bukti lokal berada di `data/binary-packaging-check/` yang di-ignore. Ini merupakan uji software lokal, bukan uji kamera atau Wi-Fi bersama tim hardware.

## Alur aplikasi

```text
PNG/JPEG
  → backend Express
  → validasi dan penyimpanan original
  → preprocessing fundus-prep-v1
  → TensorFlow model
  → validasi dua probabilitas
  → processed PNG + hasil AI disimpan di SQLite atau MongoDB
  → endpoint examination mengembalikan hasil
```

Mode dipilih melalui `AI_MODE`. Mode `model` tidak pernah beralih diam-diam ke mock ketika checkpoint hilang, gagal dimuat, atau menghasilkan output yang tidak valid.

## Catatan historis: integrasi model lima kelas

Bagian berikut mencatat pengujian model ordinal terdahulu; angka dan contoh di bawah bukan hasil model biner aktif maupun pengujian hardware Pekan 12.

### Contoh hasil aktual model lama

Input referensi: `colored_images/Moderate/000c1434d8d7.png`

```json
{
  "status": "COMPLETED",
  "processedResolution": [300, 300],
  "result": {
    "predictedClass": "Moderate",
    "confidence": 0.5792074799537659,
    "probabilities": {
      "No_DR": 0.003601372241973877,
      "Mild": 0.014766335487365723,
      "Moderate": 0.5792074799537659,
      "Severe": 0.052445173263549805,
      "Proliferative_DR": 0.3499796390533447
    },
    "riskLevel": "MEDIUM",
    "modelVersion": "fundus-b3-ordinal-aptos-v1",
    "isMock": false,
    "preprocessingVersion": "fundus-prep-v1"
  }
}
```

Original dan processed image disimpan dengan nama berbeda. Hasil dapat dibaca kembali dari SQLite melalui endpoint examination.

## Validasi otomatis

| Area | Hasil |
|---|---|
| Load checkpoint dan shape | Lulus |
| Preprocessing dan pemetaan kelas | 10/10 tes Python lulus |
| Backend dan persistensi | 8/8 tes Node lulus |
| Alur model aktual | Smoke test lulus |
| Model hilang | `MODEL_NOT_READY` |
| Model gagal dimuat | `MODEL_LOAD_FAILED` |
| Output probabilitas invalid | `INFERENCE_FAILED` |
| Citra rusak | `INVALID_IMAGE` |
| AI mati atau timeout | Examination menjadi `FAILED` |
| Respons upstream invalid | `INVALID_AI_RESPONSE` |

## Evaluasi model

Pada held-out test 526 citra, checkpoint menghasilkan accuracy 0.8042, macro F1 0.6158, dan quadratic weighted kappa 0.8464. Split mencegah duplikat identik melintasi subset, tetapi bukan patient-level split karena identitas pasien tidak tersedia. Recall kelas Severe masih 0.269. Rincian tersedia di [training.md](training.md).

## Menjalankan sistem

Jalankan dari root repository pada tiga terminal terpisah:

```powershell
.\.venv\Scripts\python.exe -m pip install -r services/ai-service/requirements.txt
.\.venv\Scripts\python.exe services/ai-service/app.py
npm run backend
npm run smoke -- "colored_images/Moderate/000c1434d8d7.png"
```

## Database dan frontend MVP

Dashboard, pasien/riwayat, pemeriksaan baru, dan hasil tersedia pada origin backend `http://127.0.0.1:3001`. MongoDB Atlas digunakan jika `DATABASE_URL` terisi; SQLite tetap tersedia untuk test lokal. Hasil menyimpan `imageId`, timestamp, waktu request inference, kategori risiko dan versi aturan. Metadata citra original/processed menyimpan MIME, ukuran, resolusi, SHA-256, parameter serta versi preprocessing. File masih berada di `UPLOAD_DIR` dan diambil melalui endpoint yang memeriksa examination ID.

Aturan risiko di `apps/backend/src/risk.js` terpisah dari inference. UI menampilkan confidence sebagai probabilitas kelas dan kategori risiko sebagai aturan prototipe, serta penanda MOCK bila model dummy digunakan.

Validasi MVP: 10/10 tes Node lulus. Smoke test dengan model aktual dan MongoDB Atlas menghasilkan examination COMPLETED, `isMock=false`, confidence/probabilitas, metadata gambar dan versi aturan yang dapat dibaca kembali. Halaman dashboard dan hasil diverifikasi di browser dengan gambar original dan processed. Identitas sample uji adalah `DEMO-001` dan gambar berasal dari dataset lokal.

## Grad-CAM dan alur perangkat

Checkpoint APTOS aktif mendukung Grad-CAM pada `efficientnetb3/top_conv`. Implementasi menggunakan fitur konvolusi dan head ordinal yang sama dengan prediksi, lalu menghitung gradien probabilitas kelas terpilih. Aktivasi positif dinormalisasi per citra dan ditampilkan pada ruang koordinat hasil prapemrosesan. Lapisan backbone yang frozen tetap dapat dijelaskan karena input diawasi oleh gradient tape.

Backend menyimpan overlay dan heatmap secara terpisah dengan checksum, sementara metadata penjelasan dicatat bersama hasil model. Hasil lama tidak diubah. Grad-CAM yang gagal diberi status UNAVAILABLE, tanpa mengganti prediksi aktual dengan mock.

Validasi tambahan: 12/12 tes backend, 10/10 tes layanan AI, dan 2/2 tes Grad-CAM lulus. Uji Grad-CAM memakai model kecil dengan aktivasi spasial yang diketahui untuk membuktikan bahwa perubahan kelas target mengubah peta dan gradien nol tidak menghasilkan peta palsu. Smoke test checkpoint aktual dengan klien ESP32-SIM menghasilkan COMPLETED dan Grad-CAM AVAILABLE pada SQLite serta MongoDB Atlas. Metadata device ID dan waktu capture ikut tersimpan. Uji ini menggunakan citra dataset, bukan kamera fisik.

Perintah dan urutan rekaman tersedia pada [panduan demo](demo.md). PDF ditangani anggota tim lain dan tidak diubah dalam implementasi ini. MQTT dan pengujian kamera fisik tetap merupakan pekerjaan lanjutan.

## Prosedur mengganti checkpoint

1. Verifikasi checksum, input shape, output shape, urutan kelas, preprocessing, dan versi runtime model baru.
2. Ubah `MODEL_PATH`, `MODEL_VERSION`, dan `MODEL_CLASS_NAMES` di `.env`.
3. Jalankan tes Python, tes backend, dan smoke test aktual.
4. Perbarui tabel model aktif dan hasil evaluasi pada dokumentasi ini.

Checkpoint aktif masih merupakan artefak riset. Penggunaan klinis membutuhkan review label, patient-level split, validasi eksternal, quality gate citra, kalibrasi threshold, dan persetujuan pihak yang berwenang.
