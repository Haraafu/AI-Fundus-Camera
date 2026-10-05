# Kontrak API

Planner final menjadi acuan jadwal; PRD menjadi acuan arsitektur. Endpoint lokal HTTP, loopback secara default. Autentikasi, HTTPS/LAN, quality gate klinis, Grad-CAM, dan dashboard ada di tahap berikutnya.

## Backend

Frontend tersedia di `/dashboard`, `/patients`, `/patients/:patientId`, `/examinations/new`, dan `/examinations/:id` pada origin backend yang sama.

`GET /api/system`: jenis storage dan mode AI yang dikonfigurasi (tanpa kredensial).

`GET /api/patients`: daftar kode pasien dan createdAt. `POST /api/patients`: JSON `{ "patientId": "PT-00001" }`, membuat pasien tanpa pemeriksaan atau mengembalikan pasien yang sudah ada.

`GET /api/examinations`: riwayat, terbaru dahulu; filter opsional `?patientId=PT-00001`.

`GET /api/examinations/:id/images/original` dan `/processed`: mengambil gambar yang terikat pada pemeriksaan tersebut. Cache dinonaktifkan; folder uploads tidak dibuka sebagai direktori publik.

`GET /health`: 200 `{ "status": "healthy", "service": "backend" }`. Ini liveness backend, bukan readiness AI.

`POST /api/examinations`: JSON `{"patientId":"DEMO-001","eye":"RIGHT","captureType":"MACULA_CENTERED"}` → 201 examination. patientId adalah kode anonim 1–64 karakter alfanumerik/underscore/dash; Patient minimal otomatis dibuat jika belum ada. Eye LEFT/RIGHT, captureType MACULA_CENTERED/OPTIC_DISC_CENTERED.

`POST /api/examinations/:id/images`: multipart `image` wajib PNG/JPEG, maksimal 10 MiB default; file benar-benar didecode, maksimal 40 juta piksel. Opsional `eye`, `capture_type` harus cocok dengan pemeriksaan; `device_id` kode 1–64 karakter; `capture_timestamp` timestamp yang dapat diparse. Backend menyimpan byte original tanpa perubahan lalu mengirim file multipart ke Python. Respons sinkron 200 examination lengkap setelah inference selesai.

`GET /api/examinations/:id`: 200 examination tersimpan, 404 jika tidak ada.

Status: CREATED → IMAGE_RECEIVED → PROCESSING → COMPLETED/FAILED. Setiap transisi tercatat pada statusHistory. Input tidak valid tetap CREATED; kegagalan AI menjadi FAILED. Satu citra per examination pada pekan 3; upload ulang/bersamaan menghasilkan 409. Buat examination baru untuk retake. Restart mengubah proses yang tertinggal menjadi FAILED/PROCESS_INTERRUPTED.

Examination: examinationId, patientId, eye, captureType, status, createdAt, completedAt (null sampai sukses), image, result, error, statusHistory.

Image: imageId, originalPath (nama file relatif terhadap UPLOAD_DIR), mimeType, sizeBytes, originalResolution, eye, captureType, deviceId, capturedAt, processedPath, preprocessingVersion, preprocessingParameters, processedResolution. Pada respons sukses, preprocessing nyata menghasilkan PNG terpisah untuk mode mock maupun model. Jika inference gagal sebelum hasil preprocessing diterima, processedPath tetap null.

Result: predictedClass, confidence, probabilities, riskLevel, modelVersion, isMock, preprocessingVersion. Label kanonis `No_DR`, `Mild`, `Moderate`, `Severe`, `Proliferative_DR`. Folder dataset lama `Proliferate_DR` dipetakan ke `Proliferative_DR` oleh adapter model. Lihat [kontrak model](model-contract.md).

Result baru juga menyimpan `imageId`, `createdAt`, dan `riskRuleVersion`. Backend menghitung kategori risiko lewat `risk.js` terpisah dari prediksi AI: No_DR/Mild → LOW, Moderate → MEDIUM, Severe/Proliferative_DR → HIGH. Versi aturan `dr-grade-risk-v1` adalah aturan kategori prototipe; confidence adalah probabilitas kelas, bukan skor risiko klinis tervalidasi. Data lama tanpa versi ditampilkan sebagai legacy.

Error: `{ "success": false, "error": { "code": "...", "message": "..." } }`. Status 400 input tidak valid, 404 tidak ditemukan, 409 examination terkunci, 413 terlalu besar, 502 kegagalan/timeout/kontrak AI tidak valid, 500 internal/storage error. Citra original tetap tersimpan bila inference gagal.

## AI Python

`GET /health`: HTTP 200 untuk liveness; memuat mode, ready, modelLoaded, modelVersion, isMock, preprocessingVersion, errorCode. `GET /ready`: 200 jika adapter terpilih siap; 503 jika checkpoint mode model hilang atau gagal dimuat. `AI_MODE=mock` adalah default template. `AI_MODE=model` memuat `MODEL_PATH` dan tidak pernah jatuh kembali ke mock.

`POST /predict`: multipart `image` PNG/JPEG. 200:

```json
{
  "success": true,
  "isMock": true,
  "prediction": {"class": "Moderate", "confidence": 0.81},
  "probabilities": {"No_DR": 0.02, "Mild": 0.07, "Moderate": 0.81, "Severe": 0.08, "Proliferative_DR": 0.02},
  "riskLevel": "MEDIUM",
  "modelVersion": "mock-v0",
  "preprocessingVersion": "fundus-prep-v1",
  "preprocessing": {
    "version": "fundus-prep-v1",
    "outputResolution": [300, 300],
    "parameters": { "colorSpace": "RGB", "externalNormalization": "none" },
    "mimeType": "image/png",
    "imageBase64": "<PNG-base64>"
  }
}
```

Dalam mode mock, semua citra valid menghasilkan prediksi dummy yang sama. Dalam mode model, probabilitas berasal dari checkpoint TensorFlow yang dikonfigurasi dan dipetakan ke label kanonis. Contoh parameters di atas diringkas; lihat kontrak model untuk parameter lengkap. Python menolak corrupt/format salah (400), file terlalu besar (413), multipart tanpa image (422 validasi FastAPI), dan model belum siap (503 MODEL_NOT_READY atau MODEL_LOAD_FAILED). Backend menerjemahkan kegagalan service menjadi error 502 tanpa rincian internal. Mode mock/aktual yang tidak cocok dengan konfigurasi backend dan citra hasil preprocessing yang tidak valid menghasilkan INVALID_AI_RESPONSE.

## Penyimpanan

Tanpa `DATABASE_URL`, backend memakai SQLite bawaan Node: patients(patientId PK, createdAt), examinations(examinationId PK, patientId FK, document JSON), fundus_images(imageId PK, examinationId FK, document JSON), ai_results(examinationId PK/FK, document JSON). Jika `DATABASE_URL` berisi URI MongoDB, backend memakai koleksi `patients`, `examinations`, `fundus_images`, dan `ai_results` pada database `DATABASE_NAME` (default `ai_fundus`). Perubahan satu examination disimpan dalam transaksi. File original tetap berada di `UPLOAD_DIR`; database hanya menyimpan metadata dan referensi path.
